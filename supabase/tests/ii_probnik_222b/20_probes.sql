-- §222b. Пробы прав на предложения ИИ по второй части пробника и заявку на проверку.
--
-- Устройство — как у §231: каждая проба — отдельная подтранзакция, откатываемая
-- исключением 'PROBE:%'; роль и claims — ОТДЕЛЬНЫМИ операторами (perform
-- set_config, CLAUDE.md §29.4); операторы по одному через probe_exec /
-- probe_count / probe_val (invoker: выполняются под authenticated). Откат
-- возвращает и данные, и роль. В конце — таблица «кто × действие → ожидаемо / факт».
\pset footer off
select set_config('request.jwt.claims', '{}', false) \g /dev/null

create temp table actors (who text primary key, uid uuid);
insert into actors values
 ('ADM',  '00000000-0000-0000-0000-00000000000a'),
 ('T11A', '00000000-0000-0000-0000-0000000000a1'),
 ('OWN',  '00000000-0000-0000-0000-0000000000a2'),
 ('T11B', '00000000-0000-0000-0000-0000000000b1'),
 ('CUR',  '00000000-0000-0000-0000-0000000000c1'),
 ('S1',   '00000000-0000-0000-0000-000000000051'),
 ('S53',  '00000000-0000-0000-0000-000000000053'),
 ('ANON', null);
grant select on actors to authenticated;

-- kind: count — сколько строк видно; exec — оператор; val — значение. expected — шаблон LIKE.
create temp table probes (n serial, who text, action text, kind text, stmts text[], expected text, actual text);
grant select on probes to authenticated;

create temp table ids (k text primary key, v text);
insert into ids values
 ('E2','50000000-0000-0000-0000-000000000002'), ('E6','50000000-0000-0000-0000-000000000006'),
 ('E9','50000000-0000-0000-0000-000000000009'),
 ('S1','20000000-0000-0000-0000-000000000051'), ('S2','20000000-0000-0000-0000-000000000052'),
 ('S4','20000000-0000-0000-0000-000000000054'), ('S53','20000000-0000-0000-0000-000000000053');

\set INS_SUG '''insert into mock_exam_ai_suggestions (mock_exam_id, student_id, task_number, points, max_points, confidence) values (''''{E6}'''', ''''{S1}'''', 14, 1, 2, ''''low'''')'''
\set REQ '''select public.mock_exam_ai_request_check(''''{E}''''::uuid, {IDS})::text'''

insert into probes (who, action, kind, stmts, expected) values
-- ── Чтение предложений ────────────────────────────────────────────────────
 ('ADM',  'предложения: все 2', 'count', array['select 1 from mock_exam_ai_suggestions'], 'rows=2'),
 ('T11A', 'предложения: 1 своей группы (№6)', 'count', array['select 1 from mock_exam_ai_suggestions'], 'rows=1'),
 ('OWN',  'предложения: 1 (владелец курса)', 'count', array['select 1 from mock_exam_ai_suggestions'], 'rows=1'),
 ('CUR',  'предложения: 1 (куратор курса читает)', 'count', array['select 1 from mock_exam_ai_suggestions'], 'rows=1'),
 ('T11B', 'предложения: только своей 11Б, чужих №6 — нет', 'count', array['select 1 from mock_exam_ai_suggestions', 'select 1 from mock_exam_ai_suggestions where mock_exam_id = ''{E6}'''], 'rows=1 ; rows=0'),
 ('S1',   'ученик: своих предложений не видит', 'count', array['select 1 from mock_exam_ai_suggestions'], 'rows=0'),
 ('S53',  'ученик 11Б: своих предложений не видит', 'count', array['select 1 from mock_exam_ai_suggestions'], 'rows=0'),
 ('ANON', 'anon: нет права', 'count', array['select 1 from mock_exam_ai_suggestions'], 'ERR 42501%'),
-- ── Чтение состояния запуска ──────────────────────────────────────────────
 ('ADM',  'состояние: все 2', 'count', array['select 1 from mock_exam_ai_runs'], 'rows=2'),
 ('T11A', 'состояние: 1 своей группы', 'count', array['select 1 from mock_exam_ai_runs'], 'rows=1'),
 ('CUR',  'состояние: 1 (куратор читает)', 'count', array['select 1 from mock_exam_ai_runs'], 'rows=1'),
 ('T11B', 'состояние: только своей 11Б', 'count', array['select 1 from mock_exam_ai_runs where mock_exam_id = ''{E6}'''], 'rows=0'),
 ('S1',   'ученик: состояния не видит', 'count', array['select 1 from mock_exam_ai_runs'], 'rows=0'),
-- ── Кэш текста PDF — только сервисному ключу ──────────────────────────────
 ('T11A', 'кэш текста PDF: нет права', 'count', array['select 1 from mock_exam_file_text_cache'], 'ERR 42501%'),
 ('ADM',  'кэш текста PDF: нет права и админу из клиента', 'count', array['select 1 from mock_exam_file_text_cache'], 'ERR 42501%'),
-- ── Запись предложений напрямую ───────────────────────────────────────────
 ('T11A', 'вставить предложение своей группе', 'exec', array[:INS_SUG], 'rows=1'),
 ('T11A', 'поправить своё предложение', 'exec', array['update mock_exam_ai_suggestions set comment = ''x'' where mock_exam_id = ''{E6}'''], 'rows=1'),
 ('T11A', 'удалить своё предложение', 'exec', array['delete from mock_exam_ai_suggestions where mock_exam_id = ''{E6}'''], 'rows=1'),
 ('T11A', 'балл больше максимума — отказ', 'exec', array['update mock_exam_ai_suggestions set points = 3 where mock_exam_id = ''{E6}'''], 'ERR 23514%'),
 ('CUR',  'куратор: вставить — отказ', 'exec', array[:INS_SUG], 'ERR 42501%'),
 ('CUR',  'куратор: поправить/удалить — 0 строк', 'exec', array['update mock_exam_ai_suggestions set comment = ''x''', 'delete from mock_exam_ai_suggestions'], 'rows=0 ; rows=0'),
 ('T11B', 'посторонний: вставить в №6 — отказ', 'exec', array[:INS_SUG], 'ERR 42501%'),
 ('T11B', 'посторонний: поправить/удалить №6 — 0 строк', 'exec', array['update mock_exam_ai_suggestions set points = 0 where mock_exam_id = ''{E6}''', 'delete from mock_exam_ai_suggestions where mock_exam_id = ''{E6}'''], 'rows=0 ; rows=0'),
 ('S1',   'ученик: вставить себе — отказ', 'exec', array[:INS_SUG], 'ERR 42501%'),
 ('S1',   'ученик: поправить/удалить — 0 строк', 'exec', array['update mock_exam_ai_suggestions set points = 2', 'delete from mock_exam_ai_suggestions'], 'rows=0 ; rows=0'),
-- ── Состояние запуска клиент не пишет ─────────────────────────────────────
 ('T11A', 'состояние: вставить напрямую — нет права', 'exec', array['insert into mock_exam_ai_runs (mock_exam_id, student_id) values (''{E6}'', ''{S2}'')'], 'ERR 42501%'),
 ('T11A', 'состояние: поправить напрямую — нет права', 'exec', array['update mock_exam_ai_runs set status = ''done'''], 'ERR 42501%'),
 ('ADM',  'состояние: удалить напрямую — нет права', 'exec', array['delete from mock_exam_ai_runs'], 'ERR 42501%'),
-- ── Заявка на проверку ────────────────────────────────────────────────────
 ('T11A', 'список: S1 в очередь (зависший прогон закрыт сторожем), S2 без фото, S53 чужой',
   'val', array[replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', 'array[''{S1}'',''{S2}'',''{S53}'']::uuid[]')],
   '[{"outcome": "queued", "student_id": "{S1}"}, {"outcome": "no_photos", "student_id": "{S2}"}, {"outcome": "not_in_group", "student_id": "{S53}"}]'),
 ('T11A', 'после заявки S1 — queued, прежняя ошибка стёрта', 'count',
   array[replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', 'array[''{S1}'']::uuid[]'),
         'select 1 from mock_exam_ai_runs where mock_exam_id = ''{E6}'' and student_id = ''{S1}'' and status = ''queued'' and last_error is null and requested_by = auth.uid()'],
   'rows=1 ; rows=1'),
 ('T11A', '«у всех»: только S4 (у S1 предложения уже есть, у S2 фото нет)', 'val',
   array[replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', 'null')],
   '[{"outcome": "queued", "student_id": "{S4}"}]'),
 ('T11A', 'повторная заявка поставленного — снова queued (функция его подхватит)', 'val',
   array[replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', 'array[''{S4}'']::uuid[]'), replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', 'array[''{S4}'']::uuid[]')],
   '%"queued"%'),
 ('OWN',  'владелец курса (teacher) ставит в очередь', 'val',
   array[replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', 'array[''{S4}'']::uuid[]')], '[{"outcome": "queued", %'),
 ('T11B', 'идущая проверка своей 11Б — второй раз не ставится', 'val',
   array[replace(replace(:REQ, '{E}', '{E2}'), '{IDS}', 'array[''{S53}'']::uuid[]')], '[{"outcome": "running", "student_id": "{S53}"}]'),
 ('ADM',  'админ ставит в очередь чужую группу', 'val',
   array[replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', 'array[''{S4}'']::uuid[]')], '[{"outcome": "queued", %'),
 ('ADM',  'пробник без группы — отказ словами', 'val',
   array[replace(replace(:REQ, '{E}', '{E9}'), '{IDS}', 'null')], 'ERR 22023: У пробника нет группы%'),
 ('CUR',  'куратор: заявка — отказ', 'val',
   array[replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', 'array[''{S1}'']::uuid[]')], 'ERR 42501: Нет доступа к этому пробнику'),
 ('T11B', 'посторонний: заявка на №6 — отказ', 'val',
   array[replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', 'array[''{S1}'']::uuid[]')], 'ERR 42501: Нет доступа к этому пробнику'),
 ('S1',   'ученик: заявка на свою работу — отказ', 'val',
   array[replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', 'array[''{S1}'']::uuid[]')], 'ERR 42501: Нет доступа к этому пробнику'),
 ('ANON', 'anon: функция не зовётся', 'val',
   array[replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', 'null')], 'ERR 42501%'),
 ('T11A', 'больше 200 учеников за раз — отказ', 'val',
   array[replace(replace(:REQ, '{E}', '{E6}'), '{IDS}', '(select array_agg(gen_random_uuid()) from generate_series(1, 201))')], 'ERR 22023%');

do $$
declare r record;
begin
  for r in select * from ids order by length(k) desc loop
    update probes set stmts = (select array_agg(replace(s, '{' || r.k || '}', r.v) order by o)
                                 from unnest(stmts) with ordinality u(s, o)),
                      expected = replace(expected, '{' || r.k || '}', r.v);
  end loop;
end $$;

do $$
declare
  p record; s text; v text; res text; u uuid;
begin
  for p in select * from probes order by n loop
    begin
      u := (select uid from actors where who = p.who);
      if u is null then
        perform set_config('role', 'anon', true);
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      else
        perform set_config('role', 'authenticated', true);
        perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      end if;
      v := null;
      foreach s in array p.stmts loop
        res := case p.kind when 'count' then public.probe_count(s) when 'val' then public.probe_val(s) else public.probe_exec(s) end;
        v := coalesce(v || ' ; ', '') || res;
      end loop;
      raise exception 'PROBE:%', v;
    exception when others then
      if sqlerrm like 'PROBE:%' then v := substr(sqlerrm, 7); else v := 'OUTER ' || sqlstate || ': ' || sqlerrm; end if;
    end;
    update probes set actual = v where n = p.n;
  end loop;
end $$;

\echo '=================== §222b: кто × действие → ожидаемо / факт ==================='
select n, who, action, actual, case when actual like expected then 'ok' else 'FAIL  ожидалось: ' || expected end as verdict
  from probes order by n;

\echo '--- Итог'
select count(*) as probes, count(*) filter (where actual like expected) as ok,
       count(*) filter (where actual not like expected or actual is null) as fail
  from probes;

\echo '--- После прогона данные не тронуты (все пробы откатились)'
select (select count(*) from mock_exam_ai_suggestions) as suggestions,
       (select string_agg(status, ',' order by student_id) from mock_exam_ai_runs) as runs,
       (select count(*) from mock_exam_task_scores) as task_scores;

\echo '--- Политики §222b'
select tablename, policyname, cmd, roles::text from pg_policies
 where tablename in ('mock_exam_ai_suggestions', 'mock_exam_ai_runs', 'mock_exam_file_text_cache') order by 1, 2;

\echo '--- Функция заявки: anon не зовёт, authenticated — да'
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated, p.prosecdef as definer
  from pg_proc p where p.proname = 'mock_exam_ai_request_check';
