-- §254. Пробы прав и смысла student_home_activity() и её внутренних функций.
-- Роль и claims — ОТДЕЛЬНЫМИ операторами (CLAUDE.md §29.4), каждая проба — в
-- своей транзакции, которая откатывается (роль возвращается сама). Строка
-- ответа: ok = совпало ли с ожиданием, рядом — факт.
\pset footer off
\set ON_ERROR_STOP off
create temp table d (t date);
insert into d values ((now() at time zone 'Europe/Moscow')::date);
grant select on d to authenticated, anon;

\echo '== 1. Аноним: функции нет (execute только authenticated)'
begin;
set local role anon;
do $$ begin
  perform public.student_home_activity();
  raise notice 'FAIL: аноним получил ответ';
exception when insufficient_privilege then raise notice 'OK: отказ — %', sqlerrm;
end $$;
rollback;

\echo '== 2. authenticated без sub: «нужен вход», а не чужие/пустые данные'
begin;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin
  perform public.student_home_activity();
  raise notice 'FAIL: без sub получил ответ';
exception when insufficient_privilege then raise notice 'OK: отказ — %', sqlerrm;
end $$;
rollback;

\echo '== 3. Внутренние функции клиенту закрыты (иначе чужой profile_id в параметре)'
begin;
select set_config('request.jwt.claims', '{"sub":"25400000-0000-0000-0000-000000000001","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin
  perform * from public.student_solved_task_days('25400000-0000-0000-0000-000000000002', current_date - 30);
  raise notice 'FAIL: student_solved_task_days исполнима';
exception when insufficient_privilege then raise notice 'OK: student_solved_task_days — отказ';
end $$;
do $$ begin
  perform * from public.student_visit_streak('25400000-0000-0000-0000-000000000002', current_date);
  raise notice 'FAIL: student_visit_streak исполнима';
exception when insufficient_privilege then raise notice 'OK: student_visit_streak — отказ';
end $$;
do $$ begin
  perform * from public.app_visits;
  raise notice 'FAIL: app_visits читается напрямую';
exception when insufficient_privilege then raise notice 'OK: app_visits напрямую — отказ';
end $$;
rollback;
select 'anon' as who,
       has_function_privilege('anon', 'public.student_home_activity(integer)', 'execute') as home,
       has_function_privilege('anon', 'public.student_solved_task_days(uuid, date)', 'execute') as solved,
       has_function_privilege('anon', 'public.student_visit_streak(uuid, date)', 'execute') as streak
union all
select 'authenticated',
       has_function_privilege('authenticated', 'public.student_home_activity(integer)', 'execute'),
       has_function_privilege('authenticated', 'public.student_solved_task_days(uuid, date)', 'execute'),
       has_function_privilege('authenticated', 'public.student_visit_streak(uuid, date)', 'execute');
\echo 'ожидается: anon f/f/f, authenticated t/f/f'

\echo '== 4. P1 (обычный ученик): серия 5, рекорд 12, сегодня заходил; заходов в окне 84 дня — 18; решено 11 по 7 дням'
begin;
select set_config('request.jwt.claims', '{"sub":"25400000-0000-0000-0000-000000000001","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'streak')::int = 5 and (r->>'record')::int = 12 and (r->>'visited_today')::boolean
         and jsonb_array_length(r->'visits') = 18
         and (select sum((x->>'n')::int) from jsonb_array_elements(r->'solved') x) = 11
         and jsonb_array_length(r->'solved') = 7
         and r->>'today' = (select t::text from d) and r->>'from' = (select (t - 83)::text from d) as ok,
       r->>'streak' as streak, r->>'record' as record, r->>'visited_today' as today_visited,
       jsonb_array_length(r->'visits') as visits,
       (select string_agg(((select t from d) - (x->>'day')::date)::text || 'д:' || (x->>'n') ||
               ' (hw ' || (x->>'hw') || ', кат ' || (x->>'catalog') || ', проб ' || (x->>'mock') || ', тест ' || (x->>'test') || ')', '; '
               order by x->>'day')
          from jsonb_array_elements(r->'solved') x) as solved_days_ago
  from (select public.student_home_activity() r) q;
\echo 'ожидается по дням (сколько дней назад): 15д:1 проб (старый, по date); 10д:2 hw (1 и 3 первой сдачи); 7д:2 проб (балл 0 не в счёт);'
\echo '  6д:3 тест (2 верно + 1 частично, незавершённая попытка не в счёт); 5д:1 кат (A — один раз, по раннему ответу);'
\echo '  3д:1 hw (задание 2 после доработки; 1 и 3 второй раз не считаются); 1д:1 кат (B); ДЗ без вердикта (2д) — нет'
select (r->'courses') = jsonb_build_array(
         jsonb_build_object('course_id', '25420000-0000-0000-0000-00000000000a', 'topics_total', 3, 'topics_done', 2),
         jsonb_build_object('course_id', '25420000-0000-0000-0000-00000000000b', 'topics_total', 1, 'topics_done', 0)) as ok,
       r->'courses' as courses
  from (select public.student_home_activity() r) q;
\echo 'ожидается: CA 2 из 3 (T1 открыта и пройдена, T4 закрыта, но пройдена; T2 открыта; T3 закрыта — не в счёт), CB 0 из 1; чужого CC нет'
rollback;

\echo '== 5. Окно: p_days=120 видит задачу T-100, p_days=1 сжимается до 7 дней'
begin;
select set_config('request.jwt.claims', '{"sub":"25400000-0000-0000-0000-000000000001","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (select sum((x->>'n')::int) from jsonb_array_elements(r->'solved') x) = 12 as ok,
       (select sum((x->>'n')::int) from jsonb_array_elements(r->'solved') x) as solved_120
  from (select public.student_home_activity(120) r) q;
select r->>'from' = (select (t - 6)::text from d) and jsonb_array_length(r->'visits') = 5 as ok,
       r->>'from' as from_day, jsonb_array_length(r->'visits') as visits_7
  from (select public.student_home_activity(1) r) q;
rollback;

\echo '== 6. P2: заходил T-3..T-1, сегодня ещё нет — серия 3 (до конца дня не обнуляется); чужого (P1) не видит'
begin;
select set_config('request.jwt.claims', '{"sub":"25400000-0000-0000-0000-000000000002","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'streak')::int = 3 and (r->>'record')::int = 3 and not (r->>'visited_today')::boolean
         and jsonb_array_length(r->'visits') = 3
         and (select sum((x->>'n')::int) from jsonb_array_elements(r->'solved') x) = 1 as ok,
       r->>'streak' as streak, r->>'record' as record, r->>'visited_today' as today_visited,
       r->'solved' as solved, r->'courses' as courses
  from (select public.student_home_activity() r) q;
\echo 'ожидается: только своя задача каталога (T-1, n=1); курс CA 1 из 2 (T2 пройдена отметкой; T4 у него не пройдена — закрытая не в счёт)'
rollback;

\echo '== 7. P3 новичок: 0 / 0, пусто'
begin;
select set_config('request.jwt.claims', '{"sub":"25400000-0000-0000-0000-000000000003","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'streak')::int = 0 and (r->>'record')::int = 0 and r->'visits' = '[]'::jsonb and r->'solved' = '[]'::jsonb as ok,
       r->>'streak' as streak, r->>'record' as record, r->'visits' as visits, r->'solved' as solved, r->'courses' as courses
  from (select public.student_home_activity() r) q;
rollback;

\echo '== 8. P4: T-3, T-2, вчера пропуск — серия 0, рекорд 2'
begin;
select set_config('request.jwt.claims', '{"sub":"25400000-0000-0000-0000-000000000004","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'streak')::int = 0 and (r->>'record')::int = 2 as ok, r->>'streak' as streak, r->>'record' as record,
       r->'courses' as courses
  from (select public.student_home_activity() r) q;
\echo 'ожидается: курсы — CC 0 из 1 (своя группа), чужие CA/CB не видны'
rollback;

\echo '== 9. Преподаватель без строки students: работает, считает только «Выполнено» каталога, курсов нет'
begin;
select set_config('request.jwt.claims', '{"sub":"25400000-0000-0000-0000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'streak')::int = 1 and r->'courses' = '[]'::jsonb
         and (select sum((x->>'n')::int) from jsonb_array_elements(r->'solved') x) = 1 as ok,
       r->>'streak' as streak, r->'solved' as solved, r->'courses' as courses
  from (select public.student_home_activity() r) q;
rollback;

\echo '== 10. Серия по дням (внутренняя, владельцем базы; «сегодня» — параметр)'
select k.label, s.streak, s.record, s.visited_today,
       (s.streak, s.record, s.visited_today) = (k.e_streak, k.e_record, k.e_today) as ok
  from (values
    ('P1, сегодня = T',            '25400000-0000-0000-0000-000000000001'::uuid, 0, 5, 12, true),
    ('P1, сегодня = T+1 (не зашёл)', '25400000-0000-0000-0000-000000000001'::uuid, -1, 5, 12, false),
    ('P1, сегодня = T+2 (разрыв)', '25400000-0000-0000-0000-000000000001'::uuid, -2, 0, 12, false),
    ('P1, сегодня = T-19',         '25400000-0000-0000-0000-000000000001'::uuid, 19, 1, 12, false),
    ('P1, сегодня = T-29 (рекорд ещё не набран)', '25400000-0000-0000-0000-000000000001'::uuid, 29, 12, 12, true),
    ('P1, сегодня = T-35',         '25400000-0000-0000-0000-000000000001'::uuid, 35, 6, 6, true),
    ('P4, сегодня = T-1',          '25400000-0000-0000-0000-000000000004'::uuid, 1, 2, 2, false),
    ('P3 (новичок)',               '25400000-0000-0000-0000-000000000003'::uuid, 0, 0, 0, false)
  ) k(label, pid, back, e_streak, e_record, e_today)
  cross join lateral public.student_visit_streak(k.pid, (select t from d) - k.back) s;
