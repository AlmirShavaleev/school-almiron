-- §241. Пробы: ученик видит только своё и только после вердикта / конца окна;
-- средний группы — только при результатах ещё хотя бы у троих других; чужой
-- ученик и чужой учитель — отказ; персонал курса — сводка.
\set ON_ERROR_STOP 0
\pset null '∅'
\set g10 '''00000000-0000-4000-8000-0000000f0001'''
\set g11 '''00000000-0000-4000-8000-0000000f0002'''
\set c10 '''00000000-0000-4000-8000-0000000c0001'''
\set ctpl '''00000000-0000-4000-8000-0000000c0000'''

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', false),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
$$;
create or replace function pg_temp.works(j jsonb) returns table (title text, kind text, hw boolean, status text, win text, score int, tasks text, grp text)
language sql as $$
  select w->>'title', w->>'kind', (w->>'homework_id') is not null, w->>'status',
         case when w->>'opens_at' is null then '—'
              when (w->>'opens_at')::timestamptz > now() then 'впереди'
              when (w->>'closes_at')::timestamptz > now() then 'идёт' || case when (w->>'personal')::boolean then ' (личное)' else '' end
              else 'закрылось' end,
         (w->>'score')::int,
         (select string_agg(t->>'no' || ':' || (t->>'verdict'), ' ') from jsonb_array_elements(case when jsonb_typeof(w->'tasks') = 'array' then w->'tasks' else '[]'::jsonb end) t),
         coalesce((w->'group')::text, '∅')
    from jsonb_array_elements(j->'works') w;
$$;
create or replace function pg_temp.mocks(j jsonb) returns table (title text, notified boolean, has_work boolean, score int, prim text, prev int, grp text)
language sql as $$
  select m->>'title', (m->>'notified')::boolean, (m->>'has_work')::boolean, (m->>'score')::int,
         coalesce(m->>'primary_score', '∅') || '/' || coalesce(m->>'primary_max', '∅'),
         (m->>'prev_score')::int, coalesce((m->'group')::text, '∅')
    from jsonb_array_elements(j->'mocks') m;
$$;

\echo === 1. S1 (10А): работы по времени курса — все темы check/control из любых модулей (урок L не попадает).
\echo ===    K идёт, черновик; F впереди; C — оценка 5, отметки по заданиям, группа (других с оценкой трое: 4,3,4 → средний 4.0, лучший);
\echo ===    P — 80, но других с оценкой двое → группы нет; U — ДЗ не опубликовано (нет ДЗ и окна); N — без времени.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select * from pg_temp.works(public.my_course_assessments(:g10));

\echo === 2. S2: C — 4, «лучше, чем 33 %», не лучший; средний тот же 4.0
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
select title, score, grp from pg_temp.works(public.my_course_assessments(:g10)) where title like 'C:%';

\echo === 3. S3: C — 3, у двоих выше, у никого ниже → better_pct нет («0 %» не пишем)
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3');
select title, score, grp from pg_temp.works(public.my_course_assessments(:g10)) where title like 'C:%';

\echo === 4. S5: C — сдано автоматически, вердикта нет → ни балла, ни строк таблицы проверки (они уже есть у учителя), ни группы
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b5');
select title, status, score, tasks, grp from pg_temp.works(public.my_course_assessments(:g10)) where title like 'C:%';

\echo === 5. S6: C — не сдавал, но ему открыли личное окно, идущее сейчас; группы нет (своего результата нет)
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b6');
select title, status, win, score, grp from pg_temp.works(public.my_course_assessments(:g10)) where title like 'C:%';

\echo === 6. S1: пробники группы со временем (без «Пробника без времени» и без пробника 11А).
\echo ===    №1 — 50, группа: средний 55, лучше 25 %; №2 — 62, +12 к прошлому (50), группы нет (итоги есть у двоих других);
\echo ===    №3 идёт — результат «отправлен», но окно не кончилось → итог скрыт; №5 впереди.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select * from pg_temp.mocks(public.my_course_assessments(:g10));

\echo === 7. S3: №2 — результат НЕ отправлен → скрыт (notified = f, балла нет)
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3');
select title, notified, score, grp from pg_temp.mocks(public.my_course_assessments(:g10)) where title in ('Пробник №1', 'Пробник №2');

\echo === 8. Чужой ученик S7 (11А) о группе 10А — отказ; о своей — только свой пробник 11А, работ по времени нет
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b7');
select public.my_course_assessments(:g10);
select jsonb_array_length(j->'works') as works, (select string_agg(m->>'title' || '=' || (m->>'score'), ', ') from jsonb_array_elements(j->'mocks') m) as mocks
  from (select public.my_course_assessments(:g11) j) q;

\echo === 9. Преподаватель 10А, владелец курса и аноним — ученической функции нет (это не их группа как ученика)
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select public.my_course_assessments(:g10);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a0');
select public.my_course_assessments(:g10);
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select public.my_course_assessments(:g10);
reset role;

\echo === 10. Персонал: преподаватель 10А — сводка по классу (в классе 6).
\echo ===     K идёт: сдал 1, пишут 2; F запланирована; C — общее окно закрылось → «ждёт проверки 1», сдали 5, средний 4.00; у S6 идёт личное окно (personal_live 1), черновика нет — пишут 0;
\echo ===     P проверена, средний 70; U — видна персоналу (ДЗ не опубликовано); N — без времени; урок L — нет.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select (j->>'in_class') in_class, j->>'group_name' grp, (j->>'is_template') tpl from (select public.course_assessments_summary(:c10) j) q;
select w->>'title' title, w->>'kind' kind, w->>'published' pub, w->>'status' status, w->>'submitted' sub, w->>'pending' pend,
       w->>'reviewed' rev, w->>'avg_score' avg, w->>'writing' writing, w->>'personal_live' pers
  from jsonb_array_elements(public.course_assessments_summary(:c10)->'works') w;
\echo ===     Пробники: №1 проверен (сдали 5, средний 55.0); №2 ждёт проверки 1 (не отправлен S3); №3 идёт, пишет 1 (S1; S2 сдал),
\echo ===     №5 запланирован; без времени — по итогам таблицы; пробника 11А нет.
select m->>'title' title, m->>'status' status, m->>'submitted' sub, m->>'pending' pend, m->>'avg_score' avg, m->>'writing' writing, m->>'in_group' n
  from jsonb_array_elements(public.course_assessments_summary(:c10)->'mocks') m;

\echo === 11. Владелец курсов (не преподаватель группы) — тоже персонал; шаблон — список работ без группы и без пробников
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a0');
select jsonb_array_length(public.course_assessments_summary(:c10)->'works') as works_10a;
select (j->>'is_template') tpl, j->>'in_class' in_class, j->>'group_name' grp, jsonb_array_length(j->'mocks') mocks,
       (select string_agg(w->>'title' || ' · ' || (w->>'status'), ', ') from jsonb_array_elements(j->'works') w) works
  from (select public.course_assessments_summary(:ctpl) j) q;

\echo === 12. Отказы сводки: преподаватель 11А о 10А, посторонний, ученик S1
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
select public.course_assessments_summary(:c10);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a3');
select public.course_assessments_summary(:c10);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select public.course_assessments_summary(:c10);

\echo === 13. Права на функции: anon — нет, authenticated — есть; обе SECURITY DEFINER со своим search_path
reset role;
select p.proname, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute') anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') auth_exec
  from pg_proc p where p.proname in ('my_course_assessments', 'course_assessments_summary') order by 1;
