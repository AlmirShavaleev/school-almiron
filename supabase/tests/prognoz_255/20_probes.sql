-- §255. Пробы прав и смысла PENDING_255: student_exam_forecast_evidence(), set_my_exam_goal(),
-- student_school_points() и чтение цели ученика (student_exam_goals) персоналом.
-- Роль и claims — ОТДЕЛЬНЫМИ операторами (CLAUDE.md §29.4), каждая проба — в своей
-- транзакции, которая откатывается. Строка ответа: ok = совпало ли с ожиданием, рядом — факт.
\pset footer off
\set ON_ERROR_STOP off

\echo '== 1. Аноним: все три функции — отказ (execute только authenticated)'
begin;
set local role anon;
do $$ begin
  perform public.student_exam_forecast_evidence();
  raise notice 'FAIL: аноним получил свидетельства';
exception when insufficient_privilege then raise notice 'OK: evidence — отказ: %', sqlerrm;
end $$;
do $$ begin
  perform public.student_school_points();
  raise notice 'FAIL: аноним получил баллы';
exception when insufficient_privilege then raise notice 'OK: points — отказ: %', sqlerrm;
end $$;
do $$ begin
  perform public.set_my_exam_goal('math', 80);
  raise notice 'FAIL: аноним поставил цель';
exception when insufficient_privilege then raise notice 'OK: goal — отказ: %', sqlerrm;
end $$;
rollback;
select r.who,
       has_function_privilege(r.who, 'public.student_exam_forecast_evidence()', 'execute') as evidence,
       has_function_privilege(r.who, 'public.set_my_exam_goal(text, integer)', 'execute') as set_goal,
       has_function_privilege(r.who, 'public.student_school_points()', 'execute') as points
  from (values ('anon'), ('authenticated')) r(who);
\echo 'ожидается: anon f/f/f, authenticated t/t/t'

\echo '== 2. authenticated без sub: «нужен вход»'
begin;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin
  perform public.student_exam_forecast_evidence();
  raise notice 'FAIL: без sub получил свидетельства';
exception when insufficient_privilege then raise notice 'OK: evidence — %', sqlerrm;
end $$;
do $$ begin
  perform public.student_school_points();
  raise notice 'FAIL: без sub получил баллы';
exception when insufficient_privilege then raise notice 'OK: points — %', sqlerrm;
end $$;
do $$ begin
  perform public.set_my_exam_goal('math', 80);
  raise notice 'FAIL: без sub поставил цель';
exception when insufficient_privilege then raise notice 'OK: goal — %', sqlerrm;
end $$;
rollback;

\echo '== 3. Ученик A: предметы — только ЕГЭ (math, physics; ОГЭ нет); своей цели нет, цель учителя по математике 70'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select jsonb_path_query_array(r->'subjects', '$[*].subject') = '["math","physics"]'
         and jsonb_path_query_array(r->'subjects', '$[*].goal') = '[null, null]'
         and jsonb_path_query_array(r->'subjects', '$[*].teacher_goal') = '[70, null]' as ok,
       jsonb_path_query_array(r->'subjects', '$[*].subject') as subjects,
       jsonb_path_query_array(r->'subjects', '$[*].goal') as goals,
       jsonb_path_query_array(r->'subjects', '$[*].teacher_goal') as teacher_goals,
       r->'titles' as titles
  from (select public.student_exam_forecast_evidence() r) x;
rollback;

\echo '== 4. Ученик A: свидетельства по источникам — math: hw 4 (№6: верно+частично, «не сверено» пропущено; №13-14: верно+не решал),'
\echo '   mock 3 (1/1, 1/2, 0/4; kim_total 19), catalog 2 (№6; снятые задача/раздел и ОГЭ — нет); physics: test 2 (№7 из каталога 1, №5 0,5), catalog 1 (вариант).'
\echo '   Нет: непроверенной работы, ОГЭ, работы 200-дневной давности, данных ученика Б.'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
with r as (select public.student_exam_forecast_evidence() r),
e as (select x from r, jsonb_array_elements(r->'evidence') x)
select (select string_agg(s, '; ' order by s) from (
          select (x->>'subject') || ' ' || (x->>'source') || ' ' || (x->>'ns') || ' ' || (x->>'score')
                 || coalesce(' kim=' || (x->>'kim_total'), '') as s from e) q) =
       'math catalog [6] 1.000; math catalog [6] 1.000; math hw [13, 14] 0.000; math hw [13, 14] 1.000; math hw [6] 0.500; math hw [6] 1.000; '
       || 'math mock [13] 0.500 kim=19; math mock [18] 0.000 kim=19; math mock [1] 1.000 kim=19; physics catalog [7] 1.000; physics test [5] 0.500; physics test [7] 1.000' as ok,
       (select count(*) from e) as rows,
       (select string_agg(s, '; ' order by s) from (
          select (x->>'subject') || ' ' || (x->>'source') || ' ' || (x->>'ns') || ' ' || (x->>'score')
                 || coalesce(' kim=' || (x->>'kim_total'), '') as s from e) q) as evidence
  from r;
rollback;

\echo '== 5. Ученик Б видит только своё: предмет physics, цель учителя 90, свидетельства — его ДЗ №1 и его каталог №7 (ни строки ученика A)'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select jsonb_path_query_array(r->'evidence', '$[*].item') = '["hw:70000000-0000-4000-8000-000000000006:1", "catalog:91000000-0000-4000-8000-000000000003"]'
         and jsonb_path_query_array(r->'subjects', '$[*].subject') = '["physics"]'
         and (r->'subjects'->0->>'teacher_goal')::int = 90 and r->'subjects'->0->'goal' = 'null'::jsonb as ok,
       r->'subjects' as subjects, jsonb_path_query_array(r->'evidence', '$[*].item') as items
  from (select public.student_exam_forecast_evidence() r) x;
rollback;

\echo '== 6. Учитель Т (нет строки students): функция ученика пуста — ни предметов, ни свидетельств'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select r->'subjects' = '[]'::jsonb and r->'evidence' = '[]'::jsonb as ok, r->'subjects' as subjects, jsonb_array_length(r->'evidence') as ev
  from (select public.student_exam_forecast_evidence() r) x;
rollback;

\echo '== 7. Цель: ученик A ставит 80 по математике и 75 по физике; цель учителя (70) не меняется; снять — null'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select public.set_my_exam_goal('math', 80) as math, public.set_my_exam_goal('physics', 75) as physics;
select public.set_my_exam_goal('math', 82) as math_again;
select jsonb_path_query_array(r->'subjects', '$[*].goal') = '[82, 75]'
         and jsonb_path_query_array(r->'subjects', '$[*].teacher_goal') = '[70, null]' as ok,
       jsonb_path_query_array(r->'subjects', '$[*].goal') as goals,
       jsonb_path_query_array(r->'subjects', '$[*].teacher_goal') as teacher_goals
  from (select public.student_exam_forecast_evidence() r) x;
select public.set_my_exam_goal('physics', null) is null as cleared;
select count(*) = 1 and min(goal) = 82 as ok, count(*) as my_rows, min(goal) as goal from public.student_exam_goals;
select count(*) = 1 and min(target_score) = 70 as ok, min(target_score) as teacher_target_untouched from public.student_subject_targets;
rollback;

\echo '== 8. Цель: проверки ввода и предмета — 0, 101, algebra, математика у Б (нет такого курса ЕГЭ)'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.set_my_exam_goal('math', 0); raise notice 'FAIL: 0 принят';
exception when invalid_parameter_value then raise notice 'OK: 0 — %', sqlerrm; end $$;
do $$ begin perform public.set_my_exam_goal('math', 101); raise notice 'FAIL: 101 принят';
exception when invalid_parameter_value then raise notice 'OK: 101 — %', sqlerrm; end $$;
do $$ begin perform public.set_my_exam_goal('algebra', 50); raise notice 'FAIL: algebra принята';
exception when invalid_parameter_value then raise notice 'OK: algebra — %', sqlerrm; end $$;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.set_my_exam_goal('math', 50); raise notice 'FAIL: Б поставил цель по чужому предмету';
exception when insufficient_privilege then raise notice 'OK: Б math — %', sqlerrm; end $$;
rollback;

\echo '== 9. Ученик напрямую в таблицы целей не пишет: student_exam_goals — нет прав записи; student_subject_targets — политики §216'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin
  insert into public.student_exam_goals (profile_id, subject, goal) values ('00000000-0000-4000-8000-0000000000a1', 'math', 99);
  raise notice 'FAIL: ученик вставил цель напрямую';
exception when insufficient_privilege then raise notice 'OK: insert student_exam_goals напрямую — %', sqlerrm; end $$;
do $$ begin
  update public.student_exam_goals set goal = 99;
  raise notice 'FAIL: ученик обновил цель напрямую';
exception when insufficient_privilege then raise notice 'OK: update student_exam_goals напрямую — %', sqlerrm; end $$;
do $$ begin
  delete from public.student_exam_goals;
  raise notice 'FAIL: ученик удалил цель напрямую';
exception when insufficient_privilege then raise notice 'OK: delete student_exam_goals напрямую — %', sqlerrm; end $$;
do $$ begin
  insert into public.student_subject_targets (student_id, subject, exam_type, target_score, updated_by)
  values ('10000000-0000-4000-8000-0000000000a1', 'physics', 'ege', 99, '00000000-0000-4000-8000-0000000000a1');
  raise notice 'FAIL: ученик вставил учительскую цель';
exception when insufficient_privilege then raise notice 'OK: insert student_subject_targets — %', sqlerrm; end $$;
update public.student_subject_targets set target_score = 1;
select count(*) = 1 and min(target_score) = 70 as ok, count(*) as visible, min(target_score) as teacher_goal_after_update from public.student_subject_targets;
rollback;
begin;
set local role anon;
do $$ begin
  perform 1 from public.student_exam_goals;
  raise notice 'FAIL: аноним читает цели';
exception when insufficient_privilege then raise notice 'OK: anon select student_exam_goals — %', sqlerrm; end $$;
rollback;

\echo '== 10. Чтение цели ученика: A ставит 85 (математика), Б — 60 (физика). Ученик видит только свою;'
\echo '    учитель Т (курсы A) — только A; посторонний учитель О (курс Б) — только Б; админ — обе'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select public.set_my_exam_goal('math', 85) \g /dev/null
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select public.set_my_exam_goal('physics', 60) \g /dev/null
select 'Б' as who, string_agg(subject || '=' || goal, '; ') as rows, count(*) = 1 and min(goal) = 60 as ok from public.student_exam_goals;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select 'A' as who, string_agg(subject || '=' || goal, '; ') as rows, count(*) = 1 and min(goal) = 85 as ok from public.student_exam_goals;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select 'T' as who, string_agg(profile_id::text || ':' || subject || '=' || goal, '; ') as rows,
       count(*) = 1 and min(goal) = 85 and bool_and(profile_id = '00000000-0000-4000-8000-0000000000a1') as ok
  from public.student_exam_goals;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select 'O' as who, string_agg(profile_id::text || ':' || subject || '=' || goal, '; ') as rows,
       count(*) = 1 and min(goal) = 60 and bool_and(profile_id = '00000000-0000-4000-8000-0000000000b1') as ok
  from public.student_exam_goals;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select 'M (админ)' as who, count(*) as rows, count(*) = 2 as ok from public.student_exam_goals;
rollback;

\echo '== 11. Баллы школы ученика A: 109 = ДЗ вовремя 4×10 + после срока 4 + оценки 10+6+6+6 + каталог 4×2 + пробник 2 + серия 9×3'
\echo '    уровень 2 «Разгон» (100..200), значки: рекорд 8 ≥ 7, вовремя 4/10, пробник 1/1, каталог 4/100'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'total')::int = 109 and r->'level' = '{"n": 2, "from": 100, "name": "Разгон", "next": 200, "next_name": "Ритм"}'::jsonb
         and r->'badges' = '[{"key": "streak7", "have": 8, "need": 7}, {"key": "ontime10", "have": 4, "need": 10}, {"key": "mock1", "have": 1, "need": 1}, {"key": "catalog100", "have": 4, "need": 100}]'::jsonb
         as ok,
       r->>'total' as total, r->'level' as level, r->'badges' as badges
  from (select public.student_school_points() r) x;
select string_agg((f->>'kind') || ' +' || (f->>'points') || coalesce(' «' || (f->>'title') || '»', '') || coalesce(' n=' || (f->>'n'), ''), ' | ' order by ord) as feed,
       count(*) as items
  from (select public.student_school_points() r) x, jsonb_array_elements(r->'feed') with ordinality as t(f, ord);
select r->'rules' as rules from (select public.student_school_points() r) x;
rollback;

\echo '== 12. Баллы школы ученика Б — только его: ДЗ вовремя 10 + оценка 5 → 10 + каталог 1×2 + серия 1×3 = 25, уровень 1'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'total')::int = 25 and (r->'level'->>'n')::int = 1 as ok, r->>'total' as total, r->'level' as level
  from (select public.student_school_points() r) x;
rollback;

\echo '== 13. Новичок (профиль без ученика и истории): 0 баллов, уровень 1 «Старт», лента пуста'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'total')::int = 0 and r->'level'->>'name' = 'Старт' and r->'feed' = '[]'::jsonb as ok, r->>'total' as total, r->'level' as level
  from (select public.student_school_points() r) x;
rollback;

\echo '== 14. Функции не пишут: student_exam_forecast_evidence и student_school_points объявлены STABLE (PostgREST — read-only транзакция)'
select proname, provolatile, prosecdef from pg_proc
 where proname in ('student_exam_forecast_evidence', 'student_school_points', 'set_my_exam_goal') order by proname;
\echo 'ожидается: evidence s/t, points s/t, set_my_exam_goal v/t'
