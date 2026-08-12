-- Правка чтения по факту проб (та же яма, что в §111.3).
--
-- `auth_is_staff_of_student` ходит через `group_students` → `groups` →
-- `course_is_staff`, а на проде `group_students` пуст: у ученика нет строки в
-- группе, и предикат честно отвечает «никто». В итоге платформенный админ
-- открывал карточку ученика (§111), но его самоотметки не видел — данные
-- расходились между двумя экранами об одном человеке.
--
-- Берём ровно то условие, которым отвечает на тот же вопрос таблица
-- `students`: `is_admin_or_owner() OR auth_is_staff_of_student(id)`. Никакой
-- новой формулировки — она была бы пятой копией правила.
--
-- Пишущие политики НЕ трогаем: самоотметку ставит и снимает только сам ученик,
-- чужой рукой она обесценивается.
drop policy if exists topic_section_marks_select on public.topic_section_marks;

create policy topic_section_marks_select
  on public.topic_section_marks
  for select to authenticated
  using (
    student_id = public.auth_student_id()
    or public.is_admin_or_owner()
    or public.auth_is_staff_of_student(student_id)
  );
