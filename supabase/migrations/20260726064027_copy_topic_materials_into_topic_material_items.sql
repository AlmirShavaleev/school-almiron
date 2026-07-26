-- ============================================================
-- Перенос старых topic_materials в новую модель topic_material_items
-- ============================================================
-- СТАТУС: ПРИМЕНЕНО 2026-07-26 через одобренный MCP-процесс.
--   version = 20260726064027
--   name    = copy_topic_materials_into_topic_material_items
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
-- ============================================================
-- Один интерфейс материалов темы. Старая модель — по одной записи на
-- фиксированный тип (UNIQUE(topic_id, type)) — копируется в новую,
-- где материалов может быть сколько угодно, с порядком и скрытием.
--
-- НИЧЕГО НЕ УДАЛЯЕТСЯ: строки topic_materials остаются на месте, чтобы
-- продолжали работать копирование шаблонов уроков (source_template_material_id)
-- и флаги has_notes/has_theory в useStudentCourseProgram.
--
-- Идемпотентность: связь source_topic_material_id + UNIQUE-индекс и
-- ON CONFLICT DO NOTHING. Повторный запуск не создаёт дублей.
-- Индекс НЕ частичный: в Postgres NULL-ы в уникальном индексе не
-- конфликтуют между собой, поэтому обычные материалы это не ограничивает,
-- а ON CONFLICT умеет на него ссылаться.
-- ============================================================

-- 1. Связь со старой записью — она же защита от дублей
alter table public.topic_material_items
  add column if not exists source_topic_material_id uuid
  references public.topic_materials(id) on delete set null;

comment on column public.topic_material_items.source_topic_material_id is
  'Из какой записи topic_materials скопирован материал. UNIQUE — защита от повторного переноса.';

create unique index if not exists topic_material_items_source_uniq
  on public.topic_material_items(source_topic_material_id);

-- 2. Перенос
-- Тип старой записи задаёт только заголовок: в новой модели вид материала
-- определяется тем, что заполнено — content, link_url или file_url.
-- Файлы старой модели лежат в бакете course-materials по пути
-- topics/{topic_id}/{type}/..., поэтому storage_path переносится как есть,
-- а фронт выбирает бакет по префиксу пути (bucketForMaterialPath).
with labelled as (
  select tm.id,
         tm.topic_id,
         tm.content,
         tm.link_url,
         tm.file_url,
         case tm.type
           when 'notes'    then 'Конспект'
           when 'theory'   then 'Теория'
           when 'tasks'    then 'Задачи'
           when 'homework' then 'Домашнее задание'
           when 'solution' then 'Решение'
           when 'video'    then 'Видео'
           when 'link'     then 'Ссылка'
           else tm.type
         end as label,
         case
           when tm.content   is not null and btrim(tm.content)  <> '' then 'text'
           when tm.link_url  is not null and btrim(tm.link_url) <> ''
             then case when tm.type = 'video' then 'video' else 'link' end
           when tm.file_url  is not null and btrim(tm.file_url) <> '' then 'file'
         end as kind,
         -- автор старых записей не хранился: берём владельца курса
         coalesce(
           c.owner_id,
           (select p.id from profiles p where p.role in ('owner', 'admin') order by p.created_at limit 1)
         ) as author,
         -- продолжаем нумерацию с конца уже существующего списка темы
         coalesce((select max(i.position) + 1 from topic_material_items i where i.topic_id = tm.topic_id), 0)
           + row_number() over (partition by tm.topic_id order by tm.updated_at, tm.id) - 1 as pos
    from topic_materials tm
    join topics t  on t.id = tm.topic_id
    join modules m on m.id = t.module_id
    join courses c on c.id = m.course_id
)
insert into public.topic_material_items
  (topic_id, kind, title, content, url, storage_path, file_name,
   position, is_visible, created_by, source_topic_material_id)
select l.topic_id,
       l.kind::public.course_material_kind,
       l.label,
       case when l.kind = 'text' then l.content end,
       case when l.kind in ('link', 'video') then l.link_url end,
       case when l.kind = 'file' then l.file_url end,
       case when l.kind = 'file' then regexp_replace(l.file_url, '^.*/', '') end,
       l.pos,
       true,
       l.author,
       l.id
  from labelled l
 where l.kind is not null
   and l.author is not null
on conflict (source_topic_material_id) do nothing;
