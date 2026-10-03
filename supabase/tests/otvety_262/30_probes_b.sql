-- §262. Пробы ПОСЛЕ 262b (применена дважды). Роль и claims — отдельными операторами, записи — в откатываемых блоках.
\pset footer off
\set ON_ERROR_STOP off

\echo '== B1. Права на колонки catalog_tasks: секретные закрыты, остальные открыты authenticated; anon — ничего'
select c.column_name,
       has_column_privilege('authenticated', 'public.catalog_tasks', c.column_name, 'select') as auth,
       has_column_privilege('anon', 'public.catalog_tasks', c.column_name, 'select') as anon,
       has_column_privilege('authenticated', 'public.catalog_tasks', c.column_name, 'select')
         = (c.column_name not in ('answer_html', 'solution_html', 'solution_plan_html', 'grade_criteria_html'))
       and not has_column_privilege('anon', 'public.catalog_tasks', c.column_name, 'select') as ok
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'catalog_tasks'
 order by c.ordinal_position;
select has_table_privilege('authenticated', 'public.catalog_tasks', 'select') = false as ok_no_table_select,
       has_table_privilege('authenticated', 'public.catalog_tasks', 'update') as update_kept,
       has_table_privilege('authenticated', 'public.catalog_tasks', 'insert') as insert_kept;

\echo '== B2. Ученик A напрямую: answer_html / solution_html / план / критерии / select * — отказ; условие и флаги — читаются'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform answer_html from public.catalog_tasks limit 1; raise notice 'FAIL: answer_html читается';
exception when insufficient_privilege then raise notice 'OK: answer_html — %', sqlerrm; end $$;
do $$ begin perform solution_html from public.catalog_tasks limit 1; raise notice 'FAIL: solution_html читается';
exception when insufficient_privilege then raise notice 'OK: solution_html — %', sqlerrm; end $$;
do $$ begin perform solution_plan_html from public.catalog_tasks limit 1; raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: solution_plan_html — %', sqlerrm; end $$;
do $$ begin perform grade_criteria_html from public.catalog_tasks limit 1; raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: grade_criteria_html — %', sqlerrm; end $$;
do $$ begin perform t.* from public.catalog_tasks t limit 1; raise notice 'FAIL: select * прошёл';
exception when insufficient_privilege then raise notice 'OK: select * — %', sqlerrm; end $$;
do $$ begin perform 1 from public.catalog_tasks where answer_html = '<p>11</p>'; raise notice 'FAIL: подбор по where';
exception when insufficient_privilege then raise notice 'OK: where answer_html — %', sqlerrm; end $$;
select count(*) as rows, count(*) filter (where has_answer) as with_answer_flag,
       bool_and(statement_html is not null) as ok_statement
  from public.catalog_tasks where section_id = 'a6200000-0000-4000-8000-000000000005';
rollback;

\echo '== B3. Аноним напрямую — отказ'
begin;
set local role anon;
do $$ begin perform id from public.catalog_tasks limit 1; raise notice 'FAIL: аноним читает каталог';
exception when insufficient_privilege then raise notice 'OK: anon id — %', sqlerrm; end $$;
do $$ begin perform answer_html from public.catalog_tasks limit 1; raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: anon answer_html — %', sqlerrm; end $$;
rollback;

\echo '== B4. Персонал (учитель T) напрямую — тоже отказ; через функцию — всё'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform answer_html from public.catalog_tasks limit 1; raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: учитель напрямую — %', sqlerrm; end $$;
select count(*) as rows, bool_and(t.reason = 'staff' and t.answer_html is not null and t.solution_html is not null) as ok
  from public.catalog_task_texts(array(select ('a6210000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 9) i)) t;
rollback;

\echo '== B5. Ученик A через функцию — то же правило, что до 262b'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select string_agg(right(t.task_id::text, 1) || ':' || coalesce(t.reason, '—'), ' ' order by t.task_id) as fact,
       string_agg(right(t.task_id::text, 1) || ':' || coalesce(t.reason, '—'), ' ' order by t.task_id)
         = '1:— 2:revealed 3:solved 4:not_checkable 5:variant 6:lesson 7:test 9:—' as ok
  from public.catalog_task_texts(array(select ('a6210000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 9) i)) t;
rollback;

\echo '== B6. §256 после 262b: проверка ответа (верно → засчитано, ответ в ответе), раскрытие, состояние страницы, задача дня'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select r->>'verdict' as verdict, (r->>'counted')::boolean as counted, r->>'answer_html' as answer,
       r->>'verdict' = 'correct' and (r->>'counted')::boolean and r->>'answer_html' = '<p>11</p>' as ok
  from (select public.catalog_check_answer('a6210000-0000-4000-8000-000000000001', '11') as r) x;
select r->>'verdict' as verdict, r->>'answer_html' is null as no_answer_on_wrong,
       r->>'verdict' = 'wrong' and r->>'answer_html' is null as ok
  from (select public.catalog_check_answer('a6210000-0000-4000-8000-000000000009', '0') as r) x;
select (public.catalog_reveal_answer('a6210000-0000-4000-8000-000000000009')->>'answer_html') = '<p>19</p>' as ok_reveal;
select jsonb_array_length(public.catalog_practice_state('a6200000-0000-4000-8000-000000000005',
         array['a6210000-0000-4000-8000-000000000001', 'a6210000-0000-4000-8000-000000000004']::uuid[])->'tasks') = 2 as ok_practice_state;
select (public.student_daily_task('math') ? 'task') as ok_daily_task;
select right(t.task_id::text, 1) as k, t.reason, t.reason = 'solved' as ok
  from public.catalog_task_texts(array['a6210000-0000-4000-8000-000000000001']::uuid[]) t;
rollback;

\echo '== B7. Раскрытие пачкой после 262b'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select right(t.task_id::text, 1) as k, t.reason, t.answer_html, t.reason = 'revealed' and t.answer_html = '<p>15</p>' as ok
  from public.catalog_reveal_answers(array['a6210000-0000-4000-8000-000000000005']::uuid[]) t;
rollback;

\echo '== B8. Бывшие invoker-функции: теперь definer и работают под authenticated'
select p.oid::regprocedure as fn, p.prosecdef as ok
  from pg_proc p
 where p.oid in ('public.catalog_tasks_attach_preview(uuid[])'::regprocedure, 'public.preview_task_verdict(uuid, text)'::regprocedure,
                 'public.variant_section_available_counts(text, text)'::regprocedure)
 order by 1;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select public.preview_task_verdict('a6210000-0000-4000-8000-000000000001', '11') = true
       and public.preview_task_verdict('a6210000-0000-4000-8000-000000000001', '12') = false as ok_preview_verdict_teacher;
select public.catalog_tasks_attach_preview(array['a6210000-0000-4000-8000-000000000001', 'a6210000-0000-4000-8000-000000000004']::uuid[]) as preview,
       (public.catalog_tasks_attach_preview(array['a6210000-0000-4000-8000-000000000001', 'a6210000-0000-4000-8000-000000000004']::uuid[])->>'part_two')::int = 1
       and (public.catalog_tasks_attach_preview(array['a6210000-0000-4000-8000-000000000001', 'a6210000-0000-4000-8000-000000000004']::uuid[])->>'total')::int = 2 as ok;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
-- Ученику — отказ. Текст ошибки в слепке — «get_my_role() does not exist»: is_admin_or_owner здесь дословно из
-- _legacy/002_rls (без search_path), а preview_task_verdict зовёт её с search_path ''. На проде — STAFF_ONLY (§179).
do $$ begin perform public.preview_task_verdict('a6210000-0000-4000-8000-000000000001', '11'); raise notice 'FAIL: ученик перебирает ответы';
exception when others then raise notice 'OK: ученик — отказ (%)', sqlerrm; end $$;
select s.total, s.available, s.available_p1, s.available_p2,
       s.total = 8 and s.available_p1 = 7 and s.available_p2 = 1 as ok
  from public.variant_section_available_counts('Математика', 'ЕГЭ') s
 where s.section_id = 'a6200000-0000-4000-8000-000000000005';
rollback;
