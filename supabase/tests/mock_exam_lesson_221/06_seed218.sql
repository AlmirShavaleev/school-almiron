-- §218. Шаблон пробника: ЕГЭ, математика, профиль — ДАННЫЕ, не схема.
--
-- НЕ МИГРАЦИЯ: в schema_migrations не попадает, ничего не создаёт.
-- Запускается руками ПОСЛЕ PENDING_218.sql (нужна таблица
-- mock_exam_templates).
--
-- Раскладка подтверждена владельцем 25.09 (карточка 070): 19 заданий,
-- первая часть — №1–12 по одному баллу, вторая: №13 — 2, №14 — 3, №15 — 2,
-- №16 — 2, №17 — 3, №18 — 4, №19 — 4. Всего 12 + 20 = 32 первичных.
--
-- Таблица перевода НЕ заполняется намеренно: её вносит владелец, официальную,
-- на экране шаблона (вставкой столбца из Excel). До этого тестовый балл
-- пробника равен первичному; после — все пробники этого шаблона
-- пересчитываются сами (триггер mock_exam_templates_rescore).
--
-- Год — 2027: год ЭКЗАМЕНА, к которому готовит учебный год 2026/27, а не
-- год, когда шаблон завели. Если владелец считает иначе — поле year правится
-- на экране шаблона, на баллы оно не влияет.
--
-- Физику не заводим: раскладку даст владелец.
--
-- Идемпотентно: повторный прогон ничего не меняет (on conflict do nothing по
-- уникальности subject + exam_type + year + title) и введённую позже таблицу
-- перевода не перетирает.

-- Шаг А. Посмотреть, нет ли уже такого шаблона.
select id, title, year, array_length(max_points, 1) as tasks,
       (select sum(m) from unnest(max_points) m) as max_primary,
       part1_last, score_scale is not null as has_scale
  from public.mock_exam_templates
 where subject = 'math' and exam_type = 'ege';

-- Шаг Б. Завести.
insert into public.mock_exam_templates (subject, exam_type, year, title, max_points, part1_last, score_scale)
values (
  'math', 'ege', 2027,
  'ЕГЭ математика, профиль',
  array[1,1,1,1,1,1,1,1,1,1,1,1, 2,3,2,2,3,4,4]::smallint[],
  12,
  null
)
on conflict on constraint mock_exam_templates_unique do nothing;

-- Шаг В. Проверить: 19 заданий, 32 первичных, первая часть 12, таблицы нет.
select title, year, array_length(max_points, 1) as tasks,
       (select sum(m) from unnest(max_points) m) as max_primary,
       part1_last, score_scale
  from public.mock_exam_templates
 where subject = 'math' and exam_type = 'ege' and year = 2027;
--   ожидание: ЕГЭ математика, профиль | 2027 | 19 | 32 | 12 | null
