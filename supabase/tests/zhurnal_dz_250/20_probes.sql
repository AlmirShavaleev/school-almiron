-- §250. Пробы журнала ДЗ course_homework_grades: персонал курса видит опубликованные ДЗ
-- тем-уроков по разделам и клетки там, где у ученика есть попытка; статус — последней попытки,
-- балл — последнего вердикта принятой; работы по времени и неопубликованные ДЗ — не ДЗ;
-- чужой преподаватель, посторонний, ученик, аноним — отказ.
\set ON_ERROR_STOP 0
\pset null '∅'
\set c10 '''00000000-0000-4000-8000-0000000c0001'''
\set c11 '''00000000-0000-4000-8000-0000000c0002'''
\set ctpl '''00000000-0000-4000-8000-0000000c0000'''

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', false),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
$$;
-- Клетки: тема (буква до двоеточия), ученик, статус, балл, номер попытки, есть ли attempt_id.
create or replace function pg_temp.cells(j jsonb) returns table (topic text, student text, status text, score int, att int, has_attempt_id boolean)
language sql as $$
  select split_part(h->>'topic_title', ':', 1), s->>'name', c->>'status', (c->>'score')::int, (c->>'attempt_number')::int,
         (c->>'attempt_id') is not null
    from jsonb_array_elements(j->'cells') c
    join jsonb_array_elements(j->'homeworks') h on h->>'topic_id' = c->>'topic_id'
    join jsonb_array_elements(j->'students') s on s->>'student_id' = c->>'student_id'
   order by 1, 2;
$$;

\echo === 1. Преподаватель 10А: 6 учеников; ДЗ — только опубликованные ДЗ тем-уроков, по разделу (Кинематика order 0,
\echo ===    потом Механика), внутри по порядку темы: A, B, Z (закрыта — topic_open false), L. Нет: D (не опубликовано),
\echo ===    E (без ДЗ), K/F/C/P/U/N/R (работы по времени), Y (другой курс).
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select (j->>'is_template') tpl, j->>'group_name' grp, jsonb_array_length(j->'students') students,
       jsonb_array_length(j->'homeworks') homeworks, jsonb_array_length(j->'cells') cells,
       (j->>'today')::date = (now() at time zone 'Europe/Moscow')::date as today_msk
  from (select public.course_homework_grades(:c10) j) q;
select h->>'module_title' module, h->>'module_order' mord, h->>'topic_title' topic, h->>'hw_title' hw,
       h->>'grade_scale' scale, (h->>'due_at')::date - current_date as due_in_days, h->>'topic_open' open
  from jsonb_array_elements(public.course_homework_grades(:c10)->'homeworks') h;

\echo === 2. A (без шкалы, срок прошёл): S1 reviewed ∅ (принято без балла); S2 submitted; S3 returned;
\echo ===    S4 draft; S5 — строки нет (попыток нет); S6 reviewed по попытке №2 (№1 вернули).
select * from pg_temp.cells(public.course_homework_grades(:c10)) where topic = 'A';

\echo === 3. B (стобалльная, срок впереди): S1 reviewed 85; S2 submitted. L (пятибалльная): S1 reviewed 5. Z: клеток нет.
select * from pg_temp.cells(public.course_homework_grades(:c10)) where topic in ('B', 'L', 'Z');

\echo === 4. Работ по времени (K, C, P, R…) в клетках нет — у них свой журнал (§249)
select count(*) as timed_cells
  from jsonb_array_elements(public.course_homework_grades(:c10)->'cells') c
 where c->>'topic_id' like '00000000-0000-4000-8000-0000007a%' and c->>'topic_id' <> '00000000-0000-4000-8000-0000007a0001';

\echo === 5. Владелец курсов (не преподаватель группы) — тоже персонал: то же число ДЗ и клеток
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a0');
select jsonb_array_length(j->'students') students, jsonb_array_length(j->'homeworks') homeworks, jsonb_array_length(j->'cells') cells
  from (select public.course_homework_grades(:c10) j) q;

\echo === 6. Каркас: учеников и клеток нет; ДЗ уроков каркаса нет (в каркасе — только проверочная) → пусто
select (j->>'is_template') tpl, j->>'group_id' grp, jsonb_array_length(j->'students') students,
       jsonb_array_length(j->'homeworks') homeworks, jsonb_array_length(j->'cells') cells
  from (select public.course_homework_grades(:ctpl) j) q;

\echo === 7. Курс 11А его преподавателем: один ученик, ДЗ Y, клетка S7 submitted
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
select * from pg_temp.cells(public.course_homework_grades(:c11));

\echo === 8. Отказы (42501): преподаватель 11А о 10А, посторонний, ученик S1 (свой курс!), аноним
\set VERBOSITY verbose
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
select public.course_homework_grades(:c10);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a3');
select public.course_homework_grades(:c10);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select public.course_homework_grades(:c10);
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select public.course_homework_grades(:c10);
reset role;
\set VERBOSITY default

\echo === 9. Права на функцию: anon — нет, authenticated — есть; SECURITY DEFINER со своим search_path
select p.proname, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute') anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') auth_exec,
       has_function_privilege('public', p.oid, 'execute') public_exec
  from pg_proc p where p.proname = 'course_homework_grades';

\echo === 10. Соседи не сломаны: журнал §249 — по-прежнему 6 работ × 6 учеников; статистика тем §242 не тронута
\echo ===     (её в цепочке нет — функция §242 в этой базе не создавалась, проба только про §249).
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select jsonb_array_length(j->'works') works, jsonb_array_length(j->'cells') cells
  from (select public.course_assessment_grades(:c10) j) q;

\echo === 11. Без N+1: один вызов на курс; время одного вызова на 10А
\timing on
select length(public.course_homework_grades(:c10)::text) > 0 as ok;
\timing off
