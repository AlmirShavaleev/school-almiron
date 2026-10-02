-- §257. Выдуманные данные для проб — ПОВЕРХ данных §255 (../prognoz_255/10_data_255.sql) и §256
-- (../katalog_prognoz_256/10_data_256.sql), грузятся после них. Там: ученик A (…a1: математика и физика ЕГЭ,
-- математика ОГЭ), B (…b1, физика ЕГЭ), учителя T (…c1, курсы A) и O (…d1, посторонний), админ M (…e1);
-- у A: 5 разных сданных ДЗ (4 вовремя), «5» за ДЗ №6 после возврата (доработка), пробник 2 первичных,
-- каталог №1 — 9 неверных (4 дня назад), затем 9 верных (3 дня назад).
-- Даты — от now().

-- Шкала шаблона: первичный 2 → score_scale[3] = 27 (индекс — первичный + 1, массивы с единицы).
update public.mock_exam_templates
   set score_scale = '{0,6,27,33,39,45,50,56,62,68,70,72,74,76,78,80,82,84,86,88,90,92,94,95,96,97,98,99,100,100,100,100,100}'
 where id = '94000000-0000-4000-8000-000000000001';

-- «Ранняя пташка»: ДЗ со сроком через 5 дней сдано вчера (за 6 дней до срока).
insert into public.topics (id, module_id, title, is_open, ege_task_numbers) values
  ('60000000-0000-4000-8000-000000000257', '50000000-0000-4000-8000-000000000001', '№8 Производная', true, '{8}');
insert into public.topic_homework (id, topic_id, title, due_at, grade_scale) values
  ('70000000-0000-4000-8000-000000000257', '60000000-0000-4000-8000-000000000257', 'ДЗ №8', (now() + interval '5 days')::date, 'five');
insert into public.topic_homework_attempts (id, homework_id, student_id, attempt_number, status, submitted_at) values
  ('80000000-0000-4000-8000-000000000257', '70000000-0000-4000-8000-000000000257', '10000000-0000-4000-8000-0000000000a1', 1, 'submitted', now() - interval '1 day');

-- «Без ошибок»: 10-я верная подряд в каталоге — задача №1 №19 вчера (после 9 верных 3 дня назад).
-- Она же — задача дня вчера, решённая в свой день (задача дня +1).
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, created_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'a5611000-0000-4000-8000-000000000019', '19', 'correct', now() - interval '1 day');
insert into public.student_daily_tasks (profile_id, day, subject, task_id, n) values
  ('00000000-0000-4000-8000-0000000000a1', ((now() - interval '1 day') at time zone 'Europe/Moscow')::date, 'math',
   'a5611000-0000-4000-8000-000000000019', 1);

-- «Закрыта зона роста»: №4 — первая проверка 20 дней назад неверна (зона роста с данными),
-- затем 4 верных за последние дни → доля 4/5 = 0,8 → «уверенно».
insert into public.catalog_tasks (id, section_id, is_published, statement_html, answer_html, exam_part)
select ('a5714000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'a5600000-0000-4000-8000-000000000004', true,
       '<p>Вероятность ' || i || '</p>', '<p>' || i || '</p>', 1
  from generate_series(1, 5) i;
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, created_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'a5714000-0000-4000-8000-000000000001', '0', 'wrong', now() - interval '20 days');
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, created_at)
select '00000000-0000-4000-8000-0000000000a1', ('a5714000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, i::text, 'correct',
       now() - interval '2 days' + i * interval '1 minute'
  from generate_series(2, 5) i;

-- ── Тяжёлый ученик H (…f1) — только для замера времени sync. Математика ЕГЭ курса A (учитель T). ──
-- 12 номеров × 50 задач каталога (600 проверок, 480 верных), 60 ДЗ с вердиктом и таблицей проверки по
-- 10 заданий, 6 пробников по 19 заданий, 40 тестов тем, серия 120 дней.
insert into public.profiles (id, full_name, role) values ('00000000-0000-4000-8000-0000000000f1', 'Ученик Х', 'student');
insert into public.students (id, profile_id) values ('10000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f1');
insert into public.group_students (group_id, student_id) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000f1');
insert into public.catalog_sections (id, subject, exam_type, exam_number, title, position, is_published)
select ('a5800000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Математика', 'ЕГЭ', n, 'Номер ' || n, 100 + n, true
  from generate_series(1, 12) n;
insert into public.catalog_tasks (id, section_id, is_published, statement_html, answer_html, exam_part)
select ('a5810000-0000-4000-' || lpad(n::text, 4, '0') || '-' || lpad(i::text, 12, '0'))::uuid,
       ('a5800000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, true, '<p>x</p>', '<p>' || i || '</p>', 1
  from generate_series(1, 12) n, generate_series(1, 50) i;
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, created_at)
select '00000000-0000-4000-8000-0000000000f1',
       ('a5810000-0000-4000-' || lpad(n::text, 4, '0') || '-' || lpad(i::text, 12, '0'))::uuid, i::text,
       case when (n + i) % 5 = 0 then 'wrong' else 'correct' end,
       now() - ((n * 50 + i) % 170) * interval '1 day' - n * interval '1 minute'
  from generate_series(1, 12) n, generate_series(1, 50) i;
insert into public.topics (id, module_id, title, is_open, ege_task_numbers)
select ('60000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, '50000000-0000-4000-8000-000000000001', 'Тема Х ' || k, true,
       array[(k % 12) + 1]::smallint[]
  from generate_series(1, 60) k;
insert into public.topic_homework (id, topic_id, title, due_at, grade_scale)
select ('70000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, ('60000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid,
       'ДЗ Х ' || k, (now() - (k * 3 - 2) * interval '1 day')::date, 'five'
  from generate_series(1, 60) k;
insert into public.topic_homework_attempts (id, homework_id, student_id, attempt_number, status, submitted_at)
select ('80000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, ('70000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid,
       '10000000-0000-4000-8000-0000000000f1', 1, 'accepted', now() - k * 3 * interval '1 day'
  from generate_series(1, 60) k;
insert into public.topic_homework_reviews (attempt_id, decision, score, created_at)
select ('80000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, 'accepted', 3 + k % 3, now() - (k * 3 - 1) * interval '1 day'
  from generate_series(1, 60) k;
insert into public.topic_homework_review_tasks (attempt_id, no, verdict)
select ('80000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, j::text, case when (k + j) % 3 = 0 then 'wrong' else 'correct' end
  from generate_series(1, 60) k, generate_series(1, 10) j;
insert into public.mock_exams (id, title, date, starts_at, subject, exam_type, template_id, group_id)
select ('94100000-0000-4000-9000-' || lpad(m::text, 12, '0'))::uuid, 'Пробник Х ' || m, now() - m * 20 * interval '1 day',
       now() - m * 20 * interval '1 day', 'math', 'ege', '94000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001'
  from generate_series(1, 6) m;
insert into public.mock_exam_task_scores (mock_exam_id, student_id, task_number, points)
select ('94100000-0000-4000-9000-' || lpad(m::text, 12, '0'))::uuid, '10000000-0000-4000-8000-0000000000f1', t, (t + m) % 2
  from generate_series(1, 6) m, generate_series(1, 19) t;
insert into public.topic_tests (id, title)
select ('93000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, 'Тест Х ' || k from generate_series(1, 40) k;
insert into public.topic_test_assignments (id, test_id, topic_id)
select ('93300000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, ('93000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid,
       ('60000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid from generate_series(1, 40) k;
insert into public.topic_test_items (id, test_id, max_points)
select ('93100000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, ('93000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, 1
  from generate_series(1, 40) k;
insert into public.topic_test_attempts (id, test_id, assignment_id, student_id, status, completed_at)
select ('93200000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, ('93000000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid,
       ('93300000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, '10000000-0000-4000-8000-0000000000f1', 'completed', now() - k * 4 * interval '1 day'
  from generate_series(1, 40) k;
insert into public.topic_test_answers (attempt_id, item_id, awarded_points, is_correct)
select ('93200000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, ('93100000-0000-4000-9000-' || lpad(k::text, 12, '0'))::uuid, k % 2, k % 2 = 1
  from generate_series(1, 40) k;
