-- §242. Выдуманные данные для проб (не прод). «Сегодня» — день по Москве (D0), Dk — k дней назад.
--   O  …a0 — владелец курсов (teacher, НЕ админ);  A …a1 — преподаватель 10А
--   B  …a2 — преподаватель 11А;                    X …a3 — посторонний (свой курс)
--   S1…S4 (…b1–b4) — ученики 10А;                   S7 …b7 — ученик 11А
-- Курс 10А (c0001), модуль «Механика»:
--   T1 «Кинематика» (открыта): F1 файл-теория, F2 файл-решение (гейт), F6 файл скрыт, V1 видео, TX текст;
--      ДЗ пятибалльное, срок D3.
--   T2 «Динамика» (открыта): F3 файл, TR1 файл тренировки (подтема видна), TR2 файл тренировки
--      (подтема скрыта), V2, V3 видео; ДЗ стобалльное, срок через 5 дней.
--   T3 «Закрыта» (is_open = false): F4 файл; ДЗ опубликовано.
--   T4 «Контрольная» (control, окно завтра): F5 «Условие» (worksheet_homework); S1 уже сдал
--      (условие ему видно по правилу topic_homework_condition_open — есть сдача).
-- Попытки ДЗ (created_at = день сдачи/начала):
--   T1: S1 сдал D2, принято 5; S2 сдал D10 — вернули, пересдал D1 — ждёт; S3 черновик D4; S4 — нет.
--   T2: S1 сдал D20, принято 80; S2 сдал D5, принято 60.
--   T4: S1 сдал D0 (работа по времени — в ДЗ-статистику не идёт, в «занимался» — идёт).
-- Просмотры файлов: S1 — F1 D0, F1 D1, F2 D1, F3 D8, TR1 D2; S2 — F1 D3, F3 D40; S3 — F1 D9;
--   преподаватель A — F1 D0 (не ученик, не считается).
-- Видео: S1 — V1 D1 600 с, дошёл 580/600 (досмотрел), V2 D2 300 с, 950/1000 (досмотрел);
--   S2 — V1 D3 120 с, 100/600 (начал); S3 — V1 D12 400 с, 590/600 (досмотрел).
-- Пробники 10А: M1 D10 (S1 60), M2 D3 (S1 70, S2 65) — последний с итогом; M3 D1 — итогов нет; M4 завтра.
create or replace function pg_temp.d(k int) returns date language sql as $$
  select (now() at time zone 'Europe/Moscow')::date - k $$;
create or replace function pg_temp.ts(k int) returns timestamptz language sql as $$
  select ((now() at time zone 'Europe/Moscow')::date - k + time '12:00') at time zone 'Europe/Moscow' $$;

insert into profiles (id, full_name, role) values
  ('00000000-0000-4000-8000-0000000000a0', 'Владелец', 'teacher'),
  ('00000000-0000-4000-8000-0000000000a1', 'Преподаватель 10А', 'teacher'),
  ('00000000-0000-4000-8000-0000000000a2', 'Преподаватель 11А', 'teacher'),
  ('00000000-0000-4000-8000-0000000000a3', 'Посторонний', 'teacher'),
  ('00000000-0000-4000-8000-0000000000b1', 'Ученик 1', 'student'),
  ('00000000-0000-4000-8000-0000000000b2', 'Ученик 2', 'student'),
  ('00000000-0000-4000-8000-0000000000b3', 'Ученик 3', 'student'),
  ('00000000-0000-4000-8000-0000000000b4', 'Ученик 4', 'student'),
  ('00000000-0000-4000-8000-0000000000b7', 'Ученик 7', 'student');
insert into teachers (id, profile_id) values
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000001a2', '00000000-0000-4000-8000-0000000000a2'),
  ('00000000-0000-4000-8000-0000000001a3', '00000000-0000-4000-8000-0000000000a3');
insert into students (id, profile_id)
select ('00000000-0000-4000-8000-0000000001b' || n)::uuid, ('00000000-0000-4000-8000-0000000000b' || n)::uuid
  from unnest(array[1, 2, 3, 4, 7]) n;

insert into courses (id, title, owner_id, is_template, subject, exam_type) values
  ('00000000-0000-4000-8000-0000000c0000', 'Физика ЕГЭ (каркас)', '00000000-0000-4000-8000-0000000000a0', true,  'physics', 'ege'),
  ('00000000-0000-4000-8000-0000000c0001', 'Физика ЕГЭ 10А',      '00000000-0000-4000-8000-0000000000a0', false, 'physics', 'ege'),
  ('00000000-0000-4000-8000-0000000c0002', 'Физика ЕГЭ 11А',      '00000000-0000-4000-8000-0000000000a0', false, 'physics', 'ege'),
  ('00000000-0000-4000-8000-0000000c000f', 'Чужой курс',          '00000000-0000-4000-8000-0000000000a3', false, 'math', 'ege');
insert into groups (id, name, course_id, teacher_id) values
  ('00000000-0000-4000-8000-0000000f0001', '10А', '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000001a1'),
  ('00000000-0000-4000-8000-0000000f0002', '11А', '00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-0000000001a2'),
  ('00000000-0000-4000-8000-0000000f000f', 'Чужая', '00000000-0000-4000-8000-0000000c000f', '00000000-0000-4000-8000-0000000001a3');
insert into group_students (group_id, student_id)
select '00000000-0000-4000-8000-0000000f0001', ('00000000-0000-4000-8000-0000000001b' || n)::uuid from generate_series(1, 4) n;
insert into group_students (group_id, student_id) values
  ('00000000-0000-4000-8000-0000000f0002', '00000000-0000-4000-8000-0000000001b7');

insert into modules (id, course_id, title, order_index) values
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-0000000c0001', 'Механика', 1);
insert into topics (id, module_id, title, order_index, is_open) values
  ('00000000-0000-4000-8000-0000007a0001', '00000000-0000-4000-8000-0000000e0001', 'T1 Кинематика', 1, true),
  ('00000000-0000-4000-8000-0000007a0002', '00000000-0000-4000-8000-0000000e0001', 'T2 Динамика', 2, true),
  ('00000000-0000-4000-8000-0000007a0003', '00000000-0000-4000-8000-0000000e0001', 'T3 Закрыта', 3, false),
  ('00000000-0000-4000-8000-0000007a0004', '00000000-0000-4000-8000-0000000e0001', 'T4 Контрольная', 4, true);

insert into topic_material_items (id, topic_id, kind, title, section, is_visible, track, subtopic_code, storage_path, created_by) values
  ('00000000-0000-4000-8000-0000000f1001', '00000000-0000-4000-8000-0000007a0001', 'file',  'F1', 'theory',             true,  'ege', null, 'x/f1.pdf', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000f1002', '00000000-0000-4000-8000-0000007a0001', 'file',  'F2', 'solution',           true,  'ege', null, 'x/f2.pdf', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000f1006', '00000000-0000-4000-8000-0000007a0001', 'file',  'F6', 'theory',             false, 'ege', null, 'x/f6.pdf', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000f1101', '00000000-0000-4000-8000-0000007a0001', 'video', 'V1', 'theory',             true,  'ege', null, null,       '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000f1102', '00000000-0000-4000-8000-0000007a0001', 'text',  'TX', 'notes',              true,  'ege', null, null,       '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000f1003', '00000000-0000-4000-8000-0000007a0002', 'file',  'F3', 'tasks',              true,  'ege', null, 'x/f3.pdf', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000f1201', '00000000-0000-4000-8000-0000007a0002', 'file',  'TR1', 'tasks',             true,  'training', 'a', 'x/tr1.pdf', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000f1202', '00000000-0000-4000-8000-0000007a0002', 'file',  'TR2', 'tasks',             true,  'training', 'b', 'x/tr2.pdf', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000f1103', '00000000-0000-4000-8000-0000007a0002', 'video', 'V2', 'theory',             true,  'ege', null, null,       '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000f1104', '00000000-0000-4000-8000-0000007a0002', 'video', 'V3', 'theory',             true,  'ege', null, null,       '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000f1004', '00000000-0000-4000-8000-0000007a0003', 'file',  'F4', 'theory',             true,  'ege', null, 'x/f4.pdf', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000f1005', '00000000-0000-4000-8000-0000007a0004', 'file',  'F5', 'worksheet_homework', true,  'ege', null, 'x/f5.pdf', '00000000-0000-4000-8000-0000000000a1');
insert into topic_subtopic_hidden (topic_id, subtopic_code) values ('00000000-0000-4000-8000-0000007a0002', 'b');

insert into topic_homework (id, topic_id, title, is_published, created_by, grade_scale, due_at)
select ('00000000-0000-4000-8000-0000000d000' || n)::uuid, ('00000000-0000-4000-8000-0000007a000' || n)::uuid,
       'ДЗ ' || n, true, '00000000-0000-4000-8000-0000000000a1',
       case when n = 2 then 'hundred' else 'five' end,
       case n when 1 then pg_temp.d(3) when 2 then pg_temp.d(-5) else null end
  from generate_series(1, 4) n;

-- Попытки (темы пока «уроки»: окна и тип ставятся ниже, как в §241).
-- id: …c0<тема>00<ученик><номер попытки>
create or replace function pg_temp.att(h int, s int, k int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-00000c0' || h || '00' || s || k)::uuid $$;
insert into topic_homework_attempts (id, homework_id, student_id, attempt_number, created_at)
select pg_temp.att(v.h, v.s, 1), ('00000000-0000-4000-8000-0000000d000' || v.h)::uuid,
       ('00000000-0000-4000-8000-0000000001b' || v.s)::uuid, 1, pg_temp.ts(v.k)
  from (values (1, 1, 2), (1, 2, 10), (1, 3, 4), (2, 1, 20), (2, 2, 5), (4, 1, 0)) v(h, s, k);
update topic_homework_attempts a set status = 'submitted', submitted_at = a.created_at
 where a.id <> pg_temp.att(1, 3, 1);
-- Вердикты: T1 S1 — 5; T1 S2 первая — вернули; T2 S1 — 80, S2 — 60.
insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score, created_at)
select pg_temp.att(v.h, v.s, 1), '00000000-0000-4000-8000-0000000000a1', v.dec::topic_homework_review_decision,
       case when v.dec = 'returned_for_revision' then 'Доделай' end, v.score, pg_temp.ts(0)
  from (values (1, 1, 'accepted', 5), (1, 2, 'returned_for_revision', null), (2, 1, 'accepted', 80), (2, 2, 'accepted', 60)) v(h, s, dec, score);
update topic_homework_attempts a set status = r.decision::text::topic_homework_attempt_status
  from topic_homework_reviews r where r.attempt_id = a.id;
-- S2 пересдал T1: вторая попытка D1, ждёт проверки.
insert into topic_homework_attempts (id, homework_id, student_id, attempt_number, created_at)
values (pg_temp.att(1, 2, 2), '00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-0000000001b2', 2, pg_temp.ts(1));
update topic_homework_attempts set status = 'submitted', submitted_at = created_at where id = pg_temp.att(1, 2, 2);

-- T4 — контрольная с окном завтра (S1 уже сдал раньше — как будто по личному окну).
update topics set kind = 'control' where id = '00000000-0000-4000-8000-0000007a0004';
update topic_homework set opens_at = now() + interval '1 day', closes_at = now() + interval '1 day 45 minutes'
 where id = '00000000-0000-4000-8000-0000000d0004';

insert into material_views (profile_id, item_id, topic_id, viewed_on)
select ('00000000-0000-4000-8000-0000000000' || v.p)::uuid, ('00000000-0000-4000-8000-0000000f1' || v.i)::uuid,
       i.topic_id, pg_temp.d(v.k)
  from (values ('b1', '001', 0), ('b1', '001', 1), ('b1', '002', 1), ('b1', '003', 8), ('b1', '201', 2),
               ('b2', '001', 3), ('b2', '003', 40), ('b3', '001', 9), ('a1', '001', 0)) v(p, i, k)
  join topic_material_items i on i.id = ('00000000-0000-4000-8000-0000000f1' || v.i)::uuid;

insert into video_watch_daily (student_id, item_id, day, seconds, max_position, duration_seconds)
select ('00000000-0000-4000-8000-0000000000' || v.p)::uuid, ('00000000-0000-4000-8000-0000000f1' || v.i)::uuid,
       pg_temp.d(v.k), v.sec, v.pos, v.dur
  from (values ('b1', '101', 1, 600, 580, 600), ('b1', '103', 2, 300, 950, 1000),
               ('b2', '101', 3, 120, 100, 600), ('b3', '101', 12, 400, 590, 600)) v(p, i, k, sec, pos, dur);

-- Пробники 10А.
insert into mock_exams (id, title, subject, exam_type, group_id, date, max_score, starts_at) values
  ('00000000-0000-4000-8000-0000000a7e01', 'Пробник №1', 'physics', 'ege', '00000000-0000-4000-8000-0000000f0001', pg_temp.ts(10), 100, pg_temp.ts(10)),
  ('00000000-0000-4000-8000-0000000a7e02', 'Пробник №2', 'physics', 'ege', '00000000-0000-4000-8000-0000000f0001', pg_temp.ts(3),  100, pg_temp.ts(3)),
  ('00000000-0000-4000-8000-0000000a7e03', 'Пробник №3', 'physics', 'ege', '00000000-0000-4000-8000-0000000f0001', pg_temp.ts(1),  100, pg_temp.ts(1)),
  ('00000000-0000-4000-8000-0000000a7e04', 'Пробник №4', 'physics', 'ege', '00000000-0000-4000-8000-0000000f0001', pg_temp.ts(-1), 100, pg_temp.ts(-1));
insert into mock_exam_results (mock_exam_id, student_id, score) values
  ('00000000-0000-4000-8000-0000000a7e01', '00000000-0000-4000-8000-0000000001b1', 60),
  ('00000000-0000-4000-8000-0000000a7e02', '00000000-0000-4000-8000-0000000001b1', 70),
  ('00000000-0000-4000-8000-0000000a7e02', '00000000-0000-4000-8000-0000000001b2', 65),
  ('00000000-0000-4000-8000-0000000a7e03', '00000000-0000-4000-8000-0000000001b1', null);
