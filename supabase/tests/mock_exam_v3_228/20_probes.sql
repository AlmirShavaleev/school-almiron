-- §228. Пробы прав и защиты смены группы. Каждая проба — в откатываемом блоке;
-- роль и claims — ОТДЕЛЬНЫМИ операторами (CLAUDE.md, §29.4). Данные, от
-- которых проба зависит, готовятся под владельцем таблиц ДО переключения роли.
\pset footer off
\set E6 '''50000000-0000-0000-0000-000000000006'''
\set E5 '''50000000-0000-0000-0000-000000000005'''
\set E3 '''50000000-0000-0000-0000-000000000003'''
\set G11A  '''40000000-0000-0000-0000-000000000001'''
\set G11A2 '''40000000-0000-0000-0000-000000000003'''
\set G11B  '''40000000-0000-0000-0000-000000000002'''
\set S1ID  '''20000000-0000-0000-0000-000000000051'''
\set S2ID  '''20000000-0000-0000-0000-000000000052'''
\set OWNER   '''{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}'''
\set T11A    '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}'''
\set T11B    '''{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}'''
\set CUR     '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'''
\set S1      '''{"sub":"00000000-0000-0000-0000-000000000051","role":"authenticated"}'''
\set S2      '''{"sub":"00000000-0000-0000-0000-000000000052","role":"authenticated"}'''
\set S11B    '''{"sub":"00000000-0000-0000-0000-000000000053","role":"authenticated"}'''

\echo '=================== R. ЧТЕНИЕ РАБОТЫ УЧЕНИКА (экран проверки §228) ==================='
\echo '--- R1. учитель группы: бланки с ответами, фото, ключ — видит все (то, что читает экран проверки)'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select (select count(*) from mock_exam_sheets where mock_exam_id = :E6) as sheets,
       (select answers[2] from mock_exam_sheets where mock_exam_id = :E6 and student_id = :S2ID) as s2_answer2,
       (select count(*) from mock_exam_photos where mock_exam_id = :E6) as photos,
       (select count(*) from mock_exam_answer_keys where mock_exam_id = :E6) as keys;
rollback;

\echo '--- R2. ученик S1: только свой бланк и свои фото; бланк S2, ключ, баллы, итоги — нет'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select (select count(*) from mock_exam_sheets where mock_exam_id = :E6) as sheets_visible,
       (select count(*) from mock_exam_sheets where mock_exam_id = :E6 and student_id = :S2ID) as s2_sheet,
       (select count(*) from mock_exam_photos where mock_exam_id = :E6) as photos_visible,
       (select count(*) from mock_exam_answer_keys) as keys,
       (select count(*) from mock_exam_task_scores) as scores,
       (select count(*) from mock_exam_results) as results;
rollback;
\echo '--- R2b. ученик S2: фото S1 (строка и объект хранилища) не видит'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S2, true) \g /dev/null
select (select count(*) from mock_exam_photos where mock_exam_id = :E6) as photos_visible,
       (select count(*) from storage.objects where bucket_id = 'mock-exams' and name like '%/photos/%') as photo_objects,
       (select count(*) from mock_exam_sheets where mock_exam_id = :E6 and student_id = :S1ID) as s1_sheet;
rollback;

\echo '--- R3. ученик ЧУЖОЙ группы (11Б): 0 строк везде'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S11B, true) \g /dev/null
select (select count(*) from mock_exam_sheets) as sheets, (select count(*) from mock_exam_photos) as photos,
       (select count(*) from mock_exam_task_scores) as scores, (select count(*) from mock_exam_answer_keys) as keys;
rollback;

\echo '--- R4. ЧУЖОЙ преподаватель (11Б): 0 строк бланков, фото, баллов, ключей, объектов фото'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11B, true) \g /dev/null
select (select count(*) from mock_exam_sheets where mock_exam_id = :E6) as sheets,
       (select count(*) from mock_exam_photos where mock_exam_id = :E6) as photos,
       (select count(*) from mock_exam_task_scores where mock_exam_id = :E6) as scores,
       (select count(*) from mock_exam_answer_keys where mock_exam_id = :E6) as keys,
       (select count(*) from storage.objects where bucket_id = 'mock-exams' and name like '50000000-0000-0000-0000-000000000006/%') as objects;
rollback;
\echo '--- R4b. чужой преподаватель: сохранить строку ученика и уведомить — 42501'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11B, true) \g /dev/null
select public.save_mock_exam_grid(:E6, jsonb_build_array(jsonb_build_object('student_id', :S1ID, 'points', '[1,1,1,1,1,1,1,1,1,1,1,1,2,3,2,2,3,4,4]'::jsonb)));
rollback;
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11B, true) \g /dev/null
select public.notify_mock_exam_results(:E6, array[:S1ID]::uuid[]);
rollback;

\echo '--- R5. куратор курса: бланки видит (чтение), сохранить не может'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :CUR, true) \g /dev/null
select count(*) as curator_sheets from mock_exam_sheets where mock_exam_id = :E6;
select public.save_mock_exam_grid(:E6, jsonb_build_array(jsonb_build_object('student_id', :S1ID, 'points', '[1,1,1,1,1,1,1,1,1,1,1,1,2,3,2,2,3,4,4]'::jsonb)));
rollback;

\echo '--- R6. учитель группы: «Сохранить» на экране проверки — одна строка ученика; баллы S2 не тронуты'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.grade_mock_exam_part1(:E6) as graded;
select student_id = :S1ID as is_s1, count(*) as cells, sum(points) as pts from mock_exam_task_scores where mock_exam_id = :E6 group by 1 order by 1;
select public.save_mock_exam_grid(:E6, jsonb_build_array(jsonb_build_object('student_id', :S1ID, 'points', '[1,1,1,1,1,1,1,1,1,1,1,1,2,3,2,2,3,4,null]'::jsonb))) -> 'rows' as saved;
select student_id = :S1ID as is_s1, count(*) as cells, sum(points) as pts,
       count(*) filter (where auto_points is not null and auto_points = points) as auto_cells
  from mock_exam_task_scores where mock_exam_id = :E6 group by 1 order by 1;
\echo '--- R6b. исправленная клетка ключа — становится ручной (points <> auto_points)'
select public.save_mock_exam_grid(:E6, jsonb_build_array(jsonb_build_object('student_id', :S2ID, 'points', '[1,1,0,0,0,0,0,0,0,0,0,0,null,null,null,null,null,null,null]'::jsonb))) -> 'rows' as saved_s2;
select task_number, points, auto_points, points is distinct from auto_points as manual from mock_exam_task_scores
 where mock_exam_id = :E6 and student_id = :S2ID and task_number <= 2 order by 1;
rollback;

\echo '=================== G. СМЕНА ГРУППЫ ==================='
\echo '--- G1. без работ: учитель 11А переносит пробник №5 в 11А-2 (свой курс) — можно'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
update mock_exams set group_id = :G11A2 where id = :E5 returning title, group_id = :G11A2 as moved;
rollback;

\echo '--- G2. в группу ЧУЖОГО курса (11Б) — 42501'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
update mock_exams set group_id = :G11B where id = :E5;
rollback;
\echo '--- G2b. владелец платформы — в любую группу'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :OWNER, true) \g /dev/null
update mock_exams set group_id = :G11B where id = :E5 returning group_id = :G11B as moved;
rollback;

\echo '--- G3. есть бланки, фото, итоги и баллы (пробник №6) — отказ 23514 с перечнем'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.grade_mock_exam_part1(:E6) -> 'changed_cells' as graded_cells;
update mock_exams set group_id = :G11A2 where id = :E6;
rollback;

\echo '--- G4. только пустой бланк «открыл и ушёл» (пинг §224) — тоже отказ: это уже работа ученика группы'
begin;
update mock_exams set starts_at = now() - interval '10 minutes' where id = :E5;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, opened_at, last_seen_at)
values (:E5, :S1ID, array_fill(null::text, array[12]), now(), now());
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
update mock_exams set group_id = :G11A2 where id = :E5;
rollback;
\echo '--- G5. только фото — отказ'
begin;
insert into mock_exam_photos (mock_exam_id, student_id, storage_path, file_name)
values (:E5, :S1ID, '50000000-0000-0000-0000-000000000005/photos/20000000-0000-0000-0000-000000000051/x.jpg', 'x.jpg');
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
update mock_exams set group_id = :G11A2 where id = :E5;
rollback;
\echo '--- G5b. только итог (внесён таблицей без работы на сайте) — отказ'
begin;
insert into mock_exam_results (mock_exam_id, student_id, score) values (:E5, :S1ID, 10);
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :OWNER, true) \g /dev/null
update mock_exams set group_id = :G11A2 where id = :E5;
rollback;

\echo '--- G6. пробник с баллами: правка названия и времени (группа та же) — можно'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.grade_mock_exam_part1(:E6) -> 'changed_cells' as graded_cells;
update mock_exams set title = 'Пробник №6 (переименован)', group_id = :G11A where id = :E6 returning title;
rollback;

\echo '--- G7. назначенный пробник без работ: смена группы переставляет напоминания (триггер §224)'
begin;
update mock_exams set starts_at = now() + interval '3 hours' where id = :E3;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
update mock_exams set group_id = :G11A2 where id = :E3 returning group_id = :G11A2 as moved;
select set_config('role', 'postgres', true) \g /dev/null
select q.status, (gs.group_id = :G11A2) as new_group, q.event_type, count(*)
  from notification_queue q
  join students s on s.profile_id = q.profile_id
  join group_students gs on gs.student_id = s.id and gs.group_id in (:G11A, :G11A2)
 where q.entity_id = :E3
 group by 1, 2, 3 order by 1, 2, 3;
rollback;

\echo '--- G8. ученик пытается сменить группу — RLS mock_exams_manage: 0 строк'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
update mock_exams set group_id = :G11A2 where id = :E5;
rollback;

\echo '--- G9. функцию триггера напрямую не позвать'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.mock_exams_group_change_guard();
rollback;

\echo '=================== F. ФАЙЛЫ «НЕСКОЛЬКИХ ГРУПП» ==================='
\echo '--- F1. условие второго пробника кладётся в ЕГО папку: учитель курса — можно, чужой учитель — RLS'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
insert into storage.objects (bucket_id, name) values ('mock-exams', '50000000-0000-0000-0000-000000000005/condition/2_copy.pdf') returning name;
rollback;
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11B, true) \g /dev/null
insert into storage.objects (bucket_id, name) values ('mock-exams', '50000000-0000-0000-0000-000000000005/condition/2_copy.pdf');
rollback;
\echo '--- F2. ученик читает условие СВОЕГО идущего пробника; копию в папке пробника другой группы — нет'
begin;
insert into mock_exams (id, title, subject, exam_type, group_id, date, template_id, starts_at, condition_path) values
 ('50000000-0000-0000-0000-000000000007','Пробник №6 для 11Б','math','ege', :G11B, now(), (select id from mock_exam_templates where year = 2027), now() - interval '5 hours',
  '50000000-0000-0000-0000-000000000007/condition/1_v6.pdf');
insert into storage.objects (bucket_id, name, owner) values ('mock-exams', '50000000-0000-0000-0000-000000000007/condition/1_v6.pdf', null);
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select name from storage.objects where bucket_id = 'mock-exams' and name like '%/condition/%' order by name;
rollback;
