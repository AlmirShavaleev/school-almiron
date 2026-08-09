-- Правка политик из 20260809114602 по факту разведки.
--
-- `auth_is_staff_of_student` требует, чтобы у ученика была строка в
-- group_students: она ходит group_students → groups → course_is_staff. На
-- проде эта таблица сейчас пуста (данные чистили), и предикат в одиночку
-- запирал заметки ДАЖЕ платформенному админу — при том что саму карточку
-- ученика он открывает.
--
-- Правильный вопрос «видит ли этот человек этого ученика» в проекте уже
-- отвечен на таблице `students`: `is_admin_or_owner() OR
-- auth_is_staff_of_student(id)`. Берём ровно его — заметка не может быть
-- доступна шире, чем сам ученик, и не может быть уже.
drop policy if exists student_feedback_notes_staff_select on public.student_feedback_notes;
drop policy if exists student_feedback_notes_staff_insert on public.student_feedback_notes;

create policy student_feedback_notes_staff_select
  on public.student_feedback_notes
  for select to authenticated
  using (
    public.is_admin_or_owner()
    or public.auth_is_staff_of_student(student_id)
  );

create policy student_feedback_notes_staff_insert
  on public.student_feedback_notes
  for insert to authenticated
  with check (
    (public.is_admin_or_owner() or public.auth_is_staff_of_student(student_id))
    and kind = 'saved'
    and author_id = auth.uid()
  );
