-- §260. Данные проб — ДО миграции: старые строки должны остаться с NULL в новых столбцах.
--   at1 — проверочная с критериями: последняя проверка ИИ с баллами (часть баллов кривые);
--   at2 — обычное ДЗ: проверка без баллов (как до §260);
--   at3 — у работы уже есть таблица преподавателя (заполнение — no-op).
insert into profiles (id, full_name, role) values
 ('26000000-0000-0000-0000-0000000000a1', 'Преподаватель', 'teacher'),
 ('26000000-0000-0000-0000-000000000051', 'Ученик', 'student');
insert into students (id, profile_id) values ('26200000-0000-0000-0000-000000000051', '26000000-0000-0000-0000-000000000051');

insert into topic_homework_attempts (id, student_id) values
 ('26300000-0000-0000-0000-000000000001', '26200000-0000-0000-0000-000000000051'),
 ('26300000-0000-0000-0000-000000000002', '26200000-0000-0000-0000-000000000051'),
 ('26300000-0000-0000-0000-000000000003', '26200000-0000-0000-0000-000000000051');

insert into topic_homework_ai_jobs (attempt_id, status, tasks, created_at, completed_at) values
 -- at2: обычное ДЗ, до §260 — без баллов.
 ('26300000-0000-0000-0000-000000000002', 'done',
  '[{"no":"1","verdict":"correct","student_answer":"5","expected_answer":"5"},{"no":"2","verdict":"wrong","student_answer":"3","expected_answer":"4","note":"знак"}]',
  now() - interval '1 day', now() - interval '1 day'),
 ('26300000-0000-0000-0000-000000000003', 'done',
  '[{"no":"1","verdict":"correct","points":1,"max_points":1}]',
  now() - interval '1 day', now() - interval '1 day');

insert into topic_homework_review_tasks (attempt_id, no, verdict, position) values
 ('26300000-0000-0000-0000-000000000003', '1', 'wrong', 10);
