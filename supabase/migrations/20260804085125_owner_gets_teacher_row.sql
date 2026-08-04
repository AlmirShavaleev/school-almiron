-- Владелец школы ведёт курсы со своего аккаунта — заводим ему строку в teachers.
--
-- profiles.role ОСТАЁТСЯ 'admin'. Это ключевое: get_my_role(),
-- is_admin_or_owner() и все построенные на них политики продолжают видеть
-- администратора. Права не сужаются и не расширяются.
--
-- Почему голая строка ничего не даёт: каждая политика, читающая teachers,
-- приходит к строке через ССЫЛКУ на неё — groups.teacher_id (course_is_staff,
-- groups_update_teacher_owned, modules/topics/topic_materials_manage_teacher),
-- lessons.teacher_id, homeworks.created_by, teacher_join_links.teacher_id,
-- teacher_join_requests.teacher_id, teacher_students.teacher_id. Строка, на
-- которую не ссылается ничего, не открывает ни одного нового ряда.
-- Оживает ровно одно: _current_teacher_id() перестаёт возвращать NULL.
--
-- Состояние ДО (снято с прода 2026-08-04): в teachers 7 строк — пять
-- demoteacher1..5@demo.local, physics@demo.ru, math@demo.ru; строки с
-- profile_id = 4972e1a0-4e4b-489b-8f84-5f735b597c11 нет.
--
-- Точный откат:
--   delete from public.teachers
--    where id = 'b7c41d38-9a52-4f60-8e13-2c6a5d094f77'
--      and profile_id = '4972e1a0-4e4b-489b-8f84-5f735b597c11';
--
-- Снимок-таблица не заводится осознанно: операция — один INSERT в таблицу с
-- UNIQUE(profile_id), id задан литералом, поэтому откат точен без снимка.
-- Снимки (как catalog_*_backup_20260803) нужны массовым UPDATE, здесь их нет.

insert into public.teachers (id, profile_id, subjects, is_active)
values (
  'b7c41d38-9a52-4f60-8e13-2c6a5d094f77'::uuid,
  '4972e1a0-4e4b-489b-8f84-5f735b597c11'::uuid,
  '{}'::subject_type[],
  true
)
on conflict (profile_id) do nothing;
