-- §240. Слепок поверх ../mock_exam_lesson_221/00_slice.sql. Основа — 05_slice_234.sql
-- (темы, модули, материалы, помощники прав — дословно из миграций, см. там),
-- БЕЗ урезанных таблиц topic_homework*: их создаёт НАСТОЯЩИЙ файл
-- 20260726073913_topic_homework.sql, дальше run.sh накатывает настоящие файлы
-- с последними определениями того, что меняет §240. Здесь же — заглушки того,
-- что в пробах не проверяется: Storage (buckets/objects), рассылки
-- (notify_homework_submitted пишет в probe_notify; enqueue_reviewed — пусто),
-- и cron.schedule (пишет в cron_probe.job — видно, что задание поставлено).

alter table courses add column is_template boolean not null default false;
alter table courses add column copied_from_course_id uuid references courses(id);
alter table courses add column subject subject_type;
alter table courses add column exam_type exam_type;

create table student_courses (student_id uuid, course_id uuid, status text, expires_at timestamptz);

create table modules (
  id uuid primary key default uuid_generate_v4(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null, order_index int not null default 0,
  source_module_id uuid references modules(id) on delete set null,
  created_at timestamptz not null default now()
);
create table topics (
  id uuid primary key default uuid_generate_v4(),
  module_id uuid not null references modules(id) on delete cascade,
  title text not null, order_index int not null default 0, max_score int,
  is_open boolean, available_from date,
  source_topic_id uuid references topics(id) on delete set null,
  created_at timestamptz not null default now()
);

create type public.course_material_kind as enum ('text', 'video', 'link', 'file');
create table topic_material_items (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  kind public.course_material_kind not null,
  title text, content text, url text, storage_path text, file_name text, mime_type text, size_bytes bigint,
  position int not null default 0, is_visible boolean not null default true,
  section text,
  created_by uuid not null,
  source_item_id uuid references topic_material_items(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table topic_material_items add constraint topic_material_items_section_check
  check (section = any (array['notes', 'theory', 'tasks', 'task_solution', 'worksheet_tasks', 'worksheet_homework', 'solution']::text[]));
create table lesson_template_materials (id uuid primary key default gen_random_uuid(), type text);

create table topic_section_marks (student_id uuid, topic_id uuid, group_key text, marked_at timestamptz default now());
create table topic_test_assignments (id uuid primary key default gen_random_uuid(), test_id uuid, topic_id uuid, assigned_by uuid);
create table test_variants (
  id uuid primary key default gen_random_uuid(), title text, description text, subject subject_type, exam_type exam_type,
  status text, created_by uuid, settings jsonb, tasks_count int, source_type text, topic_id uuid unique,
  updated_at timestamptz default now()
);
create table test_variant_items (
  id uuid primary key default gen_random_uuid(), variant_id uuid references test_variants(id) on delete cascade,
  task_id uuid, position int, section_id uuid, topic_id uuid, points int, grading_type text
);
create table test_variant_assignments (id uuid primary key default gen_random_uuid(), topic_id uuid);
create table test_variant_student_assignments (id uuid primary key default gen_random_uuid(), assignment_id uuid, student_id uuid);
create table test_variant_answers (
  id uuid primary key default gen_random_uuid(), student_assignment_id uuid, variant_item_id uuid,
  closed_by text, last_changed_at timestamptz
);
create table course_study_plan_overrides (topic_id uuid);
create table material_views (profile_id uuid, item_id uuid, topic_id uuid, viewed_on date);

create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;

create or replace function public.auth_student_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select s.id from students s where s.profile_id = auth.uid() limit 1 $$;

create or replace function public.course_of_topic(p_topic_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select m.course_id
    from topics t
    join modules m on m.id = t.module_id
   where t.id = p_topic_id;
$$;

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

create or replace function public.topic_open_now(p_is_open boolean, p_available_from date)
 returns boolean
 language sql
 stable
as $function$
  select coalesce(p_is_open, p_available_from is null or p_available_from <= current_date);
$function$;

create or replace function public.course_student_can_see_topic(p_topic_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
      from topics t
      join modules m on m.id = t.module_id
     where t.id = p_topic_id
       and public.topic_open_now(t.is_open, t.available_from)
       and public.course_student_has_access(m.course_id)
  );
$function$;

create or replace function public.topic_material_can_manage(p_topic_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.course_is_staff(public.course_of_topic(p_topic_id));
$$;

-- Урезанная редакция course_is_teacher_staff: админ, владелец курса,
-- преподаватель группы (кураторы — нет), как в 20260805215100.
create or replace function public.course_is_teacher_staff(p_course_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_course_id is not null and (
    public.course_is_admin()
    or exists (select 1 from courses c where c.id = p_course_id and c.owner_id = auth.uid())
    or exists (select 1 from groups g join teachers t on t.id = g.teacher_id
                where g.course_id = p_course_id and t.profile_id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.topic_material_can_edit(p_topic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.course_is_teacher_staff(public.course_of_topic(p_topic_id));
$function$;

create or replace function public.my_staff_course_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.id from public.courses c where public.course_is_staff(c.id);
$$;

alter table topic_material_items enable row level security;
CREATE POLICY topic_material_items_staff_select ON public.topic_material_items
  FOR SELECT USING (public.topic_material_can_manage(topic_id));
CREATE POLICY topic_material_items_teacher_insert ON public.topic_material_items
  FOR INSERT WITH CHECK (public.topic_material_can_edit(topic_id) AND created_by = auth.uid());
CREATE POLICY topic_material_items_teacher_update ON public.topic_material_items
  FOR UPDATE USING (public.topic_material_can_edit(topic_id))
  WITH CHECK (public.topic_material_can_edit(topic_id) AND created_by = auth.uid());
CREATE POLICY topic_material_items_teacher_delete ON public.topic_material_items
  FOR DELETE USING (public.topic_material_can_edit(topic_id));

-- ── §240: заглушки ──────────────────────────────────────────────────────────
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;

create table public.probe_notify (attempt_id uuid, caller uuid, at timestamptz default now());
grant select on public.probe_notify to authenticated;

create schema cron_probe;
create table cron_probe.job (jobname text primary key, schedule text, command text);
create schema cron;
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language plpgsql as $$
begin
  insert into cron_probe.job values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
  return 1;
end $$;
