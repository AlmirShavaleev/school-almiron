-- Точечный ремонт данных для реально сообщённого инцидента: группа "Группа курса",
-- лениво созданная course_join_accept ДО фикса fix_student_roster_visibility_for_course_owner,
-- осталась с teacher_id = null. RLS-дыра уже закрыта (auth_is_course_owner fallback),
-- но на странице ученика "ПРЕПОДАВАТЕЛЬ: Не назначен" всё ещё будет показываться,
-- пока teacher_id не проставлен. Чиним только эту группу — единственную из
-- обнаруженных orphan-групп с реальным участником (member_count=1); остальные
-- orphan-группы на проде пустые (0 участников), их не трогаем.
DO $$
DECLARE v_rows int;
BEGIN
  UPDATE public.groups g
  SET teacher_id = 'ce993e6b-ccd9-478d-9036-64ca38566b54'
  WHERE g.id = 'b0de3558-0d4d-42f5-a9ea-4b56ad6acec1'
    AND g.teacher_id IS NULL
    AND g.curator_id IS NULL
    AND g.course_id = '3a19df7f-def9-4dcb-ab33-6741de8101af'
    AND EXISTS (SELECT 1 FROM public.courses c WHERE c.id = g.course_id AND c.owner_id = 'd1000000-0000-0000-0000-000000000001')
    AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = 'ce993e6b-ccd9-478d-9036-64ca38566b54' AND t.profile_id = 'd1000000-0000-0000-0000-000000000001');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'REPAIR_PRECONDITION_FAILED: expected exactly 1 row updated, got %', v_rows USING ERRCODE = 'P0001';
  END IF;
END $$;
