-- §269. Выдуманные данные поверх §255/§256/§262 (ученики A …a1 и B …b1, учителя T …c1 и O …d1, админ M …e1).
-- Раздел физики ЕГЭ №1 (69…01) и задачи:
--   m1 — Markdown, число −8 (tol 0)                 m2 — Markdown, число 2,5 ± 0,1
--   m3 — Markdown, цифры 145 в любом порядке         m4 — Markdown, цифры 235 по порядку
--   m5 — Markdown, текст «к наблюдателю», часть 2   m6 — Markdown, «4,40,2» (значение+погрешность, КИМ 19)
--   h1 — старая HTML-задача, ответ 12, стоит в СДАННОМ варианте A (верно), A решал её и в каталоге, в подборке и с темой
--   h2 — старая HTML-задача без вариантов
-- Задачи m1–m6 и варианты с ними — в 12_data_md_269.sql (после первого прогона PENDING_269: нужны его колонки).
-- Заглушка 12 000 задач математики — для плана подсчёта каталога (index-only scan, §268).
insert into public.catalog_sections (id, subject, exam_type, exam_number, title, position, is_published) values
  ('69000000-0000-4000-8000-000000000001', 'Физика', 'ЕГЭ', 1, '№1 Кинематика', 1, true);

insert into public.catalog_tasks (id, section_id, subject, exam_type, is_published, statement_html, answer_html, solution_html,
                                  exam_part, external_id, has_answer, has_solution, max_points, position, partial_type) values
  ('69100000-0000-4000-8000-0000000000a1', '69000000-0000-4000-8000-000000000001', 'Физика', 'ЕГЭ', true,
   '<p>Старое условие h1</p>', '12', '<p>Старое решение h1</p>', 1, 96090, true, true, 1, 1, null),
  ('69100000-0000-4000-8000-0000000000a2', '69000000-0000-4000-8000-000000000001', 'Физика', 'ЕГЭ', true,
   '<p>Старое условие h2</p>', '7', '<p>Старое решение h2</p>', 1, 96091, true, true, 1, 2, null);

insert into public.catalog_task_topics (task_id, topic_id, is_primary, source) values
  ('69100000-0000-4000-8000-0000000000a1', '69300000-0000-4000-8000-000000000001', true, 'manual'),
  ('69100000-0000-4000-8000-0000000000a1', '69300000-0000-4000-8000-000000000002', false, 'ai');
insert into public.task_collection_items (collection_id, catalog_task_id, position) values
  ('69400000-0000-4000-8000-000000000001', '69100000-0000-4000-8000-0000000000a1', 1);
insert into public.catalog_task_assets (task_id, kind, storage_path, alt, position) values
  ('69100000-0000-4000-8000-0000000000a1', 'condition', 'physics-ege/h1.png', 'h1.png', 0);

-- Сданный вариант A с h1 (верно).
insert into public.test_variants (id) values ('69500000-0000-4000-8000-000000000001');
insert into public.test_variant_items (id, variant_id, task_id, position) values
  ('69510000-0000-4000-8000-000000000001', '69500000-0000-4000-8000-000000000001', '69100000-0000-4000-8000-0000000000a1', 1);
insert into public.test_variant_student_assignments (id, student_id, variant_id, status, submitted_at, started_at) values
  ('69520000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', '69500000-0000-4000-8000-000000000001',
   'submitted', now() - interval '2 days', now() - interval '2 days');
insert into public.test_variant_answers (student_assignment_id, variant_item_id, is_correct, submitted_at, answer_raw, answer_normalized) values
  ('69520000-0000-4000-8000-000000000001', '69510000-0000-4000-8000-000000000001', true, now() - interval '2 days', '12', '12');

-- A решил h1 и в каталоге (засчитано).
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, revealed_before, created_at) values
  ('00000000-0000-4000-8000-0000000000a1', '69100000-0000-4000-8000-0000000000a1', '12', 'correct', false, now() - interval '1 day');

insert into public.teachers (profile_id) values ('00000000-0000-4000-8000-0000000000c1');

-- 12 000 задач-заглушек (математика ЕГЭ, раздел §262) — для плана подсчёта.
insert into public.catalog_tasks (section_id, subject, exam_type, is_published, statement_html, external_id, position)
select 'a6200000-0000-4000-8000-000000000005', 'Математика', 'ЕГЭ', true, repeat('x', 300), 700000 + g, g
  from generate_series(1, 12000) g;
vacuum analyze public.catalog_tasks;
