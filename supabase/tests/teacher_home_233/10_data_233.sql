-- §233. Данные главной преподавателя поверх цепочки §231 (всё выдумано).
-- Сегодня — (now() at time zone 'Europe/Moscow')::date; все сроки — от него.
--
-- Люди (профили 33000000-…):
--   TA   …00a1  преподаватель группы GA (курс CA)
--   TB   …00b1  преподаватель группы GB (курс CB) — ПОСТОРОННИЙ для CA
--   ADM  …000a  владелец платформы (admin + строка teachers), ведёт свою группу GC (курс CC)
--   CUR  …00c1  куратор курса CA (course_curators), сам — ученик
--   SA1…SA7 …0051…0057 ученики GA;  SB1 …0061 — GB;  SC1 …0071 — GC
--
-- «Не сдали к сроку» в CA (ожидание): SA1 — ДЗ 01 и 02 (Telegram есть),
-- SA2 — ДЗ 01 (черновик, Telegram нет), SA5 — ДЗ 01 (Telegram есть, «Просроченное ДЗ»
-- выключено). Не попадают: SA3/SA4/SA6 (сдали/возвращено/принято), SA7 (пришёл
-- в день срока), ДЗ 03 без срока, 04 срок сегодня, 05 не опубликовано, 06 тема
-- закрыта, 07/08 — срок впереди.
insert into profiles (id, full_name, role) values
 ('33000000-0000-0000-0000-0000000000a1', 'Учитель А', 'teacher'),
 ('33000000-0000-0000-0000-0000000000b1', 'Учитель Б (посторонний)', 'teacher'),
 ('33000000-0000-0000-0000-00000000000a', 'Владелец платформы', 'admin'),
 ('33000000-0000-0000-0000-0000000000c1', 'Куратор курса CA', 'student'),
 ('33000000-0000-0000-0000-000000000051', 'Сафин Данияр', 'student'),
 ('33000000-0000-0000-0000-000000000052', 'Никитина Вера', 'student'),
 ('33000000-0000-0000-0000-000000000053', 'Валиев Карим', 'student'),
 ('33000000-0000-0000-0000-000000000054', 'Ахмадуллин Рустем', 'student'),
 ('33000000-0000-0000-0000-000000000055', 'Зиннатуллин Артур', 'student'),
 ('33000000-0000-0000-0000-000000000056', 'Хасанов Тимур', 'student'),
 ('33000000-0000-0000-0000-000000000057', 'Новенький Пётр', 'student'),
 ('33000000-0000-0000-0000-000000000061', 'Ученик Б', 'student'),
 ('33000000-0000-0000-0000-000000000071', 'Ученик В', 'student');

insert into teachers (id, profile_id) values
 ('33100000-0000-0000-0000-0000000000a1', '33000000-0000-0000-0000-0000000000a1'),
 ('33100000-0000-0000-0000-0000000000b1', '33000000-0000-0000-0000-0000000000b1'),
 ('33100000-0000-0000-0000-00000000000a', '33000000-0000-0000-0000-00000000000a');

insert into students (id, profile_id)
select ('33200000-0000-0000-0000-0000000000' || n)::uuid, ('33000000-0000-0000-0000-0000000000' || n)::uuid
  from unnest(array['51','52','53','54','55','56','57','61','71']) n;

insert into courses (id, title, owner_id) values
 ('33300000-0000-0000-0000-000000000001', 'Курс CA', null),
 ('33300000-0000-0000-0000-000000000002', 'Курс CB', null),
 ('33300000-0000-0000-0000-000000000003', 'Курс CC', '33000000-0000-0000-0000-00000000000a');
insert into groups (id, name, course_id, teacher_id) values
 ('33400000-0000-0000-0000-000000000001', '11А · Профиль', '33300000-0000-0000-0000-000000000001', '33100000-0000-0000-0000-0000000000a1'),
 ('33400000-0000-0000-0000-000000000002', '11Б',           '33300000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-0000000000b1'),
 ('33400000-0000-0000-0000-000000000003', 'Группа владельца', '33300000-0000-0000-0000-000000000003', '33100000-0000-0000-0000-00000000000a');
insert into course_curators (course_id, profile_id) values
 ('33300000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-0000000000c1');

insert into group_students (group_id, student_id, joined_at)
select '33400000-0000-0000-0000-000000000001', ('33200000-0000-0000-0000-0000000000' || n)::uuid, now() - interval '60 days'
  from unnest(array['51','52','53','54','55','56']) n;
-- SA7 пришёл сегодня — срок ДЗ 01/02 прошёл до него.
insert into group_students (group_id, student_id, joined_at) values
 ('33400000-0000-0000-0000-000000000001', '33200000-0000-0000-0000-000000000057', now()),
 ('33400000-0000-0000-0000-000000000002', '33200000-0000-0000-0000-000000000061', now() - interval '60 days'),
 ('33400000-0000-0000-0000-000000000003', '33200000-0000-0000-0000-000000000071', now() - interval '60 days');

insert into modules (id, course_id, title) values
 ('33500000-0000-0000-0000-000000000001', '33300000-0000-0000-0000-000000000001', 'Модуль CA'),
 ('33500000-0000-0000-0000-000000000002', '33300000-0000-0000-0000-000000000002', 'Модуль CB'),
 ('33500000-0000-0000-0000-000000000003', '33300000-0000-0000-0000-000000000003', 'Модуль CC');

-- Темы и ДЗ. Номер темы = номер ДЗ: 01–08 — сроки, 11–18 — ряды «Просели» (без срока).
create temp table hw_plan (n text, module text, title text, due int, pub boolean, open boolean, scale text);
insert into hw_plan values
 ('01','1','Отбор корней',          -2, true,  null,  'five'),
 ('02','1','Векторы',                -1, true,  null,  'five'),
 ('03','1','Без срока',              null, true, null, 'five'),
 ('04','1','Срок сегодня',           0, true,  null,  'five'),
 ('05','1','Не опубликовано',        -3, false, null, 'five'),
 ('06','1','Тема закрыта',           -3, true,  false, 'five'),
 ('07','1','Срок через 5 дней',      5, true,  null,  'five'),
 ('08','1','Срок через 9 дней',      9, true,  null,  'five'),
 ('11','1','Ряд 1', null, true, null, 'five'),
 ('12','1','Ряд 2', null, true, null, 'hundred'),
 ('13','1','Ряд 3', null, true, null, 'hundred'),
 ('14','1','Ряд 4', null, true, null, 'hundred'),
 ('15','1','Ряд 5', null, true, null, 'hundred'),
 ('16','1','Ряд 6', null, true, null, 'hundred'),
 ('17','1','Ряд 7', null, true, null, 'hundred'),
 ('18','1','Ряд 8', null, true, null, 'hundred'),
 ('31','2','ДЗ курса CB',            -2, true,  null,  'five'),
 ('41','3','ДЗ курса CC',            -1, true,  null,  'five');
insert into topics (id, module_id, title, is_open)
select ('33600000-0000-0000-0000-0000000000' || n)::uuid, ('33500000-0000-0000-0000-00000000000' || module)::uuid, title, open from hw_plan;
insert into topic_homework (id, topic_id, title, is_published, due_at, grade_scale)
select ('33700000-0000-0000-0000-0000000000' || n)::uuid, ('33600000-0000-0000-0000-0000000000' || n)::uuid, 'Домашнее задание', pub,
       case when due is null then null else (now() at time zone 'Europe/Moscow')::date + due end, scale
  from hw_plan;

-- Попытки по ДЗ 01/02 (сдачи): SA2 — черновик 01; SA3 — сдано; SA4 — возвращено; SA6 — принято.
create temp table att (hw text, st text, num int, status text, days int);
insert into att values
 ('01','52',1,'draft',    null), ('01','53',1,'submitted',3), ('01','54',1,'returned_for_revision',3), ('01','56',1,'accepted',4),
 ('02','52',1,'submitted',2),    ('02','53',1,'submitted',2), ('02','54',1,'submitted',2), ('02','55',1,'accepted',3), ('02','56',1,'submitted',2),
 ('31','61',1,'draft',    null);
insert into topic_homework_attempts (homework_id, student_id, attempt_number, status, submitted_at)
select ('33700000-0000-0000-0000-0000000000' || hw)::uuid, ('33200000-0000-0000-0000-0000000000' || st)::uuid, num,
       status::topic_homework_attempt_status, case when days is null then null else now() - make_interval(days => days) end
  from att;

-- Ряд SA3 (Валиев): 8 проверенных ДЗ, 80 82 80 84 79 | 60 62 70 (ДЗ 11 — пятёрка: 4 из 5 = 80 %).
-- У ДЗ 18 первая попытка возвращена без балла — в ряд идёт вторая, принятая с баллом.
-- Ряд SA4 (Ахмадуллин): 7 проверенных — мало, в series не попадает.
create temp table ser (hw text, st text, num int, status text, days int, score int);
insert into ser values
 ('11','53',1,'accepted',20,4), ('12','53',1,'accepted',19,82), ('13','53',1,'accepted',18,80), ('14','53',1,'accepted',17,84),
 ('15','53',1,'accepted',16,79), ('16','53',1,'accepted',15,60), ('17','53',1,'accepted',14,62),
 ('18','53',1,'returned_for_revision',13,null), ('18','53',2,'accepted',12,70),
 ('11','54',1,'accepted',20,5), ('12','54',1,'accepted',19,90), ('13','54',1,'accepted',18,90), ('14','54',1,'accepted',17,90),
 ('15','54',1,'accepted',16,20), ('16','54',1,'accepted',15,20), ('17','54',1,'accepted',14,20);
insert into topic_homework_attempts (id, homework_id, student_id, attempt_number, status, submitted_at)
select md5('att' || hw || st || num)::uuid, ('33700000-0000-0000-0000-0000000000' || hw)::uuid, ('33200000-0000-0000-0000-0000000000' || st)::uuid, num,
       status::topic_homework_attempt_status, now() - make_interval(days => days)
  from ser;
insert into topic_homework_reviews (attempt_id, decision, score, created_at)
select md5('att' || hw || st || num)::uuid,
       (case when status = 'accepted' then 'accepted' else 'returned_for_revision' end)::topic_homework_review_decision,
       score, now() - make_interval(days => days) + interval '1 hour'
  from ser;

-- Telegram: SA1 — подключён; SA2 — нет подключения; SA5 — подключён, «Просроченное ДЗ» выключено;
-- SB1 — подключён; SC1 — нет. У остальных (SA3, SA4, SA6) подключение есть — им напоминать нечего.
insert into telegram_connections (profile_id, telegram_chat_id)
select ('33000000-0000-0000-0000-0000000000' || n)::uuid, ('7700' || n)::bigint
  from unnest(array['51','53','54','55','56','61']) n;
insert into notification_prefs (user_id, telegram, overdue)
select ('33000000-0000-0000-0000-0000000000' || n)::uuid, true, n <> '55'
  from unnest(array['51','53','54','55','56','61']) n;

-- ── Пробники группы GA (шаблон 2027: 19 номеров, первая часть 1–12, таблицы перевода нет) ──
-- ME1 — закончился два дня назад: SA1 сдал бланк (ждёт), SA2 оценён целиком (не ждёт),
--       SA3 прислал только фото (ждёт), SA4 ничего (не писал), SA5 — баллы первой части
--       без работы (частично → ждёт). Итого 3, самая давняя — SA1.
-- ME2 — идёт сейчас: SA1 пишет (бланк не сдан) — не ждёт; SA2 сдал — ждёт. Итого 1.
-- ME3 — через 3 дня: в «Ближайшем», не на проверке.
-- ME0 — бумажный (без окна), месяц назад: итоги SA6 70 → ME1 58 — ряд пробников SA6.
insert into mock_exams (id, title, subject, exam_type, group_id, date, template_id, created_by, starts_at, duration_minutes) values
 ('33800000-0000-0000-0000-000000000001', 'Пробник №3', 'math', 'ege', '33400000-0000-0000-0000-000000000001', now() - interval '2 days',
   (select id from mock_exam_templates where year = 2027), '33100000-0000-0000-0000-0000000000a1', now() - interval '2 days', 240),
 ('33800000-0000-0000-0000-000000000002', 'Пробник №4', 'math', 'ege', '33400000-0000-0000-0000-000000000001', now() - interval '1 hour',
   (select id from mock_exam_templates where year = 2027), '33100000-0000-0000-0000-0000000000a1', now() - interval '1 hour', 240),
 ('33800000-0000-0000-0000-000000000003', 'Пробник №5', 'math', 'ege', '33400000-0000-0000-0000-000000000001', now() + interval '3 days',
   (select id from mock_exam_templates where year = 2027), '33100000-0000-0000-0000-0000000000a1', now() + interval '3 days', 240),
 ('33800000-0000-0000-0000-000000000000', 'Пробник №2', 'math', 'ege', '33400000-0000-0000-0000-000000000001', now() - interval '30 days',
   (select id from mock_exam_templates where year = 2027), '33100000-0000-0000-0000-0000000000a1', null, 240);

insert into mock_exam_sheets (mock_exam_id, student_id, answers, submitted_at) values
 ('33800000-0000-0000-0000-000000000001', '33200000-0000-0000-0000-000000000051', array['1','2'], now() - interval '2 days' + interval '2 hours'),
 ('33800000-0000-0000-0000-000000000001', '33200000-0000-0000-0000-000000000052', array['1','2'], now() - interval '2 days' + interval '1 hour'),
 ('33800000-0000-0000-0000-000000000002', '33200000-0000-0000-0000-000000000051', array['5'], null),
 ('33800000-0000-0000-0000-000000000002', '33200000-0000-0000-0000-000000000052', array['5'], now() - interval '10 minutes');
insert into mock_exam_photos (mock_exam_id, student_id, storage_path, file_name, created_at) values
 ('33800000-0000-0000-0000-000000000001', '33200000-0000-0000-0000-000000000053', '33800000/photos/sa3/1.jpg', '1.jpg', now() - interval '2 days' + interval '3 hours');
insert into mock_exam_task_scores (mock_exam_id, student_id, task_number, points)
select '33800000-0000-0000-0000-000000000001', '33200000-0000-0000-0000-000000000052', i, 0 from generate_series(1, 19) i;
insert into mock_exam_task_scores (mock_exam_id, student_id, task_number, points)
select '33800000-0000-0000-0000-000000000001', '33200000-0000-0000-0000-000000000055', i, 1 from generate_series(1, 12) i;
insert into mock_exam_results (mock_exam_id, student_id, score) values
 ('33800000-0000-0000-0000-000000000000', '33200000-0000-0000-0000-000000000056', 70),
 ('33800000-0000-0000-0000-000000000001', '33200000-0000-0000-0000-000000000056', 58);

-- ── Помощники проб (только в этой базе) ─────────────────────────────────────
-- Первое значение первой строки запроса текстом, или «ERR <sqlstate>: …».
create or replace function public.probe_val(p_sql text) returns text
language plpgsql security invoker as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, 'null');
exception when others then
  return 'ERR ' || sqlstate || ': ' || left(sqlerrm, 90);
end $$;
grant execute on function public.probe_val(text) to authenticated;
