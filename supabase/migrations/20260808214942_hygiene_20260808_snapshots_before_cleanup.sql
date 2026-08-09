-- Снимки ПЕРЕД уборкой 08.08 (решение владельца через оркестратора).
--
-- Удаляются: три пробных курса («Тестовый курс», «10», «егэ») со всем
-- содержимым, 24 записи auth.users без профиля, три групповых снимка 03.08.
-- Каталожные снимки и multichoice не трогаются.
--
-- Снимки сняты ДО удаления и по каждой таблице, которую задевает каскад —
-- иначе восстанавливать будет нечем: course_delete_execute чистит по цепочке,
-- и после него узнать, что там было, неоткуда.
--
-- Все снимки закрыты от ролей приложения: это архив, а не данные.

create schema if not exists cleanup_20260808;
revoke all on schema cleanup_20260808 from anon, authenticated;

do $$
declare
  v_courses uuid[] := array[
    '3a19df7f-def9-4dcb-ab33-6741de8101af',  -- Тестовый курс
    'd3a7f3f8-1e20-455b-9768-1a46c12c0680',  -- 10
    'e0e1a1bf-5ba5-4f74-9429-11d156a933d5'   -- егэ
  ]::uuid[];
begin
  create table cleanup_20260808.courses as
    select * from public.courses where id = any(v_courses);

  create table cleanup_20260808.modules as
    select * from public.modules where course_id = any(v_courses);

  create table cleanup_20260808.topics as
    select t.* from public.topics t
     join public.modules m on m.id = t.module_id where m.course_id = any(v_courses);

  create table cleanup_20260808.topic_material_items as
    select i.* from public.topic_material_items i
     join cleanup_20260808.topics t on t.id = i.topic_id;

  create table cleanup_20260808.topic_homework as
    select h.* from public.topic_homework h
     join cleanup_20260808.topics t on t.id = h.topic_id;

  create table cleanup_20260808.topic_homework_files as
    select f.* from public.topic_homework_files f
     join cleanup_20260808.topic_homework h on h.id = f.homework_id;

  create table cleanup_20260808.topic_homework_attempts as
    select a.* from public.topic_homework_attempts a
     join cleanup_20260808.topic_homework h on h.id = a.homework_id;

  create table cleanup_20260808.topic_homework_attempt_files as
    select f.* from public.topic_homework_attempt_files f
     join cleanup_20260808.topic_homework_attempts a on a.id = f.attempt_id;

  create table cleanup_20260808.topic_homework_reviews as
    select r.* from public.topic_homework_reviews r
     join cleanup_20260808.topic_homework_attempts a on a.id = r.attempt_id;

  create table cleanup_20260808.topic_test_assignments as
    select ta.* from public.topic_test_assignments ta
     join cleanup_20260808.topics t on t.id = ta.topic_id;

  create table cleanup_20260808.groups as
    select * from public.groups where course_id = any(v_courses);

  create table cleanup_20260808.group_students as
    select gs.* from public.group_students gs
     join cleanup_20260808.groups g on g.id = gs.group_id;
end $$;

-- Аккаунты без профиля: только то, что нужно для опознания и разбора
-- сценария брошенных регистраций. Пароли и токены не копируем.
create table cleanup_20260808.auth_users_without_profile as
  select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
         u.raw_user_meta_data
    from auth.users u
    left join public.profiles p on p.id = u.id
   where p.id is null;

-- Групповые снимки 03.08 копируются целиком перед сносом: они сами архив,
-- но выбрасывать архив без копии — то же самое, что удалять без снимка.
create table cleanup_20260808.groups_cleanup_backup_20260803 as
  select * from public.groups_cleanup_backup_20260803;
create table cleanup_20260808.group_students_cleanup_backup_20260803 as
  select * from public.group_students_cleanup_backup_20260803;
create table cleanup_20260808.enrollment_invites_cleanup_backup_20260803 as
  select * from public.enrollment_invites_cleanup_backup_20260803;

-- Пути файлов на момент до удаления: course_delete_execute вернёт только
-- осиротевшие, а здесь остаётся полная картина.
create table cleanup_20260808.storage_paths as
  select 'topic-materials'::text as bucket, i.storage_path as path
    from cleanup_20260808.topic_material_items i where i.storage_path is not null
  union all
  select 'topic-homework', f.storage_path
    from cleanup_20260808.topic_homework_files f where f.storage_path is not null
  union all
  select 'topic-homework-attempts', f.storage_path
    from cleanup_20260808.topic_homework_attempt_files f where f.storage_path is not null;
