-- §264. Выдуманные данные — ПОВЕРХ данных §255/§256/§257/§261 (грузятся первыми; учителя T …c1, O …d1, админ M …e1).
--
-- ── Напоминания: фиксированный день D = понедельник 05.10.2026 (МСК = UTC+3). Пробы зовут
--    student_reminder_candidates с p_now в этот день, поэтому данные — в абсолютных датах.
--    Курс R «Физика ЕГЭ 10А» (группа 10А, учитель T), курс R2 «Математика ЕГЭ 10А» (в нём «Срок ДЗ завтра» выключен
--    учителем — 15_data_after_264). Ученики (профили …8264-00000000000N, ученики 10000000-…8264-00000000000N):
--      1 Рустам  — Telegram есть; R и R2; ничего не сдал; серия 3 дня (решал D-3…D-1), сегодня не решал;
--                  в контрольной «Кинематика» — черновик БЕЗ фото.
--      2 Дина    — Telegram есть; R; сдала ДЗ «Динамика» (срок завтра) и «Силы» (срок вчера); в контрольной — черновик с фото.
--      3 Ильдар  — Telegram НЕ подключён; R.
--      4 Лейла   — Telegram есть; R; «Срок ДЗ завтра» выключила у себя (15_data_after_264).
--      5 Марат   — подключение Telegram выключено (is_enabled = false); R.
--      6 Алсу    — подключение есть, но общий выключатель notification_prefs.telegram = false; R.
--      7 Тимур   — Telegram есть; R; у проверочной «Движение по окружности» — личное окно D+1 12:00–12:45 (§240).
--      8 Зарина  — Telegram есть; только R2 (там «Срок ДЗ завтра» выключен в курсе).
--      9 Камиль  — Telegram есть; R; серия 5 дней, сегодня уже решал; контрольную сдал.
insert into public.profiles (id, full_name, role)
select ('00000000-0000-4000-8264-' || lpad(i::text, 12, '0'))::uuid,
       (array['Рустам Г.', 'Дина Ш.', 'Ильдар М.', 'Лейла А.', 'Марат Х.', 'Алсу Н.', 'Тимур С.', 'Зарина К.', 'Камиль Ю.'])[i], 'student'
  from generate_series(1, 9) i;
insert into public.students (id, profile_id)
select ('10000000-0000-4000-8264-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-4000-8264-' || lpad(i::text, 12, '0'))::uuid
  from generate_series(1, 9) i;
insert into public.courses (id, title, subject, exam_type) values
  ('30000000-0000-4000-8264-000000000001', 'Физика ЕГЭ 10А', 'physics', 'ege'),
  ('30000000-0000-4000-8264-000000000002', 'Математика ЕГЭ 10А', 'math', 'ege');
insert into public.groups (id, name, course_id, teacher_id) values
  ('40000000-0000-4000-8264-000000000001', '10А физика', '30000000-0000-4000-8264-000000000001', '20000000-0000-4000-8000-0000000000c1'),
  ('40000000-0000-4000-8264-000000000002', '10А математика', '30000000-0000-4000-8264-000000000002', '20000000-0000-4000-8000-0000000000c1');
insert into public.group_students (group_id, student_id)
select '40000000-0000-4000-8264-000000000001', ('10000000-0000-4000-8264-' || lpad(i::text, 12, '0'))::uuid
  from generate_series(1, 9) i where i <> 8;
insert into public.group_students (group_id, student_id) values
  ('40000000-0000-4000-8264-000000000002', '10000000-0000-4000-8264-000000000001'),
  ('40000000-0000-4000-8264-000000000002', '10000000-0000-4000-8264-000000000008');
insert into public.modules (id, course_id, title) values
  ('50000000-0000-4000-8264-000000000001', '30000000-0000-4000-8264-000000000001', 'Механика'),
  ('50000000-0000-4000-8264-000000000002', '30000000-0000-4000-8264-000000000002', 'Алгебра');

-- Telegram: подключение у 1,2,4,5(выключено),6,7,8,9; у 3 — нет. Общий выключатель — у всех, кроме 6.
insert into public.telegram_connections (profile_id, telegram_chat_id, is_enabled)
select ('00000000-0000-4000-8264-' || lpad(i::text, 12, '0'))::uuid, 264000 + i, i <> 5
  from generate_series(1, 9) i where i <> 3;
insert into public.notification_prefs (user_id, telegram)
select ('00000000-0000-4000-8264-' || lpad(i::text, 12, '0'))::uuid, i <> 6 from generate_series(1, 9) i;

-- ДЗ уроков: срок завтра (D+1), вчера (D-1); закрытая тема и неопубликованное ДЗ со сроком завтра — не в счёт.
insert into public.topics (id, module_id, title, is_open, kind) values
  ('61000000-0000-4000-8264-000000000001', '50000000-0000-4000-8264-000000000001', 'Динамика. Законы Ньютона', true, 'lesson'),
  ('61000000-0000-4000-8264-000000000002', '50000000-0000-4000-8264-000000000001', 'Силы в природе', true, 'lesson'),
  ('61000000-0000-4000-8264-000000000003', '50000000-0000-4000-8264-000000000001', 'Закрытая тема', false, 'lesson'),
  ('61000000-0000-4000-8264-000000000004', '50000000-0000-4000-8264-000000000001', 'Неопубликованное ДЗ', true, 'lesson'),
  ('61000000-0000-4000-8264-000000000005', '50000000-0000-4000-8264-000000000002', 'Логарифмы', true, 'lesson'),
  ('61000000-0000-4000-8264-000000000011', '50000000-0000-4000-8264-000000000001', 'Движение по окружности', false, 'check'),
  ('61000000-0000-4000-8264-000000000012', '50000000-0000-4000-8264-000000000001', 'Кинематика', false, 'control');
insert into public.topic_homework (id, topic_id, title, due_at, grade_scale, is_published, opens_at, closes_at) values
  ('71000000-0000-4000-8264-000000000001', '61000000-0000-4000-8264-000000000001', 'ДЗ', '2026-10-06', 'five', true, null, null),
  ('71000000-0000-4000-8264-000000000002', '61000000-0000-4000-8264-000000000002', 'ДЗ', '2026-10-04', 'five', true, null, null),
  ('71000000-0000-4000-8264-000000000003', '61000000-0000-4000-8264-000000000003', 'ДЗ', '2026-10-06', 'five', true, null, null),
  ('71000000-0000-4000-8264-000000000004', '61000000-0000-4000-8264-000000000004', 'ДЗ', '2026-10-06', 'five', false, null, null),
  ('71000000-0000-4000-8264-000000000005', '61000000-0000-4000-8264-000000000005', 'ДЗ', '2026-10-06', 'five', true, null, null),
  -- проверочная завтра 08:45–09:30 МСК; контрольная сегодня 14:15–15:00 МСК
  ('71000000-0000-4000-8264-000000000011', '61000000-0000-4000-8264-000000000011', 'Проверочная', null, 'five', true,
   '2026-10-06 08:45+03', '2026-10-06 09:30+03'),
  ('71000000-0000-4000-8264-000000000012', '61000000-0000-4000-8264-000000000012', 'Контрольная', null, 'five', true,
   '2026-10-05 14:15+03', '2026-10-05 15:00+03');
insert into public.topic_homework_personal_windows (homework_id, student_id, opens_at, closes_at) values
  ('71000000-0000-4000-8264-000000000011', '10000000-0000-4000-8264-000000000007', '2026-10-06 12:00+03', '2026-10-06 12:45+03');

insert into public.topic_homework_attempts (id, homework_id, student_id, attempt_number, status, submitted_at) values
  -- Дина сдала оба ДЗ (первая сдача — правило §259)
  ('81000000-0000-4000-8264-000000000001', '71000000-0000-4000-8264-000000000001', '10000000-0000-4000-8264-000000000002', 1, 'submitted', '2026-10-04 10:00+03'),
  ('81000000-0000-4000-8264-000000000002', '71000000-0000-4000-8264-000000000002', '10000000-0000-4000-8264-000000000002', 1, 'returned_for_revision', '2026-10-03 18:00+03'),
  ('81000000-0000-4000-8264-000000000003', '71000000-0000-4000-8264-000000000002', '10000000-0000-4000-8264-000000000002', 2, 'draft', null),
  -- контрольная: Рустам — черновик без фото; Дина — черновик с фото; Камиль — сдал
  ('81000000-0000-4000-8264-000000000011', '71000000-0000-4000-8264-000000000012', '10000000-0000-4000-8264-000000000001', 1, 'draft', null),
  ('81000000-0000-4000-8264-000000000012', '71000000-0000-4000-8264-000000000012', '10000000-0000-4000-8264-000000000002', 1, 'draft', null),
  ('81000000-0000-4000-8264-000000000013', '71000000-0000-4000-8264-000000000012', '10000000-0000-4000-8264-000000000009', 1, 'submitted', '2026-10-05 14:40+03');
insert into public.topic_homework_attempt_files (attempt_id, storage_path, file_name) values
  ('81000000-0000-4000-8264-000000000012', '81000000-0000-4000-8264-000000000012/1.jpg', '1.jpg');

-- Пробник группы R завтра в 10:00 МСК (235 минут).
insert into public.mock_exams (id, title, date, starts_at, duration_minutes, subject, exam_type, group_id) values
  ('94100000-0000-4000-8264-000000000001', 'Пробник №2', '2026-10-06 10:00+03', '2026-10-06 10:00+03', 235, 'physics', 'ege',
   '40000000-0000-4000-8264-000000000001');

-- Серия: Рустам решал D-3, D-2, D-1 (верные задачи каталога); Камиль — D-4…D (сегодня уже решал).
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, created_at)
select '00000000-0000-4000-8264-000000000001', ('a5810000-0000-4000-0001-' || lpad(d::text, 12, '0'))::uuid, '1', 'correct',
       ('2026-10-05 16:00+03'::timestamptz - d * interval '1 day')
  from generate_series(1, 3) d;
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, created_at)
select '00000000-0000-4000-8264-000000000009', ('a5810000-0000-4000-0002-' || lpad((d + 1)::text, 12, '0'))::uuid, '1', 'correct',
       ('2026-10-05 09:00+03'::timestamptz - d * interval '1 day')
  from generate_series(0, 4) d;

-- ── Сводка: нагрузка на классе М11А (курс 30…01: A, тяжёлый H и 24 одноклассника из §261 — 26 учеников) ──
-- Каждому из 24: 150 проверок каталога за 90 дней (номера 1–12), 20 ДЗ уроков со сроками (сдано 15, из них 3 —
-- после срока), заход на сайт.
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, created_at)
select ('00000000-0000-4000-8262-' || lpad(s::text, 12, '0'))::uuid,
       ('a5810000-0000-4000-' || lpad(((s + i) % 12 + 1)::text, 4, '0') || '-' || lpad(((s * 7 + i) % 50 + 1)::text, 12, '0'))::uuid,
       '1', case when (s + i) % 3 = 0 then 'wrong' else 'correct' end,
       now() - ((s * 13 + i * 7) % 90) * interval '1 day' - s * interval '1 minute'
  from generate_series(1, 24) s, generate_series(1, 150) i;
insert into public.topics (id, module_id, title, is_open, kind, ege_task_numbers)
select ('61000000-0000-4000-8265-' || lpad(k::text, 12, '0'))::uuid, '50000000-0000-4000-8000-000000000001', 'Урок класса ' || k, true, 'lesson',
       array[(k % 12) + 1]::smallint[]
  from generate_series(1, 20) k;
insert into public.topic_homework (id, topic_id, title, due_at, grade_scale, is_published)
select ('71000000-0000-4000-8265-' || lpad(k::text, 12, '0'))::uuid, ('61000000-0000-4000-8265-' || lpad(k::text, 12, '0'))::uuid,
       'ДЗ', (now() - k * 4 * interval '1 day')::date, 'five', true
  from generate_series(1, 20) k;
insert into public.topic_homework_attempts (id, homework_id, student_id, attempt_number, status, submitted_at)
select gen_random_uuid(), ('71000000-0000-4000-8265-' || lpad(k::text, 12, '0'))::uuid,
       ('10000000-0000-4000-8262-' || lpad(s::text, 12, '0'))::uuid, 1, 'accepted',
       now() - k * 4 * interval '1 day' + case when k % 5 = 0 then interval '2 days' else - interval '1 day' end
  from generate_series(1, 24) s, generate_series(1, 20) k
 where (s + k) % 4 <> 0;
insert into public.topic_homework_reviews (attempt_id, decision, score, created_at)
select a.id, 'accepted', 3 + (abs(hashtext(a.id::text)) % 3), a.submitted_at + interval '1 day'
  from public.topic_homework_attempts a where a.homework_id::text like '71000000-0000-4000-8265-%';
insert into public.app_visits (profile_id, visited_on)
select ('00000000-0000-4000-8262-' || lpad(s::text, 12, '0'))::uuid, (now() - (s % 9) * interval '1 day')::date
  from generate_series(1, 24) s;

analyze;
