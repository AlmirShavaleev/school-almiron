-- §271. Пробы прав и поведения оценок уроков.
--
-- Пробы идут ПО ПОРЯДКУ и НЕ откатываются: повторная оценка проверяет upsert поверх первой, сводка — итог
-- всех предыдущих. Роль и claims — отдельными вызовами set_config до пробы (CLAUDE.md §29.4), после пробы роль
-- возвращается владельцу, и результат пишется в журнал уже под ним.
\pset footer off

create temp table actors (who text primary key, uid uuid);
insert into actors values
 ('ADM', '00000000-0000-0000-0000-00000000000a'),
 ('TA',  '00000000-0000-0000-0000-0000000000a1'),
 ('OWN', '00000000-0000-0000-0000-0000000000a2'),
 ('TB',  '00000000-0000-0000-0000-0000000000b1'),
 ('CUR', '00000000-0000-0000-0000-0000000000c1'),
 ('S1',  '00000000-0000-0000-0000-000000000051'),
 ('S2',  '00000000-0000-0000-0000-000000000052'),
 ('S3',  '00000000-0000-0000-0000-000000000053'),
 ('SC',  '00000000-0000-0000-0000-000000000055'),
 ('SX',  '00000000-0000-0000-0000-000000000056'),
 ('ANON', null);

create temp table probes (n serial, who text, action text, kind text, stmt text, expected text, actual text);

-- {A1} {A2} {A3} {B1} — темы; {CA} {CB} — курсы.
insert into probes (who, action, kind, stmt, expected) values
-- ── Оценка ────────────────────────────────────────────────────────────────
 ('S1',  'оценил открытый урок своего курса: 7', 'val', 'select public.rate_topic(''{A1}'', 7)->>''rating''', '7'),
 ('S1',  'своя оценка — 7', 'val', 'select public.my_topic_rating(''{A1}'')', '7'),
 ('S1',  'передумал: 9 (upsert)', 'val', 'select public.rate_topic(''{A1}'', 9)::text', '{"rating": 9, "updated_at": %}'),
 ('S1',  'своя оценка — 9', 'val', 'select public.my_topic_rating(''{A1}'')', '9'),
 ('S2',  'второй ученик группы: 3', 'val', 'select public.rate_topic(''{A1}'', 3)->>''rating''', '3'),
 ('S2',  'чужую оценку не видит — своя 3', 'val', 'select public.my_topic_rating(''{A1}'')', '3'),
 ('SC',  'ученик по записи student_courses: 6', 'val', 'select public.rate_topic(''{A1}'', 6)->>''rating''', '6'),
 ('S2',  'ещё не оценённый урок — null', 'val', 'select public.my_topic_rating(''{A3}'')', 'null'),
 ('SX',  'запись истекла — нет доступа', 'val', 'select public.rate_topic(''{A1}'', 5)::text', 'ERR 42501: Нет доступа к этому уроку'),
 ('S3',  'ученик другого курса — нет доступа', 'val', 'select public.rate_topic(''{A1}'', 5)::text', 'ERR 42501: Нет доступа к этому уроку'),
 ('S1',  'урок другого курса — нет доступа', 'val', 'select public.rate_topic(''{B1}'', 5)::text', 'ERR 42501: Нет доступа к этому уроку'),
 ('S1',  'закрытый урок — нет доступа', 'val', 'select public.rate_topic(''{A2}'', 5)::text', 'ERR 42501: Нет доступа к этому уроку'),
 ('S1',  'несуществующий урок — нет доступа', 'val', 'select public.rate_topic(gen_random_uuid(), 5)::text', 'ERR 42501: Нет доступа к этому уроку'),
 ('S1',  'оценка 0 — ошибка ввода', 'val', 'select public.rate_topic(''{A1}'', 0)::text', 'ERR 22023: Оценка — целое число от 1 до 10'),
 ('S1',  'оценка 11 — ошибка ввода', 'val', 'select public.rate_topic(''{A1}'', 11)::text', 'ERR 22023: %'),
 ('S1',  'оценка null — ошибка ввода', 'val', 'select public.rate_topic(''{A1}'', null)::text', 'ERR 22023: %'),
 ('S1',  'после ошибок своя оценка — по-прежнему 9', 'val', 'select public.my_topic_rating(''{A1}'')', '9'),
 ('TA',  'преподаватель оценку не ставит', 'val', 'select public.rate_topic(''{A1}'', 5)::text', 'ERR 42501: Оценку урока ставит ученик'),
 ('ADM', 'админ оценку не ставит', 'val', 'select public.rate_topic(''{A1}'', 5)::text', 'ERR 42501: Оценку урока ставит ученик'),
 ('TA',  'my_topic_rating у преподавателя — null', 'val', 'select public.my_topic_rating(''{A1}'')', 'null'),
 ('ANON','anon: rate_topic — нет права', 'val', 'select public.rate_topic(''{A1}'', 5)::text', 'ERR 42501: permission denied%'),
 ('ANON','anon: my_topic_rating — нет права', 'val', 'select public.my_topic_rating(''{A1}'')', 'ERR 42501: permission denied%'),
-- ── Таблица закрыта ───────────────────────────────────────────────────────
 ('S1',  'ученик таблицу не читает', 'count', 'select 1 from public.topic_ratings', 'ERR 42501%'),
 ('S1',  'ученик в таблицу не пишет', 'val', 'insert into public.topic_ratings (topic_id, student_id, rating) values (''{A3}'', public.auth_student_id(), 1) returning 1', 'ERR 42501%'),
 ('TA',  'преподаватель таблицу не читает', 'count', 'select 1 from public.topic_ratings', 'ERR 42501%'),
 ('ADM', 'админ таблицу из клиента не читает', 'count', 'select 1 from public.topic_ratings', 'ERR 42501%'),
-- ── Сводка ────────────────────────────────────────────────────────────────
 ('TA',  'сводка курса A: одна тема', 'count', 'select * from public.topic_ratings_summary(''{CA}'')', 'rows=1'),
 ('TA',  'сводка A1: 3 оценки, среднее 6.00, распределение', 'val',
   'select concat_ws('' | '', ratings, avg_rating, dist::text) from public.topic_ratings_summary(''{CA}'') where topic_id = ''{A1}''',
   '3 | 6.00 | {0,0,1,0,0,1,0,0,1,0}'),
 ('TA',  'сводка: дата последней оценки есть', 'val', 'select (last_at is not null)::text from public.topic_ratings_summary(''{CA}'')', 'true'),
 ('OWN', 'владелец курса — сводка', 'count', 'select * from public.topic_ratings_summary(''{CA}'')', 'rows=1'),
 ('CUR', 'куратор курса — сводка', 'count', 'select * from public.topic_ratings_summary(''{CA}'')', 'rows=1'),
 ('ADM', 'админ — сводка любого курса', 'count', 'select * from public.topic_ratings_summary(''{CA}'')', 'rows=1'),
 ('TB',  'посторонний преподаватель — нет доступа', 'count', 'select * from public.topic_ratings_summary(''{CA}'')', 'ERR 42501: Нет доступа к оценкам уроков этого курса'),
 ('TB',  'свой курс B — пусто', 'count', 'select * from public.topic_ratings_summary(''{CB}'')', 'rows=0'),
 ('S1',  'ученик — нет доступа к сводке', 'count', 'select * from public.topic_ratings_summary(''{CA}'')', 'ERR 42501: Нет доступа к оценкам уроков этого курса'),
 ('ANON','anon — нет права', 'count', 'select * from public.topic_ratings_summary(''{CA}'')', 'ERR 42501: permission denied%');

update probes set stmt = replace(replace(replace(replace(replace(replace(stmt,
  '{A1}', '60000000-0000-0000-0000-0000000000a1'), '{A2}', '60000000-0000-0000-0000-0000000000a2'),
  '{A3}', '60000000-0000-0000-0000-0000000000a3'), '{B1}', '60000000-0000-0000-0000-0000000000b1'),
  '{CA}', '30000000-0000-0000-0000-00000000000a'), '{CB}', '30000000-0000-0000-0000-00000000000b');

do $$
declare p record; v text; u uuid;
begin
  for p in select * from probes order by n loop
    u := (select uid from actors where who = p.who);
    if u is null then
      perform set_config('role', 'anon', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    else
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    end if;
    v := case p.kind when 'count' then public.probe_count(p.stmt) else public.probe_val(p.stmt) end;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '{}', true);
    update probes set actual = v where n = p.n;
  end loop;
end $$;

\echo '=================== §271: кто × действие → ожидаемо / факт ==================='
select n, who, action, actual, case when actual like expected then 'ok' else 'FAIL  ожидалось: ' || expected end as verdict
  from probes order by n;

\echo '--- Итог'
select count(*) as probes, count(*) filter (where actual like expected) as ok,
       count(*) filter (where actual not like expected or actual is null) as fail
  from probes;

\echo '--- Строки таблицы: одна на пару тема × ученик (S1 переоценил — строка одна, created_at <= updated_at)'
select t.title, s.profile_id, r.rating, r.created_at <= r.updated_at as order_ok
  from topic_ratings r join topics t on t.id = r.topic_id join students s on s.id = r.student_id
 order by 1, 2;

\echo '--- Функции: anon не зовёт, authenticated — да, все definer'
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated, p.prosecdef as definer
  from pg_proc p where p.proname in ('rate_topic', 'my_topic_rating', 'topic_ratings_summary') order by 1;

\echo '--- Таблица: RLS включена, политик нет, прав у клиентов нет'
select relrowsecurity as rls,
       (select count(*) from pg_policies where tablename = 'topic_ratings') as policies,
       has_table_privilege('authenticated', 'public.topic_ratings', 'select') as auth_select,
       has_table_privilege('anon', 'public.topic_ratings', 'select') as anon_select
  from pg_class where oid = 'public.topic_ratings'::regclass;
