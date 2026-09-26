-- §228. Данные поверх данных §221/§224: все выдуманы.
-- Вторая группа того же курса 11А (куда учитель 11А вправе перенести пробник) с одним учеником.
insert into profiles values ('00000000-0000-0000-0000-000000000055','Гарипов Тимур','student');
insert into students values ('20000000-0000-0000-0000-000000000055','00000000-0000-0000-0000-000000000055');
insert into groups values ('40000000-0000-0000-0000-000000000003','11А-2','30000000-0000-0000-0000-000000000001', null, null);
insert into group_students values ('40000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000055');
-- Пробник №6 (11А): закончился 5 часов назад; работы S1 и S2, ключ, фото S1.
insert into mock_exams (id, title, subject, exam_type, group_id, date, template_id, created_by, starts_at, condition_path) values
 ('50000000-0000-0000-0000-000000000006','Пробник №6 прошёл','math','ege','40000000-0000-0000-0000-000000000001', now(),
   (select id from mock_exam_templates where year = 2027), '10000000-0000-0000-0000-0000000000a1', now() - interval '5 hours',
   '50000000-0000-0000-0000-000000000006/condition/1_v6.pdf');
insert into storage.objects (bucket_id, name, owner) values
 ('mock-exams','50000000-0000-0000-0000-000000000006/condition/1_v6.pdf','00000000-0000-0000-0000-0000000000a1'),
 ('mock-exams','50000000-0000-0000-0000-000000000006/photos/20000000-0000-0000-0000-000000000051/1_p.jpg','00000000-0000-0000-0000-000000000051');
insert into mock_exam_sheets (mock_exam_id, student_id, answers, submitted_at) values
 ('50000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000051', array['12','0,75','-3','49','0,2','6','27','5','3','144','0,25','4'], now() - interval '4 hours'),
 ('50000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000052', array['11','0,75',null,null,null,null,null,null,null,null,null,null], null);
insert into mock_exam_photos (mock_exam_id, student_id, storage_path, file_name) values
 ('50000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000051','50000000-0000-0000-0000-000000000006/photos/20000000-0000-0000-0000-000000000051/1_p.jpg','p.jpg');
insert into mock_exam_answer_keys (mock_exam_id, answers) values
 ('50000000-0000-0000-0000-000000000006', array['12','0,75','-3','49','0,2','6','27','5','3','144','0,25','4']);
