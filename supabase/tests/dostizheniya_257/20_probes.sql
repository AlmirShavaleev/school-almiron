-- §257. Пробы прав и смысла PENDING_257.sql. Роль и claims — ОТДЕЛЬНЫМИ операторами (CLAUDE.md §29.4),
-- записи — в транзакциях, которые откатываются (кроме блока 6, где sync ученика A пишет награды для
-- следующих блоков — так проверяется «повтор не дублирует» и «не отнимается»).
-- Строка ответа: ok = совпало ли с ожиданием, рядом — факт.
\pset footer off
\set ON_ERROR_STOP off
\set A '\'00000000-0000-4000-8000-0000000000a1\''
\set B '\'00000000-0000-4000-8000-0000000000b1\''
\set SA '\'10000000-0000-4000-8000-0000000000a1\''

\echo '== 1. Права на функции: аноним — ничего; authenticated — только клиентские; внутренние — никому'
select f.fn,
       has_function_privilege('anon', f.fn, 'execute') as anon,
       has_function_privilege('authenticated', f.fn, 'execute') as auth,
       (not has_function_privilege('anon', f.fn, 'execute')) and has_function_privilege('authenticated', f.fn, 'execute') = f.client as ok
  from (values
    ('public.achievement_rules()', true),
    ('public.student_achievements_sync()', true),
    ('public.mark_achievements_seen()', true),
    ('public.claim_forecast_achievement(text, integer, integer)', true),
    ('public.student_achievements_for_staff(uuid)', true),
    ('public.student_school_points()', true),
    ('public.student_achievement_progress(uuid)', false)
  ) f(fn, client);

\echo '== 2. Аноним: функции и таблицы — отказ'
begin;
set local role anon;
do $$ begin perform public.student_achievements_sync(); raise notice 'FAIL: аноним вызвал sync';
exception when insufficient_privilege then raise notice 'OK: sync — %', sqlerrm; end $$;
do $$ begin perform public.mark_achievements_seen(); raise notice 'FAIL: аноним отметил';
exception when insufficient_privilege then raise notice 'OK: seen — %', sqlerrm; end $$;
do $$ begin perform public.claim_forecast_achievement('math', 40, 50); raise notice 'FAIL: аноним заявил прогноз';
exception when insufficient_privilege then raise notice 'OK: claim — %', sqlerrm; end $$;
do $$ begin perform public.student_achievements_for_staff('10000000-0000-4000-8000-0000000000a1'); raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: staff — %', sqlerrm; end $$;
do $$ begin perform count(*) from public.student_achievements; raise notice 'FAIL: аноним читает награды';
exception when insufficient_privilege then raise notice 'OK: select student_achievements — %', sqlerrm; end $$;
do $$ begin perform count(*) from public.student_forecast_marks; raise notice 'FAIL: аноним читает прогноз';
exception when insufficient_privilege then raise notice 'OK: select student_forecast_marks — %', sqlerrm; end $$;
rollback;

\echo '== 3. authenticated без sub: «нужен вход»'
begin;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.student_achievements_sync(); raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: sync — %', sqlerrm; end $$;
do $$ begin perform public.mark_achievements_seen(); raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: seen — %', sqlerrm; end $$;
do $$ begin perform public.claim_forecast_achievement('math', 40, 50); raise notice 'FAIL';
exception when insufficient_privilege then raise notice 'OK: claim — %', sqlerrm; end $$;
rollback;

\echo '== 4. Ученик A: прямые insert/update/delete в новые таблицы — 42501'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin
  insert into public.student_achievements (profile_id, key) values (auth.uid(), 'catalog:1000');
  raise notice 'FAIL: прямой insert награды';
exception when insufficient_privilege then raise notice 'OK: insert student_achievements — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin
  update public.student_achievements set seen_at = null where profile_id = auth.uid();
  raise notice 'FAIL: прямой update награды';
exception when insufficient_privilege then raise notice 'OK: update student_achievements — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin
  delete from public.student_achievements where profile_id = auth.uid();
  raise notice 'FAIL: прямой delete награды';
exception when insufficient_privilege then raise notice 'OK: delete student_achievements — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin
  insert into public.student_forecast_marks (profile_id, subject, first_score, last_score) values (auth.uid(), 'math', 0, 100);
  raise notice 'FAIL: прямой insert прогноза';
exception when insufficient_privilege then raise notice 'OK: insert student_forecast_marks — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin
  update public.student_forecast_marks set first_score = 0 where profile_id = auth.uid();
  raise notice 'FAIL: прямой update прогноза';
exception when insufficient_privilege then raise notice 'OK: update student_forecast_marks — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin
  perform public.student_achievement_progress(auth.uid());
  raise notice 'FAIL: внутренняя функция доступна';
exception when insufficient_privilege then raise notice 'OK: student_achievement_progress — % (%)', sqlerrm, sqlstate; end $$;
rollback;

\echo '== 5. Правила: 79 наград, 16 категорий, уровень по месту в лестнице, особые — золото +50, прогноз — +0'
select count(*) as n, count(distinct key) as keys, count(distinct category) as cats,
       count(*) = 79 and count(distinct key) = 79 and count(distinct category) = 16 as ok
  from public.achievement_rules();
select category, string_agg(threshold || '→' || tier || '/+' || points, ' ' order by ord) as ladder
  from public.achievement_rules() group by category order by min(ord);
select (select string_agg(tier::text, '' order by ord) from public.achievement_rules() where category = 'catalog') = '111222334'
   and (select string_agg(tier::text, '' order by ord) from public.achievement_rules() where category = 'five') = '1124'
   and (select string_agg(tier::text, '' order by ord) from public.achievement_rules() where category = 'ontime') = '11234'
   and (select bool_and(tier = 3 and (points = 50 or key = 'special:goal')) from public.achievement_rules() where category = 'special')
   and (select bool_and(points = 0) from public.achievement_rules() where category = 'forecast' or key = 'special:goal')
   and (select array_agg(distinct points order by points) from public.achievement_rules() where category not in ('forecast', 'special')) = '{10,25,50,100}'
   as ok;

\echo '== 6. Ученик A: первый sync — have по категориям, полученные вставлены с моментом из истории, fresh у всех'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
set role authenticated;
\timing on
create temp table s1 as select public.student_achievements_sync() as j;
\timing off
reset role;
select (j->>'total')::int as total, (j->>'earned')::int as earned, (j->>'new')::int as new,
       (select count(*) from jsonb_array_elements(j->'items') x where (x->>'fresh')::boolean) as fresh,
       (select count(*) from public.student_achievements where profile_id = :A) as rows,
       (j->>'total')::int = 79 and (j->>'earned')::int = (select count(*) from public.student_achievements where profile_id = :A)
         and (j->>'new')::int = (j->>'earned')::int
         and (select count(*) from jsonb_array_elements(j->'items') x where (x->>'fresh')::boolean) = (j->>'earned')::int as ok
  from s1;
-- have по каждой категории (наибольшее «have» среди наград категории) и что ожидалось по данным §255–§257
with h as (
  select x->>'category' as category, max((x->>'have')::int) as have
    from s1, jsonb_array_elements(j->'items') x where x->>'category' <> 'special' group by 1
), exp(category, want, why) as (values
  ('catalog', 14, '№1: 9 верных 3 дня назад + 1 вчера; №4: 4 верных'),
  ('hw', 6, '6 разных сданных ДЗ (одно — 200 дней назад, одно ОГЭ)'),
  ('ontime', 5, 'все, кроме №13-14 (сдано после срока)'),
  ('five', 1, '«5» за ДЗ №6 после доработки'),
  ('mock', 1, 'один пробник с баллами'),
  ('mockscore', 27, 'первичный 2 → score_scale[3] = 27'),
  ('streak', 3, 'дни с решением: 3, 2, 1 день назад'),
  ('daily', 1, 'задача дня вчера, решена вчера'),
  ('weekly', 0, 'целей недели нет'),
  ('confident', 2, '№4 математики (0,8) и №7 физики'),
  ('closed', 1, '№4: первая неверная 20 дней назад — зона роста с данными, сейчас уверенно'),
  ('forecast', 0, 'прогноз ещё не заявлен'),
  ('tests', 1, 'один завершённый тест'),
  ('topics', 4, 'topic_done_events: темы с принятым ДЗ'),
  ('redo', 1, 'ДЗ №6: вернули → пересдал'))
select e.category, h.have, e.want, h.have = e.want as ok, e.why from exp e left join h on h.category = e.category order by e.category;
select x->>'key' as key, (x->>'have')::int as have, (x->>'need')::int as need, x->>'earned_at' is not null as earned,
       ((x->>'earned_at') is not null) = w.earned and (x->>'have')::int = w.have and (x->>'need')::int = w.need as ok
  from s1, jsonb_array_elements(j->'items') x
  join (values ('special:flawless', 14, 10, true), ('special:marathon', 9, 30, false), ('special:early', 1, 1, true),
               ('special:all_numbers', 2, 12, false), ('special:full_kim', 1, 12, false), ('special:goal', 0, 1, false))
       w(key, have, need, earned) on w.key = x->>'key';
\echo '-- earned_at — момент события из истории (не now())'
select k.key, sa.earned_at, k.want,
       abs(extract(epoch from sa.earned_at - k.want)) < 1 as ok
  from public.student_achievements sa
  join (values
    ('hw:1', (select min(a.submitted_at) from public.topic_homework_attempts a where a.student_id = :SA)),
    ('catalog:10', (select at from public.catalog_counted_solutions(:A) order by at, task_id offset 9 limit 1)),
    ('mockscore:27', (select coalesce(starts_at, date) from public.mock_exams where id = '94100000-0000-4000-8000-000000000001')),
    ('special:flawless', (select created_at from public.catalog_task_attempts where profile_id = :A and verdict = 'correct' and not revealed_before order by created_at offset 9 limit 1)),
    ('redo:1', (select submitted_at from public.topic_homework_attempts where id = '80000000-0000-4000-8000-000000000002'))
  ) k(key, want) on k.key = sa.key
 where sa.profile_id = :A;

\echo '== 7. Повторный sync не дублирует: строк столько же, fresh = 0, is_new остаётся'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
create temp table s2 on commit drop as select public.student_achievements_sync() as j;
select (j->>'earned')::int as earned,
       (select count(*) from jsonb_array_elements(j->'items') x where (x->>'fresh')::boolean) as fresh,
       (select count(*) from public.student_achievements) as my_rows,
       (j->>'earned')::int = (select (j->>'earned')::int from s1)
         and (select count(*) from jsonb_array_elements(j->'items') x where (x->>'fresh')::boolean) = 0
         and (j->>'new')::int = (j->>'earned')::int as ok
  from s2;
rollback;

\echo '== 8. Полученная награда не отнимается: сняли раздел №1 с публикации — have упал, награды остались'
begin;
update public.catalog_sections set is_published = false where id = 'a5600000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
create temp table s3 on commit drop as select public.student_achievements_sync() as j;
select x->>'key' as key, (x->>'have')::int as have, (x->>'need')::int as need, x->>'earned_at' is not null as earned,
       x->>'earned_at' is not null and (x->>'have')::int < (x->>'need')::int as ok
  from s3, jsonb_array_elements(j->'items') x where x->>'key' in ('catalog:10', 'catalog:5');
-- без №1 каталога №1 стал «уверенно» по пробнику — может добавиться награда; прежние все на месте
select (j->>'earned')::int as earned_after, (select (j->>'earned')::int from s1) as earned_before,
       (select count(*) from s1, jsonb_array_elements(s1.j->'items') b
          join jsonb_array_elements(s3.j->'items') a on a->>'key' = b->>'key'
         where b->>'earned_at' is not null and a->>'earned_at' is null) as lost,
       (select count(*) from s1, jsonb_array_elements(s1.j->'items') b
          join jsonb_array_elements(s3.j->'items') a on a->>'key' = b->>'key'
         where b->>'earned_at' is not null and a->>'earned_at' is null) = 0 as ok from s3;
rollback;

\echo '== 9. Баллы школы: + баллы наград (без двойного счёта), 20 уровней, старых значков нет'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
create temp table p1 on commit drop as select public.student_school_points() as j;
select public.student_achievements_sync() \g /dev/null
create temp table p2 on commit drop as select public.student_school_points() as j;
select (p1.j->>'total')::int as total, (p1.j->>'achievement_points')::int as from_awards,
       (select sum(r.points) from public.student_achievements sa join public.achievement_rules() r on r.key = sa.key) as want,
       (p1.j->>'achievement_points')::int = (select sum(r.points) from public.student_achievements sa join public.achievement_rules() r on r.key = sa.key)
         and p1.j = p2.j as ok
  from p1, p2;
select jsonb_array_length(j->'levels') as levels, j->'level_names'->>19 as last_name, j->'level' as level,
       j ? 'badges' as has_badges,
       jsonb_array_length(j->'levels') = 20 and j->'level_names'->>19 = 'Вершина' and not j ? 'badges' as ok
  from p1;
select f->>'kind' as kind, f->>'title' as title, f->>'points' as points from p1, jsonb_array_elements(j->'feed') f;
select exists (select 1 from p1, jsonb_array_elements(j->'feed') f where f->>'kind' = 'achievement') as ok_feed_has_awards;
rollback;
-- Без наград (до первого sync) баллов наград 0, после — ровно их сумма: проверяем на ученике B.
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
create temp table b1 on commit drop as select public.student_school_points() as j;
select public.student_achievements_sync() \g /dev/null
create temp table b2 on commit drop as select public.student_school_points() as j;
select (b1.j->>'total')::int as before, (b2.j->>'total')::int as after, (b2.j->>'achievement_points')::int as awards,
       (b1.j->>'achievement_points')::int = 0
         and (b2.j->>'total')::int - (b1.j->>'total')::int = (b2.j->>'achievement_points')::int
         and (b2.j->>'achievement_points')::int > 0 as ok
  from b1, b2;
rollback;

\echo '== 10. Новые и увиденные: mark_achievements_seen → new 0; новая награда после — new 1, fresh 1'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select public.mark_achievements_seen() as marked, public.mark_achievements_seen() as marked_again;
select (j->>'new')::int as new_after_seen, (j->>'new')::int = 0 as ok from (select public.student_achievements_sync() as j) x;
reset role;
-- ещё 6 засчитанных задач каталога (№1 №10…15 — были неверны, теперь верно) → 20
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, created_at)
select :A, ('a5611000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, i::text, 'correct', now() - interval '1 hour'
  from generate_series(10, 15) i;
set local role authenticated;
select (j->>'new')::int as new, (select string_agg(x->>'key', ',') from jsonb_array_elements(j->'items') x where (x->>'fresh')::boolean) as fresh,
       (j->>'new')::int = 1 and (select string_agg(x->>'key', ',') from jsonb_array_elements(j->'items') x where (x->>'fresh')::boolean) = 'catalog:20' as ok
  from (select public.student_achievements_sync() as j) x;
select count(*) filter (where seen_at is null) as unseen_rows, count(*) filter (where seen_at is null) = 1 as ok from public.student_achievements;
rollback;

\echo '== 11. claim_forecast_achievement: правдоподобие, первый показ запоминается один раз, без баллов школы'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
create temp table c0 on commit drop as select public.student_school_points() as j;
do $$ begin perform public.claim_forecast_achievement('math', 40, 101); raise notice 'FAIL: 101 принято';
exception when invalid_parameter_value then raise notice 'OK: 101 — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin perform public.claim_forecast_achievement('math', -1, 50); raise notice 'FAIL: −1 принято';
exception when invalid_parameter_value then raise notice 'OK: −1 — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin perform public.claim_forecast_achievement('math', null, 50); raise notice 'FAIL: null принят';
exception when invalid_parameter_value then raise notice 'OK: null — % (%)', sqlerrm, sqlstate; end $$;
do $$ begin perform public.claim_forecast_achievement('chemistry', 40, 50); raise notice 'FAIL: чужой предмет';
exception when invalid_parameter_value then raise notice 'OK: chemistry — % (%)', sqlerrm, sqlstate; end $$;
select j->'fresh' as fresh, j->>'growth' as growth, j->'fresh' = '["forecast:5"]' as ok
  from (select public.claim_forecast_achievement('math', 40, 46) as j) x;
-- «первый» второй раз игнорируется: рост — от 40, а не от 0
select j->'fresh' as fresh, j->>'first' as first, j->>'growth' as growth,
       j->>'first' = '40' and j->>'growth' = '50' and j->'fresh' = '["forecast:10", "forecast:20", "forecast:30"]' as ok
  from (select public.claim_forecast_achievement('math', 0, 90) as j) x;
-- цели нет — «Цель достигнута» не даётся; поставили цель 80 — даётся при 85
select j->'fresh' as fresh_no_goal, j->'fresh' = '[]' as ok from (select public.claim_forecast_achievement('math', 0, 95) as j) x;
select public.set_my_exam_goal('math', 80) \g /dev/null
select j->'fresh' as fresh, j->'fresh' = '["special:goal"]' as ok from (select public.claim_forecast_achievement('math', 0, 85) as j) x;
-- прогноз упал — награды остаются
select j->>'growth' as growth, (select count(*) from public.student_achievements where key like 'forecast:%' or key = 'special:goal') as kept,
       (select count(*) from public.student_achievements where key like 'forecast:%' or key = 'special:goal') = 5 as ok
  from (select public.claim_forecast_achievement('math', 0, 20) as j) x;
create temp table c1 on commit drop as select public.student_school_points() as j;
select (c0.j->>'total')::int as before, (c1.j->>'total')::int as after, (c0.j->>'total') = (c1.j->>'total') as ok_no_points from c0, c1;
select x->>'key' as key, (x->>'have')::int as have, x->>'earned_at' is not null as earned, (x->>'points')::int as points
  from (select public.student_achievements_sync() as j) s, jsonb_array_elements(j->'items') x
 where x->>'category' = 'forecast' or x->>'key' = 'special:goal';
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.claim_forecast_achievement('math', 40, 50); raise notice 'FAIL: B заявил математику без курса';
exception when invalid_parameter_value then raise notice 'OK: B math — % (%)', sqlerrm, sqlstate; end $$;
rollback;

\echo '== 12. Ученик видит только своё: B не видит наград и прогноза A'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select count(*) as visible_to_b, count(*) filter (where profile_id = '00000000-0000-4000-8000-0000000000a1') as of_a,
       count(*) filter (where profile_id = '00000000-0000-4000-8000-0000000000a1') = 0 as ok
  from public.student_achievements;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select count(*) as visible_to_a, count(*) = (select (j->>'earned')::int from s1) as ok from public.student_achievements;
rollback;

\echo '== 13. Учитель курса видит, посторонний и ученик — 42501, админ видит'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select j->>'earned' as earned, j->>'total' as total, jsonb_array_length(j->'latest') as latest,
       (j->>'earned')::int = (select (j->>'earned')::int from s1) and (j->>'total')::int = 79 and jsonb_array_length(j->'latest') = 3 as ok
  from (select public.student_achievements_for_staff('10000000-0000-4000-8000-0000000000a1') as j) x;
select x->>'key' as key, x->>'earned_at' as earned_at
  from (select public.student_achievements_for_staff('10000000-0000-4000-8000-0000000000a1') as j) s, jsonb_array_elements(j->'latest') x;
-- sync от учителя (у него нет строки students) — пустые have, без ошибок и без вставок
select (j->>'earned')::int as teacher_earned, (j->>'earned')::int = 0 as ok from (select public.student_achievements_sync() as j) x;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.student_achievements_for_staff('10000000-0000-4000-8000-0000000000a1'); raise notice 'FAIL: посторонний учитель видит';
exception when insufficient_privilege then raise notice 'OK: посторонний — % (%)', sqlerrm, sqlstate; end $$;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.student_achievements_for_staff('10000000-0000-4000-8000-0000000000a1'); raise notice 'FAIL: ученик зовёт функцию учителя';
exception when insufficient_privilege then raise notice 'OK: ученик — % (%)', sqlerrm, sqlstate; end $$;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (j->>'earned')::int as admin_sees, (j->>'earned')::int > 0 as ok
  from (select public.student_achievements_for_staff('10000000-0000-4000-8000-0000000000a1') as j) x;
rollback;

\echo '== 14. Время sync: A (малый) и X (12 номеров × 50 задач, 60 ДЗ с таблицей проверки, 6 пробников, 40 тестов, серия 120+ дней)'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
\timing on
select (j->>'earned')::int as x_earned_first from (select public.student_achievements_sync() as j) x;
select (j->>'earned')::int as x_earned_again from (select public.student_achievements_sync() as j) x;
select (j->>'total')::int as x_points from (select public.student_school_points() as j) x;
\timing off
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
\timing on
select (j->>'earned')::int as a_earned from (select public.student_achievements_sync() as j) x;
\timing off
rollback;
