-- §238. Данные проб: четыре работы, у каждой своя роль в отчёте.
--   at1 — вердикт 2 дня назад, две проверки ИИ (старая «всё неверно» и свежая) → в отчёте свежая;
--   at2 — вердикт 3 дня назад, свежая проверка ИИ упала (failed) → берётся прошлая done;
--   at3 — вердикт 20 дней назад → только в отчёте за 30 дней;
--   at4 — без вердикта → нигде.
insert into profiles (id, full_name, role) values
 ('38000000-0000-0000-0000-00000000000a', 'Админ', 'admin'),
 ('38000000-0000-0000-0000-00000000000b', 'Владелец', 'owner'),
 ('38000000-0000-0000-0000-0000000000a1', 'Преподаватель', 'teacher'),
 ('38000000-0000-0000-0000-000000000051', 'Ученик', 'student');
insert into students (id, profile_id) values ('38200000-0000-0000-0000-000000000051', '38000000-0000-0000-0000-000000000051');

insert into topic_homework_attempts (id, student_id) values
 ('38300000-0000-0000-0000-000000000001', '38200000-0000-0000-0000-000000000051'),
 ('38300000-0000-0000-0000-000000000002', '38200000-0000-0000-0000-000000000051'),
 ('38300000-0000-0000-0000-000000000003', '38200000-0000-0000-0000-000000000051'),
 ('38300000-0000-0000-0000-000000000004', '38200000-0000-0000-0000-000000000051');

insert into topic_homework_reviews (attempt_id, reviewer_id, decision, created_at) values
 ('38300000-0000-0000-0000-000000000001', '38000000-0000-0000-0000-0000000000a1', 'accepted', now() - interval '2 days'),
 ('38300000-0000-0000-0000-000000000002', '38000000-0000-0000-0000-0000000000a1', 'accepted', now() - interval '3 days'),
 ('38300000-0000-0000-0000-000000000003', '38000000-0000-0000-0000-0000000000a1', 'accepted', now() - interval '20 days');

insert into topic_homework_ai_jobs (attempt_id, status, tasks, created_at, completed_at) values
 -- at1: старая проверка — в отчёт не должна попасть.
 ('38300000-0000-0000-0000-000000000001', 'done',
  '[{"no":"1","verdict":"wrong","student_answer":"12","expected_answer":"12"},{"no":"2","verdict":"wrong","student_answer":"x","expected_answer":"x"}]',
  now() - interval '5 days', now() - interval '5 days'),
 -- at1: свежая.
 ('38300000-0000-0000-0000-000000000001', 'done', $j$[
   {"no":"1","verdict":"correct","student_answer":"12 м/с","expected_answer":"12 М/С"},
   {"no":"2","verdict":"correct","student_answer":"0,20","expected_answer":"0.2"},
   {"no":"3","verdict":"correct","student_answer":"в 144 раза","expected_answer":"144"},
   {"no":"4","verdict":"partial","student_answer":"4π; 3π","expected_answer":"4π;3π","note":"x=3π не входит в [5π/2; 4π]"},
   {"no":"5","verdict":"partial","student_answer":"12","expected_answer":"30"},
   {"no":"6","verdict":"wrong","student_answer":"−8","expected_answer":"-8."},
   {"no":"7","verdict":"unchecked","student_answer":"","expected_answer":"5"},
   {"no":"№ 8","verdict":"correct","student_answer":"5","expected_answer":"5"},
   {"no":"9","verdict":"correct","student_answer":"1","expected_answer":"1"},
   "мусор",
   {"no":"","verdict":"correct","student_answer":"1","expected_answer":"1"}
 ]$j$, now() - interval '3 days', now() - interval '3 days'),
 -- at2: прошлая done и свежая failed.
 ('38300000-0000-0000-0000-000000000002', 'done',
  '[{"no":"1","verdict":"correct","student_answer":"x","expected_answer":"x"},{"no":"2","verdict":"partial","student_answer":"1","expected_answer":"1"}]',
  now() - interval '4 days', now() - interval '4 days'),
 ('38300000-0000-0000-0000-000000000002', 'failed', null, now() - interval '3 days', null),
 -- at3: старый вердикт.
 ('38300000-0000-0000-0000-000000000003', 'done',
  '[{"no":"1","verdict":"correct","student_answer":"a","expected_answer":"a"}]',
  now() - interval '21 days', now() - interval '21 days'),
 -- at4: без вердикта.
 ('38300000-0000-0000-0000-000000000004', 'done',
  '[{"no":"1","verdict":"correct","student_answer":"a","expected_answer":"a"}]',
  now() - interval '1 days', now() - interval '1 days');

-- Таблицы преподавателя. at1 №9 удалена — пары нет, в отчёт не идёт.
insert into topic_homework_review_tasks (attempt_id, no, verdict, position) values
 ('38300000-0000-0000-0000-000000000001', '1', 'correct', 10),
 ('38300000-0000-0000-0000-000000000001', '2', 'correct', 20),
 ('38300000-0000-0000-0000-000000000001', '3', 'correct', 30),
 ('38300000-0000-0000-0000-000000000001', '4', 'correct', 40),   -- «частично» ИИ → «верно» (изменено)
 ('38300000-0000-0000-0000-000000000001', '5', 'partial', 50),
 ('38300000-0000-0000-0000-000000000001', '6', 'correct', 60),   -- изменено
 ('38300000-0000-0000-0000-000000000001', '7', 'unsolved', 70),  -- изменено
 ('38300000-0000-0000-0000-000000000001', '8', 'wrong', 80),     -- «№ 8» у ИИ, изменено
 ('38300000-0000-0000-0000-000000000002', '1', 'correct', 10),
 ('38300000-0000-0000-0000-000000000002', '2', 'partial', 20),
 ('38300000-0000-0000-0000-000000000003', '1', 'wrong', 10),     -- изменено, но вердикт давний
 ('38300000-0000-0000-0000-000000000004', '1', 'wrong', 10);
