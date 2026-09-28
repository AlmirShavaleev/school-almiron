-- §240. Данные ДО PENDING_240 (так, как они лежат на проде сейчас): каркас с
-- одной темой-«контрольной» (пока урок) и два класса-копии, которые заводят
-- триггеры синхронизации; в классе 10А — свои темы и работы учеников.
--   O  …a0 — владелец курсов (teacher, НЕ админ);  A …a1 — преподаватель 10А
--   B  …a2 — преподаватель 11А;                    X …a3 — посторонний (свой курс)
--   S1…S6 (…b1–b6) — ученики 10А;                   S7 …b7 — ученик 11А
-- Темы 10А (свой модуль): L — урок; K — будет контрольной (идёт сейчас);
-- F — проверочной (завтра); C — контрольной (закрылась час назад);
-- N — контрольной без времени (как КР «Кинематика» на проде).
insert into profiles (id, full_name, role) values
  ('00000000-0000-4000-8000-0000000000a0', 'Владелец', 'teacher'),
  ('00000000-0000-4000-8000-0000000000a1', 'Преподаватель 10А', 'teacher'),
  ('00000000-0000-4000-8000-0000000000a2', 'Преподаватель 11А', 'teacher'),
  ('00000000-0000-4000-8000-0000000000a3', 'Посторонний', 'teacher'),
  ('00000000-0000-4000-8000-0000000000b1', 'Ученик 1', 'student'),
  ('00000000-0000-4000-8000-0000000000b2', 'Ученик 2', 'student'),
  ('00000000-0000-4000-8000-0000000000b3', 'Ученик 3', 'student'),
  ('00000000-0000-4000-8000-0000000000b4', 'Ученик 4', 'student'),
  ('00000000-0000-4000-8000-0000000000b5', 'Ученик 5', 'student'),
  ('00000000-0000-4000-8000-0000000000b6', 'Ученик 6', 'student'),
  ('00000000-0000-4000-8000-0000000000b7', 'Ученик 7', 'student');
insert into teachers (id, profile_id) values
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000001a2', '00000000-0000-4000-8000-0000000000a2'),
  ('00000000-0000-4000-8000-0000000001a3', '00000000-0000-4000-8000-0000000000a3');
insert into students (id, profile_id)
select ('00000000-0000-4000-8000-0000000001b' || n)::uuid, ('00000000-0000-4000-8000-0000000000b' || n)::uuid
  from generate_series(1, 7) n;

insert into courses (id, title, owner_id, is_template, copied_from_course_id, subject, exam_type) values
  ('00000000-0000-4000-8000-0000000c0000', 'Физика ЕГЭ (каркас)', '00000000-0000-4000-8000-0000000000a0', true,  null, 'physics', 'ege'),
  ('00000000-0000-4000-8000-0000000c0001', 'Физика ЕГЭ 10А',      '00000000-0000-4000-8000-0000000000a0', false, '00000000-0000-4000-8000-0000000c0000', 'physics', 'ege'),
  ('00000000-0000-4000-8000-0000000c0002', 'Физика ЕГЭ 11А',      '00000000-0000-4000-8000-0000000000a0', false, '00000000-0000-4000-8000-0000000c0000', 'physics', 'ege'),
  ('00000000-0000-4000-8000-0000000c000f', 'Чужой курс',          '00000000-0000-4000-8000-0000000000a3', false, null, 'math', 'ege');
insert into groups (id, name, course_id, teacher_id) values
  ('00000000-0000-4000-8000-0000000f0001', '10А', '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000001a1'),
  ('00000000-0000-4000-8000-0000000f0002', '11А', '00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-0000000001a2'),
  ('00000000-0000-4000-8000-0000000f000f', 'Чужая', '00000000-0000-4000-8000-0000000c000f', '00000000-0000-4000-8000-0000000001a3');
insert into group_students (group_id, student_id)
select '00000000-0000-4000-8000-0000000f0001', ('00000000-0000-4000-8000-0000000001b' || n)::uuid from generate_series(1, 6) n;
insert into group_students (group_id, student_id) values
  ('00000000-0000-4000-8000-0000000f0002', '00000000-0000-4000-8000-0000000001b7');

-- Каркас: модуль и тема, копии в 10А/11А заводят триггеры.
insert into modules (id, course_id, title, order_index) values
  ('00000000-0000-4000-8000-0000000e0000', '00000000-0000-4000-8000-0000000c0000', 'Механика', 1);
insert into topics (id, module_id, title, order_index) values
  ('00000000-0000-4000-8000-000000070001', '00000000-0000-4000-8000-0000000e0000', 'Контрольная. Кинематика', 1);
insert into topic_material_items (topic_id, kind, title, storage_path, file_name, mime_type, position, section, created_by) values
  ('00000000-0000-4000-8000-000000070001', 'file', 'Условие', 'tpl/kr/cond.pdf', 'Условие.pdf', 'application/pdf', 0, 'worksheet_homework', '00000000-0000-4000-8000-0000000000a0'),
  ('00000000-0000-4000-8000-000000070001', 'file', 'Решение', 'tpl/kr/sol.pdf',  'Решение.pdf', 'application/pdf', 1, 'solution',           '00000000-0000-4000-8000-0000000000a0');
insert into topic_homework (id, topic_id, title, is_published, created_by, grade_scale) values
  ('00000000-0000-4000-8000-0000000d0000', '00000000-0000-4000-8000-000000070001', 'Контрольная работа', true, '00000000-0000-4000-8000-0000000000a0', 'five');

-- 10А: свой модуль и пять тем.
insert into modules (id, course_id, title, order_index) values
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-0000000c0001', 'Работы 10А', 5);
insert into topics (id, module_id, title, order_index) values
  ('00000000-0000-4000-8000-0000007a0001', '00000000-0000-4000-8000-0000000e0001', 'L: Законы Ньютона', 1),
  ('00000000-0000-4000-8000-0000007a0002', '00000000-0000-4000-8000-0000000e0001', 'K: Контрольная (идёт)', 2),
  ('00000000-0000-4000-8000-0000007a0003', '00000000-0000-4000-8000-0000000e0001', 'F: Проверочная (завтра)', 3),
  ('00000000-0000-4000-8000-0000007a0004', '00000000-0000-4000-8000-0000000e0001', 'C: Контрольная (закрылась)', 4),
  ('00000000-0000-4000-8000-0000007a0005', '00000000-0000-4000-8000-0000000e0001', 'N: Контрольная без времени', 5);
insert into topic_material_items (topic_id, kind, title, storage_path, file_name, mime_type, position, section, created_by)
select t.id, 'file', r.title, t.id || '/' || r.file, r.file, 'application/pdf', r.pos, r.section, '00000000-0000-4000-8000-0000000000a1'
  from (values ('00000000-0000-4000-8000-0000007a0001'::uuid, 'l'), ('00000000-0000-4000-8000-0000007a0002'::uuid, 'k'),
               ('00000000-0000-4000-8000-0000007a0003'::uuid, 'f'), ('00000000-0000-4000-8000-0000007a0004'::uuid, 'c'),
               ('00000000-0000-4000-8000-0000007a0005'::uuid, 'n')) t(id, code),
       (values (0, 'Условие', 'cond.pdf', 'worksheet_homework'), (1, 'Решение', 'sol.pdf', 'solution'),
               (2, 'Конспект', 'notes.pdf', 'notes')) r(pos, title, file, section);
insert into topic_homework (id, topic_id, title, is_published, created_by, due_at, grade_scale)
select ('00000000-0000-4000-8000-0000000d000' || n)::uuid, ('00000000-0000-4000-8000-0000007a000' || n)::uuid,
       'Работа ' || n, true, '00000000-0000-4000-8000-0000000000a1',
       case when n = 1 then current_date - 3 end, 'five'
  from generate_series(1, 5) n;
-- Условие ещё и файлом ДЗ (бакет topic-homework) у K и F.
insert into topic_homework_files (homework_id, storage_path, original_filename, mime_type, position) values
  ('00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-0000007a0002/task.pdf', 'task.pdf', 'application/pdf', 0),
  ('00000000-0000-4000-8000-0000000d0003', '00000000-0000-4000-8000-0000007a0003/task.pdf', 'task.pdf', 'application/pdf', 0),
  ('00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-0000007a0001/task.pdf', 'task.pdf', 'application/pdf', 0);
insert into storage.objects (bucket_id, name)
select 'topic-materials', storage_path from topic_material_items
 where topic_id in (select id from topics where module_id = '00000000-0000-4000-8000-0000000e0001')
union all
select 'topic-homework', storage_path from topic_homework_files;

-- Попытки в теме C (закроется «час назад»). Номер и статус ставит сторож.
--   S1 — черновик с фото; S2 — черновик без фото; S3 — сдал сам;
--   S4 — черновик с фото (ему дадут личное окно, идущее сейчас);
--   S5 — черновик с фото (личное окно уже закрылось);
--   S6 — черновик с фото, уведомление о сдаче падает (файл «boom»).
insert into topic_homework_attempts (id, homework_id, student_id, attempt_number)
select ('00000000-0000-4000-8000-00000c0a000' || n)::uuid, '00000000-0000-4000-8000-0000000d0004',
       ('00000000-0000-4000-8000-0000000001b' || n)::uuid, 1
  from generate_series(1, 6) n;
insert into topic_homework_attempt_files (attempt_id, storage_path, file_name, mime_type, position)
select ('00000000-0000-4000-8000-00000c0a000' || n)::uuid,
       '00000000-0000-4000-8000-00000c0a000' || n || '/p1.jpg',
       case when n = 6 then 'boom' else 'p1.jpg' end, 'image/jpeg', 0
  from generate_series(1, 6) n where n <> 2;
insert into storage.objects (bucket_id, name)
select 'topic-homework-attempts', storage_path from topic_homework_attempt_files;
update topic_homework_attempts set status = 'submitted' where id = '00000000-0000-4000-8000-00000c0a0003';

-- Тема N: у S1 работа сдана (как 9 работ КР на проде), у S2 — возвращена
-- на доработку (наследие: до §240 так было можно).
insert into topic_homework_attempts (id, homework_id, student_id, attempt_number) values
  ('00000000-0000-4000-8000-00000c0b0001', '00000000-0000-4000-8000-0000000d0005', '00000000-0000-4000-8000-0000000001b1', 1),
  ('00000000-0000-4000-8000-00000c0b0002', '00000000-0000-4000-8000-0000000d0005', '00000000-0000-4000-8000-0000000001b2', 1);
update topic_homework_attempts set status = 'submitted'
 where id in ('00000000-0000-4000-8000-00000c0b0001', '00000000-0000-4000-8000-00000c0b0002');
update topic_homework_attempts set status = 'returned_for_revision' where id = '00000000-0000-4000-8000-00000c0b0002';
