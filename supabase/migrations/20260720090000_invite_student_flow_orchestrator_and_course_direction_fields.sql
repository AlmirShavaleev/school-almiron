-- Unified "Пригласить ученика" orchestration.
-- Direction = (courses.subject, courses.exam_type) -- no separate directions table.
-- Format reuses group_type: individual | group (mini-group). No is_personal flag.

ALTER TABLE public.courses ADD COLUMN is_draft boolean NOT NULL DEFAULT false;
ALTER TABLE public.courses ADD COLUMN is_default_for_direction boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX courses_default_direction_uq
  ON public.courses (owner_id, subject, exam_type) WHERE is_default_for_direction;

CREATE OR REPLACE FUNCTION public._direction_label(p_subject public.subject_type, p_exam public.exam_type)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT (CASE p_subject
            WHEN 'physics' THEN 'Физика' WHEN 'math' THEN 'Математика'
            WHEN 'algebra' THEN 'Алгебра' WHEN 'geometry' THEN 'Геометрия'
            WHEN 'probability_statistics' THEN 'Вероятность и статистика' ELSE p_subject::text END)
    || ' · ' ||
         (CASE p_exam
            WHEN 'ege' THEN 'ЕГЭ' WHEN 'oge' THEN 'ОГЭ'
            WHEN 'grade_7' THEN '7 класс' WHEN 'grade_8' THEN '8 класс' WHEN 'grade_9' THEN '9 класс'
            WHEN 'grade_10' THEN '10 класс' WHEN 'grade_11' THEN '11 класс' ELSE p_exam::text END)
$$;
REVOKE ALL ON FUNCTION public._direction_label(public.subject_type, public.exam_type) FROM PUBLIC, anon, authenticated;

-- Atomic orchestrator: resolve/create course for direction, create individual group or
-- new/existing mini-group, then issue the invite via the unchanged create_student_invite.
-- Course resolution order:
--   existing group chosen -> its course
--   explicit p_course_id  -> validated eligible course
--   default course for (owner, subject, exam_type)
--   exactly one non-draft matching course -> use it
--   several matching, no default -> COURSE_SELECTION_REQUIRED (frontend shows compact picker)
--   none -> reuse existing draft for direction, else create a new draft (deduplicated)
CREATE OR REPLACE FUNCTION public.invite_student_flow(
  p_full_name text,
  p_format text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_class_grade text DEFAULT NULL,
  p_subject public.subject_type DEFAULT NULL,
  p_exam_type public.exam_type DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_course_id uuid DEFAULT NULL
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
  v_inv RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='P0001'; END IF;
  IF btrim(coalesce(p_full_name,'')) = '' THEN RAISE EXCEPTION 'INVALID_DATA: full_name required' USING ERRCODE='P0001'; END IF;
  IF p_format NOT IN ('individual','mini_group') THEN RAISE EXCEPTION 'INVALID_FORMAT' USING ERRCODE='P0001'; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'teacher' THEN RAISE EXCEPTION 'ONLY_TEACHER_CAN_INVITE' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_teacher_id FROM public.teachers WHERE profile_id = v_uid;
  IF v_teacher_id IS NULL THEN RAISE EXCEPTION 'TEACHER_ROW_MISSING' USING ERRCODE='P0001'; END IF;

  IF p_group_id IS NOT NULL THEN
    IF NOT public.auth_is_teacher_of_group(p_group_id) THEN RAISE EXCEPTION 'FORBIDDEN: not your group' USING ERRCODE='P0001'; END IF;
    SELECT course_id INTO v_course_id FROM public.groups WHERE id = p_group_id;
    IF v_course_id IS NULL THEN RAISE EXCEPTION 'GROUP_HAS_NO_COURSE' USING ERRCODE='P0001'; END IF;
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
          SELECT id INTO v_course_id FROM public.courses
          WHERE owner_id = v_uid AND subject = v_subj AND exam_type = v_exam AND is_draft = true
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

  RETURN jsonb_build_object(
    'invite_id', v_inv.invite_id, 'token', v_inv.token, 'short_code', v_inv.short_code, 'expires_at', v_inv.expires_at,
    'group_id', v_group_id, 'course_id', v_course_id,
    'course_created', v_course_created, 'group_created', v_group_created, 'draft_course', v_is_draft
  );
END; $$;
REVOKE ALL ON FUNCTION public.invite_student_flow(text,text,text,text,text,public.subject_type,public.exam_type,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_student_flow(text,text,text,text,text,public.subject_type,public.exam_type,uuid,uuid) TO authenticated;
