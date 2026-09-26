\pset footer off
\set E '''50000000-0000-0000-0000-000000000003'''
-- пользователи
\set OWNER   '''{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}'''
\set T11A    '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}'''
\set T11B    '''{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}'''
\set CUR     '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'''
\set S1      '''{"sub":"00000000-0000-0000-0000-000000000051","role":"authenticated"}'''
\set S2      '''{"sub":"00000000-0000-0000-0000-000000000052","role":"authenticated"}'''
\set S4      '''{"sub":"00000000-0000-0000-0000-000000000054","role":"authenticated"}'''
\set S11B    '''{"sub":"00000000-0000-0000-0000-000000000053","role":"authenticated"}'''

\echo '=================== A. ДО НАЧАЛА (starts_at = now() + 1 ч) ==================='
update mock_exams set starts_at = now() + interval '1 hour' where id = :E;
set role authenticated; select set_config('request.jwt.claims', :S1, false) \g /dev/null
\echo '--- A1. ученик: страница пробника — условия нет (condition_path = null)'
select (r->>'condition_path') is null as no_condition, r->>'starts_at' is not null as has_start,
       (r->>'server_now')::timestamptz < (r->>'starts_at')::timestamptz as before_start
  from public.my_mock_exam(:E) r;
\echo '--- A2. ученик: файл условия в хранилище — не выдаётся (0 строк = не подписать ссылку)'
select count(*) as condition_objects from storage.objects where bucket_id = 'mock-exams' and name like '%/condition/%';
\echo '--- A3. ученик: ответ в бланк до начала'
select public.save_mock_exam_answer(:E, 1, '5');
\echo '--- A4. ученик: сдать до начала'
select public.submit_mock_exam(:E);
\echo '--- A5. ученик: загрузить фото до начала'
insert into storage.objects (bucket_id, name) values ('mock-exams', '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000051/early.jpg');
reset role;

\echo '=================== B. ИДЁТ (начался час назад, до конца 3 ч) ==================='
update mock_exams set starts_at = now() - interval '1 hour' where id = :E;
set role authenticated; select set_config('request.jwt.claims', :S1, false) \g /dev/null
\echo '--- B1. ученик S1 пишет бланк; ответ сохранения — только поле, ответ и время'
select public.save_mock_exam_answer(:E, 1, '12') - 'saved_at' as saved;
select public.save_mock_exam_answer(:E, 2, '0.75') - 'saved_at' as saved;
select public.save_mock_exam_answer(:E, 3, '-3') - 'saved_at' as saved;
select count(*) from (select public.save_mock_exam_answer(:E, n, a) from (values (4,'49'),(5,'0,2'),(6,'6'),(7,'27'),(8,'5'),(10,'144'),(11,'0,35'),(12,'4')) v(n,a)) q;
\echo '--- B2. номер вне первой части и слишком длинный ответ'
select public.save_mock_exam_answer(:E, 13, '1');
select public.save_mock_exam_answer(:E, 1, repeat('9', 41));
\echo '--- B3. ученик: условие теперь есть, решения нет; ключа в ответе нет'
select (r->>'condition_path') as condition_path, r->'answers' as answers, r ? 'key' as has_key, r ? 'correct' as has_correct
  from public.my_mock_exam(:E) r;
select name from storage.objects where bucket_id = 'mock-exams' order by name;
\echo '--- B4. ученик: ключ — ни таблицей, ни записью'
select count(*) as key_rows from mock_exam_answer_keys;
insert into mock_exam_answer_keys (mock_exam_id, answers, updated_by) values (:E, '{1}', '00000000-0000-0000-0000-000000000051');
\echo '--- B4b. ученик: проверка по ключу и запись ключа функцией — отказ'
select public.grade_mock_exam_part1(:E);
select public.save_mock_exam_key(:E, array['1','2','3','4','5','6','7','8','9','10','11','12']);
\echo '--- B5. ученик: бланк мимо функции — ни вставить, ни поправить, ни сдать задним числом'
update mock_exam_sheets set answers[1] = '999';
insert into mock_exam_sheets (mock_exam_id, student_id) values (:E, '20000000-0000-0000-0000-000000000052');
\echo '--- B6. ученик: баллы и итоги по-прежнему не видны (политики §218/§215 не тронуты)'
select (select count(*) from mock_exam_task_scores) as task_scores, (select count(*) from mock_exam_results) as results;
\echo '--- B7. фото: в свою папку — да, в чужую — нет; регистрация чужого пути и несуществующего файла — нет'
insert into storage.objects (bucket_id, name) values ('mock-exams', '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000051/p1.jpg');
insert into storage.objects (bucket_id, name) values ('mock-exams', '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000052/fake.jpg');
select r->>'file_name' as file_name, r->>'position' as position
  from public.add_mock_exam_photo(:E, '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000051/p1.jpg', 'стр 1.jpg', 'image/webp', 1000) r;
select public.add_mock_exam_photo(:E, '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000052/x.jpg', 'x', 'image/jpeg', 1);
select public.add_mock_exam_photo(:E, '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000051/nope.jpg', 'x', 'image/jpeg', 1);
\echo '--- B8. S1 сдаёт; после сдачи бланк не пишется, фото — можно'
select (public.submit_mock_exam(:E)->>'submitted_at') is not null as submitted;
select public.save_mock_exam_answer(:E, 9, '3');
insert into storage.objects (bucket_id, name) values ('mock-exams', '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000051/p2.jpg');
select r->>'position' as position from public.add_mock_exam_photo(:E, '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000051/p2.jpg', 'стр 2.jpg', 'image/webp', 1000) r;
\echo '--- B9. S2 и S4 пишут, не сдают'
select set_config('request.jwt.claims', :S2, false) \g /dev/null
select count(*) from (select public.save_mock_exam_answer(:E, n, a) from (values (1,'12'),(2,' 0,75 '),(3,'3')) v(n,a)) q;
select set_config('request.jwt.claims', :S4, false) \g /dev/null
select count(*) from (select public.save_mock_exam_answer(:E, n, a) from (values (1,'12'),(2,'0,75')) v(n,a)) q;
\echo '--- B10. S2 видит только свой бланк и ни одного чужого фото'
select set_config('request.jwt.claims', :S2, false) \g /dev/null
select student_id, answers from mock_exam_sheets;
\echo '--- B10b. S2 пытается убрать фото S1'
select public.remove_mock_exam_photo((select id from mock_exam_photos where student_id = '20000000-0000-0000-0000-000000000051' limit 1));
reset role;
select set_config('request.jwt.claims', :S2, false) \g /dev/null
select public.remove_mock_exam_photo((select p.id from mock_exam_photos p where p.student_id = '20000000-0000-0000-0000-000000000051' limit 1));
set role authenticated;
select count(*) as photos_visible from mock_exam_photos;
select count(*) as photo_objects_visible from storage.objects where name like '%/photos/%';
\echo '--- B11. ученик 11Б (не из группы): ничего'
select set_config('request.jwt.claims', :S11B, false) \g /dev/null
select public.my_mock_exam(:E);
select public.save_mock_exam_answer(:E, 1, '1');
select (select count(*) from mock_exam_sheets) as sheets, (select count(*) from mock_exam_photos) as photos,
       (select count(*) from storage.objects where bucket_id = 'mock-exams') as objects;
\echo '--- B12. чужой преподаватель (11Б): ничего не видит и ничего не может'
select set_config('request.jwt.claims', :T11B, false) \g /dev/null
select (select count(*) from mock_exam_sheets) as sheets, (select count(*) from mock_exam_photos) as photos,
       (select count(*) from mock_exam_answer_keys) as keys,
       (select count(*) from storage.objects where bucket_id = 'mock-exams') as objects;
select public.save_mock_exam_key(:E, array['1','2','3','4','5','6','7','8','9','10','11','12']);
select public.grade_mock_exam_part1(:E);
insert into storage.objects (bucket_id, name) values ('mock-exams', '50000000-0000-0000-0000-000000000003/condition/evil.pdf');
\echo '--- B13. преподаватель группы: ключ; не поддающийся автопроверке ответ назван; проверен только сданный бланк (S1)'
select set_config('request.jwt.claims', :T11A, false) \g /dev/null
select public.save_mock_exam_key(:E, array['12','0,75','-3','49','0,2','6','27','5','3','144','0,25','четыре']);
select student_id, task_number, points, auto_points from mock_exam_task_scores order by student_id, task_number;
select student_id, score, primary_score, part1_score, part2_score from mock_exam_results order by student_id;
\echo '--- B14. S1 сдал, но результат не отправлен: результата и решения нет'
select set_config('request.jwt.claims', :S1, false) \g /dev/null
select public.my_mock_exam_result(:E);
select count(*) as solution_objects from storage.objects where name like '%/solution/%';
reset role;

\echo '=================== C. КОНЕЦ + 5 МИН (фото ещё 10 мин) ==================='
update mock_exams set starts_at = now() - interval '4 hours 5 minutes' where id = :E;
set role authenticated; select set_config('request.jwt.claims', :S2, false) \g /dev/null
\echo '--- C1. S2: бланк закрыт, сдать нельзя'
select public.save_mock_exam_answer(:E, 4, '49');
select public.submit_mock_exam(:E);
\echo '--- C2. S2: фото ещё принимаются'
insert into storage.objects (bucket_id, name) values ('mock-exams', '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000052/late.jpg');
select r->>'file_name' as file_name from public.add_mock_exam_photo(:E, '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000052/late.jpg', 'поздно.jpg', 'image/webp', 10) r;
reset role;

\echo '=================== D. КОНЕЦ + 16 МИН ==================='
update mock_exams set starts_at = now() - interval '4 hours 16 minutes' where id = :E;
set role authenticated; select set_config('request.jwt.claims', :S2, false) \g /dev/null
\echo '--- D1. S2: фото не принимаются — ни хранилищем, ни регистрацией, ни удалением'
insert into storage.objects (bucket_id, name) values ('mock-exams', '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000052/too-late.jpg');
select public.add_mock_exam_photo(:E, '50000000-0000-0000-0000-000000000003/photos/20000000-0000-0000-0000-000000000052/late.jpg', 'x', 'image/webp', 10);
select public.remove_mock_exam_photo((select id from mock_exam_photos limit 1));
delete from storage.objects where name like '%/photos/%';
select count(*) as still_there from storage.objects where name like '%/photos/%';
\echo '--- D2. преподаватель: теперь проверены и несданные бланки (окно кончилось); повтор — ноль изменений'
select set_config('request.jwt.claims', :T11A, false) \g /dev/null
select public.grade_mock_exam_part1(:E);
select public.grade_mock_exam_part1(:E);
select student_id, task_number, points, auto_points from mock_exam_task_scores where task_number in (1,2,3,9,11,12) order by student_id, task_number;
\echo '--- D3. преподаватель исправил авто-клетку S1 №11 (опечатка в ключе) и поставил №13'
select public.save_mock_exam_grid(:E, jsonb_build_array(jsonb_build_object('student_id','20000000-0000-0000-0000-000000000051',
  'points', (select jsonb_agg(case when t = 11 then 1 when t = 13 then 2 when t <= 11 then points when t = 12 then null else null end order by t)
               from generate_series(1,19) t left join mock_exam_task_scores sc on sc.task_number = t and sc.student_id = '20000000-0000-0000-0000-000000000051')))) -> 'rows';
select task_number, points, auto_points, points = auto_points as is_auto from mock_exam_task_scores
 where student_id = '20000000-0000-0000-0000-000000000051' and task_number in (10,11,12,13) order by task_number;
\echo '--- D4. ключ поправлен (№11 = 0,35): ручная клетка не тронута, авто-клетки пересчитаны'
select public.save_mock_exam_key(:E, array['12','0,75','-3','49','0,2','6','27','5','3','144','0,35','4']) -> 'grade';
select student_id, task_number, points, auto_points from mock_exam_task_scores where task_number in (11,12) order by student_id, task_number;
select student_id, score, part1_score, part2_score from mock_exam_results order by student_id;
\echo '--- D5. куратор курса: видит бланки, но проверить по ключу и сохранить ключ не может'
select set_config('request.jwt.claims', :CUR, false) \g /dev/null
select count(*) as sheets_visible from mock_exam_sheets;
select public.grade_mock_exam_part1(:E);
\echo '--- D6. «Уведомить» S1; S1 видит результат и решение, S2 — нет'
select set_config('request.jwt.claims', :T11A, false) \g /dev/null
select public.notify_mock_exam_results(:E, array['20000000-0000-0000-0000-000000000051']::uuid[]) - 'rows';
select set_config('request.jwt.claims', :S1, false) \g /dev/null
select r->>'status' as status, r->>'score' as score, r->>'part1_score' as p1, r->>'part2_score' as p2, r->>'solution_path' as solution
  from public.my_mock_exam_result(:E) r;
select t->>'n' as n, t->>'answer' as answer, t->>'correct' as correct, t->>'points' as points, t->>'max' as max
  from public.my_mock_exam_result(:E) r, jsonb_array_elements(r->'tasks') t where (t->>'n')::int in (1,2,9,11,12,13,14);
select count(*) as solution_objects from storage.objects where name like '%/solution/%';
select count(*) as key_rows_after_notify from mock_exam_answer_keys;
select set_config('request.jwt.claims', :S2, false) \g /dev/null
select public.my_mock_exam_result(:E);
select count(*) as solution_objects from storage.objects where name like '%/solution/%';
\echo '--- D7. программа курса: у S1 пробник есть со статусом; у ученика 11Б в его группе — пусто'
select set_config('request.jwt.claims', :S1, false) \g /dev/null
select e->>'title' as title, e->>'module_id' as module_id, e->>'module_position' as pos, e->>'submitted_at' is not null as submitted,
       e->>'has_work' as has_work, e->>'notified' as notified
  from jsonb_array_elements(public.my_mock_exams('40000000-0000-0000-0000-000000000001')) e;
select set_config('request.jwt.claims', :S11B, false) \g /dev/null
select public.my_mock_exams('40000000-0000-0000-0000-000000000002') as s11b_own_group,
       public.my_mock_exams('40000000-0000-0000-0000-000000000001') as s11b_foreign_group;
\echo '--- D8. чужой бакет с «кривым» путём — политики mock-exams его не роняют'
insert into storage.objects (bucket_id, name) values ('other', 'не-uuid/папка/файл.txt');
select count(*) from storage.objects where bucket_id = 'other';
reset role;

\echo '=================== E. СТРАЖИ СХЕМЫ ==================='
\echo '--- E1. раздел из чужого курса'
update mock_exams set module_id = '60000000-0000-0000-0000-000000000002' where id = :E;
\echo '--- E2. онлайн-окно без шаблона'
update mock_exams set starts_at = now() where id = '50000000-0000-0000-0000-000000000000';
\echo '--- E3. anon: функций ученика нет'
set role anon;
select public.my_mock_exam(:E);
reset role;
