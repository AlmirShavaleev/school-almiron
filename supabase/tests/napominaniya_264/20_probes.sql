-- §264. Пробы PENDING_264 на локальном слепке. Роль и claims — ОТДЕЛЬНЫМИ операторами (CLAUDE.md §29.4),
-- каждая проба прав — под ролью authenticated/anon/service_role (под владельцем таблиц права не проверяются).
-- Записи — в откатываемых транзакциях. День напоминаний D = 05.10.2026 (МСК), см. 10_data_264.sql.
\pset footer off
\set ON_ERROR_STOP off
\set CR '\'30000000-0000-4000-8264-000000000001\''
\set CM '\'30000000-0000-4000-8000-000000000001\''
\set CP '\'30000000-0000-4000-8000-000000000002\''

\echo '== 1. Права на функции: кандидаты — только service_role; сводка — authenticated, не anon'
select f.fn,
       has_function_privilege('anon', f.fn, 'execute') as anon,
       has_function_privilege('authenticated', f.fn, 'execute') as auth,
       has_function_privilege('service_role', f.fn, 'execute') as service,
       (not has_function_privilege('anon', f.fn, 'execute'))
         and has_function_privilege('authenticated', f.fn, 'execute') = f.client
         and (f.client or has_function_privilege('service_role', f.fn, 'execute')) as ok
  from (values
    ('public.student_reminder_candidates(timestamptz, text[])', false),
    ('public.course_summary_for_staff(uuid)', true)
  ) f(fn, client);

\echo '== 2. Кандидаты: authenticated (учитель T, ученик) и anon — отказ; service_role — ответ'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.student_reminder_candidates(now(), null); raise notice 'FAIL: учитель получил кандидатов';
exception when insufficient_privilege then raise notice 'OK: учитель — % (%)', sqlerrm, sqlstate; end $$;
rollback;
begin;
set local role anon;
do $$ begin perform public.student_reminder_candidates(now(), null); raise notice 'FAIL: anon получил кандидатов';
exception when insufficient_privilege then raise notice 'OK: anon — % (%)', sqlerrm, sqlstate; end $$;
rollback;
begin;
set local role service_role;
select jsonb_array_length(public.student_reminder_candidates('2026-10-05 19:00+03', null)->'candidates') as service_role_candidates;
rollback;

\echo '== 3. Кто попадает в кандидаты (D 19:00 МСК, все виды): нет Telegram (Ильдар), подключение выключено (Марат),'
\echo '==    общий выключатель off (Алсу) — нет совсем; закрытая тема и неопубликованное ДЗ — нет; done/course_on/student_on — флаги'
select c->>'kind' as kind, p.full_name as student, c->>'title' as title,
       coalesce(c->>'due_date', to_char((c->>'opens_at')::timestamptz at time zone 'Europe/Moscow', 'DD.MM HH24:MI')) as "когда",
       c->>'done' as done, c->>'has_draft' as draft, c->>'has_photo' as photo,
       c->>'streak' as streak, c->>'solved_today' as solved_today,
       c->>'course_on' as course_on, c->>'student_on' as student_on
  from jsonb_array_elements(public.student_reminder_candidates('2026-10-05 19:00+03', null)->'candidates') c
  join public.profiles p on p.id = (c->>'profile_id')::uuid
 order by 1, 2, 3;

\echo '== 4. «Нет фото» (D 14:50 МСК): контрольная «Кинематика» 14:15–15:00 — черновик без фото (Рустам) / с фото (Дина) / сдал (Камиль) / ничего (остальные)'
select p.full_name as student, c->>'title' as title,
       to_char((c->>'closes_at')::timestamptz at time zone 'Europe/Moscow', 'HH24:MI') as closes,
       c->>'done' as done, c->>'has_draft' as draft, c->>'has_photo' as photo, c->>'opened' as opened
  from jsonb_array_elements(public.student_reminder_candidates('2026-10-05 14:50+03', array['no_photo'])->'candidates') c
  join public.profiles p on p.id = (c->>'profile_id')::uuid
 where c->>'title' = 'Кинематика'
 order by 1;

\echo '== 5. Личное окно §240: проверочная «Движение по окружности» у Тимура — 12:00, у остальных — 08:45 (D+1)'
select p.full_name as student,
       to_char((c->>'opens_at')::timestamptz at time zone 'Europe/Moscow', 'DD.MM HH24:MI') as opens,
       to_char((c->>'closes_at')::timestamptz at time zone 'Europe/Moscow', 'HH24:MI') as closes, c->>'event_key' as event_key
  from jsonb_array_elements(public.student_reminder_candidates('2026-10-06 07:55+03', array['check_soon'])->'candidates') c
  join public.profiles p on p.id = (c->>'profile_id')::uuid
 order by 1;

\echo '== 6. Серия считается только когда её спрашивают (p_kinds без streak — строк серии нет)'
select (select count(*) from jsonb_array_elements(public.student_reminder_candidates('2026-10-05 18:30+03', array['streak'])->'candidates') c) as with_streak,
       (select count(*) from jsonb_array_elements(public.student_reminder_candidates('2026-10-05 18:30+03', array['hw_overdue'])->'candidates') c
         where c->>'kind' = 'streak') as without_streak;

\echo '== 7. Настройки курса (RLS через course_is_staff): учитель T пишет и читает; чужой учитель O, ученик — нет; anon — нет прав'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
insert into public.course_reminder_settings (course_id, streak) values (:CR, false)
  on conflict (course_id) do update set streak = excluded.streak, updated_at = now();
select course_id, streak, mock_tomorrow, updated_by = '00000000-0000-4000-8000-0000000000c1' as by_t from public.course_reminder_settings where course_id = :CR;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select count(*) as other_teacher_sees from public.course_reminder_settings where course_id = :CR;
do $$ begin
  insert into public.course_reminder_settings (course_id, streak) values ('30000000-0000-4000-8264-000000000001', false)
    on conflict (course_id) do update set streak = excluded.streak;
  raise notice 'FAIL: чужой учитель изменил настройки';
exception when insufficient_privilege then raise notice 'OK: чужой учитель — % (%)', sqlerrm, sqlstate; end $$;
with u as (update public.course_reminder_settings set streak = false where course_id = '30000000-0000-4000-8264-000000000001' returning 1)
select count(*) as other_teacher_updated from u;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8264-000000000001","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select count(*) as student_sees from public.course_reminder_settings;
do $$ begin
  insert into public.course_reminder_settings (course_id) values ('30000000-0000-4000-8264-000000000002')
    on conflict (course_id) do update set hw_due_tomorrow = true;
  raise notice 'FAIL: ученик изменил настройки курса';
exception when insufficient_privilege then raise notice 'OK: ученик — % (%)', sqlerrm, sqlstate; end $$;
rollback;
begin;
set local role anon;
do $$ begin perform 1 from public.course_reminder_settings; raise notice 'FAIL: anon читает настройки';
exception when insufficient_privilege then raise notice 'OK: anon — % (%)', sqlerrm, sqlstate; end $$;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin delete from public.course_reminder_settings; raise notice 'FAIL: удаление разрешено';
exception when insufficient_privilege then raise notice 'OK: удаления нет — % (%)', sqlerrm, sqlstate; end $$;
rollback;

\echo '== 8. Ученик выключает вид у себя (своя строка notification_prefs) — и кандидат становится student_on = false'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8264-000000000001","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
with u as (update public.notification_prefs set remind_streak = false where user_id = auth.uid() returning 1) select count(*) as own_updated from u;
with u as (update public.notification_prefs set remind_streak = false where user_id = '00000000-0000-4000-8264-000000000002' returning 1) select count(*) as other_updated from u;
reset role;
set local role service_role;
select c->>'kind' as kind, c->>'student_on' as student_on
  from jsonb_array_elements(public.student_reminder_candidates('2026-10-05 18:30+03', array['streak'])->'candidates') c
 where c->>'profile_id' = '00000000-0000-4000-8264-000000000001';
rollback;

\echo '== 9. Задание pg_cron: одно, раз в 5 минут, секрет — из vault (значения в тексте нет); повтор PENDING не плодит'
select jobname, schedule, command like '%functions/v1/student-reminders%' as url_ok,
       command like '%vault.decrypted_secrets%name = ''cron_secret''%' as secret_from_vault,
       (select count(*) from cron.job where jobname = 'student-reminders') as jobs
  from cron.job where jobname = 'student-reminders';

\echo '== 10. Сводка класса: anon — нет execute; без входа, чужой учитель O, ученик — 42501; нет курса — 22023'
begin;
set local role anon;
do $$ begin perform public.course_summary_for_staff('30000000-0000-4000-8000-000000000002'); raise notice 'FAIL: anon получил сводку';
exception when insufficient_privilege then raise notice 'OK: anon — % (%)', sqlerrm, sqlstate; end $$;
rollback;
begin;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.course_summary_for_staff('30000000-0000-4000-8000-000000000002'); raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: без входа — % (%)', sqlerrm, sqlstate; end $$;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.course_summary_for_staff('30000000-0000-4000-8000-000000000002'); raise notice 'FAIL: чужой учитель видит сводку';
exception when insufficient_privilege then raise notice 'OK: чужой учитель — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin perform public.course_summary_for_staff(null); raise notice 'FAIL';
exception when sqlstate '22023' then raise notice 'OK: без курса — % (%)', sqlerrm, sqlstate; end $$;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.course_summary_for_staff('30000000-0000-4000-8000-000000000002'); raise notice 'FAIL: ученик видит сводку класса';
exception when insufficient_privilege then raise notice 'OK: ученик A — % (%)', sqlerrm, sqlstate; end $$;
rollback;

\echo '== 11. Учитель T: сводка физики 11А (A + 6 одноклассников); админ M — тоже; ученик A — проверочные, ДЗ, каталог, серия'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select x->'course'->>'title' as course, x->>'forecast_enabled' as forecast, jsonb_array_length(x->'students') as students,
       jsonb_array_length(x->'titles') as titles
  from (select public.course_summary_for_staff(:CP) x) s;
select s->>'name' as name,
       jsonb_array_length(s->'forecast'->'evidence') as evidence,
       jsonb_array_length(s->'forecast'->'numbers') as numbers,
       (select string_agg(coalesce(a->>'score', a->>'status', 'не писал'), ' · ' order by a->>'date') from jsonb_array_elements(s->'assessments') a) as assessments,
       jsonb_array_length(s->'homeworks') as homeworks,
       s->'catalog' as catalog, s->>'streak' as streak, s->>'last_solved' as last_solved, s->>'last_seen' as last_seen
  from (select jsonb_array_elements(public.course_summary_for_staff(:CP)->'students') s) q
 order by 1 limit 3;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select jsonb_array_length(public.course_summary_for_staff(:CP)->'students') as admin_students;
rollback;

\echo '== 12. Курс без ЕГЭ-прогноза (ОГЭ) — forecast null у всех; курс без учеников (10В — один пустой)'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select x->>'forecast_enabled' as oge_forecast,
       (select count(*) from jsonb_array_elements(x->'students') s where s->'forecast' <> 'null'::jsonb) as with_forecast
  from (select public.course_summary_for_staff('30000000-0000-4000-8000-000000000003') x) q;
select jsonb_array_length(x->'students') as students_10v, x->'students'->0->'assessments' as assessments, x->'students'->0->'catalog' as catalog
  from (select public.course_summary_for_staff('30000000-0000-4000-8261-000000000001') x) q;
rollback;

\echo '== 13. Время: класс М11А (26 учеников: тяжёлый H + 24 одноклассника по 150 проверок каталога, 20 ДЗ, 8 проверочных) — 3 замера'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$
declare t0 timestamptz; x jsonb; i int; ms numeric[] := '{}';
begin
  for i in 1..3 loop
    t0 := clock_timestamp();
    x := public.course_summary_for_staff('30000000-0000-4000-8000-000000000001');
    ms := ms || round(extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
  raise notice 'М11А: учеников %, ответ % КБ, время % мс', jsonb_array_length(x->'students'), round(length(x::text) / 1024.0), ms;
end $$;
rollback;

\echo '== 14. Время кандидатов напоминаний (service_role, все виды, D 18:30)'
begin;
set local role service_role;
do $$
declare t0 timestamptz; x jsonb;
begin
  t0 := clock_timestamp();
  x := public.student_reminder_candidates('2026-10-05 18:30+03', null);
  raise notice 'кандидатов %, журнал %, время % мс', jsonb_array_length(x->'candidates'), jsonb_array_length(x->'log'),
    round(extract(epoch from clock_timestamp() - t0) * 1000);
end $$;
rollback;
