-- Fix for the "Курсы ученика" legacy-source bug: adds a course/group assignment path for a
-- student who is ALREADY an active teacher_students member (no pending teacher_join_request
-- exists for them, so distribute_join_request cannot be reused as-is -- it requires a locked,
-- pending join_request row). This does not touch onboarding: teacher_join_requests and
-- distribute_join_request are untouched. Mirrors the same per-assignment logic (course
-- ownership check, structural already-assigned dedup, individual/existing_group/new_group)
-- so both entry points behave identically; the only difference is what gates access
-- (an active teacher_students row here, a pending join_request there) and that this path
-- never touches teacher_join_requests. Idempotency reuses distribution_flow_requests
-- (join_request_id stays NULL for this path -- the column is already nullable).
CREATE OR REPLACE FUNCTION public.distribute_student_courses(p_student_id uuid, p_assignments jsonb, p_request_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_teacher_id uuid;
  v_teacher_profile_id uuid;
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
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001'; END IF;

  SELECT t.id INTO v_teacher_id FROM public.teachers t WHERE t.profile_id = v_uid;
  IF v_teacher_id IS NULL THEN RAISE EXCEPTION 'TEACHER_ROW_MISSING' USING ERRCODE = 'P0001'; END IF;
  v_teacher_profile_id := v_uid;

  -- Ownership gate: caller must have an ACTIVE teacher_students link to this student (locked,
  -- so a concurrent archive can't race past this check).
  PERFORM 1 FROM public.teacher_students ts
    WHERE ts.teacher_id = v_teacher_id AND ts.student_id = p_student_id AND ts.status = 'active'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN: not your student' USING ERRCODE = 'P0001'; END IF;

  -- Idempotency claim (same pattern as distribute_join_request): read-if-completed, else
  -- claim the (teacher_id, request_id) key first.
  IF p_request_id IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.distribution_flow_requests
      WHERE teacher_id = v_teacher_id AND request_id = p_request_id AND status = 'completed';
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

    BEGIN
      INSERT INTO public.distribution_flow_requests (teacher_id, request_id, join_request_id, status)
      VALUES (v_teacher_id, p_request_id, NULL, 'pending');
    EXCEPTION WHEN unique_violation THEN
      SELECT result INTO v_existing FROM public.distribution_flow_requests
        WHERE teacher_id = v_teacher_id AND request_id = p_request_id;
      IF v_existing IS NULL THEN RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS' USING ERRCODE = 'P0001'; END IF;
      RETURN v_existing;
    END;
  END IF;

  SELECT p.full_name INTO v_student_full_name
  FROM public.students s JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.id = p_student_id;
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

    SELECT g.id INTO v_group_id
    FROM public.groups g
    JOIN public.group_students gs ON gs.group_id = g.id
    WHERE g.teacher_id = v_teacher_id AND g.course_id = v_course_id AND g.is_active
      AND gs.student_id = p_student_id
    LIMIT 1;

    IF v_group_id IS NOT NULL THEN
      v_already_assigned := true;
    ELSIF v_mode = 'individual' THEN
      INSERT INTO public.groups (name, course_id, teacher_id, type)
      VALUES ('Индивидуально · ' || btrim(v_student_full_name), v_course_id, v_teacher_id, 'individual')
      RETURNING id INTO v_group_id;
      v_group_created := true;
      INSERT INTO public.group_students (group_id, student_id) VALUES (v_group_id, p_student_id)
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

      INSERT INTO public.group_students (group_id, student_id) VALUES (v_group_id, p_student_id)
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

      INSERT INTO public.group_students (group_id, student_id) VALUES (v_group_id, p_student_id)
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

  v_result := jsonb_build_object(
    'student_id', p_student_id,
    'assignments', v_assignments_out,
    'status', 'ok'
  );

  IF p_request_id IS NOT NULL THEN
    UPDATE public.distribution_flow_requests
    SET status = 'completed', result = v_result, completed_at = now()
    WHERE teacher_id = v_teacher_id AND request_id = p_request_id;
  END IF;

  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.distribute_student_courses(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.distribute_student_courses(uuid, jsonb, uuid) TO authenticated;
