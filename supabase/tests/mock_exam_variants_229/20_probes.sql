-- §229. Пробы вариантов. Каждая проба — в откатываемом блоке; роль и claims —
-- ОТДЕЛЬНЫМИ операторами (CLAUDE.md, §29.4). Время двигается сдвигом starts_at
-- под владельцем таблиц ДО переключения роли — проверяется серверное now().
\pset footer off
\set E3 '''50000000-0000-0000-0000-000000000003'''
\set E6 '''50000000-0000-0000-0000-000000000006'''
\set E7 '''50000000-0000-0000-0000-000000000007'''
\set E8 '''50000000-0000-0000-0000-000000000008'''
\set V1 '''80000000-0000-0000-0000-000000000001'''
\set V2 '''80000000-0000-0000-0000-000000000002'''
\set V3 '''80000000-0000-0000-0000-000000000003'''
\set S1ID  '''20000000-0000-0000-0000-000000000051'''
\set S2ID  '''20000000-0000-0000-0000-000000000052'''
\set S4ID  '''20000000-0000-0000-0000-000000000054'''
\set S5ID  '''20000000-0000-0000-0000-000000000055'''
\set T11A    '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}'''
\set T11B    '''{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}'''
\set CUR     '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'''
\set S1      '''{"sub":"00000000-0000-0000-0000-000000000051","role":"authenticated"}'''
\set S2      '''{"sub":"00000000-0000-0000-0000-000000000052","role":"authenticated"}'''
\set S4      '''{"sub":"00000000-0000-0000-0000-000000000054","role":"authenticated"}'''
\set S11B    '''{"sub":"00000000-0000-0000-0000-000000000053","role":"authenticated"}'''
-- Сессия без пользователя: после отката пробы claims возвращаются к '{}', а не к
-- пустой строке (auth.uid() слепка, в отличие от настоящего, пустую строку не разбирает).
select set_config('request.jwt.claims', '{}', false) \g /dev/null

\echo '=================== M. ПЕРЕНОС ДАННЫХ (миграция прогнана дважды) ==================='
\echo '--- M1. каждый пробник, существовавший до миграции: ровно один вариант, №1, те же пути и тот же ключ'
select b.mock_exam_id, count(v.id) as variants, min(v.position) as pos,
       bool_and(v.condition_path is not distinct from b.condition_path) as same_condition,
       bool_and(v.solution_path is not distinct from b.solution_path) as same_solution,
       bool_and(vk.answers is not distinct from b.key_answers) as same_key
  from probe_before_229 b
  left join mock_exam_variants v on v.mock_exam_id = b.mock_exam_id
  left join mock_exam_variant_keys vk on vk.variant_id = v.id
 group by b.mock_exam_id order by b.mock_exam_id;
\echo '--- M2. выдача: у каждого ученика группы — вариант 1 (у пробника без группы — никого)'
select b.mock_exam_id, b.group_size,
       (select count(*) from mock_exam_variant_students vs where vs.mock_exam_id = b.mock_exam_id) as assigned
  from probe_before_229 b order by b.mock_exam_id;
\echo '--- M3. пробник №8, заведённый после миграции старым экраном: строк вариантов нет'
select (select count(*) from mock_exam_variants where mock_exam_id = :E8) as variants,
       (select count(*) from mock_exam_variant_students where mock_exam_id = :E8) as assigned;

\echo '=================== V. ЧТО ВИДИТ УЧЕНИК ==================='
\echo '--- V1. до начала: S1 (вариант 1) — условия нет ни путём, ни файлом; номер варианта есть'
begin;
update mock_exams set starts_at = now() + interval '1 hour' where id = :E7;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select r->>'condition_path' as condition_path, r->'variant'->>'position' as variant, r->>'variant_count' as of
  from public.my_mock_exam(:E7) r;
select count(*) as visible_objects from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000007/%';
rollback;

\echo '--- V2. идёт: S1 — путь условия СВОЕГО варианта; из файлов видит только v1/condition и старый путь (вариант 1)'
begin;
update mock_exams set starts_at = now() - interval '1 hour' where id = :E7;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select r->>'condition_path' as condition_path, r->'variant'->>'position' as variant,
       r::text like '%criteria%' as mentions_criteria, r ? 'key' as has_key
  from public.my_mock_exam(:E7) r;
select name from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000007/%' order by name;
rollback;

\echo '--- V3. идёт: S2 (вариант 2) — только v2/condition; решение своего варианта до конца — нет; старый путь (вариант 1) — нет'
begin;
update mock_exams set starts_at = now() - interval '1 hour' where id = :E7;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S2, true) \g /dev/null
select r->>'condition_path' as condition_path, r->'variant'->>'position' as variant from public.my_mock_exam(:E7) r;
select name from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000007/%' order by name;
rollback;

\echo '--- V4. S4 без выдачи: первое чтение выдаёт наименее занятый (вариант 3), дальше видит только v3/condition'
begin;
update mock_exams set starts_at = now() - interval '1 hour' where id = :E7;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S4, true) \g /dev/null
select r->>'condition_path' as condition_path, r->'variant'->>'position' as variant from public.my_mock_exam(:E7) r;
select name from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000007/%' order by name;
select public.my_mock_exam(:E7)->'variant'->>'position' as second_read_same_variant;
rollback;

\echo '--- V4b. S4 без выдачи заходит пингом (§224) — бланк заведён, вариант выдан тот же «наименее занятый»'
begin;
update mock_exams set starts_at = now() - interval '1 hour' where id = :E7;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S4, true) \g /dev/null
select public.mock_exam_ping(:E7) ->> 'pinged' as pinged;
reset role;
select v.position as assigned_variant from mock_exam_variant_students vs join mock_exam_variants v on v.id = vs.variant_id
 where vs.mock_exam_id = :E7 and vs.student_id = :S4ID;
rollback;

\echo '--- V5. после конца, результат отправлен: S2 видит решение СВОЕГО варианта; S1 (у варианта 1 решения нет) — чужое решение не видит; критерии — никто'
begin;
update mock_exams set starts_at = now() - interval '5 hours' where id = :E7;
insert into mock_exam_results (mock_exam_id, student_id, score, notified_at) values (:E7, :S1ID, 10, now()), (:E7, :S2ID, 12, now());
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S2, true) \g /dev/null
select 'S2' as who, r->>'solution_path' as solution_path, r->'variant'->>'position' as variant, r->'tasks'->0->>'correct' as correct_1
  from public.my_mock_exam_result(:E7) r;
select 'S2' as who, name from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000007/%' order by name;
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select 'S1' as who, r->>'solution_path' as solution_path, r->'variant'->>'position' as variant, r->'tasks'->0->>'correct' as correct_1
  from public.my_mock_exam_result(:E7) r;
select 'S1' as who, name from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000007/%' order by name;
rollback;

\echo '--- V6. результат отправлен, но окно ещё идёт: ключа и решения нет (pending), объект решения не виден'
begin;
update mock_exams set starts_at = now() - interval '1 hour' where id = :E7;
insert into mock_exam_results (mock_exam_id, student_id, score, notified_at) values (:E7, :S2ID, 12, now());
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S2, true) \g /dev/null
select public.my_mock_exam_result(:E7) as result;
select count(*) as solution_objects from storage.objects where bucket_id = 'mock-exams' and name like '%/solution/%';
rollback;

\echo '--- V7. после конца, результат НЕ отправлен: решения нет'
begin;
update mock_exams set starts_at = now() - interval '5 hours' where id = :E7;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S2, true) \g /dev/null
select public.my_mock_exam_result(:E7) as result;
select count(*) as solution_objects from storage.objects where bucket_id = 'mock-exams' and name like '%/solution/%';
rollback;

\echo '--- V8. ученик таблицами напрямую: варианты, ключи, выдача — 0 строк; записать выдачу себе — RLS; поправить — 0 строк'
begin;
update mock_exams set starts_at = now() - interval '5 hours' where id = :E7;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select (select count(*) from mock_exam_variants) as variants, (select count(*) from mock_exam_variant_keys) as keys,
       (select count(*) from mock_exam_variant_students) as assignments;
update mock_exam_variant_students set variant_id = :V2 where student_id = :S1ID;
insert into mock_exam_variant_students (mock_exam_id, student_id, variant_id) values (:E7, :S4ID, :V2);
rollback;
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select public.save_mock_exam_variant_key(:V1, array['1','2','3','4','5','6','7','8','9','10','11','12']);
rollback;

\echo '--- V9. ученик ДРУГОЙ группы (11Б): пробник не его, файлов 0'
begin;
update mock_exams set starts_at = now() - interval '5 hours' where id = :E7;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S11B, true) \g /dev/null
select count(*) as objects from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000007/%';
select public.my_mock_exam(:E7);
rollback;

\echo '--- V10. ЧУЖОЙ преподаватель (11Б): варианты, ключи, выдача, файлы — 0; ключ варианта и вариант — отказ'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11B, true) \g /dev/null
select (select count(*) from mock_exam_variants where mock_exam_id = :E7) as variants,
       (select count(*) from mock_exam_variant_keys where mock_exam_id = :E7) as keys,
       (select count(*) from mock_exam_variant_students where mock_exam_id = :E7) as assignments,
       (select count(*) from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000007/%') as objects;
insert into mock_exam_variants (mock_exam_id, position) values (:E7, 4);
rollback;
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11B, true) \g /dev/null
select public.save_mock_exam_variant_key(:V2, array['1','2','3','4','5','6','7','8','9','10','11','12']);
rollback;
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11B, true) \g /dev/null
insert into storage.objects (bucket_id, name) values ('mock-exams', '50000000-0000-0000-0000-000000000007/v2/criteria/evil.pdf');
rollback;

\echo '--- V11. учитель группы: видит все варианты, ключи, выдачу и ВСЕ файлы, включая критерии; грузит критерии в папку варианта'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select (select count(*) from mock_exam_variants where mock_exam_id = :E7) as variants,
       (select count(*) from mock_exam_variant_keys where mock_exam_id = :E7) as keys,
       (select count(*) from mock_exam_variant_students where mock_exam_id = :E7) as assignments,
       (select count(*) from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000007/%') as objects;
insert into storage.objects (bucket_id, name) values ('mock-exams', '50000000-0000-0000-0000-000000000007/v3/criteria/2_crit3.pdf');
update mock_exam_variants set criteria_path = '50000000-0000-0000-0000-000000000007/v3/criteria/2_crit3.pdf' where id = :V3;
select position, criteria_path is not null as has_criteria from mock_exam_variants where mock_exam_id = :E7 order by position;
rollback;

\echo '--- V12. куратор курса: варианты и ключи видит (как ключ §221), записать — RLS'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :CUR, true) \g /dev/null
select (select count(*) from mock_exam_variants where mock_exam_id = :E7) as variants, (select count(*) from mock_exam_variant_keys where mock_exam_id = :E7) as keys;
update mock_exam_variants set label = 'x' where id = :V1;
rollback;

\echo '=================== G. ПРОВЕРКА ПО КЛЮЧУ — КЛЮЧ ВАРИАНТА УЧЕНИКА ==================='
\echo '--- G1. S1 (вариант 1) и S2 (вариант 2) ответили по СВОЕМУ ключу: S1 12 из 12; S2 11 из 12 (№12 — «0» при ключе 32). По ключу варианта 1 у S2 был бы 0'
begin;
update mock_exams set starts_at = now() - interval '5 hours' where id = :E7;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, submitted_at) values
 (:E7, :S1ID, array['1','2','3','4','5','6','7','8','9','10','11','12'], now() - interval '4 hours'),
 (:E7, :S2ID, array['21','22','23','24','25','26','27','28','29','30','31','0'], now() - interval '4 hours');
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.grade_mock_exam_part1(:E7) as grade;
select student_id, sum(points) as part1, count(*) filter (where auto_points is not null) as auto_cells
  from mock_exam_task_scores where mock_exam_id = :E7 group by student_id order by student_id;
rollback;

\echo '--- G2. S4 без выдачи сдал бланк: вариант выдан при заведении бланка (наименее занятый — 3), у варианта 3 ключа нет — первая часть не проверяется'
begin;
update mock_exams set starts_at = now() - interval '5 hours' where id = :E7;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, submitted_at) values
 (:E7, :S4ID, array['1','2','3','4','5','6','7','8','9','10','11','12'], now() - interval '4 hours');
select v.position as s4_variant from mock_exam_variant_students vs join mock_exam_variants v on v.id = vs.variant_id where vs.student_id = :S4ID and vs.mock_exam_id = :E7;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.grade_mock_exam_part1(:E7) as grade;
select count(*) as s4_cells from mock_exam_task_scores where mock_exam_id = :E7 and student_id = :S4ID;
rollback;

\echo '--- G3. ключ варианта 3 сохранён учителем — S4 перепроверен сразу'
begin;
update mock_exams set starts_at = now() - interval '5 hours' where id = :E7;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, submitted_at) values
 (:E7, :S4ID, array['1','2','3','4','5','6','7','8','9','10','11','12'], now() - interval '4 hours');
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.save_mock_exam_variant_key(:V3, array['1','2','3','4','5','6','7','8','9','10','11','99']) as saved;
select sum(points) as s4_part1 from mock_exam_task_scores where mock_exam_id = :E7 and student_id = :S4ID;
select public.save_mock_exam_variant_key(:V3, array['1','2']);
rollback;

\echo '--- G4. пробник №8 без вариантов (старый экран): проверка по прежнему ключу, как до §229'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.grade_mock_exam_part1(:E8) as grade;
select sum(points) as s1_part1 from mock_exam_task_scores where mock_exam_id = :E8 and student_id = :S1ID;
rollback;
\echo '--- G4b. ученик пробника №8: условие — прежний путь, варианта нет; файл виден'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select r->>'condition_path' as condition_path, r->'variant' as variant, r->>'variant_count' as variant_count from public.my_mock_exam(:E8) r;
select name from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000008/%';
rollback;

\echo '--- G5. пробник №6 (перенесён): старый экран сохраняет ключ save_mock_exam_key — он ложится и в вариант 1; проверка идёт по нему'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.save_mock_exam_key(:E6, array['12','0,75','-3','49','0,2','6','27','5','3','144','0,25','99'])->'grade' as grade;
select vk.answers[12] as variant1_key_12 from mock_exam_variant_keys vk join mock_exam_variants v on v.id = vk.variant_id where v.mock_exam_id = :E6;
select points as s1_task12 from mock_exam_task_scores where mock_exam_id = :E6 and student_id = :S1ID and task_number = 12;
rollback;

\echo '--- G6. результат ученика пробника №6 (перенесён): ключ — тот же, что был, путь решения — прежний'
begin;
insert into mock_exam_results (mock_exam_id, student_id, score, notified_at) values (:E6, :S1ID, 12, now());
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select r->>'status' as status, r->'tasks'->1->>'correct' as correct_2, r->'variant'->>'position' as variant from public.my_mock_exam_result(:E6) r;
select name from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000006/condition/%';
rollback;

\echo '=================== C. СМЕНА ВАРИАНТА И ЗАЩИТА ==================='
\echo '--- C1. учитель меняет вариант S4 (бланка нет) — можно; S1 после первого захода (бланк есть) — 23514'
begin;
update mock_exams set starts_at = now() - interval '1 hour' where id = :E7;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, opened_at) values (:E7, :S1ID, array_fill(null::text, array[12]), now());
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
insert into mock_exam_variant_students (mock_exam_id, student_id, variant_id) values (:E7, :S4ID, :V2)
  on conflict (mock_exam_id, student_id) do update set variant_id = excluded.variant_id;
select v.position as s4_now from mock_exam_variant_students vs join mock_exam_variants v on v.id = vs.variant_id where vs.student_id = :S4ID and vs.mock_exam_id = :E7;
update mock_exam_variant_students set variant_id = :V3 where mock_exam_id = :E7 and student_id = :S1ID;
rollback;
\echo '--- C2. то же через «раздачу» пачкой (upsert): S1 с бланком оставлен тем же вариантом — пачка проходит'
begin;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, opened_at) values (:E7, :S1ID, array_fill(null::text, array[12]), now());
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
insert into mock_exam_variant_students (mock_exam_id, student_id, variant_id) values (:E7, :S1ID, :V1), (:E7, :S2ID, :V3), (:E7, :S4ID, :V2)
  on conflict (mock_exam_id, student_id) do update set variant_id = excluded.variant_id;
select vs.student_id, v.position from mock_exam_variant_students vs join mock_exam_variants v on v.id = vs.variant_id where vs.mock_exam_id = :E7 order by vs.student_id;
rollback;
\echo '--- C3. снять выдачу у S2 с фото (вариант 2 ≠ первого) — 23514; у S1 с бланком (вариант 1 = первый) — можно'
begin;
insert into mock_exam_photos (mock_exam_id, student_id, storage_path, file_name) values (:E7, :S2ID, '50000000-0000-0000-0000-000000000007/photos/20000000-0000-0000-0000-000000000052/1.jpg', '1.jpg');
insert into mock_exam_sheets (mock_exam_id, student_id, answers) values (:E7, :S1ID, array_fill(null::text, array[12]));
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
delete from mock_exam_variant_students where mock_exam_id = :E7 and student_id = :S1ID;
delete from mock_exam_variant_students where mock_exam_id = :E7 and student_id = :S2ID;
rollback;
\echo '--- C4. удалить вариант 2, по которому пишет S2 — 23514; вариант 3 (никто не пишет) — можно'
begin;
insert into mock_exam_sheets (mock_exam_id, student_id, answers) values (:E7, :S2ID, array_fill(null::text, array[12]));
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
delete from mock_exam_variants where id = :V3;
select count(*) as variants_left from mock_exam_variants where mock_exam_id = :E7;
delete from mock_exam_variants where id = :V2;
rollback;
\echo '--- C5. номер варианта не меняется; ученик не из группы — 23514'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
update mock_exam_variants set position = 5 where id = :V3;
rollback;
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
insert into mock_exam_variant_students (mock_exam_id, student_id, variant_id) values (:E7, :S5ID, :V1);
rollback;
\echo '--- C6. вариант ЧУЖОГО пробника ученику не выдать (составная ссылка)'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
insert into mock_exam_variant_students (mock_exam_id, student_id, variant_id)
select :E6, :S4ID, :V2 on conflict (mock_exam_id, student_id) do update set variant_id = excluded.variant_id;
rollback;
\echo '--- C7. удалить пробник со всеми вариантами, бланками и выдачей — каскад не останавливается'
begin;
insert into mock_exam_sheets (mock_exam_id, student_id, answers) values (:E7, :S2ID, array_fill(null::text, array[12]));
delete from mock_exams where id = :E7;
select (select count(*) from mock_exam_variants where mock_exam_id = :E7) as variants,
       (select count(*) from mock_exam_variant_students where mock_exam_id = :E7) as assigned;
rollback;
\echo '--- C8. старый экран меняет mock_exams.condition_path у перенесённого пробника — вариант 1 получает тот же путь'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
update mock_exams set condition_path = '50000000-0000-0000-0000-000000000003/condition/2_new.pdf' where id = :E3;
select condition_path from mock_exam_variants where mock_exam_id = :E3 and position = 1;
rollback;
\echo '--- C9. смена группы пробника без работ (§228 разрешает): выдача прежней группы убрана'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select count(*) as before from mock_exam_variant_students where mock_exam_id = :E3;
update mock_exams set group_id = '40000000-0000-0000-0000-000000000003' where id = :E3;
select count(*) as after from mock_exam_variant_students where mock_exam_id = :E3;
rollback;
\echo '--- C10. функции-помощники напрямую не позвать'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S4, true) \g /dev/null
select public.mock_exam_ensure_variant(:E7, :S4ID);
rollback;
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S4, true) \g /dev/null
select public.mock_exam_student_variant(:E7, :S4ID);
rollback;
\echo '--- C11. anon: my_mock_exam и ключ варианта — нет права'
begin;
select set_config('role', 'anon', true) \g /dev/null
select public.my_mock_exam(:E7);
rollback;
