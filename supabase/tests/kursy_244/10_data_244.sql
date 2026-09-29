-- §244. Выдуманные данные для проб teacher_courses_overview (не прод).
-- D0 — «сегодня» по Москве, Dk — k дней назад (для сдач); для дат тем — current_date ± k,
-- как сравнивает сама topic_open_now.
--
-- Люди:  O …a0 — владелец курсов (teacher, НЕ админ);   B …a2 — преподаватель группы 11А физики;
--        X …a3 — посторонний преподаватель (свой курс); K …a4 — куратор курса 1 части 11А
--        (course_curators) И ученик той же группы (sK) — его собственная сдача в «ждут» ему не идёт;
--        AD …a5 — администратор платформы;               S1…S6 (…b1–b6) — ученики.
-- Курсы:
--   tpl1 «Математика ЕГЭ. 1 часть» — шаблон; 2 модуля, 3 темы (все открыты: даты нет).
--   tpl2 «Физика ЕГЭ» — шаблон; 1 модуль, 2 темы (одна по плану через 4 дня).
--   c1  «Математика ЕГЭ. 1 часть 11А» — копия tpl1; ученики S1, S2, S3, sK (4); 2 модуля (второй пуст);
--       темы: t1 is_open=true; t2 план D-3 (открыта); t3, t4 план +5 (закрыты); t5 план +10;
--       t6 is_open=false, план +2 (выключена руками — не «по плану»); t7 is_open=true, план +1
--       (открыли раньше — не «по плану»); t8 план сегодня (открыта).
--       ⇒ topics 8, open 4 (t1, t2, t7, t8), modules 2, next_open = +5, next_open_count = 2.
--       ДЗ: h1 на t1, h2 на t2, h3 на t7 (контрольная).
--       Попытки: S1 h1 сдал D0 — ждёт; S2 h1 №1 сдал D10 — вернули, №2 сдал D6 — ждёт;
--                S3 h1 сдал D7 — принято; S3 h2 черновик D1; S1 h2 сдал D2 — принято;
--                S2 h3 (контрольная) сдал D1 — ждёт; sK h2 сдал D0 — ждёт.
--       ⇒ для O: pending 4 (S1h1, S2h1№2, S2h3, sKh2), subs_7d 5 (D0, D6, D2, D1, D0; D7 и D10 — нет).
--       ⇒ для K: pending 3, subs_7d 4 (своя сдача sKh2 не считается).
--   c2  «Физика ЕГЭ 11А класс» — копия tpl2; ученики S1, S4 (2); 1 модуль;
--       темы: p1 план D-1 (открыта), p2 план +3, p3 is_open=false ⇒ topics 3, open 1, next +3 (1 тема).
--       Попытки по p1: S4 сдал D3 — ждёт; S1 сдал D2 — вернули ⇒ pending 1, subs_7d 2.
--   c3  «Физика ЕГЭ 10А» — копия tpl2; ученик S5; ни модулей, ни тем ⇒ всё по нулям, next null.
--   cf  «Чужой курс» (владелец X); ученик S6; S6 сдал D0 — ждёт ⇒ у X pending 1.
create or replace function pg_temp.ts(k int) returns timestamptz language sql as $$
  select ((now() at time zone 'Europe/Moscow')::date - k + time '12:00') at time zone 'Europe/Moscow' $$;
create or replace function pg_temp.id(t text) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-' || lpad(t, 12, '0'))::uuid $$;

insert into profiles (id, full_name, role) values
  (pg_temp.id('a0'), 'Владелец', 'teacher'),
  (pg_temp.id('a2'), 'Преподаватель 11А', 'teacher'),
  (pg_temp.id('a3'), 'Посторонний', 'teacher'),
  (pg_temp.id('a4'), 'Куратор-ученик', 'student'),
  (pg_temp.id('a5'), 'Администратор', 'admin'),
  (pg_temp.id('b1'), 'Ученик 1', 'student'), (pg_temp.id('b2'), 'Ученик 2', 'student'),
  (pg_temp.id('b3'), 'Ученик 3', 'student'), (pg_temp.id('b4'), 'Ученик 4', 'student'),
  (pg_temp.id('b5'), 'Ученик 5', 'student'), (pg_temp.id('b6'), 'Ученик 6', 'student');
insert into teachers (id, profile_id) values
  (pg_temp.id('1a2'), pg_temp.id('a2')), (pg_temp.id('1a3'), pg_temp.id('a3'));
insert into students (id, profile_id)
select pg_temp.id('1b' || n), pg_temp.id('b' || n) from generate_series(1, 6) n;
insert into students (id, profile_id) values (pg_temp.id('1a4'), pg_temp.id('a4'));

insert into courses (id, title, owner_id, is_template, subject, exam_type) values
  (pg_temp.id('c0a1'), 'Математика ЕГЭ. 1 часть',      pg_temp.id('a0'), true,  'math',    'ege'),
  (pg_temp.id('c0a2'), 'Физика ЕГЭ',                   pg_temp.id('a0'), true,  'physics', 'ege'),
  (pg_temp.id('c001'), 'Математика ЕГЭ. 1 часть 11А',  pg_temp.id('a0'), false, 'math',    'ege'),
  (pg_temp.id('c002'), 'Физика ЕГЭ 11А класс',         pg_temp.id('a0'), false, 'physics', 'ege'),
  (pg_temp.id('c003'), 'Физика ЕГЭ 10А',               pg_temp.id('a0'), false, 'physics', 'ege'),
  (pg_temp.id('c00f'), 'Чужой курс',                   pg_temp.id('a3'), false, 'math',    'ege');

insert into groups (id, name, course_id, teacher_id) values
  (pg_temp.id('f001'), '11А', pg_temp.id('c001'), null),
  (pg_temp.id('f002'), '11А', pg_temp.id('c002'), pg_temp.id('1a2')),
  (pg_temp.id('f003'), '10А', pg_temp.id('c003'), null),
  (pg_temp.id('f00f'), 'Чужая', pg_temp.id('c00f'), pg_temp.id('1a3'));
insert into group_students (group_id, student_id) values
  (pg_temp.id('f001'), pg_temp.id('1b1')), (pg_temp.id('f001'), pg_temp.id('1b2')),
  (pg_temp.id('f001'), pg_temp.id('1b3')), (pg_temp.id('f001'), pg_temp.id('1a4')),
  (pg_temp.id('f002'), pg_temp.id('1b1')), (pg_temp.id('f002'), pg_temp.id('1b4')),
  (pg_temp.id('f003'), pg_temp.id('1b5')),
  (pg_temp.id('f00f'), pg_temp.id('1b6'));
insert into course_curators (course_id, profile_id) values (pg_temp.id('c001'), pg_temp.id('a4'));

insert into modules (id, course_id, title, order_index) values
  (pg_temp.id('e0a1'), pg_temp.id('c0a1'), 'Алгебра', 1),
  (pg_temp.id('e0a2'), pg_temp.id('c0a1'), 'Геометрия', 2),
  (pg_temp.id('e0a3'), pg_temp.id('c0a2'), 'Механика', 1),
  (pg_temp.id('e011'), pg_temp.id('c001'), 'Алгебра', 1),
  (pg_temp.id('e012'), pg_temp.id('c001'), 'Геометрия (пусто)', 2),
  (pg_temp.id('e021'), pg_temp.id('c002'), 'Механика', 1),
  (pg_temp.id('e0f1'), pg_temp.id('c00f'), 'Чужой модуль', 1);

insert into topics (id, module_id, title, order_index, is_open, available_from) values
  (pg_temp.id('7a01'), pg_temp.id('e0a1'), 'Шаблон 1', 1, null, null),
  (pg_temp.id('7a02'), pg_temp.id('e0a1'), 'Шаблон 2', 2, null, null),
  (pg_temp.id('7a03'), pg_temp.id('e0a2'), 'Шаблон 3', 1, null, null),
  (pg_temp.id('7b01'), pg_temp.id('e0a3'), 'Физ шаблон 1', 1, null, null),
  (pg_temp.id('7b02'), pg_temp.id('e0a3'), 'Физ шаблон 2', 2, null, current_date + 4),
  (pg_temp.id('7101'), pg_temp.id('e011'), 't1', 1, true,  null),
  (pg_temp.id('7102'), pg_temp.id('e011'), 't2', 2, null,  current_date - 3),
  (pg_temp.id('7103'), pg_temp.id('e011'), 't3', 3, null,  current_date + 5),
  (pg_temp.id('7104'), pg_temp.id('e011'), 't4', 4, null,  current_date + 5),
  (pg_temp.id('7105'), pg_temp.id('e011'), 't5', 5, null,  current_date + 10),
  (pg_temp.id('7106'), pg_temp.id('e011'), 't6', 6, false, current_date + 2),
  (pg_temp.id('7107'), pg_temp.id('e011'), 't7', 7, true,  current_date + 1),
  (pg_temp.id('7108'), pg_temp.id('e011'), 't8', 8, null,  current_date),
  (pg_temp.id('7201'), pg_temp.id('e021'), 'p1', 1, null,  current_date - 1),
  (pg_temp.id('7202'), pg_temp.id('e021'), 'p2', 2, null,  current_date + 3),
  (pg_temp.id('7203'), pg_temp.id('e021'), 'p3', 3, false, null),
  (pg_temp.id('7f01'), pg_temp.id('e0f1'), 'q1', 1, true,  null);

-- Родство копий ставим ПОСЛЕ тем: иначе синхронизация шаблона (§213, template_sync_*) разнесла бы
-- темы шаблонов по копиям, и ручной подсчёт перестал бы быть ручным.
update courses set copied_from_course_id = pg_temp.id('c0a1') where id = pg_temp.id('c001');
update courses set copied_from_course_id = pg_temp.id('c0a2') where id in (pg_temp.id('c002'), pg_temp.id('c003'));

insert into topic_homework (id, topic_id, title, is_published, created_by, grade_scale) values
  (pg_temp.id('d001'), pg_temp.id('7101'), 'h1', true, pg_temp.id('a0'), 'five'),
  (pg_temp.id('d002'), pg_temp.id('7102'), 'h2', true, pg_temp.id('a0'), 'five'),
  (pg_temp.id('d003'), pg_temp.id('7107'), 'h3', true, pg_temp.id('a0'), 'five'),
  (pg_temp.id('d021'), pg_temp.id('7201'), 'hp1', true, pg_temp.id('a0'), 'five'),
  (pg_temp.id('d0f1'), pg_temp.id('7f01'), 'hq1', true, pg_temp.id('a3'), 'five');

-- Попытки: (id, ДЗ, ученик, номер, день сдачи k или null — черновик, итоговый статус)
create temp table att_src (aid text, hw text, st text, n int, k int, fin text);
insert into att_src values
  ('3001', 'd001', '1b1', 1, 0,    'submitted'),
  ('3002', 'd001', '1b2', 1, 10,   'returned_for_revision'),
  ('3003', 'd001', '1b2', 2, 6,    'submitted'),
  ('3004', 'd001', '1b3', 1, 7,    'accepted'),
  ('3005', 'd002', '1b3', 1, null, 'draft'),
  ('3006', 'd002', '1b1', 1, 2,    'accepted'),
  ('3007', 'd003', '1b2', 1, 1,    'submitted'),
  ('3008', 'd002', '1a4', 1, 0,    'submitted'),
  ('3021', 'd021', '1b4', 1, 3,    'submitted'),
  ('3022', 'd021', '1b1', 1, 2,    'returned_for_revision'),
  ('30f1', 'd0f1', '1b6', 1, 0,    'submitted');
-- Порядок вставки важен для индекса одной активной попытки: №1 S2 по h1 закрываем до №2.
insert into topic_homework_attempts (id, homework_id, student_id, attempt_number, created_at)
select pg_temp.id(aid), pg_temp.id(hw), pg_temp.id(st), n, pg_temp.ts(coalesce(k, 1))
  from att_src where aid <> '3003';
update topic_homework_attempts a set status = 'submitted', submitted_at = pg_temp.ts(s.k)
  from att_src s where a.id = pg_temp.id(s.aid) and s.k is not null;
update topic_homework_attempts a set status = s.fin::topic_homework_attempt_status
  from att_src s where a.id = pg_temp.id(s.aid) and s.fin in ('accepted', 'returned_for_revision');
insert into topic_homework_attempts (id, homework_id, student_id, attempt_number, created_at)
values (pg_temp.id('3003'), pg_temp.id('d001'), pg_temp.id('1b2'), 2, pg_temp.ts(6));
update topic_homework_attempts set status = 'submitted', submitted_at = pg_temp.ts(6) where id = pg_temp.id('3003');

-- t7 — контрольная (тип ставится после попыток, как в §241/§242: сторож попыток требует окно работы).
update topics set kind = 'control' where id = pg_temp.id('7107');
update topic_homework set opens_at = now() - interval '2 days', closes_at = now() - interval '2 days' + interval '45 minutes'
 where id = pg_temp.id('d003');
