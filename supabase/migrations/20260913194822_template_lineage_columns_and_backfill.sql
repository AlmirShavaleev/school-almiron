-- Линейка происхождения: «эта строка класса — отражение вот той строки шаблона».
--
-- Владелец работает так: материал и задачи кладутся в курс-каркас, а классы —
-- его отражения плюс своё. Платформа этого не умела: копия курса была снимком
-- на момент копирования, и всё, что добавлялось в шаблон потом, оставалось в
-- шаблоне. 13.09 так потерялись 10 задач по «Кинематике» и шесть видео по
-- математике.
--
-- Связи в базе не было вовсе. Переиспользовать было нечего: `source_template_id`
-- у тем смотрит на `lesson_templates`, `source_topic_material_id` у материалов —
-- на мёртвую `topic_materials` (0 строк) и вдобавок несёт уникальный индекс,
-- который запрещает одной строке отразиться в трёх классах. Поэтому новые
-- столбцы, а старые не трогаем.
--
-- Уникальных индексов на новые столбцы нет намеренно: одна строка шаблона
-- отражается во ВСЕХ копиях курса.

alter table public.modules
  add column if not exists source_module_id uuid references public.modules(id) on delete set null;

alter table public.topics
  add column if not exists source_topic_id uuid references public.topics(id) on delete set null;

alter table public.topic_material_items
  add column if not exists source_item_id uuid references public.topic_material_items(id) on delete set null;

alter table public.topic_homework
  add column if not exists source_homework_id uuid references public.topic_homework(id) on delete set null;

alter table public.topic_homework_files
  add column if not exists source_file_id uuid references public.topic_homework_files(id) on delete set null;

comment on column public.modules.source_module_id            is 'Модуль-источник в курсе-каркасе. §172';
comment on column public.topics.source_topic_id              is 'Тема-источник в курсе-каркасе. §172';
comment on column public.topic_material_items.source_item_id is 'Материал-источник в курсе-каркасе. §172';
comment on column public.topic_homework.source_homework_id   is 'ДЗ-источник в курсе-каркасе. §172';
comment on column public.topic_homework_files.source_file_id is 'Файл ДЗ-источник в курсе-каркасе. §172';

create index if not exists modules_source_module_idx             on public.modules (source_module_id);
create index if not exists topics_source_topic_idx               on public.topics (source_topic_id);
create index if not exists topic_material_items_source_item_idx  on public.topic_material_items (source_item_id);
create index if not exists topic_homework_source_homework_idx    on public.topic_homework (source_homework_id);
create index if not exists topic_homework_files_source_file_idx  on public.topic_homework_files (source_file_id);

-- ── Заполнение линейки задним числом ────────────────────────────────────────
--
-- Семь копий сделаны до появления линейки. Сопоставляем по четвёрке
-- (модуль: название и порядок; тема: название и порядок) — на проде это даёт
-- 100 % и ни одной двусмысленности, проверено запросом перед миграцией.
-- Сопоставление по одним названиям давало 2–4 двусмысленности на курс, поэтому
-- порядок обязателен.
--
-- Ничего не удаляется и не вставляется: только update пустых столбцов.

-- Модули: по (название, порядок). Лишние модули класса (у 11А их 14 против 13)
-- остаются без источника — это своё, и синхронизация их не трогает.
update public.modules cm
   set source_module_id = tm.id
  from public.courses c
  join public.modules tm on tm.course_id = c.copied_from_course_id
 where cm.course_id = c.id
   and c.copied_from_course_id is not null
   and cm.source_module_id is null
   and tm.title = cm.title
   and tm.order_index = cm.order_index;

update public.topics ct
   set source_topic_id = tt.id
  from public.modules cm
  join public.modules tm on tm.id = cm.source_module_id
  join public.topics tt on tt.module_id = tm.id
 where ct.module_id = cm.id
   and ct.source_topic_id is null
   and tt.title = ct.title
   and tt.order_index = ct.order_index;

-- Материалы: внутри пары тем по (вид, адрес/путь/текст) и позиции.
update public.topic_material_items ci
   set source_item_id = ti.id
  from public.topics ct
  join public.topics tt on tt.id = ct.source_topic_id
  join public.topic_material_items ti on ti.topic_id = tt.id
 where ci.topic_id = ct.id
   and ci.source_item_id is null
   and ti.kind = ci.kind
   and coalesce(ti.storage_path, ti.url, ti.content) is not distinct from
       coalesce(ci.storage_path, ci.url, ci.content)
   and ti.position = ci.position;

-- Тот же ключ без позиции — для тем, где материал один, а позиции разъехались.
update public.topic_material_items ci
   set source_item_id = ti.id
  from public.topics ct
  join public.topics tt on tt.id = ct.source_topic_id
  join public.topic_material_items ti on ti.topic_id = tt.id
 where ci.topic_id = ct.id
   and ci.source_item_id is null
   and ti.kind = ci.kind
   and coalesce(ti.storage_path, ti.url, ti.content) is not distinct from
       coalesce(ci.storage_path, ci.url, ci.content)
   and not exists (
     select 1 from public.topic_material_items ci2
      where ci2.source_item_id = ti.id and ci2.topic_id = ci.topic_id
   );

-- Запасной ключ для «Физика ЕГЭ 11А класс»: курс скопирован до §101, файлы были
-- перезалиты под другими путями, и 77 строк по пути не совпадают. Имя, размер и
-- позиция их опознают — проверено ровно на этих 77.
update public.topic_material_items ci
   set source_item_id = ti.id
  from public.topics ct
  join public.topics tt on tt.id = ct.source_topic_id
  join public.topic_material_items ti on ti.topic_id = tt.id
 where ci.topic_id = ct.id
   and ci.source_item_id is null
   and ti.kind = ci.kind
   and ti.file_name is not distinct from ci.file_name
   and ti.size_bytes is not distinct from ci.size_bytes
   and ti.position = ci.position
   and not exists (
     select 1 from public.topic_material_items ci2
      where ci2.source_item_id = ti.id and ci2.topic_id = ci.topic_id
   );

-- ДЗ: у темы оно одно, поэтому связь однозначна парой тем.
update public.topic_homework ch
   set source_homework_id = th.id
  from public.topics ct
  join public.topics tt on tt.id = ct.source_topic_id
  join public.topic_homework th on th.topic_id = tt.id
 where ch.topic_id = ct.id
   and ch.source_homework_id is null;

update public.topic_homework_files cf
   set source_file_id = tf.id
  from public.topic_homework ch
  join public.topic_homework th on th.id = ch.source_homework_id
  join public.topic_homework_files tf on tf.homework_id = th.id
 where cf.homework_id = ch.id
   and cf.source_file_id is null
   and tf.storage_path is not distinct from cf.storage_path
   and tf.position = cf.position;
