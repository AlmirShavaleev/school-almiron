-- §260. Пробы PENDING_260: новые столбцы, их CHECK, заполнение таблицы с баллами, права.
-- Каждая проба: claims — отдельным set_config (CLAUDE.md §29.4), роль authenticated
-- (или anon) — set local role, затем вызов; ошибка ловится и печатается кодом.
-- Всё в одной транзакции с откатом в конце: записи проб в базе не остаются.
\pset footer off
begin;
create function pg_temp.probe(p_uid text, p_role text, p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '{}' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  if p_role is not null then execute format('set local role %I', p_role); end if;
  begin
    execute p_sql into v;
  exception when others then
    v := 'ОТКАЗ ' || sqlstate || ': ' || sqlerrm;
  end;
  reset role;
  return coalesce(v, '(пусто)');
end $$;
grant execute on function pg_temp.probe(text, text, text) to public;

create temp table probes (n serial, who text, action text, expected text, actual text);
grant all on probes to public;
grant all on sequence probes_n_seq to public;

\set T '''26000000-0000-0000-0000-0000000000a1'''
\set ST '''26000000-0000-0000-0000-000000000051'''
\set A1 '''26300000-0000-0000-0000-000000000001'''

-- at1: проверка §260 с баллами. Строки: годная, балл строкой «2», балл больше
-- максимума, нулевой максимум, «не сверено» с null.
insert into topic_homework_ai_jobs (attempt_id, status, tasks, points_total, points_max, grade_table, grading, created_at, completed_at)
values ('26300000-0000-0000-0000-000000000001', 'done', $j$[
  {"no":"1","verdict":"correct","points":1,"max_points":1,"student_answer":"T = 0,2 с","expected_answer":"T = 0,2 с"},
  {"no":"6","verdict":"partial","points":"2","max_points":2,"student_answer":"121","expected_answer":"112"},
  {"no":"7","verdict":"correct","points":5,"max_points":2,"student_answer":"","expected_answer":""},
  {"no":"8","verdict":"partial","points":1,"max_points":0},
  {"no":"9","verdict":"unchecked","points":null,"max_points":3},
  {"no":"10","verdict":"wrong","points":-1,"max_points":1}
]$j$, 9, 12, '[{"min":0,"max":4,"grade":2},{"min":5,"max":7,"grade":3},{"min":8,"max":10,"grade":4},{"min":11,"max":12,"grade":5}]', 'criteria',
  now(), now());

insert into probes (who, action, expected, actual) values
 ('владелец таблиц', 'старые строки ai_jobs после миграции',
  'обе без баллов: 2',
  pg_temp.probe(null, null, 'select count(*)::text from topic_homework_ai_jobs where attempt_id <> ''26300000-0000-0000-0000-000000000001'' and points_total is null and points_max is null and grade_table is null and grading is null')),
 ('владелец таблиц', 'ai_jobs.grading = ''other''',
  'ОТКАЗ 23514',
  pg_temp.probe(null, null, 'with i as (insert into topic_homework_ai_jobs (attempt_id, grading) values (''26300000-0000-0000-0000-000000000002'', ''other'') returning 1) select count(*)::text from i')),
 ('владелец таблиц', 'ai_jobs.grade_table — объект, а не массив',
  'ОТКАЗ 23514',
  pg_temp.probe(null, null, 'with i as (insert into topic_homework_ai_jobs (attempt_id, grade_table) values (''26300000-0000-0000-0000-000000000002'', ''{}'') returning 1) select count(*)::text from i')),
 ('владелец таблиц', 'ai_jobs.points_total < 0',
  'ОТКАЗ 23514',
  pg_temp.probe(null, null, 'with i as (insert into topic_homework_ai_jobs (attempt_id, points_total) values (''26300000-0000-0000-0000-000000000002'', -1) returning 1) select count(*)::text from i')),
 ('преподаватель', 'заполнение таблицы at1 из проверки с баллами',
  '6',
  pg_temp.probe(:T, 'authenticated', 'select public.topic_homework_review_tasks_seed(''26300000-0000-0000-0000-000000000001'')::text')),
 ('преподаватель', 'что легло: no/verdict/points/max_points',
  '1 correct 1/1; 6 partial ∅/2 (балл строкой — не число); 7 correct 2/2 (больше максимума → максимум); 8 partial ∅/∅ (максимум 0); 9 unchecked ∅/3; 10 wrong ∅/1 (балл < 0)',
  pg_temp.probe(:T, 'authenticated', 'select string_agg(format(''%s %s %s/%s'', no, verdict, coalesce(points::text, ''∅''), coalesce(max_points::text, ''∅'')), ''; '' order by position) from topic_homework_review_tasks where attempt_id = ''26300000-0000-0000-0000-000000000001''')),
 ('преподаватель', 'повторное заполнение — правки не затираются',
  '0',
  pg_temp.probe(:T, 'authenticated', 'select public.topic_homework_review_tasks_seed(''26300000-0000-0000-0000-000000000001'')::text')),
 ('преподаватель', '«+» по №9: points = 2 из 3 (вердикт пишет клиент)',
  '1',
  pg_temp.probe(:T, 'authenticated', 'with u as (update topic_homework_review_tasks set points = 2, verdict = ''partial'' where attempt_id = ''26300000-0000-0000-0000-000000000001'' and no = ''9'' returning 1) select count(*)::text from u')),
 ('преподаватель', 'points больше максимума (4 из 3)',
  'ОТКАЗ 23514',
  pg_temp.probe(:T, 'authenticated', 'with u as (update topic_homework_review_tasks set points = 4 where attempt_id = ''26300000-0000-0000-0000-000000000001'' and no = ''9'' returning 1) select count(*)::text from u')),
 ('преподаватель', 'points без максимума (№8)',
  'ОТКАЗ 23514',
  pg_temp.probe(:T, 'authenticated', 'with u as (update topic_homework_review_tasks set points = 1 where attempt_id = ''26300000-0000-0000-0000-000000000001'' and no = ''8'' returning 1) select count(*)::text from u')),
 ('преподаватель', 'points < 0',
  'ОТКАЗ 23514',
  pg_temp.probe(:T, 'authenticated', 'with u as (update topic_homework_review_tasks set points = -1 where attempt_id = ''26300000-0000-0000-0000-000000000001'' and no = ''9'' returning 1) select count(*)::text from u')),
 ('преподаватель', 'max_points = 0',
  'ОТКАЗ 23514',
  pg_temp.probe(:T, 'authenticated', 'with u as (update topic_homework_review_tasks set max_points = 0 where attempt_id = ''26300000-0000-0000-0000-000000000001'' and no = ''8'' returning 1) select count(*)::text from u')),
 ('преподаватель', 'обычное ДЗ at2: заполнение',
  '2',
  pg_temp.probe(:T, 'authenticated', 'select public.topic_homework_review_tasks_seed(''26300000-0000-0000-0000-000000000002'')::text')),
 ('преподаватель', 'обычное ДЗ at2: что легло',
  'баллов нет: 1 correct ∅/∅; 2 wrong ∅/∅',
  pg_temp.probe(:T, 'authenticated', 'select string_agg(format(''%s %s %s/%s'', no, verdict, coalesce(points::text, ''∅''), coalesce(max_points::text, ''∅'')), ''; '' order by position) from topic_homework_review_tasks where attempt_id = ''26300000-0000-0000-0000-000000000002''')),
 ('преподаватель', 'at3: таблица уже была — заполнение no-op',
  '0',
  pg_temp.probe(:T, 'authenticated', 'select public.topic_homework_review_tasks_seed(''26300000-0000-0000-0000-000000000003'')::text')),
 ('преподаватель', 'at3: строка прежняя (баллы проверки её не тронули)',
  '1 wrong ∅/∅',
  pg_temp.probe(:T, 'authenticated', 'select string_agg(format(''%s %s %s/%s'', no, verdict, coalesce(points::text, ''∅''), coalesce(max_points::text, ''∅'')), ''; '') from topic_homework_review_tasks where attempt_id = ''26300000-0000-0000-0000-000000000003''')),
 ('ученик', 'заполнение чужой проверкой',
  'ОТКАЗ P0001: Нет прав на проверку этой работы',
  pg_temp.probe(:ST, 'authenticated', 'select public.topic_homework_review_tasks_seed(''26300000-0000-0000-0000-000000000001'')::text')),
 ('ученик', 'правка балла своей работы до вердикта',
  '0 (RLS не отдаёт строки)',
  pg_temp.probe(:ST, 'authenticated', 'with u as (update topic_homework_review_tasks set points = 3 where attempt_id = ''26300000-0000-0000-0000-000000000001'' and no = ''9'' returning 1) select count(*)::text from u')),
 ('ученик', 'чтение своей таблицы до вердикта',
  '0',
  pg_temp.probe(:ST, 'authenticated', 'select count(*)::text from topic_homework_review_tasks where attempt_id = ''26300000-0000-0000-0000-000000000001''')),
 ('anon', 'заполнение',
  'ОТКАЗ 42501: permission denied for function',
  pg_temp.probe(null, 'anon', 'select public.topic_homework_review_tasks_seed(''26300000-0000-0000-0000-000000000001'')::text')),
 ('владелец таблиц', 'итог по №9 после всех проб',
  '9 partial 2/3 (отказанные правки не прошли)',
  pg_temp.probe(null, null, 'select format(''%s %s %s/%s'', no, verdict, points, max_points) from topic_homework_review_tasks where attempt_id = ''26300000-0000-0000-0000-000000000001'' and no = ''9''')),
 ('владелец таблиц', 'определение seed: security definer, search_path, execute у anon/public снят',
  'definer=t; path=t; anon=f; authenticated=t',
  pg_temp.probe(null, null, $$select format('definer=%s; path=%s; anon=%s; authenticated=%s', p.prosecdef, coalesce(array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%', false), has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute')) from pg_proc p where p.proname = 'topic_homework_review_tasks_seed'$$));

select n, who, action, expected, actual from probes order by n;
rollback;
