-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260730132312
--   name    = catalog_counts_covering_index
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- ============================================================
-- Каталог заданий: покрывающий индекс под счётчики (2026-07-30)
-- ============================================================
-- Владелец: «каталог задач долго подгружает числа... сейчас очень долго всё
-- открывается, то же самое по внутренним вкладкам».
--
-- Замерено на проде через explain (analyze) ДО индекса:
--   get_catalog_direction_counts()                    — 2645 мс
--   get_catalog_section_task_counts_by_source(...)    —  968 мс
--     (из них ~820 мс — Bitmap Heap Scan на catalog_tasks)
--   get_catalog_section_counts(...)                   —   20 мс  (ок)
--   get_catalog_topic_counts_by_source(...)           —   40 мс  (ок)
--
-- Причина: существующий catalog_tasks_subject_idx (subject, exam_type) не
-- покрывает ни is_published, ни id, поэтому планировщик идёт в heap за
-- широкими строками (в catalog_tasks лежит контент задачи) — 1152 heap-блока
-- ради того, чтобы посчитать строки. Счётчику сами данные задачи не нужны:
-- ему нужны только признаки и id.
--
-- Индекс покрывающий: ключ (is_published, subject, exam_type) + INCLUDE (id).
-- Оба запроса становятся Index Only Scan и heap не трогают вовсе:
--   * счётчики направлений — обход префикса is_published = true;
--   * счётчики разделов/тем — равенство по всем трём + id для join'а.
--
-- ПОСЛЕ индекса и vacuum (analyze) — Heap Fetches: 0:
--   get_catalog_direction_counts()                    — 2645 -> 9.7 мс  (×270)
--   get_catalog_section_task_counts_by_source(...)    —  968 -> 15.9 мс (×60)
-- Важно: без VACUUM карта видимости не заполнена и Index Only Scan всё равно
-- лазает в heap (было Heap Fetches: 3143, ~190-260 мс). Поэтому vacuum здесь
-- не косметика, а часть фикса.
--
-- Числа на четырёх карточках лендинга при этом ещё и захардкожены на фронте
-- (решение владельца: «сделай это просто фиксированными числами, чтобы они
-- не подгружались откуда либо») — индекс нужен для ВНУТРЕННИХ вкладок, где
-- захардкодить нельзя: там в счётчик входит личный прогресс ученика
-- (completed_count из catalog_task_progress).

create index if not exists catalog_tasks_counts_covering_idx
  on public.catalog_tasks (is_published, subject, exam_type)
  include (id);

comment on index public.catalog_tasks_counts_covering_idx is
  'Покрывающий индекс для счётчиков каталога (get_catalog_direction_counts, get_catalog_section_task_counts_by_source): даёт Index Only Scan вместо чтения широких строк из heap.';

analyze public.catalog_tasks;

-- VACUUM нельзя выполнить внутри транзакции миграции — прогнан отдельно
-- сразу после применения:
--   vacuum (analyze) public.catalog_tasks;
-- Без него Index Only Scan остаётся с Heap Fetches > 0. Если этот файл
-- когда-нибудь накатывают на чистую базу, прогоните команду вручную.
