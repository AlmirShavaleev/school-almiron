-- §261. Пробы PENDING_261 на локальном слепке. Роль и claims — ОТДЕЛЬНЫМИ операторами (CLAUDE.md §29.4),
-- каждая проба под ролью authenticated/anon (под владельцем таблиц права не проверяются).
-- Строка ответа: ok = совпало ли с ожиданием, рядом — факт.
\pset footer off
\set ON_ERROR_STOP off
\set SA '\'10000000-0000-4000-8000-0000000000a1\''
\set SH '\'10000000-0000-4000-8000-0000000000f1\''
\set SC '\'10000000-0000-4000-8261-0000000000c0\''

\echo '== 1. Права на функции: anon — ничего; authenticated — только клиентские; внутренние — никому'
select f.fn,
       has_function_privilege('anon', f.fn, 'execute') as anon,
       has_function_privilege('authenticated', f.fn, 'execute') as auth,
       (not has_function_privilege('anon', f.fn, 'execute')) and has_function_privilege('authenticated', f.fn, 'execute') = f.client as ok
  from (values
    ('public.student_overview_for_staff(uuid, text)', true),
    ('public.student_progress_report(uuid, date, date)', true),
    ('public.student_exam_forecast_evidence()', true),
    ('public.student_school_points()', true),
    ('public.student_forecast_evidence_of(uuid, timestamptz)', false),
    ('public.student_school_points_of(uuid)', false),
    ('public.student_work_rows(uuid)', false)
  ) f(fn, client);

\echo '== 2. anon: отказ (нет execute)'
begin;
set local role anon;
do $$ begin perform public.student_overview_for_staff('10000000-0000-4000-8000-0000000000a1'); raise notice 'FAIL: anon получил карточку';
exception when insufficient_privilege then raise notice 'OK: anon overview — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin perform public.student_progress_report('10000000-0000-4000-8000-0000000000a1', current_date - 30, current_date); raise notice 'FAIL: anon получил отчёт';
exception when insufficient_privilege then raise notice 'OK: anon report — % (%)', sqlerrm, sqlstate; end $$;
rollback;

\echo '== 3. authenticated без sub: «нужен вход» (42501)'
begin;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.student_overview_for_staff('10000000-0000-4000-8000-0000000000a1'); raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: без входа — % (%)', sqlerrm, sqlstate; end $$;
rollback;

\echo '== 4. Чужой учитель O, ученик A про себя, ученик B про A — 42501; внутренние функции — 42501'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.student_overview_for_staff('10000000-0000-4000-8000-0000000000a1'); raise notice 'FAIL: чужой учитель видит карточку';
exception when insufficient_privilege then raise notice 'OK: чужой учитель, карточка — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin perform public.student_progress_report('10000000-0000-4000-8000-0000000000a1', current_date - 30, current_date); raise notice 'FAIL: чужой учитель видит отчёт';
exception when insufficient_privilege then raise notice 'OK: чужой учитель, отчёт — % (%)', sqlerrm, sqlstate; end $$;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.student_overview_for_staff('10000000-0000-4000-8000-0000000000a1'); raise notice 'FAIL: ученик видит свою учительскую карточку';
exception when insufficient_privilege then raise notice 'OK: ученик A про себя — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin perform public.student_work_rows('10000000-0000-4000-8000-0000000000a1'); raise notice 'FAIL: внутренняя доступна';
exception when insufficient_privilege then raise notice 'OK: student_work_rows — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin perform public.student_forecast_evidence_of('00000000-0000-4000-8000-0000000000b1', now()); raise notice 'FAIL: внутренняя доступна';
exception when insufficient_privilege then raise notice 'OK: student_forecast_evidence_of — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin perform public.student_school_points_of('00000000-0000-4000-8000-0000000000b1'); raise notice 'FAIL: внутренняя доступна';
exception when insufficient_privilege then raise notice 'OK: student_school_points_of — % (%)', sqlerrm, sqlstate; end $$;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.student_overview_for_staff('10000000-0000-4000-8000-0000000000a1'); raise notice 'FAIL: ученик B видит A';
exception when insufficient_privilege then raise notice 'OK: ученик B про A — % (%)', sqlerrm, sqlstate; end $$;
rollback;

\echo '== 5. Учитель курса T → карточка A приходит; админ M → тоже'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select jsonb_array_length(x->'subjects') as subjects,
       jsonb_array_length(x->'assessments') as assessments,
       jsonb_array_length(x->'homeworks') as homeworks,
       jsonb_array_length(x->'forecast'->'evidence') as evidence,
       x->'forecast'->'subjects' as fc_subjects,
       x->'activity'->'streak' as streak, x->'activity'->'record' as record,
       jsonb_array_length(x->'activity'->'days') as days14,
       x->'activity'->'daily' as daily,
       x->'activity'->'catalog' as catalog,
       x->'achievements'->'total' as ach_total,
       x->'points'->'level'->>'n' as level, x->'points'->'levels_count' as levels,
       x->'next_steps'->'steps' as next_steps,
       (select count(*) from jsonb_array_elements(x->'assessments') a where a->>'subject' = 'physics') = 3
         and jsonb_array_length(x->'forecast'->'evidence') > 0
         and (x->'points'->>'levels_count')::int = 20 and (x->'achievements'->>'total')::int = 79 as ok
  from (select public.student_overview_for_staff(:SA) as x) t;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select jsonb_array_length(x->'assessments') as assessments, jsonb_array_length(x->'homeworks') as homeworks, true as ok
  from (select public.student_overview_for_staff(:SA) as x) t;
rollback;

\echo '== 6. Проверочные A (физика): баллы 10 из 12 (не решено = 0), средняя по классу 29/7, будущая не попала, пропущенная — без оценки'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select a->>'title' as title, a->>'kind' as kind, a->>'date' as date, a->>'status' as status, a->>'score' as score,
       a->>'points' as points, a->>'points_max' as points_max, a->>'class_avg' as class_avg,
       a->>'class_graded' as class_graded, a->>'class_size' as class_size
  from (select public.student_overview_for_staff(:SA) as x) t, jsonb_array_elements(x->'assessments') a;
select (select a->>'points' from jsonb_array_elements(x->'assessments') a where a->>'title' = 'Движение по окружности') = '10'
   and (select a->>'points_max' from jsonb_array_elements(x->'assessments') a where a->>'title' = 'Движение по окружности') = '12'
   and (select (a->>'class_avg')::numeric from jsonb_array_elements(x->'assessments') a where a->>'title' = 'Движение по окружности') = 4.14
   and (select (a->>'class_graded')::int from jsonb_array_elements(x->'assessments') a where a->>'title' = 'Движение по окружности') = 7
   and (select a->'points' from jsonb_array_elements(x->'assessments') a where a->>'title' = 'Кинематика: броски') = 'null'::jsonb
   and (select (a->>'class_avg')::numeric from jsonb_array_elements(x->'assessments') a where a->>'title' = 'Кинематика: броски') = 4.00
   and not exists (select 1 from jsonb_array_elements(x->'assessments') a where a->>'title' = 'Динамика (будет)')
   and (select a->'status' from jsonb_array_elements(x->'assessments') a where a->>'title' = 'Статика (пропустил)') = 'null'::jsonb
   as ok
  from (select public.student_overview_for_staff(:SA) as x) t;
rollback;

\echo '== 7. ДЗ A (физика): срок и ПЕРВАЯ сдача; закрытая тема и черновик ДЗ не попали'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select h->>'title' as title, h->>'due_at' as due_at, (h->>'first_submitted_at')::timestamptz::date as first_submitted,
       h->>'status' as status, h->>'score' as score
  from (select public.student_overview_for_staff(:SA, 'physics') as x) t, jsonb_array_elements(x->'homeworks') h;
select not exists (select 1 from jsonb_array_elements(x->'homeworks') h where h->>'title' in ('Закрытая тема', 'Черновик ДЗ'))
   and exists (select 1 from jsonb_array_elements(x->'homeworks') h where h->>'title' = 'Кинематика. Теория' and h->'first_submitted_at' = 'null'::jsonb)
   and (select count(*) from jsonb_array_elements(x->'homeworks')) = 4
   and (select bool_and(h->>'subject' = 'physics') from jsonb_array_elements(x->'homeworks') h)
   as ok
  from (select public.student_overview_for_staff(:SA, 'physics') as x) t;
\echo '-- фильтр предмета: math — работ физики нет, свидетельства только math'
select (select count(*) from jsonb_array_elements(x->'assessments') a where a->>'subject' <> 'math') as not_math_assessments,
       (select count(*) from jsonb_array_elements(x->'homeworks') h where h->>'subject' <> 'math') as not_math_hw,
       (select count(*) from jsonb_array_elements(x->'forecast'->'evidence') e where e->>'subject' <> 'math') as not_math_ev,
       (select count(*) from jsonb_array_elements(x->'assessments') a where a->>'subject' <> 'math') = 0
         and (select count(*) from jsonb_array_elements(x->'homeworks') h where h->>'subject' <> 'math') = 0
         and (select count(*) from jsonb_array_elements(x->'forecast'->'evidence') e where e->>'subject' <> 'math') = 0 as ok
  from (select public.student_overview_for_staff(:SA, 'math') as x) t;
rollback;

\echo '== 8. Ученик без данных (C): пустые массивы, не ошибка'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select jsonb_array_length(x->'assessments') as assessments, jsonb_array_length(x->'homeworks') as homeworks,
       jsonb_array_length(x->'forecast'->'evidence') as evidence, jsonb_array_length(x->'activity'->'days') as days,
       x->'activity'->'streak' as streak, x->'points'->'total' as points, x->'next_steps' as next_steps,
       jsonb_array_length(x->'assessments') = 0 and jsonb_array_length(x->'homeworks') = 0
         and jsonb_array_length(x->'forecast'->'evidence') = 0 and jsonb_array_length(x->'activity'->'days') = 0
         and (x->'activity'->>'streak')::int = 0 and x->'next_steps' = 'null'::jsonb as ok
  from (select public.student_overview_for_staff(:SC) as x) t;
select jsonb_array_length(r->'subjects') as subjects,
       (select jsonb_array_length(s->'assessments') + jsonb_array_length(s->'homeworks') from jsonb_array_elements(r->'subjects') s) as works,
       r->'diligence' as diligence,
       (select jsonb_array_length(s->'assessments') + jsonb_array_length(s->'homeworks') from jsonb_array_elements(r->'subjects') s) = 0
         and (r->'diligence'->>'solve_days')::int = 0 as ok
  from (select public.student_progress_report(:SC, current_date - 30, current_date) as r) t;
rollback;

\echo '== 9. Отчёт A за 30 дней: новые поля'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select s->>'subject' as subject, s->>'exam_type' as exam, s->>'target' as target, s->>'exam_goal' as exam_goal,
       jsonb_array_length(s->'assessments') as assessments, jsonb_array_length(s->'homeworks') as homeworks
  from (select public.student_progress_report(:SA, current_date - 30, current_date) as r) t, jsonb_array_elements(r->'subjects') s;
select a->>'title' as title, a->>'score' as score, a->>'points' as points, a->>'points_max' as points_max,
       a->>'class_avg' as class_avg, a->>'class_size' as class_size
  from (select public.student_progress_report(:SA, current_date - 30, current_date) as r) t,
       jsonb_array_elements(r->'subjects') s, jsonb_array_elements(s->'assessments') a
 where s->>'subject' = 'physics';
select r->'diligence' as diligence, jsonb_array_length(r->'forecast'->'evidence') as evidence,
       (select s->>'exam_goal' from jsonb_array_elements(r->'subjects') s where s->>'subject' = 'physics' and s->>'exam_type' = 'ege') = '75'
         and (select s->'exam_goal' from jsonb_array_elements(r->'subjects') s where s->>'subject' = 'math' and s->>'exam_type' = 'oge') = 'null'::jsonb
         and (select jsonb_array_length(s->'assessments') from jsonb_array_elements(r->'subjects') s where s->>'subject' = 'physics') = 3
         -- «Импульс (впереди)» — срок через 4 дня, вне периода
         and (select jsonb_array_length(s->'homeworks') from jsonb_array_elements(r->'subjects') s where s->>'subject' = 'physics') = 3
         and (r->'diligence'->>'levels_count')::int = 20 and (r->'diligence'->>'achievements_total')::int = 79
         and (r->'diligence'->>'period_days')::int = 31
         and jsonb_array_length(r->'forecast'->'evidence') > 0 as ok
  from (select public.student_progress_report(:SA, current_date - 30, current_date) as r) t;
\echo '-- период в прошлом: прогноз на конец периода (now = конец дня p_to), работ периода нет'
select r->'forecast'->>'now' as fc_now, r->'forecast'->>'today' as fc_today, jsonb_array_length(r->'forecast'->'evidence') as evidence,
       (r->'forecast'->>'today')::date = current_date - 150
         and (select bool_and((e->>'at')::timestamptz <= (r->'forecast'->>'now')::timestamptz) from jsonb_array_elements(r->'forecast'->'evidence') e) is not false as ok
  from (select public.student_progress_report(:SA, current_date - 250, current_date - 150) as r) t;
rollback;

\echo '== 10. Приватность: в классе меньше шести — средняя по классу в отчёте не печатается (на карточке учителя — есть)'
begin;
delete from public.group_students where group_id = '40000000-0000-4000-8000-000000000002'
   and student_id in ('10000000-0000-4000-8261-000000000005', '10000000-0000-4000-8261-000000000006');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select a->>'title' as title, a->>'class_avg' as report_class_avg, a->>'class_size' as class_size,
       a->'class_avg' = 'null'::jsonb and (a->>'class_size')::int = 5 as ok
  from (select public.student_progress_report(:SA, current_date - 30, current_date) as r) t,
       jsonb_array_elements(r->'subjects') s, jsonb_array_elements(s->'assessments') a
 where s->>'subject' = 'physics' and a->>'title' = 'Движение по окружности';
select a->>'class_avg' as card_class_avg, a->'class_avg' <> 'null'::jsonb as ok
  from (select public.student_overview_for_staff(:SA) as x) t, jsonb_array_elements(x->'assessments') a
 where a->>'title' = 'Движение по окружности';
rollback;

\echo '== 11. Прежний контракт: ответы ученика и прежние поля отчёта — как до PENDING_261'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select 'evidence A' as what, (public.student_exam_forecast_evidence() - 'now') = ((select v from public._probe_old where k = 'fc_a') - 'now') as ok;
select 'school points A' as what, public.student_school_points() = (select v from public._probe_old where k = 'sp_a') as ok;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select 'evidence H' as what, (public.student_exam_forecast_evidence() - 'now') = ((select v from public._probe_old where k = 'fc_h') - 'now') as ok;
select 'school points H' as what, public.student_school_points() = (select v from public._probe_old where k = 'sp_h') as ok;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
-- прежние поля: новый ответ без новых ключей (и без generated_at) = старый без generated_at
select x.k as what,
       (x.new - 'generated_at' - 'forecast' - 'diligence')
         || jsonb_build_object('subjects', coalesce((select jsonb_agg(s - 'exam_goal' - 'assessments' - 'homeworks') from jsonb_array_elements(x.new->'subjects') s), '[]'::jsonb))
       = (x.old - 'generated_at') as ok
  from (
    select 'report A' as k, public.student_progress_report(:SA, current_date - 30, current_date) as new, (select v from public._probe_old where k = 'rep_a') as old
    union all
    select 'report H', public.student_progress_report(:SH, current_date - 60, current_date), (select v from public._probe_old where k = 'rep_h')
    union all
    select 'report A old period', public.student_progress_report(:SA, current_date - 250, current_date - 150), (select v from public._probe_old where k = 'rep_a_old_period')
  ) x;
rollback;

\echo '== 12. Время: тяжёлый H (60 ДЗ, 8 проверочных × 25 учеников, 600 проверок каталога, 6 пробников) и A — учитель T'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select jsonb_array_length(x->'assessments') as assessments, jsonb_array_length(x->'homeworks') as homeworks,
       jsonb_array_length(x->'forecast'->'evidence') as evidence, length(x::text) as bytes
  from (select public.student_overview_for_staff(:SH) as x) t;
\timing on
select length(public.student_overview_for_staff(:SH)::text) as overview_h;
select length(public.student_overview_for_staff(:SH)::text) as overview_h;
select length(public.student_overview_for_staff(:SH)::text) as overview_h;
select length(public.student_overview_for_staff(:SA)::text) as overview_a;
select length(public.student_progress_report(:SH, current_date - 30, current_date)::text) as report_h;
select length(public.student_progress_report(:SA, current_date - 30, current_date)::text) as report_a;
\timing off
rollback;
