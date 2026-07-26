-- ============================================================
-- Материалы переезжают с урока на ТЕМУ
-- ============================================================
-- СТАТУС: ПРИМЕНЕНО 2026-07-26 через одобренный MCP-процесс.
--   version = 20260726062211
--   name    = topic_material_items_repoint_to_topics
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
-- ============================================================
-- Продуктовая модель изменилась: сущности «урок» в пользовательской
-- логике больше нет, материалы висят прямо на теме.
--
-- Не создаём третью параллельную систему. course_lesson_materials уже
-- имеет ровно нужную форму (kind text/video/link/file, title, position,
-- is_visible, storage_path, RLS) и от неё никто не зависит, поэтому
-- переиспользуем её, а не старую topic_materials — там UNIQUE(topic_id, type),
-- нет position и is_visible, и на ней висят 5 файлов фронта, копирование
-- шаблонов уроков и флаги has_notes/has_theory.
--
-- НЕ трогаем: course_lessons (остаётся до отдельной миграции удаления),
-- topic_materials, бакет course-lesson-materials и его политики,
-- catalog_*, homework*, всё остальное.
-- ============================================================

-- 1. Переименование: имя должно отражать модель
alter table public.course_lesson_materials rename to topic_material_items;

comment on table public.topic_material_items is
  'Материалы темы: текст, видео, ссылка или файл. Курс -> тема -> материалы.';

-- 2. Привязка к теме, с переносом существующих строк через урок
alter table public.topic_material_items add column topic_id uuid;

update public.topic_material_items m
   set topic_id = l.topic_id
  from public.course_lessons l
 where l.id = m.lesson_id
   and m.topic_id is null;

-- материал, у урока которого не было темы, переносить некуда — таких быть
-- не должно (course_lessons.topic_id NOT NULL), проверяем явно
do $$
declare orphan int;
begin
  select count(*) into orphan from public.topic_material_items where topic_id is null;
  if orphan > 0 then
    raise exception 'Не удалось перенести % материал(ов): не найдена тема урока', orphan;
  end if;
end $$;

alter table public.topic_material_items alter column topic_id set not null;
alter table public.topic_material_items
  add constraint topic_material_items_topic_id_fkey
  foreign key (topic_id) references public.topics(id) on delete cascade;

comment on column public.topic_material_items.topic_id is
  'Тема, которой принадлежит материал.';

-- lesson_id становится рудиментом: перестаёт быть обязательным и не
-- используется. Колонка и FK на course_lessons убираются отдельной
-- миграцией удаления, вместе с самой course_lessons.
alter table public.topic_material_items alter column lesson_id drop not null;

comment on column public.topic_material_items.lesson_id is
  'РУДИМЕНТ. Не используется в новой модели. Удаляется вместе с course_lessons.';

create index topic_material_items_topic_idx
  on public.topic_material_items(topic_id, position, created_at);

-- 3. RLS: политики переезжают с урока на тему
drop policy if exists course_lesson_materials_staff_all      on public.topic_material_items;
drop policy if exists course_lesson_materials_student_select on public.topic_material_items;

create or replace function public.topic_material_can_manage(p_topic_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.course_is_staff(public.course_of_topic(p_topic_id));
$$;

comment on function public.topic_material_can_manage(uuid) is
  'Может ли текущий пользователь редактировать материалы темы.';

create policy topic_material_items_staff_all on public.topic_material_items
  for all to authenticated
  using      (public.topic_material_can_manage(topic_id))
  with check (public.topic_material_can_manage(topic_id)
              and created_by = auth.uid());

-- ученик: доступ к курсу + topics.available_from — и то и другое уже
-- внутри course_student_can_see_topic
create policy topic_material_items_student_select on public.topic_material_items
  for select to authenticated
  using (is_visible and public.course_student_can_see_topic(topic_id));

-- 4. Storage: отдельный бакет, путь {topic_id}/{файл}
insert into storage.buckets (id, name, public, file_size_limit)
values ('topic-materials', 'topic-materials', false, 52428800)
on conflict (id) do nothing;

create policy topic_material_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'topic-materials'
    and (
      public.topic_material_can_manage(((storage.foldername(name))[1])::uuid)
      or public.course_student_can_see_topic(((storage.foldername(name))[1])::uuid)
    )
  );

create policy topic_material_files_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'topic-materials'
    and public.topic_material_can_manage(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'topic-materials'
    and public.topic_material_can_manage(((storage.foldername(name))[1])::uuid)
  );

-- 5. Гранты по тому же принципу, что в hardening-миграции:
--    PUBLIC/anon закрыты, authenticated — только там, где нужно политикам.
revoke all on function public.topic_material_can_manage(uuid) from public, anon, authenticated;
grant execute on function public.topic_material_can_manage(uuid) to authenticated, service_role;
