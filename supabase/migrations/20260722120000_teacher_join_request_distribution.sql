-- Stage 2 of the new onboarding flow: atomic distribution of a pending teacher_join_request
-- into one or more courses/groups. Does not touch student_courses -- real course access stays
-- group_students -> groups.course_id, same invariant as Stage 1 and the old invite flow.
-- teacher_students keeps its active/archived meaning; teacher_join_requests keeps its
-- pending/approved/rejected/cancelled meaning. group_type enum is not touched: "individual"
-- already existed for the individual-group case, "group" is reused for new mini-groups.

-- Idempotency ledger for the distribution flow, mirroring invite_flow_requests but kept as a
-- separate table: a distribution's target (join_request_id, assignments) is a different shape
-- of "unit of work" than an invite-flow send, and folding them into one table would make the
-- status/result columns ambiguous between two unrelated flows.
CREATE TABLE public.distribution_flow_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  join_request_id uuid REFERENCES public.teacher_join_requests(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (teacher_id, request_id)
);
-- No table-level grants to anon/authenticated -- only the SECURITY DEFINER RPC below touches it,
-- same closed-table pattern as teacher_join_links / teacher_join_requests / invite_flow_requests.
REVOKE ALL ON public.distribution_flow_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.distribute_join_request(p_join_request_id uuid, p_assignments jsonb, p_request_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jr public.teacher_join_requests%ROWTYPE;
  v_teacher_id uuid;
  v_teacher_profile_id uuid;
  v_student_id uuid;
  v_student_full_name text;
  v_existing jsonb;
  v_item jsonb;
  v_course_id uuid;
  v_mode text;
  v_seen_courses uuid[] := '{}';
  v_course RECORD;
  v_grp public.groups%ROWTYPE;
  v_group_id uuid;
  v_group_created boolean;
  v_already_assigned boolean;
  v_cnt int;
  v_max int;
  v_title text;
  v_schedule_days text[];
  v_schedule_time text;
  v_assignments_out jsonb := '[]'::jsonb;
  v_ts_id uuid;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001'; END IF;

  -- Lock the join request row up front: this serializes any concurrent distribute attempt on
  -- the same request (the second caller blocks here until the first commits or rolls back, then
  -- re-reads a non-pending status and is rejected below -- no explicit advisory lock needed).
  SELECT * INTO v_jr FROM public.teacher_join_requests WHERE id = p_join_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOIN_REQUEST_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  IF NOT (public.is_admin_or_owner() OR EXISTS (
    SELECT 1 FROM public.teachers t WHERE t.id = v_jr.teacher_id AND t.profile_id = v_uid
  )) THEN
    RAISE EXCEPTION 'FORBIDDEN: not your join request' USING ERRCODE = 'P0001';
  END IF;

  v_teacher_id := v_jr.teacher_id;
  SELECT profile_id INTO v_teacher_profile_id FROM public.teachers WHERE id = v_teacher_id;
  v_student_id := v_jr.student_id;

  -- Idempotency claim comes BEFORE the pending-status gate: a replay with the same
  -- request_id must still return the original envelope even though the join request is no
  -- longer 'pending' by then (the first, successful call already flipped it to 'approved').
  -- Checking status first would reject every legitimate retry after a successful first call.
  IF p_request_id IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.distribution_flow_requests
      WHERE teacher_id = v_teacher_id AND request_id = p_request_id AND status = 'completed';
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

    BEGIN
      INSERT INTO public.distribution_flow_requests (teacher_id, request_id, join_request_id, status)
      VALUES (v_teacher_id, p_request_id, p_join_request_id, 'pending');
    EXCEPTION WHEN unique_violation THEN
      -- a concurrent tx claimed the same key; by the time we get past its lock it has
      -- committed (or rolled back, leaving nothing), so its completed result is readable now.
      SELECT result INTO v_existing FROM public.distribution_flow_requests
        WHERE teacher_id = v_teacher_id AND request_id = p_request_id;
      IF v_existing IS NULL THEN RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS' USING ERRCODE = 'P0001'; END IF;
      RETURN v_existing;
    END;
  END IF;

  IF v_jr.status <> 'pending' THEN
    RAISE EXCEPTION 'REQUEST_ALREADY_PROCESSED: %', v_jr.status USING ERRCODE = 'P0001';
  END IF;

  SELECT p.full_name INTO v_student_full_name
  FROM public.students s JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.id = v_student_id;
  IF v_student_full_name IS NULL THEN RAISE EXCEPTION 'STUDENT_MISSING' USING ERRCODE = 'P0001'; END IF;

  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' OR jsonb_array_length(p_assignments) = 0 THEN
    RAISE EXCEPTION 'NO_ASSIGNMENTS' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_assignments) LOOP
    v_course_id := NULLIF(v_item->>'course_id', '')::uuid;
    v_mode := v_item->>'mode';
    IF v_course_id IS NULL THEN RAISE EXCEPTION 'INVALID_ASSIGNMENT: course_id required' USING ERRCODE = 'P0001'; END IF;
    IF v_mode NOT IN ('individual', 'existing_group', 'new_group') THEN
      RAISE EXCEPTION 'INVALID_ASSIGNMENT: unknown mode %', v_mode USING ERRCODE = 'P0001';
    END IF;
    IF v_course_id = ANY(v_seen_courses) THEN
      RAISE EXCEPTION 'DUPLICATE_COURSE_IN_REQUEST' USING ERRCODE = 'P0001';
    END IF;
    v_seen_courses := v_seen_courses || v_course_id;

    SELECT id, is_active INTO v_course FROM public.courses
    WHERE id = v_course_id AND owner_id = v_teacher_profile_id;
    IF v_course.id IS NULL OR NOT v_course.is_active THEN
      RAISE EXCEPTION 'COURSE_NOT_AVAILABLE' USING ERRCODE = 'P0001';
    END IF;

    v_group_created := false;
    v_already_assigned := false;

    -- Structural dedup: is this student already a member of one of this teacher's active
    -- groups for this course? Never rely on group name matching.
    SELECT g.id INTO v_group_id
    FROM public.groups g
    JOIN public.group_students gs ON gs.group_id = g.id
    WHERE g.teacher_id = v_teacher_id AND g.course_id = v_course_id AND g.is_active
      AND gs.student_id = v_student_id
    LIMIT 1;

    IF v_group_id IS NOT NULL THEN
      v_already_assigned := true;
    ELSIF v_mode = 'individual' THEN
      -- Reuse an existing individual group for this exact teacher/student/course triple if one
      -- exists (structural check above already covers this -- reaching here means none does).
      INSERT INTO public.groups (name, course_id, teacher_id, type)
      VALUES ('Индивидуально · ' || btrim(v_student_full_name), v_course_id, v_teacher_id, 'individual')
      RETURNING id INTO v_group_id;
      v_group_created := true;
      INSERT INTO public.group_students (group_id, student_id) VALUES (v_group_id, v_student_id)
        ON CONFLICT ON CONSTRAINT group_students_group_id_student_id_key DO NOTHING;

    ELSIF v_mode = 'existing_group' THEN
      v_group_id := NULLIF(v_item->>'group_id', '')::uuid;
      IF v_group_id IS NULL THEN RAISE EXCEPTION 'INVALID_ASSIGNMENT: group_id required' USING ERRCODE = 'P0001'; END IF;

      SELECT * INTO v_grp FROM public.groups WHERE id = v_group_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
      IF v_grp.teacher_id IS DISTINCT FROM v_teacher_id THEN RAISE EXCEPTION 'FORBIDDEN: not your group' USING ERRCODE = 'P0001'; END IF;
      IF v_grp.course_id IS DISTINCT FROM v_course_id THEN RAISE EXCEPTION 'GROUP_COURSE_MISMATCH' USING ERRCODE = 'P0001'; END IF;
      IF NOT v_grp.is_active THEN RAISE EXCEPTION 'GROUP_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;

      SELECT count(*) INTO v_cnt FROM public.group_students WHERE group_id = v_grp.id;
      IF v_cnt >= v_grp.max_students THEN
        RAISE EXCEPTION 'GROUP_ALREADY_FULL: % / % мест', v_cnt, v_grp.max_students USING ERRCODE = 'P0001';
      END IF;

      INSERT INTO public.group_students (group_id, student_id) VALUES (v_group_id, v_student_id)
        ON CONFLICT ON CONSTRAINT group_students_group_id_student_id_key DO NOTHING;

    ELSE -- new_group
      v_max := NULLIF(v_item->>'max_students', '')::int;
      IF v_max IS NULL OR v_max < 1 THEN RAISE EXCEPTION 'MAX_STUDENTS_REQUIRED' USING ERRCODE = 'P0001'; END IF;

      v_title := NULLIF(btrim(coalesce(v_item->>'title', '')), '');
      IF v_title IS NULL THEN
        SELECT 'Мини-группа · ' || c.title INTO v_title FROM public.courses c WHERE c.id = v_course_id;
      END IF;

      IF v_item ? 'schedule_days' AND jsonb_typeof(v_item->'schedule_days') = 'array' THEN
        SELECT array_agg(x) INTO v_schedule_days FROM jsonb_array_elements_text(v_item->'schedule_days') x;
      ELSE
        v_schedule_days := NULL;
      END IF;
      v_schedule_time := NULLIF(v_item->>'schedule_time', '');

      INSERT INTO public.groups (name, course_id, teacher_id, type, max_students, schedule_days, schedule_time)
      VALUES (v_title, v_course_id, v_teacher_id, 'group', v_max, v_schedule_days, v_schedule_time::time)
      RETURNING id INTO v_group_id;
      v_group_created := true;

      INSERT INTO public.group_students (group_id, student_id) VALUES (v_group_id, v_student_id)
        ON CONFLICT ON CONSTRAINT group_students_group_id_student_id_key DO NOTHING;
    END IF;

    v_assignments_out := v_assignments_out || jsonb_build_object(
      'course_id', v_course_id,
      'group_id', v_group_id,
      'mode', CASE WHEN v_already_assigned THEN 'already_assigned' ELSE v_mode END,
      'group_created', v_group_created,
      'already_assigned', v_already_assigned
    );
  END LOOP;

  INSERT INTO public.teacher_students AS ts (teacher_id, student_id, source_invite_id)
  VALUES (v_teacher_id, v_student_id, NULL)
  ON CONFLICT ON CONSTRAINT teacher_students_teacher_id_student_id_key
  DO UPDATE SET status = 'active', updated_at = now()
  RETURNING ts.id INTO v_ts_id;

  UPDATE public.teacher_join_requests SET status = 'approved', reviewed_at = now(), reviewed_by = v_uid
  WHERE id = p_join_request_id;

  v_result := jsonb_build_object(
    'join_request_id', p_join_request_id,
    'student_id', v_student_id,
    'teacher_student_id', v_ts_id,
    'assignments', v_assignments_out,
    'status', 'approved'
  );

  IF p_request_id IS NOT NULL THEN
    UPDATE public.distribution_flow_requests
    SET status = 'completed', result = v_result, completed_at = now()
    WHERE teacher_id = v_teacher_id AND request_id = p_request_id;
  END IF;

  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.distribute_join_request(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.distribute_join_request(uuid, jsonb, uuid) TO authenticated;
