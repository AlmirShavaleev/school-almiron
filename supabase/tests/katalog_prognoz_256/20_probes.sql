-- §256. Пробы прав и смысла PENDING_256. Роль и claims — ОТДЕЛЬНЫМИ операторами (CLAUDE.md §29.4),
-- записи — в транзакциях, которые откатываются. Строка ответа: ok = совпало ли с ожиданием, рядом — факт.
\pset footer off
\set ON_ERROR_STOP off
\set A '\'00000000-0000-4000-8000-0000000000a1\''
\set B '\'00000000-0000-4000-8000-0000000000b1\''

\echo '== 1. Права на функции: аноним — ничего; authenticated — только клиентские; внутренние — никому'
select f.fn,
       has_function_privilege('anon', f.fn, 'execute') as anon,
       has_function_privilege('authenticated', f.fn, 'execute') as auth,
       (not has_function_privilege('anon', f.fn, 'execute')) and has_function_privilege('authenticated', f.fn, 'execute') = f.client as ok
  from (values
    ('public.catalog_check_answer(uuid, text)', true),
    ('public.catalog_reveal_answer(uuid)', true),
    ('public.catalog_practice_state(uuid, uuid[])', true),
    ('public.catalog_reward_rules()', true),
    ('public.student_daily_task(text)', true),
    ('public.student_weekly_goal(text)', true),
    ('public.student_catalog_week_for_staff(uuid)', true),
    ('public.student_home_activity(integer)', true),
    ('public.student_exam_forecast_evidence()', true),
    ('public.student_school_points()', true),
    ('public.student_exam_evidence_rows(uuid, timestamptz)', false),
    ('public.student_kim_zone_shares(uuid, text[], integer[], timestamptz[])', false),
    ('public.catalog_counted_solutions(uuid)', false),
    ('public.student_weak_numbers(uuid, text)', false),
    ('public.student_solve_days(uuid)', false),
    ('public.student_solve_streak(uuid, date)', false),
    ('public.catalog_zone_of(numeric)', false),
    ('public.catalog_task_verdict(text, text, text)', false),
    ('public.catalog_task_checkable(integer, text, text)', false)
  ) f(fn, client);

\echo '== 2. Аноним: проверка, раскрытие, задача дня — отказ; таблицы — отказ'
begin;
set local role anon;
do $$ begin perform public.catalog_check_answer('a5617000-0000-4000-8000-00000000000a', '7'); raise notice 'FAIL: аноним проверил';
exception when insufficient_privilege then raise notice 'OK: check — %', sqlerrm; end $$;
do $$ begin perform public.catalog_reveal_answer('a5617000-0000-4000-8000-00000000000a'); raise notice 'FAIL: аноним раскрыл';
exception when insufficient_privilege then raise notice 'OK: reveal — %', sqlerrm; end $$;
do $$ begin perform public.student_daily_task('math'); raise notice 'FAIL: аноним получил задачу дня';
exception when insufficient_privilege then raise notice 'OK: daily — %', sqlerrm; end $$;
do $$ begin perform count(*) from public.catalog_task_attempts; raise notice 'FAIL: аноним читает попытки';
exception when insufficient_privilege then raise notice 'OK: attempts select — %', sqlerrm; end $$;
rollback;

\echo '== 3. authenticated без sub: «нужен вход»'
begin;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.catalog_check_answer('a5617000-0000-4000-8000-00000000000a', '7'); raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: check — %', sqlerrm; end $$;
do $$ begin perform public.student_weekly_goal('math'); raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: weekly — %', sqlerrm; end $$;
rollback;

\echo '== 4. Ученик A: прямые insert/update/delete в новые таблицы — 42501'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin
  insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict) values (auth.uid(), 'a5617000-0000-4000-8000-00000000000a', '7', 'correct');
  raise notice 'FAIL: прямой insert попытки';
exception when insufficient_privilege then raise notice 'OK: insert attempts — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin
  update public.catalog_task_attempts set verdict = 'correct' where profile_id = auth.uid();
  raise notice 'FAIL: прямой update попытки';
exception when insufficient_privilege then raise notice 'OK: update attempts — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin
  delete from public.catalog_task_reveals where profile_id = auth.uid();
  raise notice 'FAIL: прямой delete раскрытия';
exception when insufficient_privilege then raise notice 'OK: delete reveals — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin
  insert into public.catalog_task_reveals (profile_id, task_id) values (auth.uid(), 'a5617000-0000-4000-8000-00000000000a');
  raise notice 'FAIL: прямой insert раскрытия';
exception when insufficient_privilege then raise notice 'OK: insert reveals — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin
  insert into public.student_daily_tasks (profile_id, day, subject, task_id, n) values (auth.uid(), current_date, 'math', 'a5617000-0000-4000-8000-00000000000a', 7);
  raise notice 'FAIL: прямой insert задачи дня';
exception when insufficient_privilege then raise notice 'OK: insert daily — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin
  insert into public.student_weekly_goals (profile_id, week_start, subject, numbers) values (auth.uid(), current_date, 'math', '{7}');
  raise notice 'FAIL: прямой insert цели недели';
exception when insufficient_privilege then raise notice 'OK: insert weekly — % (%)', sqlerrm, sqlstate; end $$;
rollback;

\echo '== 5. Видит только своё: A — 18 своих попыток; B — 0 (чужие не видны)'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select count(*) = 18 as ok, count(*) as a_sees from public.catalog_task_attempts;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
select count(*) = 0 as ok, count(*) as b_sees from public.catalog_task_attempts;
rollback;

\echo '== 6. Проверка: неверно → верно (засчитано, +5 «зона роста»), повтор — без записи и без баллов'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'verdict') = 'wrong' and (r->>'counted')::boolean = false and r->'answer_html' = 'null'::jsonb and (r->>'points')::int = 0 as ok,
       r->>'verdict' as verdict, r->>'zone' as zone, r->'answer_html' as answer
  from (select public.catalog_check_answer('a5617000-0000-4000-8000-00000000000a', '8') r) x;
select (r->>'verdict') = 'correct' and (r->>'counted')::boolean and r->>'zone' = 'growth' and (r->>'points')::int = 5
       and r->>'answer_html' = '<p>7</p>' and (r->>'solved')::int = 1 as ok,
       r->>'zone' as zone, r->>'points' as points, r->>'answer_html' as answer
  from (select public.catalog_check_answer('a5617000-0000-4000-8000-00000000000a', ' 7 ') r) x;
select (r->>'already_solved')::boolean and (r->>'points')::int = 0 as ok, r->>'verdict' as verdict
  from (select public.catalog_check_answer('a5617000-0000-4000-8000-00000000000a', '7') r) x;
select count(*) = 2 as ok, count(*) as attempts_7a from public.catalog_task_attempts where task_id = 'a5617000-0000-4000-8000-00000000000a';
-- верная задача — «Выполнено» и в каталоге (политик catalog_task_progress в слепке нет — смотрим владельцем)
reset role;
select count(*) = 1 as ok from public.catalog_task_progress where user_id = :A and task_id = 'a5617000-0000-4000-8000-00000000000a' and is_completed;
set local role authenticated;
-- в прогнозе: задача одной строкой, верно после неверной = 0,5. В одной транзакции now() один, поэтому
-- неверная попытка, сделанная выше, неотличима по времени от верной — для этой строки кладём её минутой раньше.
reset role;
update public.catalog_task_attempts set created_at = now() - interval '1 minute'
 where profile_id = :A and task_id = 'a5617000-0000-4000-8000-00000000000a' and verdict = 'wrong';
set local role authenticated;
select e->>'score' = '0.500' as ok, e->>'score' as score
  from jsonb_array_elements(public.student_exam_forecast_evidence()->'evidence') e
 where e->>'item' = 'catalog:a5617000-0000-4000-8000-00000000000a';
rollback;

\echo '== 7. Набор «-6; 7»: «7 -6» — верно, «7» — неверно; множественный выбор физики: «31» при эталоне «13» — верно'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select public.catalog_check_answer('a5617000-0000-4000-8000-00000000000b', '7')->>'verdict' = 'wrong' as ok;
select public.catalog_check_answer('a5617000-0000-4000-8000-00000000000b', '7 -6')->>'verdict' = 'correct' as ok;
select (r->>'verdict') = 'correct' and r->>'subject' = 'physics' and (r->>'n')::int = 7 as ok, r->>'zone' as zone, r->>'points' as points
  from (select public.catalog_check_answer('a561f000-0000-4000-8000-000000000001', '31') r) x;
rollback;

\echo '== 8. Раскрыл ответ → верная попытка НЕ засчитана (0 баллов, вне прогноза и баллов школы)'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
create temp table p8 on commit drop as select (public.student_school_points()->>'total')::int as before;
select r->>'answer_html' = '<p>0,5</p>' and (r->>'solved_before')::boolean = false as ok
  from (select public.catalog_reveal_answer('a5617000-0000-4000-8000-00000000000d') r) x;
select (r->>'verdict') = 'correct' and (r->>'counted')::boolean = false and (r->>'revealed_before')::boolean and (r->>'points')::int = 0 as ok,
       r->>'counted' as counted
  from (select public.catalog_check_answer('a5617000-0000-4000-8000-00000000000d', '0.5') r) x;
select count(*) = 0 as ok from jsonb_array_elements(public.student_exam_forecast_evidence()->'evidence') e
 where e->>'item' = 'catalog:a5617000-0000-4000-8000-00000000000d';
select (public.student_school_points()->>'total')::int = before as ok, before, (public.student_school_points()->>'total')::int as after from p8;
rollback;

\echo '== 9. Непроверяемые: эталон не берётся автопроверкой, вторая часть, снятая задача, пустой ответ'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.catalog_check_answer('a5617000-0000-4000-8000-00000000000c', 'x'); raise notice 'FAIL: непроверяемая проверена';
exception when sqlstate '22023' then raise notice 'OK: %', sqlerrm; end $$;
do $$ begin perform public.catalog_check_answer('a5613000-0000-4000-8000-000000000001', '5'); raise notice 'FAIL: вторая часть проверена';
exception when sqlstate '22023' then raise notice 'OK: часть 2 — %', sqlerrm; end $$;
do $$ begin perform public.catalog_check_answer('91000000-0000-4000-8000-000000000005', '1'); raise notice 'FAIL: снятая задача проверена';
exception when sqlstate 'P0002' then raise notice 'OK: снятая — %', sqlerrm; end $$;
do $$ begin perform public.catalog_check_answer('a5617000-0000-4000-8000-00000000000a', '   '); raise notice 'FAIL: пустой ответ';
exception when sqlstate '22023' then raise notice 'OK: пусто — %', sqlerrm; end $$;
rollback;

\echo '== 10. Зона и награды по таблице: границы 40 % / 70 % (как сервер), очки 5/3/1, вехи'
select v.share, public.catalog_zone_of(v.share) as zone, public.catalog_zone_of(v.share) = v.expect as ok
  from (values (null::numeric, 'growth'), (0.0, 'growth'), (0.3999, 'growth'), (0.4, 'progress'), (0.55, 'progress'),
               (0.7, 'progress'), (0.7001, 'confident'), (1.0, 'confident')) v(share, expect);
select z.zone, public.catalog_zone_points(z.zone) as per_task,
       array[public.catalog_zone_milestone(z.zone, 10), public.catalog_zone_milestone(z.zone, 20), public.catalog_zone_milestone(z.zone, 30), public.catalog_zone_milestone(z.zone, 11)] as miles,
       public.catalog_zone_points(z.zone) = z.p and array[public.catalog_zone_milestone(z.zone, 10), public.catalog_zone_milestone(z.zone, 20), public.catalog_zone_milestone(z.zone, 30), public.catalog_zone_milestone(z.zone, 11)] = z.m as ok
  from (values ('growth', 5, array[30, 50, 80, 0]), ('progress', 3, array[20, 30, 40, 0]), ('confident', 1, array[5, 5, 5, 0])) z(zone, p, m);

\echo '== 11. Зона на МОМЕНТ попытки: №6 «уверенно» (ДЗ: верно + частично = 0,75) → +1; №1: 10-я верная в «в процессе» (10/19 = 0,53) → +3 и веха +20'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
create temp table p11 on commit drop as select (public.student_school_points()->>'total')::int as before;
select r->>'zone' = 'confident' and (r->>'points')::int = 1 as ok, r->>'zone' as zone, r->>'share' as share, r->>'points' as points
  from (select public.catalog_check_answer('a5616000-0000-4000-8000-000000000001', '5') r) x;
select r->>'zone' = 'progress' and (r->>'points')::int = 3 and (r->>'solved')::int = 10 and (r->>'milestone_bonus')::int = 20 as ok,
       r->>'zone' as zone, r->>'share' as share, r->>'points' as points, r->>'solved' as solved, r->>'milestone_bonus' as milestone
  from (select public.catalog_check_answer('a5611000-0000-4000-8000-000000000019', '19') r) x;
-- баллы школы выросли ровно на начисленное (1 + 3 + 20); сегодня — первый день с решением, серия ≥ 2 не появилась
select (public.student_school_points()->>'total')::int - before = 24 as ok, before, (public.student_school_points()->>'total')::int as after from p11;
select count(*) = 1 as ok from jsonb_array_elements(public.student_school_points()->'feed') f where f->>'kind' = 'catalog_milestone' and (f->>'n')::int = 10;
-- «100 задач каталога»: засчитанные задачи с проверкой (9 + 2), самоотметки «Выполнено» не считаются
select (b->>'have')::int = 11 as ok, b->>'have' as have
  from jsonb_array_elements(public.student_school_points()->'badges') b where b->>'key' = 'catalog100';
rollback;

\echo '== 12. Прогноз: каталог — проверенные ответы (верные и неверные), самоотметки вне; вариант/урок — источник catalog'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select count(*) filter (where e->>'item' like 'catalog:a5611%') = 18
       and count(*) filter (where e->>'item' like 'catalog:a5611%' and e->>'score' = '0.000') = 9
       and count(*) filter (where e->>'item' in ('catalog:91000000-0000-4000-8000-000000000001', 'catalog:91000000-0000-4000-8000-000000000002')) = 0
       and count(*) filter (where e->>'item' like 'variant:%' and e->>'subject' = 'physics') = 1 as ok,
       count(*) filter (where e->>'source' = 'catalog') as catalog_rows
  from jsonb_array_elements(public.student_exam_forecast_evidence()->'evidence') e;
-- зоны номеров приходят с сервера; №6 — confident, №4 — growth (данных нет), засчитано №1 — 9
select (select n->>'zone' from jsonb_array_elements(r->'numbers') n where n->>'subject' = 'math' and (n->>'n')::int = 6) = 'confident'
   and (select n->>'zone' from jsonb_array_elements(r->'numbers') n where n->>'subject' = 'math' and (n->>'n')::int = 4) = 'growth'
   and (select (n->>'solved')::int from jsonb_array_elements(r->'numbers') n where n->>'subject' = 'math' and (n->>'n')::int = 1) = 9
   and r->'catalog_rules'->>'weekly_goal' = '40'
   and (select t->>'section_id' from jsonb_array_elements(r->'titles') t where t->>'subject' = 'math' and (t->>'n')::int = 7) = 'a5600000-0000-4000-8000-000000000007' as ok
  from (select public.student_exam_forecast_evidence() r) x;
rollback;

\echo '== 13. Задача дня: самый слабый номер (№4 — нет данных), стабильна в течение дня, +10 за верный в тот же день'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
create temp table p13 on commit drop as
  select public.student_daily_task('math') as r1, (public.student_school_points()->>'total')::int as before;
select (r1->>'n')::int = 4 and r1->>'zone' = 'growth' and (r1->>'bonus')::int = 10 and (r1->>'done')::boolean = false
       and jsonb_array_length(r1->'task'->'assets') >= 0 as ok, r1->>'n' as n, r1->'task'->>'id' as task from p13;
select (public.student_daily_task('math')->'task'->>'id') = (r1->'task'->>'id') as ok_same_task from p13;
select count(*) = 1 as ok from public.student_daily_tasks where profile_id = auth.uid();
-- решаем: ответ — эталон задачи
select (r->>'counted')::boolean and (r->>'daily_bonus')::int = 10 and (r->>'points')::int = 5 as ok, r->>'daily_bonus' as daily, r->>'points' as points
  from p13, lateral (select public.catalog_check_answer((r1->'task'->>'id')::uuid,
          case r1->'task'->>'id' when 'a5614000-0000-4000-8000-000000000001' then '0.25' else '0,5' end) r) x;
-- после решения номер №4 уже не «без данных», но задача дня — та же, done
select (r->'task'->>'id') = (r1->'task'->>'id') and (r->>'done')::boolean as ok
  from p13, lateral (select public.student_daily_task('math') r) x;
select (public.student_school_points()->>'total')::int - before = 15 as ok, before, (public.student_school_points()->>'total')::int as after from p13;
-- физика: тот же день, свой предмет — своя строка
select (public.student_daily_task('physics')->>'subject') = 'physics' as ok;
-- B (физика ЕГЭ) просит математику — задачи нет (не его предмет), записи нет
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
select public.student_daily_task('math')->'task' = 'null'::jsonb as ok;
do $$ begin perform public.student_daily_task('chemistry'); raise notice 'FAIL';
exception when sqlstate '22023' then raise notice 'OK: чужой предмет — %', sqlerrm; end $$;
rollback;

\echo '== 14. Цель недели: неделя с понедельника по Москве, два слабых номера, +40 один раз'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'week_start')::date = date_trunc('week', now() at time zone 'Europe/Moscow')::date
       and extract(isodow from (r->>'week_start')::date) = 1
       and (r->>'week_end')::date = (r->>'week_start')::date + 6
       and r->'numbers' = '[4, 7]'::jsonb and (r->>'target')::int = 10 and (r->>'progress')::int = 0 and (r->>'bonus')::int = 40 as ok,
       r->>'week_start' as week_start, r->'numbers' as numbers
  from (select public.student_weekly_goal('math') r) x;
select public.student_weekly_goal('math')->'numbers' = '[4, 7]'::jsonb as ok_fixed;
reset role;
update public.student_weekly_goals set target = 2 where profile_id = :A;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
create temp table p14 on commit drop as select (public.student_school_points()->>'total')::int as before;
select (r->>'weekly_bonus')::int = 0 and (r->'weekly'->>'progress')::int = 1 as ok from (select public.catalog_check_answer('a5614000-0000-4000-8000-000000000001', '0,25') r) x;
select (r->>'weekly_bonus')::int = 40 and (r->'weekly'->>'progress')::int = 2 as ok from (select public.catalog_check_answer('a5617000-0000-4000-8000-00000000000a', '7') r) x;
select (r->>'weekly_bonus')::int = 0 as ok_no_second_bonus from (select public.catalog_check_answer('a5614000-0000-4000-8000-000000000002', '0,5') r) x;
select count(*) = 1 as ok from jsonb_array_elements(public.student_school_points()->'feed') f where f->>'kind' = 'weekly';
-- 3 задачи «зоны роста» по 5 + 40 за цель
select (public.student_school_points()->>'total')::int - before = 55 as ok, before, (public.student_school_points()->>'total')::int as after from p14;
rollback;

\echo '== 15. Серия по дням с решением: заход без решения не продлевает, «сегодня ещё нет» не обнуляет'
-- B: заходил сегодня и вчера (app_visits), ничего не решал → серия 0 (по старому правилу было бы 2)
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'streak')::int = 0 and (r->>'visited_today')::boolean and r->>'streak_rule' = 'solve' as ok,
       r->>'streak' as streak, r->>'visited_today' as visited
  from (select public.student_home_activity(84) r) x;
rollback;
-- A: дни с решением — 2 и 3 дня назад (ДЗ, тест, каталог); «сегодня» = вчера → серия 2, не обнулена
select s.streak = 2 and not s.solved_today as ok, s.streak, s.record
  from public.student_solve_streak(:A, (now() at time zone 'Europe/Moscow')::date - 1) s;
-- … а «сегодня» настоящее: вчера ничего — серия 0
select s.streak = 0 as ok, s.streak from public.student_solve_streak(:A, (now() at time zone 'Europe/Moscow')::date) s;
-- верная задача каталога сегодня продлевает (решил сегодня → серия ≥ 1, solved_today)
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select public.catalog_check_answer('a5617000-0000-4000-8000-00000000000a', '7') is not null as checked;
select (r->>'streak')::int = 1 and (r->>'solved_today')::boolean
       and r->'streak_days' @> to_jsonb(array[((now() at time zone 'Europe/Moscow')::date)::text]) as ok, r->>'streak' as streak
  from (select public.student_home_activity(84) r) x;
rollback;
-- неверная и раскрытая попытки день не засчитывают
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select public.catalog_check_answer('a5617000-0000-4000-8000-00000000000a', '8') is not null as wrong_checked;
select public.catalog_reveal_answer('a5617000-0000-4000-8000-00000000000d') is not null,
       public.catalog_check_answer('a5617000-0000-4000-8000-00000000000d', '0,5') is not null;
select (public.student_home_activity(84)->>'solved_today')::boolean = false as ok;
rollback;

\echo '== 16. Лимит: не больше 30 проверок в минуту'
begin;
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, created_at)
select :B, ('a5611000-0000-4000-8000-' || lpad((1 + i % 20)::text, 12, '0'))::uuid, '0', 'wrong', now() - interval '10 seconds'
  from generate_series(1, 30) i;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.catalog_check_answer('a5617000-0000-4000-8000-00000000000a', '7'); raise notice 'FAIL: 31-я проверка прошла';
exception when sqlstate '54000' then raise notice 'OK: %', sqlerrm; end $$;
rollback;

\echo '== 17. Учитель: «каталог за 7 дней»: учитель курса A — видит; посторонний и сам ученик — отказ; админ — видит'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'tried')::int = 18 and (r->>'correct')::int = 9 as ok, r
  from (select public.student_catalog_week_for_staff('10000000-0000-4000-8000-0000000000a1') r) x;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true) \g /dev/null
do $$ begin perform public.student_catalog_week_for_staff('10000000-0000-4000-8000-0000000000a1'); raise notice 'FAIL: посторонний учитель';
exception when insufficient_privilege then raise notice 'OK: посторонний — %', sqlerrm; end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
do $$ begin perform public.student_catalog_week_for_staff('10000000-0000-4000-8000-0000000000a1'); raise notice 'FAIL: ученик сам';
exception when insufficient_privilege then raise notice 'OK: ученик — %', sqlerrm; end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true) \g /dev/null
select (public.student_catalog_week_for_staff('10000000-0000-4000-8000-0000000000a1')->>'tried')::int = 18 as ok_admin;
rollback;

\echo '== 18. Состояние страницы каталога: номер, зона, задачи (проверяема, попытки, раскрыта)'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select public.catalog_reveal_answer('a5617000-0000-4000-8000-00000000000d') is not null as revealed;
select r->'number'->>'zone' = 'growth' and (r->'number'->>'n')::int = 7 and r->'rules'->>'daily_task' = '10'
       and (select bool_and((t->>'checkable')::boolean = (t->>'task_id' <> 'a5617000-0000-4000-8000-00000000000c'))
              from jsonb_array_elements(r->'tasks') t)
       and (select (t->>'revealed')::boolean from jsonb_array_elements(r->'tasks') t where t->>'task_id' = 'a5617000-0000-4000-8000-00000000000d')
       and jsonb_array_length(r->'tasks') = 4 as ok
  from (select public.catalog_practice_state('a5600000-0000-4000-8000-000000000007',
          array['a5617000-0000-4000-8000-00000000000a', 'a5617000-0000-4000-8000-00000000000b',
                'a5617000-0000-4000-8000-00000000000c', 'a5617000-0000-4000-8000-00000000000d']::uuid[]) r) x;
-- раздел №1: засчитано 9, зона «в процессе»
select r->'number'->>'zone' = 'progress' and (r->'number'->>'solved')::int = 9 as ok
  from (select public.catalog_practice_state('a5600000-0000-4000-8000-000000000001') r) x;
rollback;
