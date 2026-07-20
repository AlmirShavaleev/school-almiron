-- Stabilization patch for invite_student_flow:
--  * server-side idempotency via invite_flow_requests (UNIQUE teacher_id + request_id)
--  * draft course reuse only when is_draft AND is_active
--  * block invite into an already-full existing group at issue time (no reservation)

CREATE TABLE public.invite_flow_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  invite_id uuid REFERENCES public.enrollment_invites(id) ON DELETE SET NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (teacher_id, request_id)
);
ALTER TABLE public.invite_flow_requests ENABLE ROW LEVEL SECURITY;
-- No policies + no grants: only the SECURITY DEFINER orchestrator (postgres-owned) touches it.
REVOKE ALL ON public.invite_flow_requests FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.invite_student_flow(text,text,text,text,text,public.subject_type,public.exam_type,uuid,uuid);

CREATE OR REPLACE FUNCTION public.invite_student_flow(
  p_full_name text,
  p_format text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_class_grade text DEFAULT NULL,
  p_subject public.subject_type DEFAULT NULL,
  p_exam_type public.exam_type DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_course_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_teacher_id uuid;
  v_course_id uuid;
  v_group_id uuid;
  v_course_created boolean := false;
  v_group_created boolean := false;
  v_is_draft boolean := false;
  v_subj public.subject_type;
  v_exam public.exam_type;
  v_match_count int;
  v_max int;
  v_cnt int;
  v_inv RECORD;
  v_result jsonb;
  v_existing jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;
  IF btrim(coalesce(p_full_name,'')) = '' THEN RAISE EXCEPTION 'INVALID_DATA: full_name required' USING ERRCODE='P0001'; END IF;
  IF p_format NOT IN ('individual','mini_group') THEN RAISE EXCEPTION 'INVALID_FORMAT' USING ERRCODE='P0001'; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'teacher' THEN RAISE EXCEPTION 'ONLY_TEACHER_CAN_INVITE' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_teacher_id FROM public.teachers WHERE profile_id = v_uid;
  IF v_teacher_id IS NULL THEN RAISE EXCEPTION 'TEACHER_ROW_MISSING' USING ERRCODE='P0001'; END IF;

  -- ── idempotency claim (see report for race-safety) ──
  IF p_request_id IS NOT NULL THEN
    SELECT result INTO v_existing FROM public.invite_flow_requests
      WHERE teacher_id = v_teacher_id AND request_id = p_request_id AND status = 'completed';
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

    BEGIN
      INSERT INTO public.invite_flow_requests (teacher_id, request_id, status)
      VALUES (v_teacher_id, p_request_id, 'pending');
    EXCEPTION WHEN unique_violation THEN
      -- a concurrent tx claimed the same key; by the time the blocked INSERT resolves with
      -- unique_violation, that tx has committed -> its completed result is now readable.
      SELECT result INTO v_existing FROM public.invite_flow_requests
        WHERE teacher_id = v_teacher_id AND request_id = p_request_id;
      IF v_existing IS NULL THEN RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS' USING ERRCODE='P0001'; END IF;
      RETURN v_existing;
    END;
  END IF;

  IF p_group_id IS NOT NULL THEN
    IF NOT public.auth_is_teacher_of_group(p_group_id) THEN RAISE EXCEPTION 'FORBIDDEN: not your group' USING ERRCODE='P0001'; END IF;
    SELECT course_id INTO v_course_id FROM public.groups WHERE id = p_group_id;
    IF v_course_id IS NULL THEN RAISE EXCEPTION 'GROUP_HAS_NO_COURSE' USING ERRCODE='P0001'; END IF;
    -- capacity check at issue time (do not reserve a seat, just refuse issuing into a full group)
    SELECT max_students INTO v_max FROM public.groups WHERE id = p_group_id;
    SELECT count(*) INTO v_cnt FROM public.group_students WHERE group_id = p_group_id;
    IF v_cnt >= v_max THEN RAISE EXCEPTION 'GROUP_ALREADY_FULL: % / % мест', v_cnt, v_max USING ERRCODE='P0001'; END IF;
    v_group_id := p_group_id;
  ELSE
    IF p_subject IS NULL OR p_exam_type IS NULL THEN RAISE EXCEPTION 'DIRECTION_REQUIRED' USING ERRCODE='P0001'; END IF;
    v_subj := p_subject; v_exam := p_exam_type;

    IF p_course_id IS NOT NULL THEN
      SELECT id INTO v_course_id FROM public.courses
      WHERE id = p_course_id AND owner_id = v_uid AND subject = v_subj AND exam_type = v_exam;
      IF v_course_id IS NULL THEN RAISE EXCEPTION 'COURSE_NOT_ELIGIBLE' USING ERRCODE='P0001'; END IF;
    ELSE
      SELECT id INTO v_course_id FROM public.courses
      WHERE owner_id = v_uid AND subject = v_subj AND exam_type = v_exam AND is_default_for_direction LIMIT 1;

      IF v_course_id IS NULL THEN
        SELECT count(*) INTO v_match_count FROM public.courses
        WHERE owner_id = v_uid AND subject = v_subj AND exam_type = v_exam AND is_draft = false;

        IF v_match_count = 1 THEN
          SELECT id INTO v_course_id FROM public.courses
          WHERE owner_id = v_uid AND subject = v_subj AND exam_type = v_exam AND is_draft = false LIMIT 1;
        ELSIF v_match_count > 1 THEN
          RAISE EXCEPTION 'COURSE_SELECTION_REQUIRED' USING ERRCODE='P0001';
        ELSE
          -- reuse only an ACTIVE draft; never resurrect an archived/inactive one
          SELECT id INTO v_course_id FROM public.courses
          WHERE owner_id = v_uid AND subject = v_subj AND exam_type = v_exam AND is_draft = true AND is_active = true
          ORDER BY created_at LIMIT 1;
          IF v_course_id IS NULL THEN
            INSERT INTO public.courses (title, subject, exam_type, owner_id, is_draft, is_active)
            VALUES ('Черновик · ' || public._direction_label(v_subj, v_exam), v_subj, v_exam, v_uid, true, true)
            RETURNING id INTO v_course_id;
            v_course_created := true;
          END IF;
          v_is_draft := true;
        END IF;
      END IF;
    END IF;

    IF p_format = 'individual' THEN
      INSERT INTO public.groups (name, course_id, teacher_id, type)
      VALUES ('Индивидуально · ' || btrim(p_full_name), v_course_id, v_teacher_id, 'individual')
      RETURNING id INTO v_group_id;
    ELSE
      INSERT INTO public.groups (name, course_id, teacher_id, type)
      VALUES (public._direction_label(v_subj, v_exam) || ' · мини-группа', v_course_id, v_teacher_id, 'group')
      RETURNING id INTO v_group_id;
    END IF;
    v_group_created := true;
  END IF;

  SELECT * INTO v_inv FROM public.create_student_invite(v_group_id, p_full_name, p_email, p_phone, p_class_grade);

  v_result := jsonb_build_object(
    'invite_id', v_inv.invite_id, 'token', v_inv.token, 'short_code', v_inv.short_code, 'expires_at', v_inv.expires_at,
    'group_id', v_group_id, 'course_id', v_course_id,
    'course_created', v_course_created, 'group_created', v_group_created, 'draft_course', v_is_draft
  );

  IF p_request_id IS NOT NULL THEN
    UPDATE public.invite_flow_requests
    SET status = 'completed', course_id = v_course_id, group_id = v_group_id, invite_id = v_inv.invite_id,
        result = v_result, completed_at = now()
    WHERE teacher_id = v_teacher_id AND request_id = p_request_id;
  END IF;

  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.invite_student_flow(text,text,text,text,text,public.subject_type,public.exam_type,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_student_flow(text,text,text,text,text,public.subject_type,public.exam_type,uuid,uuid,uuid) TO authenticated;
