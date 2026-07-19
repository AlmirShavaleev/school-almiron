CREATE OR REPLACE FUNCTION public._assign_teacher_on_group_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_teacher_count int;
  v_teacher_id uuid;
BEGIN
  IF NEW.teacher_id IS NOT NULL THEN RETURN NEW; END IF;
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'teacher' THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_teacher_count FROM public.teachers WHERE profile_id = v_uid;
  IF v_teacher_count = 0 THEN
    RAISE EXCEPTION 'TEACHER_ROW_MISSING: no teachers row for profile %', v_uid USING ERRCODE = 'P0001';
  ELSIF v_teacher_count > 1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_TEACHER_ROW: multiple teachers rows for profile %', v_uid USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_teacher_id FROM public.teachers WHERE profile_id = v_uid;
  NEW.teacher_id := v_teacher_id;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._assign_teacher_on_group_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER assign_teacher_on_group_insert BEFORE INSERT ON public.groups
FOR EACH ROW EXECUTE FUNCTION public._assign_teacher_on_group_insert();

-- point repair: only the confirmed 10А group, only if all preconditions still hold
DO $$
DECLARE v_rows int;
BEGIN
  UPDATE public.groups g
  SET teacher_id = 'b8857b8c-6ffd-4664-9eb0-5a6de4d6b558'
  WHERE g.id = '029c2f9d-b274-4fc4-877e-b1bfe3af7f62'
    AND g.teacher_id IS NULL
    AND g.course_id = 'e0e1a1bf-5ba5-4f74-9429-11d156a933d5'
    AND EXISTS (SELECT 1 FROM public.courses c WHERE c.id = g.course_id AND c.owner_id = 'd1000000-0000-0000-0000-000000000005')
    AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = 'b8857b8c-6ffd-4664-9eb0-5a6de4d6b558' AND t.profile_id = 'd1000000-0000-0000-0000-000000000005');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_FAILED: expected exactly 1 row updated, got %', v_rows USING ERRCODE = 'P0001';
  END IF;
END $$;
