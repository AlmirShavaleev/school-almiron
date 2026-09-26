-- §231. Пробы прав на mock_exams / mock_exam_results (и запись mock_exam_task_scores).
--
-- Каждая проба — отдельная подтранзакция, откатываемая исключением 'PROBE:%'
-- (как пробы для прода). Внутри: роль и claims — ОТДЕЛЬНЫМИ операторами
-- (perform set_config, CLAUDE.md §29.4), затем операторы пробы по одному
-- через probe_exec / probe_count (invoker: выполняются под authenticated).
-- Откат возвращает и данные, и роль. Результат пробы пишется в журнал уже
-- под владельцем. В конце — таблица «кто × действие → ожидаемо / факт».
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
 ('S53',  '00000000-0000-0000-0000-000000000053');
grant select on actors to authenticated;

-- kind: count — сколько строк видно; exec — операторы по порядку, факт через « ; ».
-- expected — шаблон LIKE.
create temp table probes (n serial, who text, action text, kind text, stmts text[], expected text, actual text);
grant select on probes to authenticated;

-- Короткие имена: E<N> — пробник 50000000-…-00000000000N, группы 11А/11Б, ученики.
create temp table ids (k text primary key, v text);
insert into ids values
 ('E0','50000000-0000-0000-0000-000000000000'), ('E1','50000000-0000-0000-0000-000000000001'),
 ('E2','50000000-0000-0000-0000-000000000002'), ('E5','50000000-0000-0000-0000-000000000005'),
 ('E6','50000000-0000-0000-0000-000000000006'), ('E9','50000000-0000-0000-0000-000000000009'),
 ('E10','5a000000-0000-0000-0000-000000000010'), ('V10','8a000000-0000-0000-0000-000000000010'),
 ('G11A','40000000-0000-0000-0000-000000000001'), ('G11B','40000000-0000-0000-0000-000000000002'),
 ('TCH_A1','10000000-0000-0000-0000-0000000000a1'), ('TCH_A2','10000000-0000-0000-0000-0000000000a2'),
 ('TCH_B1','10000000-0000-0000-0000-0000000000b1'),
 ('S1','20000000-0000-0000-0000-000000000051'), ('S2','20000000-0000-0000-0000-000000000052'),
 ('S4','20000000-0000-0000-0000-000000000054'), ('S53','20000000-0000-0000-0000-000000000053');

-- Вставка пробника так же, как её делает экран (lib/mockExamCreate.ts): с RETURNING.
\set INS_A '''insert into mock_exams (id, title, subject, exam_type, date, group_id, template_id, max_score, created_by, starts_at, duration_minutes) select ''''{E10}'''', ''''новый'''', ''''math'''', ''''ege'''', now(), ''''{G11A}'''', (select id from mock_exam_templates where year = 2027), 32, {CB}, null, 235 returning id'''

insert into probes (who, action, kind, stmts, expected) values
-- ── Видимость пробников ───────────────────────────────────────────────────
 ('ADM',  'видит пробники: все 10', 'count', array['select 1 from mock_exams'], 'rows=10'),
 ('T11A', 'видит пробники: 7 своей группы + свой №9 без группы', 'count', array['select 1 from mock_exams'], 'rows=8'),
 ('OWN',  'видит пробники: 7 группы своего курса', 'count', array['select 1 from mock_exams'], 'rows=7'),
 ('T11B', 'видит пробники: только №2 своей 11Б', 'count', array['select 1 from mock_exams'], 'rows=1'),
 ('CUR',  'видит пробники: 7 группы своего курса', 'count', array['select 1 from mock_exams'], 'rows=7'),
 ('S1',   'видит пробники: 7 своей группы (как до §231)', 'count', array['select 1 from mock_exams'], 'rows=7'),
 ('S53',  'видит пробники: только №2 своей 11Б', 'count', array['select 1 from mock_exams'], 'rows=1'),
 ('T11B', 'чужой №6 (11А) по id', 'count', array['select 1 from mock_exams where id = ''{E6}'''], 'rows=0'),
 ('T11A', 'чужой №2 (11Б) по id', 'count', array['select 1 from mock_exams where id = ''{E2}'''], 'rows=0'),
 ('T11B', 'чужой №9 без группы (автор T11A)', 'count', array['select 1 from mock_exams where id = ''{E9}'''], 'rows=0'),
 ('T11A', '№0 без группы и без автора', 'count', array['select 1 from mock_exams where id = ''{E0}'''], 'rows=0'),
 ('T11A', 'список «Пробники» (groups!inner, как useMockExams)', 'count', array['select 1 from mock_exams me join groups g on g.id = me.group_id'], 'rows=7'),
-- ── Видимость итогов ──────────────────────────────────────────────────────
 ('ADM',  'видит итоги: все 3', 'count', array['select 1 from mock_exam_results'], 'rows=3'),
 ('T11A', 'видит итоги: 2 своей группы (№6)', 'count', array['select 1 from mock_exam_results'], 'rows=2'),
 ('OWN',  'видит итоги: 2 (владелец курса)', 'count', array['select 1 from mock_exam_results'], 'rows=2'),
 ('T11B', 'видит итоги: 1 своей 11Б, чужих — нет', 'count', array['select 1 from mock_exam_results'], 'rows=1'),
 ('CUR',  'видит итоги: 2 (куратор курса читает)', 'count', array['select 1 from mock_exam_results'], 'rows=2'),
 ('S1',   'таблицу итогов напрямую не читает (как до §231)', 'count', array['select 1 from mock_exam_results'], 'rows=0'),
 ('S53',  'таблицу итогов напрямую не читает', 'count', array['select 1 from mock_exam_results'], 'rows=0'),
 ('T11A', 'профиль ученика S53 (useStudentProfile): его итоги 11Б', 'count', array['select 1 from mock_exam_results where student_id = ''{S53}'''], 'rows=0'),
-- ── Создание ──────────────────────────────────────────────────────────────
 ('T11A', 'создать в свою 11А, автор — он', 'exec', array[replace(:INS_A, '{CB}', '''{TCH_A1}''')], 'rows=1'),
 ('T11A', 'создать в свою 11А, автор null', 'exec', array[replace(:INS_A, '{CB}', 'null')], 'rows=1'),
 ('T11A', 'создать в 11А, автором записать T11B', 'exec', array[replace(:INS_A, '{CB}', '''{TCH_B1}''')], 'ERR 42501%'),
 ('T11A', 'создать в чужую 11Б', 'exec', array[replace(replace(:INS_A, '{CB}', '''{TCH_A1}'''), '{G11A}', '{G11B}')], 'ERR 42501%'),
 ('T11A', 'создать сразу в 11А и 11Б одной вставкой — ни одного', 'exec',
   array['insert into mock_exams (title, subject, exam_type, date, group_id) values (''x'',''math'',''ege'',now(),''{G11A}''), (''x'',''math'',''ege'',now(),''{G11B}'') returning id'], 'ERR 42501%'),
 ('T11A', 'создать без группы', 'exec', array['insert into mock_exams (title, subject, exam_type, date, group_id, created_by) values (''x'',''math'',''ege'',now(),null,''{TCH_A1}'') returning id'], 'ERR 42501%'),
 ('OWN',  'создать в 11А (владелец курса без своей группы)', 'exec', array[replace(:INS_A, '{CB}', '''{TCH_A2}''')], 'rows=1'),
 ('T11B', 'создать в чужую 11А', 'exec', array[replace(:INS_A, '{CB}', '''{TCH_B1}''')], 'ERR 42501%'),
 ('CUR',  'создать в 11А (куратор не управляет)', 'exec', array[replace(:INS_A, '{CB}', 'null')], 'ERR 42501%'),
 ('S1',   'создать в 11А', 'exec', array[replace(:INS_A, '{CB}', 'null')], 'ERR 42501%'),
 ('ADM',  'создать в 11А и 11Б одной вставкой (две группы формы §228)', 'exec',
   array['insert into mock_exams (title, subject, exam_type, date, group_id) values (''x'',''math'',''ege'',now(),''{G11A}''), (''x'',''math'',''ege'',now(),''{G11B}'') returning id'], 'rows=2'),
 ('T11A', 'полный путь формы: пробник → вариант → условие в хранилище → ключ', 'exec',
   array[replace(:INS_A, '{CB}', '''{TCH_A1}'''),
         'insert into mock_exam_variants (id, mock_exam_id, position) values (''{V10}'', ''{E10}'', 1) returning id',
         'insert into storage.objects (bucket_id, name, owner) values (''mock-exams'', ''{E10}/v1/condition/1_x.pdf'', auth.uid())',
         'select public.save_mock_exam_variant_key(''{V10}'', array[''1'',''2'',''3'',''4'',''5'',''6'',''7'',''8'',''9'',''10'',''11'',''12''])'],
   'rows=1 ; rows=1 ; rows=1 ; rows=1'),
 ('T11A', 'копия условия в папку второго пробника (storage.copy = чтение + вставка)', 'exec',
   array['select 1 from storage.objects where bucket_id = ''mock-exams'' and name = ''{E6}/condition/1_v6.pdf''',
         'insert into storage.objects (bucket_id, name, owner) values (''mock-exams'', ''{E1}/v1/condition/1_copy.pdf'', auth.uid())'],
   'rows=1 ; rows=1'),
-- ── Правка ────────────────────────────────────────────────────────────────
 ('T11A', 'правка №6 своей группы', 'exec', array['update mock_exams set title = ''t'' where id = ''{E6}'''], 'rows=1'),
 ('OWN',  'правка №6 (владелец курса)', 'exec', array['update mock_exams set title = ''t'' where id = ''{E6}'''], 'rows=1'),
 ('ADM',  'правка №2', 'exec', array['update mock_exams set title = ''t'' where id = ''{E2}'''], 'rows=1'),
 ('T11B', 'правка чужого №6', 'exec', array['update mock_exams set title = ''t'' where id = ''{E6}'''], 'rows=0'),
 ('CUR',  'правка №6 (куратор)', 'exec', array['update mock_exams set title = ''t'' where id = ''{E6}'''], 'rows=0'),
 ('S1',   'правка №6', 'exec', array['update mock_exams set title = ''t'' where id = ''{E6}'''], 'rows=0'),
 ('S53',  'правка №2 своей группы', 'exec', array['update mock_exams set title = ''t'' where id = ''{E2}'''], 'rows=0'),
 ('T11A', 'правка чужого №2', 'exec', array['update mock_exams set title = ''t'' where id = ''{E2}'''], 'rows=0'),
 ('T11A', 'перенос №5 (без работ) в чужую 11Б — триггер §228', 'exec', array['update mock_exams set group_id = ''{G11B}'' where id = ''{E5}'''], 'ERR 42501%'),
 ('T11B', 'перенос своего №2 (с итогом) в 11А — триггер §228', 'exec', array['update mock_exams set group_id = ''{G11A}'' where id = ''{E2}'''], 'ERR 23514%'),
 ('T11A', 'снять группу у №1 чужого автора (WITH CHECK)', 'exec', array['update mock_exams set group_id = null where id = ''{E1}'''], 'ERR 42501%'),
 ('T11A', 'свой №9 без группы: правка названия', 'exec', array['update mock_exams set title = ''t'' where id = ''{E9}'''], 'rows=1'),
 ('T11A', 'свой №9 без группы → в свою 11А', 'exec', array['update mock_exams set group_id = ''{G11A}'' where id = ''{E9}'''], 'rows=1'),
 ('T11A', 'свой №9 без группы → в чужую 11Б', 'exec', array['update mock_exams set group_id = ''{G11B}'' where id = ''{E9}'''], 'ERR 42501%'),
 ('T11B', 'чужой №9 без группы → в свою 11Б', 'exec', array['update mock_exams set group_id = ''{G11B}'' where id = ''{E9}'''], 'rows=0'),
 ('T11A', '№0 без группы и без автора', 'exec', array['update mock_exams set title = ''t'' where id = ''{E0}'''], 'rows=0'),
 ('ADM',  '№0 без группы → в 11А', 'exec', array['update mock_exams set group_id = ''{G11A}'' where id = ''{E0}'''], 'rows=1'),
-- ── Удаление ──────────────────────────────────────────────────────────────
 ('T11A', 'удалить №6 своей группы (каскад)', 'exec', array['delete from mock_exams where id = ''{E6}'''], 'rows=1'),
 ('ADM',  'удалить №2', 'exec', array['delete from mock_exams where id = ''{E2}'''], 'rows=1'),
 ('T11B', 'удалить чужой №6', 'exec', array['delete from mock_exams where id = ''{E6}'''], 'rows=0'),
 ('CUR',  'удалить №6 (куратор)', 'exec', array['delete from mock_exams where id = ''{E6}'''], 'rows=0'),
 ('S1',   'удалить №6', 'exec', array['delete from mock_exams where id = ''{E6}'''], 'rows=0'),
 ('T11A', 'удалить чужой №2', 'exec', array['delete from mock_exams where id = ''{E2}'''], 'rows=0'),
 ('T11A', 'удалить свой №9 без группы', 'exec', array['delete from mock_exams where id = ''{E9}'''], 'rows=1'),
 ('T11B', 'удалить чужой №9 без группы', 'exec', array['delete from mock_exams where id = ''{E9}'''], 'rows=0'),
-- ── Итоги: запись напрямую ────────────────────────────────────────────────
 ('T11A', 'итог: вставить S4 в №6', 'exec', array['insert into mock_exam_results (mock_exam_id, student_id, score) values (''{E6}'', ''{S4}'', 5)'], 'rows=1'),
 ('T11A', 'итоги №6: правка заметки', 'exec', array['update mock_exam_results set notes = ''n'' where mock_exam_id = ''{E6}'''], 'rows=2'),
 ('T11A', 'итог S2 №6: удалить', 'exec', array['delete from mock_exam_results where mock_exam_id = ''{E6}'' and student_id = ''{S2}'''], 'rows=1'),
 ('T11B', 'итог: вставить в чужой №6', 'exec', array['insert into mock_exam_results (mock_exam_id, student_id, score) values (''{E6}'', ''{S4}'', 5)'], 'ERR 42501%'),
 ('T11B', 'итоги чужого №6: правка', 'exec', array['update mock_exam_results set score = 0 where mock_exam_id = ''{E6}'''], 'rows=0'),
 ('T11B', 'итоги чужого №6: удалить', 'exec', array['delete from mock_exam_results where mock_exam_id = ''{E6}'''], 'rows=0'),
 ('T11B', 'итоги своего №2: правка', 'exec', array['update mock_exam_results set notes = ''n'' where mock_exam_id = ''{E2}'''], 'rows=1'),
 ('CUR',  'итог: вставить в №6', 'exec', array['insert into mock_exam_results (mock_exam_id, student_id, score) values (''{E6}'', ''{S4}'', 5)'], 'ERR 42501%'),
 ('CUR',  'итоги №6: правка', 'exec', array['update mock_exam_results set score = 0 where mock_exam_id = ''{E6}'''], 'rows=0'),
 ('CUR',  'итоги №6: удалить', 'exec', array['delete from mock_exam_results where mock_exam_id = ''{E6}'''], 'rows=0'),
 ('S1',   'итог себе: вставить в №6', 'exec', array['insert into mock_exam_results (mock_exam_id, student_id, score) values (''{E6}'', ''{S4}'', 5)'], 'ERR 42501%'),
 ('S1',   'свой итог №6: поднять балл', 'exec', array['update mock_exam_results set score = 100 where mock_exam_id = ''{E6}'' and student_id = ''{S1}'''], 'rows=0'),
-- ── Баллы по заданиям: запись только тому, кто управляет ─────────────────
 ('T11A', 'баллы №6: удалить', 'exec', array['delete from mock_exam_task_scores where mock_exam_id = ''{E6}'''], 'rows=38'),
 ('CUR',  'баллы №6: читает', 'count', array['select 1 from mock_exam_task_scores where mock_exam_id = ''{E6}'''], 'rows=38'),
 ('CUR',  'баллы №6: удалить (до §231 — могла)', 'exec', array['delete from mock_exam_task_scores where mock_exam_id = ''{E6}'''], 'rows=0'),
 ('CUR',  'баллы №6: вставить', 'exec', array['insert into mock_exam_task_scores (mock_exam_id, student_id, task_number, points, updated_by) values (''{E6}'', ''{S4}'', 1, 1, auth.uid())'], 'ERR 42501%'),
 ('T11B', 'баллы чужого №6: удалить', 'exec', array['delete from mock_exam_task_scores where mock_exam_id = ''{E6}'''], 'rows=0'),
-- ── Функции экранов ───────────────────────────────────────────────────────
 ('T11A', 'save_mock_exam_grid №6 (таблица / «Сохранить» проверки)', 'exec',
   array['select public.save_mock_exam_grid(''{E6}'', ''[{"student_id":"{S4}","points":[1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0]}]''::jsonb)'], 'rows=1'),
 ('OWN',  'save_mock_exam_grid №6', 'exec',
   array['select public.save_mock_exam_grid(''{E6}'', ''[{"student_id":"{S4}","points":[1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0]}]''::jsonb)'], 'rows=1'),
 ('CUR',  'save_mock_exam_grid №6', 'exec',
   array['select public.save_mock_exam_grid(''{E6}'', ''[{"student_id":"{S4}","points":[1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0]}]''::jsonb)'], 'ERR 42501%'),
 ('T11B', 'save_mock_exam_grid чужого №6 (пробник ему не виден)', 'exec',
   array['select public.save_mock_exam_grid(''{E6}'', ''[]''::jsonb)'], 'ERR P0002: Пробник не найден'),
 ('T11A', 'grade_mock_exam_part1 №6 (открытие «Работ»)', 'exec', array['select public.grade_mock_exam_part1(''{E6}'')'], 'rows=1'),
 ('CUR',  'grade_mock_exam_part1 №6', 'exec', array['select public.grade_mock_exam_part1(''{E6}'')'], 'ERR 42501%'),
 ('T11B', 'grade_mock_exam_part1 чужого №6', 'exec', array['select public.grade_mock_exam_part1(''{E6}'')'], 'ERR 42501%'),
 ('T11A', 'notify_mock_exam_results №6, одному S2', 'exec', array['select public.notify_mock_exam_results(''{E6}'', array[''{S2}'']::uuid[])'], 'rows=1'),
 ('T11B', 'notify_mock_exam_results чужого №6', 'exec', array['select public.notify_mock_exam_results(''{E6}'', null)'], 'ERR 42501%'),
 ('CUR',  'notify_mock_exam_results №6', 'exec', array['select public.notify_mock_exam_results(''{E6}'', null)'], 'ERR 42501%'),
 ('T11A', 'бланки, фото, ключ, варианты №6 (страница пробника)', 'count',
   array['select 1 from mock_exam_sheets where mock_exam_id = ''{E6}'' union all select 1 from mock_exam_photos where mock_exam_id = ''{E6}'' union all select 1 from mock_exam_answer_keys where mock_exam_id = ''{E6}'' union all select 1 from mock_exam_variants where mock_exam_id = ''{E6}'''], 'rows=5'),
 ('T11B', 'бланки, фото, ключ, варианты чужого №6', 'count',
   array['select 1 from mock_exam_sheets where mock_exam_id = ''{E6}'' union all select 1 from mock_exam_photos where mock_exam_id = ''{E6}'' union all select 1 from mock_exam_answer_keys where mock_exam_id = ''{E6}'' union all select 1 from mock_exam_variants where mock_exam_id = ''{E6}'''], 'rows=0'),
-- ── Ученик ────────────────────────────────────────────────────────────────
 ('S1',   'my_mock_exam_result №6: свой итог готов', 'count', array['select 1 from public.my_mock_exam_result(''{E6}'') r where r->>''status'' = ''ready'' and (r->>''score'')::int = 32'], 'rows=1'),
 ('S1',   'my_mock_exams(11А): пробники группы со временем', 'count', array['select 1 from public.my_mock_exams(''{G11A}'')'], 'rows=%'),
 ('S1',   'my_mock_exam №6 (страница пробника ученика)', 'count', array['select 1 from public.my_mock_exam(''{E6}'') r where r is not null'], 'rows=1'),
 ('S53',  'my_mock_exam_result чужого №6', 'exec', array['select public.my_mock_exam_result(''{E6}'')'], 'ERR 42501%'),
 ('S53',  'условие чужого №6 в хранилище', 'count', array['select 1 from storage.objects where bucket_id = ''mock-exams'' and name like ''{E6}/%'''], 'rows=0');

-- Подстановка коротких имён.
do $$
declare r record;
begin
  for r in select * from ids order by length(k) desc loop
    update probes set stmts = (select array_agg(replace(s, '{' || r.k || '}', r.v) order by o)
                                 from unnest(stmts) with ordinality u(s, o));
  end loop;
end $$;

-- Прогон: каждая проба — подтранзакция, откатываемая 'PROBE:%'.
do $$
declare
  p record; s text; v text; res text;
begin
  for p in select * from probes order by n loop
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', (select uid from actors where who = p.who), 'role', 'authenticated')::text, true);
      v := null;
      foreach s in array p.stmts loop
        res := case p.kind when 'count' then public.probe_count(s) else public.probe_exec(s) end;
        v := coalesce(v || ' ; ', '') || res;
      end loop;
      raise exception 'PROBE:%', v;
    exception when others then
      if sqlerrm like 'PROBE:%' then v := substr(sqlerrm, 7); else v := 'OUTER ' || sqlstate || ': ' || sqlerrm; end if;
    end;
    update probes set actual = v where n = p.n;
  end loop;
end $$;

\echo '=================== §231: кто × действие → ожидаемо / факт ==================='
select n, who, action, expected, actual, case when actual like expected then 'ok' else 'FAIL' end as verdict
  from probes order by n;

\echo '--- Итог'
select count(*) as probes, count(*) filter (where actual like expected) as ok,
       count(*) filter (where actual not like expected) as fail
  from probes;

\echo '--- После прогона данные не тронуты (все пробы откатились)'
select (select count(*) from mock_exams) as exams, (select count(*) from mock_exam_results) as results,
       (select count(*) from mock_exam_task_scores) as task_scores;

\echo '--- Политики после §231'
select tablename, policyname, cmd, roles::text from pg_policies
 where tablename in ('mock_exams', 'mock_exam_results', 'mock_exam_task_scores') order by 1, 2;

\echo '--- Помощники §231: anon не зовёт, authenticated — да'
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p where p.proname in ('mock_exam_group_is_staff', 'mock_exam_group_can_manage', 'mock_exam_is_my_teacher')
 order by 1;
