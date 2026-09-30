-- §246. Выдуманные данные проб. Ручной подсчёт — в 20_probes.sql рядом с каждой пробой.
-- Профили: A..I, W, X — ученики; T — преподаватель. J добавляется в откатываемом блоке (порог 10).
insert into profiles (id, full_name, role)
select probe.id('p' || k), 'Ученик ' || k, 'student' from unnest(array['A','B','C','D','E','F','G','H','I','J','W','X']) k;
insert into profiles (id, full_name, role) values (probe.id('pT'), 'Преподаватель T', 'teacher');
insert into students (id, profile_id)
select probe.id('s' || k), probe.id('p' || k) from unnest(array['A','B','C','D','E','F','G','H','I','J','W','X']) k;
insert into teachers (id, profile_id) values (probe.id('tT'), probe.id('pT'));

-- Курсы: A — в группе математики ЕГЭ (свой экзамен), B — физики ОГЭ.
insert into courses (id, title, subject, exam_type) values
  (probe.id('cM'), 'Математика ЕГЭ 11А', 'math', 'ege'),
  (probe.id('cPO'), 'Физика ОГЭ 9Б', 'physics', 'oge');
insert into groups (id, name, course_id, teacher_id) values
  (probe.id('gM'), '11А', probe.id('cM'), probe.id('tT')),
  (probe.id('gPO'), '9Б', probe.id('cPO'), probe.id('tT'));
insert into group_students values (probe.id('gM'), probe.id('sA')), (probe.id('gPO'), probe.id('sB'));

-- Разделы.
insert into catalog_sections (id, subject, exam_type, exam_number, title, position, is_published) values
  (probe.id('sM1'),   'Математика', 'ЕГЭ', 1,    '№1',  1,  true),
  (probe.id('sM2'),   'Математика', 'ЕГЭ', 2,    '№2',  2,  true),
  (probe.id('sM12'),  'Математика', 'ЕГЭ', 12,   '№12', 12, true),
  (probe.id('sM5x'),  'Математика', 'ЕГЭ', 5,    '№5 (снят)', 5, false),
  (probe.id('sMnull'),'Математика', 'ЕГЭ', null, 'без номера', 99, true),
  (probe.id('sP0'),   'Физика', 'ЕГЭ', 0,  'старый формат', 0, true),
  (probe.id('sP1'),   'Физика', 'ЕГЭ', 1,  '№1', 1, true),
  (probe.id('sO1'),   'Физика', 'ОГЭ', 1,  '№1', 1, true),
  (probe.id('sO20a'), 'Физика', 'ОГЭ', 20, '№20 · пустой', 20, true),
  (probe.id('sO20b'), 'Физика', 'ОГЭ', 20, '№20 · б', 21, true),
  (probe.id('sO20c'), 'Физика', 'ОГЭ', 20, '№20 · в', 22, true),
  (probe.id('sMO1'),  'Математика', 'ОГЭ', 1, '№1', 1, true);

-- Задачи: <раздел>:<ключ задачи>[:unpub]
insert into catalog_tasks (id, section_id, is_published)
select probe.id(t), probe.id(s), coalesce(p, true)
  from (values
    ('sM1','m1a',null),('sM1','m1b',null),('sM1','m1c',null),('sM1','m1d',null),('sM1','m1e',null),('sM1','m1u',false),
    ('sM2','m2a',null),('sM2','m2b',null),('sM2','m2c',null),
    ('sM12','m12a',null),('sM12','m12b',null),('sM12','m12c',null),('sM12','m12d',null),
    ('sM5x','m5a',null),('sM5x','m5b',null),
    ('sMnull','mna',null),('sMnull','mnb',null),
    ('sP1','p1a',null),('sP1','p1b',null),('sP1','p1c',null),
    ('sO1','o1a',null),('sO1','o1b',null),
    ('sO20b','o20b1',null),('sO20b','o20b2',null),
    ('sO20c','o20c1',null),('sO20c','o20c2',null),('sO20c','o20c3',null),
    ('sMO1','mo1a',null),('sMO1','mo1b',null)
  ) v(s, t, p);

-- Вариант: по пункту на каждую задачу.
insert into test_variant_items (id, variant_id, task_id)
select probe.id('i:' || ct_key), probe.id('V'), probe.id(ct_key)
  from unnest(array['m1a','m1b','m1c','m1d','m1e','m2a','m2b','m2c','m12a','m12b','m12c','m12d','p1a','p1b','o20c1']) ct_key;
insert into test_variant_student_assignments (id, variant_id, student_id, submitted_at)
select probe.id('sa:' || k), probe.id('V'), probe.id('s' || k), null from unnest(array['A','B','C','G','J','W']) k;

-- ── A ──────────────────────────────────────────────────────────────────────
-- Отметки: m1a (2 дня), m1b (2 дня), m1c (10 дней), m2a (20 дней), p1a (1 день);
-- не считаются: m1u (задача снята), m5a (раздел снят), mna (раздел без номера), m12c (is_completed = false).
insert into catalog_task_progress (user_id, task_id, is_completed, completed_at)
select probe.id('pA'), probe.id(t), c, now() - (d || ' days')::interval
  from (values ('m1a',true,2),('m1b',true,2),('m1c',true,10),('m2a',true,20),('p1a',true,1),
               ('m1u',true,1),('m5a',true,1),('mna',true,1),('m12c',false,1)) v(t, c, d);
-- Ответы: m1a верно 40 дней назад (та же задача, что отметка → одна задача, время — раньшее: 40 дней);
-- m12a верно (время — сдача работы, 3 дня); m12b НЕверно; o20c1 верно (30 дней, физика ОГЭ).
insert into test_variant_answers (student_assignment_id, variant_item_id, is_correct, submitted_at)
values (probe.id('sa:A'), probe.id('i:m1a'), true, now() - interval '40 days'),
       (probe.id('sa:A'), probe.id('i:m12b'), false, now() - interval '1 day'),
       (probe.id('sa:A'), probe.id('i:o20c1'), true, now() - interval '30 days');
insert into test_variant_student_assignments (id, variant_id, student_id, submitted_at)
values (probe.id('sa:A2'), probe.id('V'), probe.id('sA'), now() - interval '3 days');
insert into test_variant_answers (student_assignment_id, variant_item_id, is_correct, submitted_at)
values (probe.id('sa:A2'), probe.id('i:m12a'), true, null);
-- Итого A: математика ЕГЭ №1 = 3, №2 = 1, №12 = 1 → 5 (за 7 дней: m1b, m12a = 2);
--          физика ЕГЭ №1 = 1 (за 7 дней 1); физика ОГЭ №20 = 1 (0). Всего 7, за 7 дней 3.

-- ── Остальные ученики (математика ЕГЭ) ─────────────────────────────────────
-- Первые k задач пула m1a,m1b,m1c,m1d,m1e,m2a,m2b,m2c,m12a,m12b,m12c,m12d отметкой:
-- B=1, D=2, E=3, F=5, G=6, H=7, I=8. C — одна задача верным ответом (m2b).
insert into catalog_task_progress (user_id, task_id, is_completed, completed_at)
select probe.id('p' || s.k), probe.id(pool.t), true, now() - interval '5 days'
  from (values ('B',1),('D',2),('E',3),('F',5),('G',6),('H',7),('I',8)) s(k, cnt)
  join (select t, row_number() over () as rn
          from unnest(array['m1a','m1b','m1c','m1d','m1e','m2a','m2b','m2c','m12a','m12b','m12c','m12d']) t) pool
    on pool.rn <= s.cnt;
-- B: та же m1a ещё и верным ответом — у B всё равно 1.
insert into test_variant_answers (student_assignment_id, variant_item_id, is_correct, submitted_at)
values (probe.id('sa:B'), probe.id('i:m1a'), true, now() - interval '1 day'),
       (probe.id('sa:C'), probe.id('i:m2b'), true, now() - interval '1 day'),
-- G: ещё и физика ЕГЭ p1b ответом → по объединению у G 7.
       (probe.id('sa:G'), probe.id('i:p1b'), true, now() - interval '1 day'),
-- W: только неверные ответы — не решающий.
       (probe.id('sa:W'), probe.id('i:m1a'), false, now() - interval '1 day'),
       (probe.id('sa:W'), probe.id('i:m1b'), null,  now() - interval '1 day');
-- T (преподаватель) отметил 10 задач — в «решающих учениках» его нет.
insert into catalog_task_progress (user_id, task_id, is_completed, completed_at)
select probe.id('pT'), probe.id(t), true, now()
  from unnest(array['m1a','m1b','m1c','m1d','m1e','m2a','m2b','m2c','m12a','m12b']) t;
-- Математика ЕГЭ, решающие: A5, B1, C1, D2, E3, F5, G6, H7, I8 = 9 (порог 10 не набран).
