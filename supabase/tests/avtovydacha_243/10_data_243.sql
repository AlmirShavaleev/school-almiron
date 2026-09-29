-- §243. Выдуманные данные для проб (не прод) — состояние ДО миграции.
--   O  …a0 — владелец курсов (teacher, НЕ админ);  X …a3 — посторонний преподаватель (свой курс)
--   S1 …b1 — Физика 11А и Математика 11А, Telegram подключён;
--   S2 …b2 — Физика 11А, Telegram нет;  S3 …b3 — Физика 11А, Telegram выключен;
--   S4 …b4 — придёт в Физику 11А позже; S5 …b5 — Физика 11А, выключен (is_active = false);
--   S6 …b6 — «Массовый курс» (14 тем), Telegram подключён; S7 …b7 — класс-копия каркаса, Telegram есть.
-- Физика 11А (модуль «Механика»):
--   A1 «Законы Ньютона» закрыта тумблером, ДЗ с файлом, срок 2026-10-03  → тумблер;
--   A2 «Импульс тела» по дате (через 3 дня), ДЗ с файлом                 → крон по дате;
--   A3 «Работа и мощность» открыта, ДЗ БЕЗ файлов                        → файл добавили;
--   A4 «Кинематика» открыта, ДЗ с файлом, не опубликовано                → бэкфилл;
--   A5 «Контрольная» (control) открыта, ДЗ без файлов                    → бэкфилл (работа по времени);
--   A6 «Проверочная» (check) закрыта, ДЗ без файлов                      → тумблер, без сводки;
--   A7 «Статика» открыта, ДЗ опубликовано кнопкой до §243               → не трогается;
--   A8 «Давление» закрыта, ДЗ с файлом                                   → открыли и закрыли до отправки;
--   A9 «Контрольная 2» (control) открыта, ДЗ нет; A10 «Гидростатика» открыта, ДЗ нет.
-- Математика 11А: B1 «Производная сложной функции» (срок 2026-10-02), B2 «Первообразная» — закрыты, с файлами.
-- Массовый курс: M01…M14 закрыты, с файлами.
-- Каркас «Физика (каркас)»: T1 открыта (is_open null), ДЗ с файлом; T2 открыта, ДЗ без файлов.
-- Класс-копия «Физика 10Б»: темы и ДЗ заводит синхронизация — K1 (копия T1) открыта, файл пришёл
--   из каркаса → бэкфилл; K2 (копия T2) открыта, ДЗ без файлов.
-- Чужой курс X: F1 открыта, ДЗ опубликовано.
create or replace function pg_temp.u(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid $$;

insert into profiles (id, full_name, role) values
  (pg_temp.u('a0'), 'Владелец', 'teacher'),
  (pg_temp.u('a3'), 'Посторонний', 'teacher'),
  (pg_temp.u('b1'), 'Ученик 1', 'student'), (pg_temp.u('b2'), 'Ученик 2', 'student'),
  (pg_temp.u('b3'), 'Ученик 3', 'student'), (pg_temp.u('b4'), 'Ученик 4', 'student'),
  (pg_temp.u('b5'), 'Ученик 5', 'student'), (pg_temp.u('b6'), 'Ученик 6', 'student'),
  (pg_temp.u('b7'), 'Ученик 7', 'student');
insert into teachers (id, profile_id) values (pg_temp.u('1a3'), pg_temp.u('a3'));
insert into students (id, profile_id, is_active)
select pg_temp.u('1b' || n), pg_temp.u('b' || n), n <> 5 from generate_series(1, 7) n;

insert into telegram_connections (profile_id, telegram_chat_id, is_enabled) values
  (pg_temp.u('b1'), 1001, true), (pg_temp.u('b3'), 1003, false),
  (pg_temp.u('b6'), 1006, true), (pg_temp.u('b7'), 1007, true);

insert into courses (id, title, owner_id, is_template, copied_from_course_id) values
  (pg_temp.u('c1'), 'Физика ЕГЭ 11А класс',  pg_temp.u('a0'), false, null),
  (pg_temp.u('c2'), 'Математика ЕГЭ — 11А', pg_temp.u('a0'), false, null),
  (pg_temp.u('c3'), 'Массовый курс',         pg_temp.u('a0'), false, null),
  (pg_temp.u('c4'), 'Физика (каркас)',       pg_temp.u('a0'), true,  null),
  (pg_temp.u('c5'), 'Физика 10Б',            pg_temp.u('a0'), false, pg_temp.u('c4')),
  (pg_temp.u('cf'), 'Чужой курс',            pg_temp.u('a3'), false, null);
insert into groups (id, name, course_id, teacher_id) values
  (pg_temp.u('f1'), '11А', pg_temp.u('c1'), null), (pg_temp.u('f2'), '11А мат', pg_temp.u('c2'), null),
  (pg_temp.u('f3'), 'Масса', pg_temp.u('c3'), null), (pg_temp.u('f5'), '10Б', pg_temp.u('c5'), null),
  (pg_temp.u('ff'), 'Чужая', pg_temp.u('cf'), pg_temp.u('1a3'));
insert into group_students (group_id, student_id) values
  (pg_temp.u('f1'), pg_temp.u('1b1')), (pg_temp.u('f1'), pg_temp.u('1b2')),
  (pg_temp.u('f1'), pg_temp.u('1b3')), (pg_temp.u('f1'), pg_temp.u('1b5')),
  (pg_temp.u('f2'), pg_temp.u('1b1')), (pg_temp.u('f3'), pg_temp.u('1b6')),
  (pg_temp.u('f5'), pg_temp.u('1b7'));

insert into modules (id, course_id, title, order_index) values
  (pg_temp.u('e1'), pg_temp.u('c1'), 'Механика', 1), (pg_temp.u('e2'), pg_temp.u('c2'), 'Анализ', 1),
  (pg_temp.u('e3'), pg_temp.u('c3'), 'Всё', 1), (pg_temp.u('e4'), pg_temp.u('c4'), 'Механика', 1),
  (pg_temp.u('ef'), pg_temp.u('cf'), 'Чужое', 1);
-- Модуль и темы класса-копии «Физика 10Б» заводит синхронизация каркаса (как на проде): темы
-- копии встают с is_open = nullif(каркас, true) = null и без даты — то есть сразу открыты.

insert into topics (id, module_id, title, order_index, is_open, available_from, kind) values
  (pg_temp.u('7a01'), pg_temp.u('e1'), 'Законы Ньютона',    1, false, null, 'lesson'),
  (pg_temp.u('7a02'), pg_temp.u('e1'), 'Импульс тела',      2, null, current_date + 3, 'lesson'),
  (pg_temp.u('7a03'), pg_temp.u('e1'), 'Работа и мощность', 3, true,  null, 'lesson'),
  (pg_temp.u('7a04'), pg_temp.u('e1'), 'Кинематика',        4, true,  null, 'lesson'),
  (pg_temp.u('7a05'), pg_temp.u('e1'), 'Контрольная',       5, true,  null, 'control'),
  (pg_temp.u('7a06'), pg_temp.u('e1'), 'Проверочная',       6, false, null, 'check'),
  (pg_temp.u('7a07'), pg_temp.u('e1'), 'Статика',           7, true,  null, 'lesson'),
  (pg_temp.u('7a08'), pg_temp.u('e1'), 'Давление',          8, false, null, 'lesson'),
  (pg_temp.u('7a09'), pg_temp.u('e1'), 'Контрольная 2',     9, true,  null, 'control'),
  (pg_temp.u('7a10'), pg_temp.u('e1'), 'Гидростатика',     10, true,  null, 'lesson'),
  (pg_temp.u('7b01'), pg_temp.u('e2'), 'Производная сложной функции', 1, false, null, 'lesson'),
  (pg_temp.u('7b02'), pg_temp.u('e2'), 'Первообразная',               2, false, null, 'lesson'),
  (pg_temp.u('7c01'), pg_temp.u('e4'), 'Каркас: Законы Ньютона',   1, null, null, 'lesson'),
  (pg_temp.u('7c02'), pg_temp.u('e4'), 'Каркас: Работа',           2, null, null, 'lesson'),
  (pg_temp.u('7f01'), pg_temp.u('ef'), 'Чужая тема',               1, true, null, 'lesson');
insert into topics (id, module_id, title, order_index, is_open, kind)
select pg_temp.u('7e' || lpad(n::text, 2, '0')), pg_temp.u('e3'),
       (array['Кинематика','Свободное падение','Движение по окружности','Силы в природе','Сила трения','Закон Гука',
              'Всемирное тяготение','Статика','Давление','Закон Архимеда','Гидростатика','Колебания','Волны','Звук'])[n],
       n, false, 'lesson'
  from generate_series(1, 14) n;

-- ДЗ (id — по умолчанию; в пробах ДЗ ищется по теме). Всё — черновики, кроме A7 и F1
-- (опубликованы кнопкой до §243). ДЗ классов-копий заводит сама синхронизация каркаса
-- (template_sync_homework) при вставке ДЗ каркаса, файл K1 — она же.
insert into topic_homework (topic_id, title, is_published, created_by, due_at)
select t.id, 'Домашнее задание',
       t.id in (pg_temp.u('7a07'), pg_temp.u('7f01')),
       case when t.id = pg_temp.u('7f01') then pg_temp.u('a3') else pg_temp.u('a0') end,
       case t.id when pg_temp.u('7a01') then date '2026-10-03' when pg_temp.u('7b01') then date '2026-10-02' end
  from topics t
 where t.id not in (pg_temp.u('7a09'), pg_temp.u('7a10'))
   and t.source_topic_id is null;

-- Файлы задания — у всех, кроме A3, A5, A6, T2 (копии получают файлы синхронизацией: K1 — файл T1).
insert into topic_homework_files (homework_id, storage_path, original_filename, position)
select h.id, 'hw/' || h.id || '.pdf', 'zadanie.pdf', 0
  from topic_homework h
  join topics t on t.id = h.topic_id
 where h.topic_id not in (pg_temp.u('7a03'), pg_temp.u('7a05'), pg_temp.u('7a06'), pg_temp.u('7c02'))
   and t.source_topic_id is null;
