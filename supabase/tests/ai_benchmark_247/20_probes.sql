-- §247. Пробы: закрытость таблицы и функций, счёт отчёта на фикстуре 2 модели × 3 работы, кандидаты.
-- Каждая проба: claims — отдельным set_config (CLAUDE.md §29.4), затем set local role и вызов;
-- ошибка ловится и печатается кодом. Всё в одной транзакции с откатом в конце.
\pset footer off
begin;
create function pg_temp.probe(p_uid text, p_role text, p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{}' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
  exception when others then
    v := 'ОТКАЗ ' || sqlstate || ': ' || sqlerrm;
  end;
  reset role;
  return coalesce(v, '(пусто)');
end $$;

create temp table probes (n serial, who text, action text, expected text, actual text);

\set T '47000000-0000-0000-0000-0000000000a1'
\set A '47000000-0000-0000-0000-00000000000a'
\set S '47000000-0000-0000-0000-0000000000b1'

-- ── Закрыто от anon и authenticated ──────────────────────────────────
insert into probes (who, action, expected, actual) values
 ('преподаватель', 'select из ai_benchmark_results', 'ОТКАЗ 42501',
  pg_temp.probe(:'T', 'authenticated', $q$select count(*)::text from public.ai_benchmark_results$q$)),
 ('админ платформы', 'select из ai_benchmark_results', 'ОТКАЗ 42501',
  pg_temp.probe(:'A', 'authenticated', $q$select count(*)::text from public.ai_benchmark_results$q$)),
 ('ученик', 'select из ai_benchmark_results', 'ОТКАЗ 42501',
  pg_temp.probe(:'S', 'authenticated', $q$select count(*)::text from public.ai_benchmark_results$q$)),
 ('преподаватель', 'insert в ai_benchmark_results', 'ОТКАЗ 42501',
  pg_temp.probe(:'T', 'authenticated', $q$with i as (insert into public.ai_benchmark_results (run_id, attempt_id, model, status) values ('x', '47000000-0000-0000-0002-000000000001', 'm', 'ok') returning 1) select count(*)::text from i$q$)),
 ('anon', 'select из ai_benchmark_results', 'ОТКАЗ 42501',
  pg_temp.probe(null, 'anon', $q$select count(*)::text from public.ai_benchmark_results$q$)),
 ('админ платформы', 'ai_benchmark_report(''r1'')', 'ОТКАЗ 42501',
  pg_temp.probe(:'A', 'authenticated', $q$select count(*)::text from public.ai_benchmark_report('r1')$q$)),
 ('преподаватель', 'ai_benchmark_candidates()', 'ОТКАЗ 42501',
  pg_temp.probe(:'T', 'authenticated', $q$select count(*)::text from public.ai_benchmark_candidates()$q$)),
 ('anon', 'ai_benchmark_report(''r1'')', 'ОТКАЗ 42501',
  pg_temp.probe(null, 'anon', $q$select count(*)::text from public.ai_benchmark_report('r1')$q$)),
 ('преподаватель', 'ai_benchmark_task_key(''1'')', 'ОТКАЗ 42501',
  pg_temp.probe(:'T', 'authenticated', $q$select public.ai_benchmark_task_key('1')$q$));

insert into probes (who, action, expected, actual)
select 'каталог', 'RLS включена / политик / привилегии authenticated,anon / service_role',
       'rls=t; policies=0; auth=f,f,f,f; anon=f; service=t,t,t',
       format('rls=%s; policies=%s; auth=%s,%s,%s,%s; anon=%s; service=%s,%s,%s',
         (select relrowsecurity from pg_class where oid = 'public.ai_benchmark_results'::regclass),
         (select count(*) from pg_policies where tablename = 'ai_benchmark_results'),
         has_table_privilege('authenticated', 'public.ai_benchmark_results', 'select'),
         has_table_privilege('authenticated', 'public.ai_benchmark_results', 'insert'),
         has_function_privilege('authenticated', 'public.ai_benchmark_report(text)', 'execute'),
         has_function_privilege('authenticated', 'public.ai_benchmark_candidates()', 'execute'),
         has_table_privilege('anon', 'public.ai_benchmark_results', 'select'),
         has_table_privilege('service_role', 'public.ai_benchmark_results', 'insert'),
         has_function_privilege('service_role', 'public.ai_benchmark_report(text)', 'execute'),
         has_function_privilege('service_role', 'public.ai_benchmark_candidates()', 'execute'));

-- ── Сопоставление номеров — как normalizeTaskNo/noteTaskKey (значения JS посчитаны node) ──
insert into probes (who, action, expected, actual)
select 'postgres', 'ai_benchmark_task_key: «№␣4», « 4. », «12 А», «1 a» (тонкий), BOM+7, «Nº5»',
       '4|4|12а|1a|7|nº5',
       string_agg(public.ai_benchmark_task_key(x), '|' order by o)
  from unnest(array[E'№ 4', ' 4. ', '12 А', E'1 a', E'﻿7', 'Nº5']) with ordinality u(x, o);

insert into probes (who, action, expected, actual)
select 'postgres', 'ai_benchmark_five: 4/five, 89, 90, 49, 50/hundred, null, без шкалы',
       '4|4|5|2|3|-|-',
       concat_ws('|', public.ai_benchmark_five(4, 'five'), public.ai_benchmark_five(89, 'hundred'),
         public.ai_benchmark_five(90, 'hundred'), public.ai_benchmark_five(49, 'hundred'),
         public.ai_benchmark_five(50, 'hundred'),
         coalesce(public.ai_benchmark_five(null, 'five')::text, '-'), coalesce(public.ai_benchmark_five(50, null)::text, '-'));

-- ── Отчёт под service_role: ровно то, что посчитано вручную (см. 10_data_247.sql) ──
-- Столбцы: model, works, ok, error, unreadable, compared, pairs, matched, %, matched_seeded, %,
-- dangerous, stricter, ai_unchecked, missed, all_matched, %, no_dangerous, %, grade_pairs,
-- grade_matched, %, off_2plus, avg_in, avg_out, avg_cost, total_cost, avg_latency.
insert into probes (who, action, expected, actual) values
 ('service_role', 'ai_benchmark_report(''r1''): Qwen',
  '(qwen/qwen3-vl-235b-a22b-instruct,3,2,1,0,2,8,6,75.0,5,62.5,1,1,0,0,1,50.0,1,50.0,2,1,50.0,0,2000.0,283.3,0.015000,0.03,11666.7)',
  pg_temp.probe(null, 'service_role', $q$select r::text from public.ai_benchmark_report('r1') r where r.model like 'qwen/%'$q$)),
 ('service_role', 'ai_benchmark_report(''r1''): Gemini',
  '(google/gemini-3.8-flash,3,3,0,1,2,6,3,50.0,3,50.0,1,1,1,1,1,50.0,1,50.0,1,0,0.0,1,3750.0,450.0,0.003000,0.006,19000.0)',
  pg_temp.probe(null, 'service_role', $q$select r::text from public.ai_benchmark_report('r1') r where r.model like 'google/%'$q$)),
 ('service_role', 'ai_benchmark_report(''r1''): моделей (A4 не итог, A5 без таблицы, r0 — не в счёт)',
  '2',
  pg_temp.probe(null, 'service_role', $q$select count(*)::text from public.ai_benchmark_report('r1')$q$)),
 ('service_role', 'ai_benchmark_report(''нет такого'')', '0',
  pg_temp.probe(null, 'service_role', $q$select count(*)::text from public.ai_benchmark_report('нет такого')$q$)),
 ('postgres', 'ai_benchmark_report(''r0''): одна работа Gemini, 1 пара, не совпала (ИИ wrong / учитель correct — строже)',
  '(google/gemini-3.8-flash,1,1,0,0,1,1,0,0.0,0,0.0,0,1,0,4,0,0.0,1,100.0,1,0,0.0,1,1.0,1.0,1.000000,1,1.0)',
  (select r::text from public.ai_benchmark_report('r0') r));

-- ── Кандидаты: только итог учителя + таблица проверки + файлы, по дате сдачи ──
insert into probes (who, action, expected, actual) values
 ('service_role', 'ai_benchmark_candidates(): A3, A1, A2 (A4 не итог, A5 без таблицы, A6 без файлов)',
  '…03 returned_for_revision балл - строк 2/2 файлов 1; …01 accepted балл 4 строк 6/5 файлов 2; …02 accepted балл 80 строк 3/3 файлов 1',
  pg_temp.probe(null, 'service_role', $q$select string_agg(format('…%s %s балл %s строк %s/%s файлов %s', right(attempt_id::text, 2), status, coalesce(teacher_score::text, '-'), review_tasks, review_tasks_checked, files), '; ') from public.ai_benchmark_candidates()$q$));

-- ── Запись: повтор (run_id, attempt_id, model) перезаписывает; удаление попытки чистит результаты ──
insert into probes (who, action, expected, actual) values
 ('service_role', 'upsert того же ключа дважды (как edge-функция): строк 1, в ней второй статус',
  '1 error',
  pg_temp.probe(null, 'service_role', $q$with a as (insert into public.ai_benchmark_results (run_id, attempt_id, model, status) values ('rx', '47000000-0000-0000-0002-000000000001', 'google/gemini-3.8-flash', 'ok') on conflict (run_id, attempt_id, model) do update set status = excluded.status returning 1) select count(*)::text from a$q$));
insert into probes (who, action, expected, actual) values
 ('service_role', '', '',
  pg_temp.probe(null, 'service_role', $q$with a as (insert into public.ai_benchmark_results (run_id, attempt_id, model, status, error) values ('rx', '47000000-0000-0000-0002-000000000001', 'google/gemini-3.8-flash', 'error', 'x') on conflict (run_id, attempt_id, model) do update set status = excluded.status, error = excluded.error returning 1) select ''$q$));
update probes set actual = (select count(*)::text || ' ' || max(status) from ai_benchmark_results where run_id = 'rx')
 where action like 'upsert того же ключа%';
delete from probes where action = '';
insert into probes (who, action, expected, actual)
select 'service_role', 'второй insert того же ключа без on conflict', 'ОТКАЗ 23505',
  pg_temp.probe(null, 'service_role', $q$with a as (insert into public.ai_benchmark_results (run_id, attempt_id, model, status) values ('rx', '47000000-0000-0000-0002-000000000001', 'google/gemini-3.8-flash', 'ok') returning 1) select count(*)::text from a$q$);
insert into probes (who, action, expected, actual)
select 'service_role', 'статус вне ok/error', 'ОТКАЗ 23514',
  pg_temp.probe(null, 'service_role', $q$with a as (insert into public.ai_benchmark_results (run_id, attempt_id, model, status) values ('ry', '47000000-0000-0000-0002-000000000001', 'm', 'done') returning 1) select count(*)::text from a$q$);
delete from topic_homework_attempts where id = '47000000-0000-0000-0002-000000000003';
insert into probes (who, action, expected, actual)
select 'postgres', 'удалили попытку A3 — её строк замера не осталось', '0',
       (select count(*)::text from ai_benchmark_results where attempt_id = '47000000-0000-0000-0002-000000000003');

select n, who, action,
       case when actual = expected or (expected like 'ОТКАЗ %' and actual like expected || '%') then 'ok' else 'FAIL' end as verdict,
       expected, actual
  from probes order by n;
select count(*) filter (where not (actual = expected or (expected like 'ОТКАЗ %' and actual like expected || '%'))) as failed,
       count(*) as total
  from probes;
rollback;
