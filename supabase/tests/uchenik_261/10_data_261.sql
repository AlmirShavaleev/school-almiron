-- §261. Выдуманные данные — ПОВЕРХ данных §255/§256/§257 (грузятся первыми). Там: ученик A (…a1: математика и
-- физика ЕГЭ учителя T, математика ОГЭ), B (…b1, физика ЕГЭ учителя O), тяжёлый H (…f1, математика ЕГЭ учителя T,
-- 60 ДЗ, 600 проверок каталога); учителя T (…c1), O (…d1, посторонний), админ M (…e1). Даты — от now().

-- ── Класс физики A (группа Ф11А, курс 30…02): шесть одноклассников — в классе 7, средняя по классу печатается.
insert into public.profiles (id, full_name, role)
select ('00000000-0000-4000-8261-' || lpad(i::text, 12, '0'))::uuid, 'Одноклассник ' || i, 'student' from generate_series(1, 6) i;
insert into public.students (id, profile_id)
select ('10000000-0000-4000-8261-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-4000-8261-' || lpad(i::text, 12, '0'))::uuid
  from generate_series(1, 6) i;
insert into public.group_students (group_id, student_id)
select '40000000-0000-4000-8000-000000000002', ('10000000-0000-4000-8261-' || lpad(i::text, 12, '0'))::uuid from generate_series(1, 6) i;

-- ── Проверочные и контрольные физики ──
insert into public.topics (id, module_id, title, is_open, kind, ege_task_numbers) values
  ('61000000-0000-4000-8261-000000000001', '50000000-0000-4000-8000-000000000002', 'Движение по окружности', false, 'check', '{}'),
  ('61000000-0000-4000-8261-000000000002', '50000000-0000-4000-8000-000000000002', 'Кинематика: броски', false, 'control', '{}'),
  ('61000000-0000-4000-8261-000000000003', '50000000-0000-4000-8000-000000000002', 'Динамика (будет)', false, 'check', '{}'),
  ('61000000-0000-4000-8261-000000000004', '50000000-0000-4000-8000-000000000002', 'Статика (пропустил)', false, 'check', '{}');
insert into public.topic_homework (id, topic_id, title, grade_scale, is_published, opens_at, closes_at) values
  ('71000000-0000-4000-8261-000000000001', '61000000-0000-4000-8261-000000000001', 'Проверочная', 'five', true, now() - interval '5 days', now() - interval '5 days' + interval '45 minutes'),
  ('71000000-0000-4000-8261-000000000002', '61000000-0000-4000-8261-000000000002', 'Контрольная', 'five', true, now() - interval '12 days', now() - interval '12 days' + interval '45 minutes'),
  ('71000000-0000-4000-8261-000000000003', '61000000-0000-4000-8261-000000000003', 'Проверочная', 'five', true, now() + interval '3 days', now() + interval '3 days' + interval '45 minutes'),
  ('71000000-0000-4000-8261-000000000004', '61000000-0000-4000-8261-000000000004', 'Проверочная', 'five', true, now() - interval '2 days', now() - interval '2 days' + interval '45 minutes');
-- A: проверочная — 4, баллы по критериям 10 из 12 (задание 8 «не решено» — 0); контрольная — 4 без баллов.
insert into public.topic_homework_attempts (id, homework_id, student_id, attempt_number, status, submitted_at) values
  ('81000000-0000-4000-8261-000000000001', '71000000-0000-4000-8261-000000000001', '10000000-0000-4000-8000-0000000000a1', 1, 'accepted', now() - interval '5 days' + interval '40 minutes'),
  ('81000000-0000-4000-8261-000000000002', '71000000-0000-4000-8261-000000000002', '10000000-0000-4000-8000-0000000000a1', 1, 'accepted', now() - interval '12 days' + interval '44 minutes');
insert into public.topic_homework_reviews (attempt_id, decision, score, created_at) values
  ('81000000-0000-4000-8261-000000000001', 'accepted', 4, now() - interval '4 days'),
  ('81000000-0000-4000-8261-000000000002', 'accepted', 4, now() - interval '11 days');
insert into public.topic_homework_review_tasks (attempt_id, no, verdict, points, max_points) values
  ('81000000-0000-4000-8261-000000000001', '1', 'correct', 1, 1),
  ('81000000-0000-4000-8261-000000000001', '2', 'correct', 1, 1),
  ('81000000-0000-4000-8261-000000000001', '3', 'correct', 1, 1),
  ('81000000-0000-4000-8261-000000000001', '4', 'correct', 1, 1),
  ('81000000-0000-4000-8261-000000000001', '5', 'correct', 1, 1),
  ('81000000-0000-4000-8261-000000000001', '6', 'correct', 2, 2),
  ('81000000-0000-4000-8261-000000000001', '7', 'correct', 3, 3),
  ('81000000-0000-4000-8261-000000000001', '8', 'unsolved', null, 2);
insert into public.topic_homework_review_tasks (attempt_id, no, verdict) values
  ('81000000-0000-4000-8261-000000000002', '1', 'correct'),
  ('81000000-0000-4000-8261-000000000002', '2', 'wrong');
-- Одноклассники: проверочная 5,4,4,3,5,4 (с A — 7 оценок, средняя 29/7 ≈ 4,14); контрольная — трое 3,4,5,
-- у четвёртого работа возвращена (оценки нет — в среднюю не идёт).
insert into public.topic_homework_attempts (id, homework_id, student_id, attempt_number, status, submitted_at)
select ('81000000-0000-4000-8261-1' || lpad(i::text, 11, '0'))::uuid, '71000000-0000-4000-8261-000000000001',
       ('10000000-0000-4000-8261-' || lpad(i::text, 12, '0'))::uuid, 1, 'accepted', now() - interval '5 days' + interval '30 minutes'
  from generate_series(1, 6) i;
insert into public.topic_homework_reviews (attempt_id, decision, score, created_at)
select ('81000000-0000-4000-8261-1' || lpad(i::text, 11, '0'))::uuid, 'accepted', (array[5, 4, 4, 3, 5, 4])[i], now() - interval '4 days'
  from generate_series(1, 6) i;
insert into public.topic_homework_attempts (id, homework_id, student_id, attempt_number, status, submitted_at)
select ('81000000-0000-4000-8261-2' || lpad(i::text, 11, '0'))::uuid, '71000000-0000-4000-8261-000000000002',
       ('10000000-0000-4000-8261-' || lpad(i::text, 12, '0'))::uuid, 1, case when i = 4 then 'returned_for_revision' else 'accepted' end::public.topic_homework_attempt_status,
       now() - interval '12 days' + interval '30 minutes'
  from generate_series(1, 4) i;
insert into public.topic_homework_reviews (attempt_id, decision, score, created_at)
select ('81000000-0000-4000-8261-2' || lpad(i::text, 11, '0'))::uuid,
       case when i = 4 then 'returned_for_revision' else 'accepted' end::public.topic_homework_review_decision,
       case when i = 4 then null else (array[3, 4, 5])[i] end, now() - interval '11 days'
  from generate_series(1, 4) i;

-- ── ДЗ уроков физики со сроками (правило «вовремя» §259 — первая сдача по Москве против срока) ──
insert into public.topics (id, module_id, title, is_open, kind) values
  ('61000000-0000-4000-8261-000000000011', '50000000-0000-4000-8000-000000000002', 'Динамика. Законы Ньютона', true, 'lesson'),
  ('61000000-0000-4000-8261-000000000012', '50000000-0000-4000-8000-000000000002', 'Силы в природе', true, 'lesson'),
  ('61000000-0000-4000-8261-000000000013', '50000000-0000-4000-8000-000000000002', 'Кинематика. Теория', true, 'lesson'),
  ('61000000-0000-4000-8261-000000000014', '50000000-0000-4000-8000-000000000002', 'Импульс (впереди)', true, 'lesson'),
  ('61000000-0000-4000-8261-000000000015', '50000000-0000-4000-8000-000000000002', 'Закрытая тема', false, 'lesson'),
  ('61000000-0000-4000-8261-000000000016', '50000000-0000-4000-8000-000000000002', 'Черновик ДЗ', true, 'lesson');
insert into public.topic_homework (id, topic_id, title, due_at, grade_scale, is_published) values
  ('71000000-0000-4000-8261-000000000011', '61000000-0000-4000-8261-000000000011', 'ДЗ', (now() - interval '6 days')::date, 'five', true),
  ('71000000-0000-4000-8261-000000000012', '61000000-0000-4000-8261-000000000012', 'ДЗ', (now() - interval '3 days')::date, 'five', true),
  ('71000000-0000-4000-8261-000000000013', '61000000-0000-4000-8261-000000000013', 'ДЗ', (now() - interval '2 days')::date, 'five', true),
  ('71000000-0000-4000-8261-000000000014', '61000000-0000-4000-8261-000000000014', 'ДЗ', (now() + interval '4 days')::date, 'five', true),
  ('71000000-0000-4000-8261-000000000015', '61000000-0000-4000-8261-000000000015', 'ДЗ', (now() - interval '1 days')::date, 'five', true),
  ('71000000-0000-4000-8261-000000000016', '61000000-0000-4000-8261-000000000016', 'ДЗ', (now() - interval '1 days')::date, 'five', false);
-- вовремя (за день до срока) → 5; с опозданием (2 дня после срока) → 4. «Кинематика. Теория» — не сдано.
insert into public.topic_homework_attempts (id, homework_id, student_id, attempt_number, status, submitted_at) values
  ('81000000-0000-4000-8261-000000000011', '71000000-0000-4000-8261-000000000011', '10000000-0000-4000-8000-0000000000a1', 1, 'accepted', now() - interval '7 days'),
  ('81000000-0000-4000-8261-000000000012', '71000000-0000-4000-8261-000000000012', '10000000-0000-4000-8000-0000000000a1', 1, 'accepted', now() - interval '1 days');
insert into public.topic_homework_reviews (attempt_id, decision, score, created_at) values
  ('81000000-0000-4000-8261-000000000011', 'accepted', 5, now() - interval '6 days'),
  ('81000000-0000-4000-8261-000000000012', 'accepted', 4, now() - interval '12 hours');

-- Цель ученика A по физике (§255) и «что делать» на последний месяц (§217).
insert into public.student_exam_goals (profile_id, subject, goal) values ('00000000-0000-4000-8000-0000000000a1', 'physics', 75);
insert into public.student_report_next_steps (student_id, period_from, period_to, steps, updated_by) values
  ('10000000-0000-4000-8000-0000000000a1', (now() - interval '30 days')::date, now()::date,
   array['№4 и №10 — по 10 задач каталога', 'ДЗ «Кинематика. Теория» — сдать до воскресенья'], '00000000-0000-4000-8000-0000000000c1');
-- Видео и материалы за период (отчёт, прежние поля).
insert into public.topic_material_items (id, topic_id, kind) values ('62000000-0000-4000-8261-000000000001', '61000000-0000-4000-8261-000000000011', 'video');
insert into public.video_watch_daily (student_id, item_id, day, seconds) values
  ('00000000-0000-4000-8000-0000000000a1', '62000000-0000-4000-8261-000000000001', (now() - interval '3 days')::date, 1800);
insert into public.material_views (profile_id, item_id, topic_id, viewed_on) values
  ('00000000-0000-4000-8000-0000000000a1', '62000000-0000-4000-8261-000000000001', '61000000-0000-4000-8261-000000000011', (now() - interval '3 days')::date);

-- ── Ученик C без данных: курс учителя T без тем и работ ──
insert into public.profiles (id, full_name, role) values ('00000000-0000-4000-8261-0000000000c0', 'Ученик Пустой', 'student');
insert into public.students (id, profile_id) values ('10000000-0000-4000-8261-0000000000c0', '00000000-0000-4000-8261-0000000000c0');
insert into public.courses (id, title, subject, exam_type) values ('30000000-0000-4000-8261-000000000001', 'Физика ЕГЭ 10В', 'physics', 'ege');
insert into public.groups (id, name, course_id, teacher_id) values
  ('40000000-0000-4000-8261-000000000001', '10В', '30000000-0000-4000-8261-000000000001', '20000000-0000-4000-8000-0000000000c1');
insert into public.group_students (group_id, student_id) values ('40000000-0000-4000-8261-000000000001', '10000000-0000-4000-8261-0000000000c0');

-- ── Нагрузка: класс тяжёлого H (группа М11А) — 24 одноклассника, 8 проверочных с таблицей баллов у всех ──
insert into public.profiles (id, full_name, role)
select ('00000000-0000-4000-8262-' || lpad(i::text, 12, '0'))::uuid, 'Класс Х ' || i, 'student' from generate_series(1, 24) i;
insert into public.students (id, profile_id)
select ('10000000-0000-4000-8262-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-4000-8262-' || lpad(i::text, 12, '0'))::uuid
  from generate_series(1, 24) i;
insert into public.group_students (group_id, student_id)
select '40000000-0000-4000-8000-000000000001', ('10000000-0000-4000-8262-' || lpad(i::text, 12, '0'))::uuid from generate_series(1, 24) i;
insert into public.topics (id, module_id, title, is_open, kind)
select ('61000000-0000-4000-8262-' || lpad(k::text, 12, '0'))::uuid, '50000000-0000-4000-8000-000000000001', 'Проверочная Х ' || k, false, 'check'
  from generate_series(1, 8) k;
insert into public.topic_homework (id, topic_id, title, grade_scale, is_published, opens_at, closes_at)
select ('71000000-0000-4000-8262-' || lpad(k::text, 12, '0'))::uuid, ('61000000-0000-4000-8262-' || lpad(k::text, 12, '0'))::uuid,
       'Проверочная', 'five', true, now() - k * 7 * interval '1 day', now() - k * 7 * interval '1 day' + interval '45 minutes'
  from generate_series(1, 8) k;
-- попытки: H (…f1) и 24 одноклассника; у каждого первая возвращена, вторая принята
insert into public.topic_homework_attempts (id, homework_id, student_id, attempt_number, status, submitted_at)
select gen_random_uuid(), ('71000000-0000-4000-8262-' || lpad(k::text, 12, '0'))::uuid, s.id, n,
       case when n = 1 then 'returned_for_revision' else 'accepted' end::public.topic_homework_attempt_status,
       now() - k * 7 * interval '1 day' + n * interval '10 minutes'
  from generate_series(1, 8) k,
       (select id from public.students where id::text like '10000000-0000-4000-8262-%' or id = '10000000-0000-4000-8000-0000000000f1') s,
       generate_series(1, 2) n;
insert into public.topic_homework_reviews (attempt_id, decision, score, created_at)
select a.id, case when a.attempt_number = 1 then 'returned_for_revision' else 'accepted' end::public.topic_homework_review_decision,
       case when a.attempt_number = 1 then null else 3 + (abs(hashtext(a.id::text)) % 3) end, a.submitted_at + interval '1 day'
  from public.topic_homework_attempts a
 where a.homework_id::text like '71000000-0000-4000-8262-%';
insert into public.topic_homework_review_tasks (attempt_id, no, verdict, points, max_points)
select a.id, j::text, case when (j + a.attempt_number) % 4 = 0 then 'wrong' else 'correct' end,
       case when (j + a.attempt_number) % 4 = 0 then 0 else 1 end, 1
  from public.topic_homework_attempts a, generate_series(1, 12) j
 where a.homework_id::text like '71000000-0000-4000-8262-%';

analyze;
