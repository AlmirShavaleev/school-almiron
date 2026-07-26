-- СТАТУС: ПРИМЕНЕНО 2026-07-26 через одобренный MCP-процесс.
--   version = 20260726135515
--   name    = topic_material_items_section
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- Рубрика материала темы для быстрых кнопок в модалке темы.
-- NULL = материал без рубрики (добавлен старой формой). Видео живёт в kind='video',
-- ДЗ и тестирование — отдельные системы (topic_homework / topic_tests).
alter table public.topic_material_items
  add column section text
  check (section in ('notes', 'theory', 'tasks', 'solution'));

comment on column public.topic_material_items.section is
  'Рубрика: notes=Конспект, theory=Теория, tasks=Задачи, solution=Решение ДЗ. NULL — без рубрики.';
