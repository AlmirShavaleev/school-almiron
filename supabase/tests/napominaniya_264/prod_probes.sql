-- §264. Пробы на ПРОДЕ после применения PENDING_264 (MCP execute_sql). Только чтение; set_config — отдельным
-- оператором (CLAUDE.md §29.4). Подставить: <T> — profiles.id учителя 11А, <O> — постороннего учителя,
-- <S> — profiles.id ученика 11А, <C> — courses.id курса 11А.

-- 1. Права: кандидаты — только service_role; сводка — authenticated, не anon.
select f.fn, has_function_privilege('anon', f.fn, 'execute') as anon,
       has_function_privilege('authenticated', f.fn, 'execute') as auth,
       has_function_privilege('service_role', f.fn, 'execute') as service
  from (values ('public.student_reminder_candidates(timestamptz, text[])'), ('public.course_summary_for_staff(uuid)')) f(fn);
-- ожидание: кандидаты f/f/t; сводка f/t/(любое)

-- 2. Таблица и колонки на месте, политики — три (select/insert/update), RLS включена.
select relrowsecurity from pg_class where oid = 'public.course_reminder_settings'::regclass;
select policyname, cmd from pg_policies where tablename = 'course_reminder_settings' order by 1;
select column_name, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'notification_prefs' and column_name like 'remind_%' order by 1;

-- 3. Задание крона: одно, */5, URL функции, секрет из vault (значение не печатать — только признак).
select jobname, schedule, command like '%functions/v1/student-reminders%' as url_ok,
       command like '%vault.decrypted_secrets%' as secret_from_vault
  from cron.job where jobname = 'student-reminders';

-- 4. Кандидаты под service_role: сколько и каких видов сейчас (без персональных данных), время.
set role service_role;
select c->>'kind' as kind, count(*) as n,
       count(*) filter (where (c->>'course_on')::boolean and (c->>'student_on')::boolean) as enabled
  from jsonb_array_elements(public.student_reminder_candidates(now(), null)->'candidates') c group by 1 order by 1;
explain (analyze, timing off, summary on) select public.student_reminder_candidates(now(), null);
reset role;

-- 5. Сводка: учитель курса — ответ и время; посторонний учитель — 42501.
begin;
select set_config('request.jwt.claims', '{"sub":"<T>","role":"authenticated"}', true);
set local role authenticated;
explain (analyze, timing off, summary on) select public.course_summary_for_staff('<C>');
select jsonb_array_length(x->'students') as students, round(length(x::text) / 1024.0) as kb, x->>'forecast_enabled' as fc
  from (select public.course_summary_for_staff('<C>') x) q;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"<O>","role":"authenticated"}', true);
set local role authenticated;
select public.course_summary_for_staff('<C>');  -- ожидание: ERROR 42501 ACCESS_DENIED
rollback;

-- 6. Ученик не видит настроек курса и не может их писать.
begin;
select set_config('request.jwt.claims', '{"sub":"<S>","role":"authenticated"}', true);
set local role authenticated;
select count(*) from public.course_reminder_settings;  -- ожидание: 0
rollback;

-- 7. Через сутки работы: напоминания по видам и статусам, никому больше 2 в день.
select payload->>'kind' as kind, status, count(*) from notification_queue
 where event_type = 'student_reminder' and created_at > now() - interval '1 day' group by 1, 2 order by 1, 2;
select count(*) as over_limit from (
  select profile_id, (scheduled_for at time zone 'Europe/Moscow')::date, count(*) from notification_queue
   where event_type = 'student_reminder' and status in ('pending', 'processing', 'sent') group by 1, 2 having count(*) > 2) x;
