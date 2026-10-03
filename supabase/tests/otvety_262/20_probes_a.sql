-- §262. Пробы ПОСЛЕ 262a, ДО 262b. Роль и claims — ОТДЕЛЬНЫМИ операторами (CLAUDE.md §29.4), записи — в
-- откатываемых транзакциях. ok = совпало ли с ожиданием, рядом — факт.
\pset footer off
\set ON_ERROR_STOP off

\echo '== A1. Права на функции §262: аноним — ничего; authenticated — выдача и раскрытие; правило — никому'
select f.fn,
       has_function_privilege('anon', f.fn, 'execute') as anon,
       has_function_privilege('authenticated', f.fn, 'execute') as auth,
       (not has_function_privilege('anon', f.fn, 'execute')) and has_function_privilege('authenticated', f.fn, 'execute') = f.client as ok
  from (values
    ('public.catalog_task_texts(uuid[])', true),
    ('public.catalog_task_text(uuid)', true),
    ('public.catalog_reveal_answers(uuid[])', true),
    ('public.catalog_answer_reasons(uuid, uuid[])', false)
  ) f(fn, client);

\echo '== A2. Аноним: выдача и раскрытие — отказ (нет execute)'
begin;
set local role anon;
do $$ begin perform * from public.catalog_task_texts(array['a6210000-0000-4000-8000-000000000001']::uuid[]); raise notice 'FAIL: аноним получил ответы';
exception when insufficient_privilege then raise notice 'OK: texts — %', sqlerrm; end $$;
do $$ begin perform public.catalog_task_text('a6210000-0000-4000-8000-000000000001'); raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: text — %', sqlerrm; end $$;
do $$ begin perform * from public.catalog_reveal_answers(array['a6210000-0000-4000-8000-000000000001']::uuid[]); raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: reveal — %', sqlerrm; end $$;
rollback;

\echo '== A3. authenticated без sub: «нужен вход»; ученик A — правило напрямую не вызвать'
begin;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform * from public.catalog_task_texts(array['a6210000-0000-4000-8000-000000000004']::uuid[]); raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: texts без входа — %', sqlerrm; end $$;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform * from public.catalog_answer_reasons('00000000-0000-4000-8000-0000000000c1', array['a6210000-0000-4000-8000-000000000001']::uuid[]); raise notice 'FAIL: правило вызвано учеником';
exception when insufficient_privilege then raise notice 'OK: правило — %', sqlerrm; end $$;
rollback;

\echo '== A4. Ученик A: ответ только по правилу (k1 закрыта, k2 revealed, k3 solved, k4 not_checkable, k5 variant, k6 lesson, k7 test, k8 — нет строки, k9 закрыта)'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select right(t.task_id::text, 1) as k, t.allowed, t.reason, t.answer_html, t.solution_html, t.solution_plan_html, t.grade_criteria_html,
       t.has_plan, t.has_criteria,
       (t.allowed = e.allowed and t.reason is not distinct from e.reason
        and (t.answer_html is not null) = e.allowed and (t.solution_html is not null) = e.allowed) as ok
  from public.catalog_task_texts(array(select ('a6210000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 9) i)) t
  join (values ('1', false, null), ('2', true, 'revealed'), ('3', true, 'solved'), ('4', true, 'not_checkable'),
               ('5', true, 'variant'), ('6', true, 'lesson'), ('7', true, 'test'), ('9', false, null)) e(k, allowed, reason)
    on e.k = right(t.task_id::text, 1)
 order by 1;
select count(*) = 8 as ok_k8_hidden, count(*) as rows
  from public.catalog_task_texts(array(select ('a6210000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 9) i));
select (public.catalog_task_text('a6210000-0000-4000-8000-000000000001')->>'allowed')::boolean = false
       and public.catalog_task_text('a6210000-0000-4000-8000-000000000001')->>'answer_html' is null as ok_single_locked,
       public.catalog_task_text('a6210000-0000-4000-8000-000000000003')->>'answer_html' = '<p>13</p>' as ok_single_solved,
       public.catalog_task_text('a6210000-0000-4000-8000-000000000008') is null as ok_single_unpublished;
rollback;

\echo '== A5. Чужой ученик B (другой курс): открыта только k4 (без проверки); k5 — вариант B не сдан, k6 — разбор не открыт, k7 — попытка не завершена'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select string_agg(right(t.task_id::text, 1) || ':' || coalesce(t.reason, '—'), ' ' order by t.task_id) as fact,
       bool_and((t.reason is not null) = (right(t.task_id::text, 1) = '4')) and bool_and((t.answer_html is null) = not t.allowed) as ok
  from public.catalog_task_texts(array(select ('a6210000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 9) i)) t;
rollback;

\echo '== A6. Персонал (учитель T, посторонний учитель O, админ M, куратор K): всё, включая снятую k8'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select 'T' as who, count(*) as rows, bool_and(t.reason = 'staff' and t.answer_html is not null and t.solution_html is not null) as ok
  from public.catalog_task_texts(array(select ('a6210000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 9) i)) t;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select 'O' as who, count(*) as rows, bool_and(t.reason = 'staff' and t.answer_html is not null) as ok
  from public.catalog_task_texts(array(select ('a6210000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 9) i)) t;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select 'M' as who, count(*) as rows, bool_and(t.reason = 'staff' and t.answer_html is not null) as ok,
       (select grade_criteria_html from public.catalog_task_texts(array['a6210000-0000-4000-8000-000000000004']::uuid[])) = '<p>Критерии k4</p>' as ok_criteria
  from public.catalog_task_texts(array(select ('a6210000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 9) i)) t;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select 'K' as who, count(*) as rows, bool_and(t.reason = 'staff') as ok
  from public.catalog_task_texts(array(select ('a6210000-0000-4000-8000-00000000000' || i)::uuid from generate_series(1, 9) i)) t;
rollback;

\echo '== A7. Больше 300 id — TOO_MANY'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform * from public.catalog_task_texts(array(select gen_random_uuid() from generate_series(1, 301))); raise notice 'FAIL';
exception when invalid_parameter_value then raise notice 'OK: %', sqlerrm; end $$;
rollback;

\echo '== A8. Раскрытие пачкой (A, k1 и k9; откат): тексты пришли, причина revealed, отметки записаны; дальше k1 верно — НЕ засчитано'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select right(t.task_id::text, 1) as k, t.reason, t.answer_html, t.solution_html,
       t.reason = 'revealed' and t.answer_html is not null and t.solution_html is not null as ok
  from public.catalog_reveal_answers(array['a6210000-0000-4000-8000-000000000001', 'a6210000-0000-4000-8000-000000000009']::uuid[]) t
 order by 1;
select count(*) = 2 as ok_marks from public.catalog_task_reveals
 where profile_id = auth.uid() and task_id in ('a6210000-0000-4000-8000-000000000001', 'a6210000-0000-4000-8000-000000000009');
select r->>'verdict' as verdict, (r->>'counted')::boolean as counted, (r->>'revealed_before')::boolean as revealed_before,
       r->>'verdict' = 'correct' and not (r->>'counted')::boolean as ok
  from (select public.catalog_check_answer('a6210000-0000-4000-8000-000000000001', '11') as r) x;
rollback;

\echo '== A9. Раскрытие снятой задачи (k8) учеником — отметки нет, строки нет'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select count(*) = 0 as ok_no_row from public.catalog_reveal_answers(array['a6210000-0000-4000-8000-000000000008']::uuid[]);
select count(*) = 0 as ok_no_mark from public.catalog_task_reveals where profile_id = auth.uid() and task_id = 'a6210000-0000-4000-8000-000000000008';
rollback;

\echo '== A10. ДО 262b (дыра, которую закрывает шаг 2): ученик A читает answer_html напрямую'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select count(*) as rows_with_answer, count(*) > 0 as hole_open
  from public.catalog_tasks where answer_html is not null;
rollback;

\echo '== A11. Invoker-функции до 262b: prosecdef = false (262b их переведёт)'
select p.oid::regprocedure as fn, p.prosecdef
  from pg_proc p
 where p.oid in ('public.catalog_tasks_attach_preview(uuid[])'::regprocedure, 'public.preview_task_verdict(uuid, text)'::regprocedure,
                 'public.variant_section_available_counts(text, text)'::regprocedure)
 order by 1;
