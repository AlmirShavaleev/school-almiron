-- Колонка «привязан Telegram» в списке учеников. Решение владельца 2026-08-04.
--
-- Преподаватель не может читать telegram_connections: политики пускают только
-- к своей строке (tc_select_own) либо платформенного админа (tc_select_admin).
-- Поэтому definer-функция — по образцу topic_homework_notify_targets (§75).
--
-- Отдаёт РОВНО boolean: ни chat_id, ни имени в телеграме, ни времени привязки.
-- Список ученикам не раздаётся целиком — функция отвечает только по тем id,
-- которые ей передали, и только если вызывающий имеет право видеть этого
-- ученика. Условие доступа взято ровно из политики students_select_admin,
-- чтобы не заводить третью формулировку одного и того же правила.
--
-- Чужие id в массиве не ошибка, а просто отсутствие строки в ответе: клиент
-- показывает прочерк. Так проще, чем падать на первом же ученике, которого
-- преподаватель видеть не должен.

create or replace function public.students_telegram_flags(p_student_ids uuid[])
returns table(student_id uuid, telegram_linked boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select s.id,
         exists (select 1 from telegram_connections tc
                  where tc.profile_id = s.profile_id and tc.is_enabled)
    from students s
   where s.id = any(p_student_ids)
     and s.profile_id is not null
     and (public.is_admin_or_owner() or public.auth_is_staff_of_student(s.id));
$function$;

revoke all on function public.students_telegram_flags(uuid[]) from public, anon;
grant execute on function public.students_telegram_flags(uuid[]) to authenticated;
