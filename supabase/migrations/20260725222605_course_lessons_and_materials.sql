-- ============================================================
-- ЭТАП 1 MVP: уроки курса и их материалы
-- Проект: School (kthfozyfruorwjhvvsbw)
-- ============================================================
-- СТАТУС: ПРИМЕНЕНО 2026-07-25 через одобренный MCP-процесс.
--   version = 20260725222605
--   name    = course_lessons_and_materials
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
-- Если SQL нужно изменить — новая миграция с новой версией.
-- ============================================================
-- Только CREATE. Ни одного DROP существующих объектов.
-- Не трогает: lessons, homework*, test_variant*, task_collections, catalog_*.
--
-- Конвенция: автор -> profiles(id) == auth.uid(); ученик -> students(id).
-- ============================================================

-- Транзакцией управляет процесс применения (MCP apply_migration) — явный begin/commit не нужен.

-- ============================================================
-- 1. Технический модуль «Основной»
-- ============================================================
-- topics.module_id — NOT NULL, поэтому уровень модулей нельзя убрать.
-- Прячем его: у курса есть ровно один модуль «Основной», UI его не показывает.

create or replace function public.course_default_module(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_module_id uuid;
begin
  -- берём первый существующий модуль курса, если он есть
  select id into v_module_id
    from modules
   where course_id = p_course_id
   order by order_index, created_at
   limit 1;

  if v_module_id is not null then
    return v_module_id;
  end if;

  insert into modules (course_id, title, order_index)
  values (p_course_id, 'Основной', 0)
  returning id into v_module_id;

  return v_module_id;
end $$;

comment on function public.course_default_module(uuid) is
  'Возвращает технический модуль курса, создавая его при необходимости. UI уровень модулей не показывает.';

-- новый курс сразу получает модуль
create or replace function public.course_ensure_default_module()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.course_default_module(new.id);
  return new;
end $$;

create trigger courses_default_module
  after insert on public.courses
  for each row execute function public.course_ensure_default_module();

-- бэкфилл для уже существующих курсов без модулей (идемпотентно)
insert into public.modules (course_id, title, order_index)
select c.id, 'Основной', 0
  from public.courses c
 where not exists (select 1 from public.modules m where m.course_id = c.id);

-- ============================================================
-- 2. Уроки курса
-- ============================================================
-- ВНИМАНИЕ: это НЕ public.lessons. Та таблица — расписание занятий
-- (scheduled_at NOT NULL, group_id, zoom_link) и остаётся нетронутой
-- до возврата расписания. Здесь — единица содержания курса.

create table public.course_lessons (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid not null references public.topics(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 300),
  summary      text check (length(summary) <= 5000),
  position     integer not null default 0 check (position >= 0),
  is_published boolean not null default false,
  created_by   uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.course_lessons is
  'Урок как единица содержания курса: курс -> тема -> урок. Не имеет даты и не привязан к группе.';
comment on column public.course_lessons.is_published is
  'Черновик виден только персоналу курса.';
comment on column public.course_lessons.position is
  'Порядок урока внутри темы.';

create index course_lessons_topic_idx   on public.course_lessons(topic_id, position, created_at);
create index course_lessons_author_idx  on public.course_lessons(created_by);

-- ============================================================
-- 3. Материалы урока
-- ============================================================
create type public.course_material_kind as enum ('text', 'video', 'link', 'file');

create table public.course_lesson_materials (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.course_lessons(id) on delete cascade,
  kind         public.course_material_kind not null,
  title        text check (length(btrim(title)) between 1 and 300),

  content      text check (length(content) <= 100000),  -- kind = text
  url          text check (length(url) <= 2000),        -- kind = video | link

  storage_path text,                                    -- kind = file
  file_name    text,
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0),

  position     integer not null default 0 check (position >= 0),
  is_visible   boolean not null default true,
  created_by   uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- ровно одна полезная нагрузка на материал, соответствующая его типу
  constraint course_lesson_materials_payload_chk check (
    case kind
      when 'text' then content is not null and btrim(content) <> ''
                       and url is null and storage_path is null
      when 'video' then url is not null and btrim(url) <> ''
                       and content is null and storage_path is null
      when 'link'  then url is not null and btrim(url) <> ''
                       and content is null and storage_path is null
      when 'file'  then storage_path is not null and btrim(storage_path) <> ''
                       and content is null and url is null
    end
  ),
  -- ссылки только http(s): защита от javascript: и data: в поле url
  constraint course_lesson_materials_url_chk check (
    url is null or url ~* '^https?://'
  )
);

comment on table public.course_lesson_materials is
  'Материалы урока: текст, видео, ссылка или файл. Тип задаёт, какое поле заполнено.';
comment on column public.course_lesson_materials.is_visible is
  'Материал можно скрыть от учеников, не удаляя.';

create unique index course_lesson_materials_path_uniq
  on public.course_lesson_materials(storage_path) where storage_path is not null;
create index course_lesson_materials_lesson_idx
  on public.course_lesson_materials(lesson_id, position, created_at);

-- ============================================================
-- 4. updated_at
-- ============================================================
create or replace function public.course_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger course_lessons_touch
  before update on public.course_lessons
  for each row execute function public.course_touch_updated_at();

create trigger course_lesson_materials_touch
  before update on public.course_lesson_materials
  for each row execute function public.course_touch_updated_at();

-- ============================================================
-- 5. Хелперы доступа
-- ============================================================
-- Все SECURITY DEFINER + фиксированный search_path: политики не рекурсируют
-- и не обходятся через подмену search_path.

-- курс, которому принадлежит тема
create or replace function public.course_of_topic(p_topic_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select m.course_id
    from topics t
    join modules m on m.id = t.module_id
   where t.id = p_topic_id;
$$;

create or replace function public.course_is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid() and p.role in ('admin', 'owner')
  );
$$;

-- персонал курса: владелец курса, преподаватель или куратор любой его группы, админ
create or replace function public.course_is_staff(p_course_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_course_id is not null and (
    public.course_is_admin()
    or exists (select 1 from courses c
                where c.id = p_course_id and c.owner_id = auth.uid())
    or exists (select 1 from groups g
                join teachers t on t.id = g.teacher_id
               where g.course_id = p_course_id and t.profile_id = auth.uid())
    or exists (select 1 from groups g
                join curators cu on cu.id = g.curator_id
               where g.course_id = p_course_id and cu.profile_id = auth.uid())
  );
$$;

-- доступ ученика к курсу.
-- Путь 1 — группа: единственный живой способ в этой базе.
-- Путь 2 — прямая запись: student_courses сегодня пуста, ветка no-op,
--          но без неё прямые зачисления молча не заработают.
create or replace function public.course_student_has_access(p_course_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_course_id is not null and (
    exists (select 1 from group_students gs
              join groups g on g.id = gs.group_id
             where gs.student_id = public.auth_student_id()
               and g.course_id = p_course_id)
    or exists (select 1 from student_courses sc
                where sc.student_id = public.auth_student_id()
                  and sc.course_id = p_course_id
                  and sc.status in ('active', 'trial')
                  and (sc.expires_at is null or sc.expires_at > now()))
  );
$$;

-- ученик видит тему: есть доступ к курсу и тема уже открыта
create or replace function public.course_student_can_see_topic(p_topic_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from topics t
      join modules m on m.id = t.module_id
     where t.id = p_topic_id
       and (t.available_from is null or t.available_from <= current_date)
       and public.course_student_has_access(m.course_id)
  );
$$;

-- ученик видит урок: тема открыта и урок опубликован
create or replace function public.course_student_can_see_lesson(p_lesson_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from course_lessons l
     where l.id = p_lesson_id
       and l.is_published
       and public.course_student_can_see_topic(l.topic_id)
  );
$$;

create or replace function public.course_is_lesson_staff(p_lesson_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from course_lessons l
     where l.id = p_lesson_id
       and public.course_is_staff(public.course_of_topic(l.topic_id))
  );
$$;

-- ============================================================
-- 6. RLS
-- ============================================================
alter table public.course_lessons          enable row level security;
alter table public.course_lesson_materials enable row level security;

grant select, insert, update, delete on public.course_lessons          to authenticated;
grant select, insert, update, delete on public.course_lesson_materials to authenticated;

-- ---------- course_lessons ----------
create policy course_lessons_staff_all on public.course_lessons
  for all to authenticated
  using      (public.course_is_staff(public.course_of_topic(topic_id)))
  with check (public.course_is_staff(public.course_of_topic(topic_id))
              and created_by = auth.uid());

create policy course_lessons_student_select on public.course_lessons
  for select to authenticated
  using (is_published and public.course_student_can_see_topic(topic_id));

-- ---------- course_lesson_materials ----------
create policy course_lesson_materials_staff_all on public.course_lesson_materials
  for all to authenticated
  using      (public.course_is_lesson_staff(lesson_id))
  with check (public.course_is_lesson_staff(lesson_id)
              and created_by = auth.uid());

create policy course_lesson_materials_student_select on public.course_lesson_materials
  for select to authenticated
  using (is_visible and public.course_student_can_see_lesson(lesson_id));

-- ============================================================
-- 7. Storage
-- ============================================================
-- Отдельный бакет, чтобы не пересекаться с политиками старого
-- lesson_materials на бакете lesson-materials.
-- Конвенция пути: {lesson_id}/{имя файла}

insert into storage.buckets (id, name, public, file_size_limit)
values ('course-lesson-materials', 'course-lesson-materials', false, 52428800)
on conflict (id) do nothing;

create policy course_lesson_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'course-lesson-materials'
    and (
      public.course_is_lesson_staff(((storage.foldername(name))[1])::uuid)
      or public.course_student_can_see_lesson(((storage.foldername(name))[1])::uuid)
    )
  );

create policy course_lesson_files_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'course-lesson-materials'
    and public.course_is_lesson_staff(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'course-lesson-materials'
    and public.course_is_lesson_staff(((storage.foldername(name))[1])::uuid)
  );

-- ============================================================
-- 8. Чтение урока целиком
-- ============================================================
create or replace function public.course_lesson_view(p_lesson_id uuid)
returns table (
  lesson_id    uuid,
  title        text,
  summary      text,
  is_published boolean,
  material_id  uuid,
  kind         public.course_material_kind,
  material_title text,
  content      text,
  url          text,
  storage_path text,
  file_name    text,
  -- не `position`: это ключевое слово SQL, в RETURNS TABLE не проходит
  material_position integer
)
language sql stable security invoker set search_path = public, pg_temp
as $$
  select l.id, l.title, l.summary, l.is_published,
         m.id, m.kind, m.title, m.content, m.url, m.storage_path, m.file_name, m.position
    from course_lessons l
    left join course_lesson_materials m on m.lesson_id = l.id
   where l.id = p_lesson_id
   order by m.position, m.created_at;
$$;

comment on function public.course_lesson_view(uuid) is
  'Урок с материалами одним запросом. SECURITY INVOKER — видимость определяет RLS.';

grant execute on function public.course_default_module(uuid)          to authenticated;
grant execute on function public.course_lesson_view(uuid)             to authenticated;
grant execute on function public.course_student_can_see_lesson(uuid)  to authenticated;
grant execute on function public.course_is_lesson_staff(uuid)         to authenticated;

-- конец миграции
