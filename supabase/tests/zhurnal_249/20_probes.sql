-- §249. Пробы журнала оценок course_assessment_grades: персонал курса видит
-- поклеточно ученики × работы; оценка — последний вердикт последней попытки;
-- черновик — draft; возвращённая без новой попытки — returned; чужой
-- преподаватель, посторонний, ученик, аноним — отказ.
\set ON_ERROR_STOP 0
\pset null '∅'
\set c10 '''00000000-0000-4000-8000-0000000c0001'''
\set c11 '''00000000-0000-4000-8000-0000000c0002'''
\set ctpl '''00000000-0000-4000-8000-0000000c0000'''

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', false),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
$$;
-- Клетки журнала: тема (буква), ученик (имя), статус, балл, номер попытки.
create or replace function pg_temp.cells(j jsonb) returns table (work text, student text, status text, score int, att int, has_attempt_id boolean)
language sql as $$
  select split_part(w->>'title', ':', 1), s->>'name', c->>'status', (c->>'score')::int, (c->>'attempt_number')::int,
         (c->>'attempt_id') is not null
    from jsonb_array_elements(j->'cells') c
    join jsonb_array_elements(j->'works') w on w->>'topic_id' = c->>'topic_id'
    join jsonb_array_elements(j->'students') s on s->>'student_id' = c->>'student_id'
   order by 1, 2;
$$;

\echo === 1. Преподаватель 10А: ученики (6, по имени), работы — только check/control с ОПУБЛИКОВАННЫМ ДЗ, по дате окна
\echo ===    (P −3 дня, R −3 дня 1 ч → R раньше P; C −2 ч; K идёт; F завтра; N без окна — в конце). Урок L и U (ДЗ не опубликовано) — нет.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select (j->>'is_template') tpl, j->>'group_name' grp, jsonb_array_length(j->'students') students,
       jsonb_array_length(j->'works') works, jsonb_array_length(j->'cells') cells
  from (select public.course_assessment_grades(:c10) j) q;
select s->>'name' name from jsonb_array_elements(public.course_assessment_grades(:c10)->'students') s;
select w->>'title' title, w->>'kind' kind, w->>'grade_scale' scale,
       case when w->>'opens_at' is null then 'без окна' when (w->>'opens_at')::timestamptz > now() then 'впереди' else 'открылась' end win
  from jsonb_array_elements(public.course_assessment_grades(:c10)->'works') w;

\echo === 2. C (пятибалльная, закрылась): S1 5, S2 4, S3 3, S4 4 — reviewed; S5 — submitted (сдано автоматически, балла нет); S6 — none
select * from pg_temp.cells(public.course_assessment_grades(:c10)) where work = 'C';
select s->>'name' name, c->>'auto_submitted' auto
  from jsonb_array_elements(public.course_assessment_grades(:c10)->'cells') c
  join jsonb_array_elements(public.course_assessment_grades(:c10)->'students') s on s->>'student_id' = c->>'student_id'
 where c->>'topic_id' = '00000000-0000-4000-8000-0000007a0004' and c->>'status' = 'submitted';

\echo === 3. K (идёт): S1, S2 — черновики (draft, балла нет); S3 — сдал (submitted); S4..S6 — none
select * from pg_temp.cells(public.course_assessment_grades(:c10)) where work = 'K';

\echo === 4. P (стобалльная): S1 80, S2 60, S3 70 — reviewed; остальные none
select * from pg_temp.cells(public.course_assessment_grades(:c10)) where work = 'P';

\echo === 5. R (пересдачи): S1 — reviewed 4 по попытке №2 (№1 возвращена); S2 — returned, балла нет;
\echo ===    S3 — draft (попытка №2 после возврата); S4 — reviewed 3 (вернули, потом приняли как есть — последний вердикт);
\echo ===    S5 — submitted по попытке №2; S6 — none
select * from pg_temp.cells(public.course_assessment_grades(:c10)) where work = 'R';

\echo === 6. Владелец курсов (не преподаватель группы) — тоже персонал: то же число клеток
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a0');
select jsonb_array_length(j->'students') students, jsonb_array_length(j->'works') works, jsonb_array_length(j->'cells') cells
  from (select public.course_assessment_grades(:c10) j) q;

\echo === 7. Шаблон курса: работы есть (проверочная каркаса), учеников и клеток нет
select (j->>'is_template') tpl, j->>'group_id' grp, jsonb_array_length(j->'students') students,
       (select string_agg(w->>'title', ', ') from jsonb_array_elements(j->'works') w) works,
       jsonb_array_length(j->'cells') cells
  from (select public.course_assessment_grades(:ctpl) j) q;

\echo === 8. Курс 11А его преподавателем: работ по времени нет → пустые работы и клетки, ученик один
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
select jsonb_array_length(j->'students') students, jsonb_array_length(j->'works') works, jsonb_array_length(j->'cells') cells
  from (select public.course_assessment_grades(:c11) j) q;

\echo === 9. Отказы (42501): преподаватель 11А о 10А, посторонний, ученик S1 (свой курс!), аноним
\set VERBOSITY verbose
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
select public.course_assessment_grades(:c10);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a3');
select public.course_assessment_grades(:c10);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select public.course_assessment_grades(:c10);
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select public.course_assessment_grades(:c10);
reset role;
\set VERBOSITY default

\echo === 10. Права на функцию: anon — нет, authenticated — есть; SECURITY DEFINER со своим search_path
select p.proname, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute') anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') auth_exec,
       has_function_privilege('public', p.oid, 'execute') public_exec
  from pg_proc p where p.proname = 'course_assessment_grades';

\echo === 11. Сводка §241 не сломана: по R — сдали 4 (S1, S2 вернули, S4, S5 — не черновики), ждут 1, средний принятых (4+3)/2
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select w->>'title' title, w->>'submitted' sub, w->>'pending' pend, w->>'avg_score' avg
  from jsonb_array_elements(public.course_assessments_summary(:c10)->'works') w where w->>'title' like 'R:%';

\echo === 12. Без N+1: один план на вызов; время одного вызова на 10А
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
\timing on
select length(public.course_assessment_grades(:c10)::text) > 0 as ok;
\timing off
