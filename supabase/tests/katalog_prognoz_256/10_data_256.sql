-- §256. Выдуманные данные для проб — ПОВЕРХ данных §255 (../prognoz_255/10_data_255.sql, грузятся первыми):
-- там ученики A (…a1: математика и физика ЕГЭ, математика ОГЭ) и B (…b1), учителя T (…c1, курсы A) и
-- O (…d1, посторонний), админ M (…e1); ДЗ №6 у A (верно + частично), пробник №1 1/1, самоотметки
-- «Выполнено» на задачах №6 (91…01, 91…02) — по новому правилу они вне прогноза и баллов.
-- Даты — от now().

-- Эталоны задачам §255: 91…01 — «9» (проверяемая), снятая 91…05 — «1».
update public.catalog_tasks set answer_html = '<p>9</p>', exam_part = 1 where id = '91000000-0000-4000-8000-000000000001';
update public.catalog_tasks set answer_html = '<p>1</p>', exam_part = 1 where id = '91000000-0000-4000-8000-000000000005';
update public.catalog_tasks set subject = 'Физика' where section_id = '90000000-0000-4000-8000-000000000002';

insert into public.catalog_sections (id, subject, exam_type, exam_number, title, position, is_published) values
  ('a5600000-0000-4000-8000-000000000001', 'Математика', 'ЕГЭ', 1, 'Планиметрия', 1, true),
  ('a5600000-0000-4000-8000-000000000004', 'Математика', 'ЕГЭ', 4, 'Теория вероятностей', 4, true),
  ('a5600000-0000-4000-8000-000000000007', 'Математика', 'ЕГЭ', 7, 'Вычисления и преобразования', 7, true),
  ('a5600000-0000-4000-8000-000000000013', 'Математика', 'ЕГЭ', 13, 'Уравнения', 13, true);

-- №1: 20 задач с эталоном-числом i (задачи 1…9 решены верно 3 дня назад, 10…18 — неверно 4 дня назад, 19 и 20 не трогал).
insert into public.catalog_tasks (id, section_id, is_published, statement_html, answer_html, exam_part)
select ('a5611000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'a5600000-0000-4000-8000-000000000001', true,
       '<p>Задача №1, вариант ' || i || '</p>', '<p>' || i || '</p>', 1
  from generate_series(1, 20) i;
-- №4: две проверяемые задачи, по №4 у A нет НИКАКИХ свидетельств — самый слабый номер.
insert into public.catalog_tasks (id, section_id, is_published, statement_html, answer_html, exam_part) values
  ('a5614000-0000-4000-8000-000000000001', 'a5600000-0000-4000-8000-000000000004', true, '<p>Вероятность 1</p>', '<p>0,25</p>', 1),
  ('a5614000-0000-4000-8000-000000000002', 'a5600000-0000-4000-8000-000000000004', true, '<p>Вероятность 2</p>', '<p>0,5</p>', 1);
-- №7: 7a — «7»; 7b — набор «-6; 7»; 7c — эталон не берётся автопроверкой; 7d — для раскрытия.
insert into public.catalog_tasks (id, section_id, is_published, statement_html, answer_html, exam_part) values
  ('a5617000-0000-4000-8000-00000000000a', 'a5600000-0000-4000-8000-000000000007', true, '<p>2^(x−3) = 16</p>', '<p>7</p>', 1),
  ('a5617000-0000-4000-8000-00000000000b', 'a5600000-0000-4000-8000-000000000007', true, '<p>Корни</p>', '<p>-6; 7</p>', 1),
  ('a5617000-0000-4000-8000-00000000000c', 'a5600000-0000-4000-8000-000000000007', true, '<p>Преобразуйте</p>', '<p>см. решение</p>', 1),
  ('a5617000-0000-4000-8000-00000000000d', 'a5600000-0000-4000-8000-000000000007', true, '<p>Половина</p>', '<p>0,5</p>', 1);
-- №13 — вторая часть: эталон-число есть, но задача не проверяется (развёрнутый ответ).
insert into public.catalog_tasks (id, section_id, is_published, statement_html, answer_html, exam_part) values
  ('a5613000-0000-4000-8000-000000000001', 'a5600000-0000-4000-8000-000000000013', true, '<p>Тригонометрия</p>', '<p>5</p>', 2);
-- №6: ещё одна проверяемая задача (по №6 у A «уверенно»: ДЗ верно + частично = 0,75).
insert into public.catalog_tasks (id, section_id, is_published, statement_html, answer_html, exam_part) values
  ('a5616000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', true, '<p>log3(x+4)=2</p>', '<p>5</p>', 1);
-- Физика №7: множественный выбор (partial_type), эталон «13» — порядок цифр не важен.
insert into public.catalog_tasks (id, section_id, is_published, statement_html, answer_html, exam_part, partial_type, subject) values
  ('a561f000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', true, '<p>Выберите два утверждения</p>', '<p>13</p>', 1, 'multi_choice', 'Физика');
insert into public.catalog_task_assets (task_id, kind, storage_path, alt, position) values
  ('a5614000-0000-4000-8000-000000000001', 'image', 'math-ege/4/fig.png', 'рисунок', 1);

-- История A по №1.
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, created_at)
select '00000000-0000-4000-8000-0000000000a1', ('a5611000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, i::text, 'correct',
       now() - interval '3 days' + i * interval '1 minute'
  from generate_series(1, 9) i;
insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, created_at)
select '00000000-0000-4000-8000-0000000000a1', ('a5611000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, '999', 'wrong',
       now() - interval '4 days' + i * interval '1 minute'
  from generate_series(10, 18) i;
