-- ============================================================
-- Lesson Library + copy-on-add (draft, not applied)
-- School Almiron
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. Library tables
-- ------------------------------------------------------------

create table if not exists public.lesson_templates (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  subject public.subject_type not null,
  exam_type public.exam_type,
  description text,
  is_shared boolean not null default false, -- future only, inactive in copy guard
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_template_materials (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid not null references public.lesson_templates(id) on delete cascade,
  type text not null check (type in ('notes', 'theory', 'tasks', 'homework', 'solution', 'video', 'link')),
  content text,
  file_path text,
  link_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_template_materials_payload_check check (
    content is not null or file_path is not null or link_url is not null
  )
);

create table if not exists public.lesson_template_tasks (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid not null references public.lesson_templates(id) on delete cascade,
  task_kind text not null check (task_kind in ('homework_template')),
  catalog_task_id uuid,
  title text,
  payload jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.lesson_template_copies (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid not null references public.lesson_templates(id) on delete restrict,
  topic_id uuid not null references public.topics(id) on delete cascade,
  target_group_id uuid not null references public.groups(id) on delete cascade,
  target_course_id uuid not null references public.courses(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. Provenance on copied entities
-- ------------------------------------------------------------

alter table public.topics
  add column if not exists source_template_id uuid references public.lesson_templates(id) on delete set null;

alter table public.homeworks
  add column if not exists source_template_id uuid references public.lesson_templates(id) on delete set null;

alter table public.topic_materials
  add column if not exists source_template_material_id uuid references public.lesson_template_materials(id) on delete set null;

-- ------------------------------------------------------------
-- 3. Staging table for copy orchestration
-- ------------------------------------------------------------

create table if not exists public.lesson_copy_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  template_id uuid not null references public.lesson_templates(id) on delete cascade,
  target_group_id uuid not null references public.groups(id) on delete cascade,
  target_course_id uuid not null references public.courses(id) on delete cascade,
  target_module_id uuid not null references public.modules(id) on delete cascade,
  requested_available_from date,
  requested_order_index integer,
  topic_id uuid references public.topics(id) on delete set null,
  manifest jsonb not null default '{}'::jsonb,
  status text not null default 'staged' check (status in ('staged', 'copied', 'finalized', 'rolled_back', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lesson_templates_owner_created
  on public.lesson_templates(owner_id, created_at desc);

create index if not exists idx_lesson_template_materials_template_sort
  on public.lesson_template_materials(template_id, sort_order, created_at);

create index if not exists idx_lesson_template_tasks_template_sort
  on public.lesson_template_tasks(template_id, sort_order, created_at);

create index if not exists idx_lesson_template_copies_template
  on public.lesson_template_copies(template_id);

create index if not exists idx_lesson_template_copies_target_group_created
  on public.lesson_template_copies(target_group_id, created_at desc);

create index if not exists idx_lesson_copy_jobs_requested_by_created
  on public.lesson_copy_jobs(requested_by, created_at desc);

create index if not exists idx_lesson_copy_jobs_topic
  on public.lesson_copy_jobs(topic_id);

-- ------------------------------------------------------------
-- 3a. Library storage bucket
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('lesson-library', 'lesson-library', false)
on conflict (id) do nothing;

drop trigger if exists lesson_templates_updated_at on public.lesson_templates;
create trigger lesson_templates_updated_at
  before update on public.lesson_templates
  for each row execute function public.update_updated_at();

drop trigger if exists lesson_template_materials_updated_at on public.lesson_template_materials;
create trigger lesson_template_materials_updated_at
  before update on public.lesson_template_materials
  for each row execute function public.update_updated_at();

drop trigger if exists lesson_copy_jobs_updated_at on public.lesson_copy_jobs;
create trigger lesson_copy_jobs_updated_at
  before update on public.lesson_copy_jobs
  for each row execute function public.update_updated_at();

-- ------------------------------------------------------------
-- 4. RLS
-- ------------------------------------------------------------

alter table public.lesson_templates enable row level security;
alter table public.lesson_template_materials enable row level security;
alter table public.lesson_template_tasks enable row level security;
alter table public.lesson_template_copies enable row level security;
alter table public.lesson_copy_jobs enable row level security;

-- ------------------------------------------------------------
-- 4a. Storage RLS for lesson-library
-- ------------------------------------------------------------

drop policy if exists lesson_library_select_own_objects on storage.objects;
create policy "lesson_library_select_own_objects" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'lesson-library'
    and split_part(name, '/', 1) = 'owner'
    and split_part(name, '/', 2) = auth.uid()::text
  );

drop policy if exists lesson_library_insert_own_objects on storage.objects;
create policy "lesson_library_insert_own_objects" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'lesson-library'
    and split_part(name, '/', 1) = 'owner'
    and split_part(name, '/', 2) = auth.uid()::text
  );

drop policy if exists lesson_library_update_own_objects on storage.objects;
create policy "lesson_library_update_own_objects" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'lesson-library'
    and split_part(name, '/', 1) = 'owner'
    and split_part(name, '/', 2) = auth.uid()::text
  )
  with check (
    bucket_id = 'lesson-library'
    and split_part(name, '/', 1) = 'owner'
    and split_part(name, '/', 2) = auth.uid()::text
  );

drop policy if exists lesson_library_delete_own_objects on storage.objects;
create policy "lesson_library_delete_own_objects" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'lesson-library'
    and split_part(name, '/', 1) = 'owner'
    and split_part(name, '/', 2) = auth.uid()::text
  );

-- ------------------------------------------------------------
-- 5. Auth helper functions
-- ------------------------------------------------------------

create or replace function public.auth_can_manage_lesson_template(p_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.lesson_templates lt
    where lt.id = p_template_id
      and lt.owner_id = auth.uid()
  );
$$;

create or replace function public.auth_can_copy_to_group_course(
  p_group_id uuid,
  p_course_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select p.id as profile_id, p.role
    from public.profiles p
    where p.id = auth.uid()
  )
  select exists (
    select 1
    from public.groups g
    left join public.teachers t on t.id = g.teacher_id
    left join public.curators c on c.id = g.curator_id
    cross join me
    where g.id = p_group_id
      and g.course_id = p_course_id
      and (
        me.role in ('admin', 'owner')
        or (me.role = 'teacher' and t.profile_id = me.profile_id)
        or (me.role = 'curator' and c.profile_id = me.profile_id)
      )
  );
$$;

-- ------------------------------------------------------------
-- 6. RLS policies
-- ------------------------------------------------------------

drop policy if exists lesson_templates_select_own on public.lesson_templates;
create policy lesson_templates_select_own on public.lesson_templates
  for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists lesson_templates_insert_own on public.lesson_templates;
create policy lesson_templates_insert_own on public.lesson_templates
  for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists lesson_templates_update_own on public.lesson_templates;
create policy lesson_templates_update_own on public.lesson_templates
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists lesson_templates_delete_own on public.lesson_templates;
create policy lesson_templates_delete_own on public.lesson_templates
  for delete
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists lesson_template_materials_select_own on public.lesson_template_materials;
create policy lesson_template_materials_select_own on public.lesson_template_materials
  for select
  to authenticated
  using (exists (
    select 1
    from public.lesson_templates lt
    where lt.id = lesson_template_materials.template_id
      and lt.owner_id = auth.uid()
  ));

drop policy if exists lesson_template_materials_insert_own on public.lesson_template_materials;
create policy lesson_template_materials_insert_own on public.lesson_template_materials
  for insert
  to authenticated
  with check (exists (
    select 1
    from public.lesson_templates lt
    where lt.id = lesson_template_materials.template_id
      and lt.owner_id = auth.uid()
  ));

drop policy if exists lesson_template_materials_update_own on public.lesson_template_materials;
create policy lesson_template_materials_update_own on public.lesson_template_materials
  for update
  to authenticated
  using (exists (
    select 1
    from public.lesson_templates lt
    where lt.id = lesson_template_materials.template_id
      and lt.owner_id = auth.uid()
  ))
  with check (exists (
    select 1
    from public.lesson_templates lt
    where lt.id = lesson_template_materials.template_id
      and lt.owner_id = auth.uid()
  ));

drop policy if exists lesson_template_materials_delete_own on public.lesson_template_materials;
create policy lesson_template_materials_delete_own on public.lesson_template_materials
  for delete
  to authenticated
  using (exists (
    select 1
    from public.lesson_templates lt
    where lt.id = lesson_template_materials.template_id
      and lt.owner_id = auth.uid()
  ));

drop policy if exists lesson_template_tasks_select_own on public.lesson_template_tasks;
create policy lesson_template_tasks_select_own on public.lesson_template_tasks
  for select
  to authenticated
  using (exists (
    select 1
    from public.lesson_templates lt
    where lt.id = lesson_template_tasks.template_id
      and lt.owner_id = auth.uid()
  ));

drop policy if exists lesson_template_tasks_insert_own on public.lesson_template_tasks;
create policy lesson_template_tasks_insert_own on public.lesson_template_tasks
  for insert
  to authenticated
  with check (exists (
    select 1
    from public.lesson_templates lt
    where lt.id = lesson_template_tasks.template_id
      and lt.owner_id = auth.uid()
  ));

drop policy if exists lesson_template_tasks_update_own on public.lesson_template_tasks;
create policy lesson_template_tasks_update_own on public.lesson_template_tasks
  for update
  to authenticated
  using (exists (
    select 1
    from public.lesson_templates lt
    where lt.id = lesson_template_tasks.template_id
      and lt.owner_id = auth.uid()
  ))
  with check (exists (
    select 1
    from public.lesson_templates lt
    where lt.id = lesson_template_tasks.template_id
      and lt.owner_id = auth.uid()
  ));

drop policy if exists lesson_template_tasks_delete_own on public.lesson_template_tasks;
create policy lesson_template_tasks_delete_own on public.lesson_template_tasks
  for delete
  to authenticated
  using (exists (
    select 1
    from public.lesson_templates lt
    where lt.id = lesson_template_tasks.template_id
      and lt.owner_id = auth.uid()
  ));

drop policy if exists lesson_template_copies_select_owner_or_admin on public.lesson_template_copies;
create policy lesson_template_copies_select_owner_or_admin on public.lesson_template_copies
  for select
  to authenticated
  using (
    created_by = auth.uid()
    or public.is_admin_or_owner()
  );

drop policy if exists lesson_copy_jobs_select_owner_or_admin on public.lesson_copy_jobs;
create policy lesson_copy_jobs_select_owner_or_admin on public.lesson_copy_jobs
  for select
  to authenticated
  using (
    requested_by = auth.uid()
    or public.is_admin_or_owner()
  );

-- No direct insert/update/delete policies for copy tables/jobs from client.
-- They are manipulated only through SECURITY DEFINER RPCs.

-- ------------------------------------------------------------
-- 7. RPC: stage_lesson_copy
-- ------------------------------------------------------------

create or replace function public.stage_lesson_copy(
  p_template_id uuid,
  p_target_group_id uuid,
  p_target_course_id uuid,
  p_target_module_id uuid,
  p_available_from date default null,
  p_order_index integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := auth.uid();
  v_template public.lesson_templates%rowtype;
  v_job_id uuid;
  v_topic_id uuid;
  v_effective_order integer;
  v_manifest jsonb;
begin
  if v_profile_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select *
    into v_template
  from public.lesson_templates
  where id = p_template_id
    and owner_id = v_profile_id;

  if not found then
    raise exception 'TEMPLATE_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if not public.auth_can_copy_to_group_course(p_target_group_id, p_target_course_id) then
    raise exception 'TARGET_GROUP_COURSE_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.modules m
    where m.id = p_target_module_id
      and m.course_id = p_target_course_id
  ) then
    raise exception 'TARGET_MODULE_NOT_IN_TARGET_COURSE';
  end if;

  v_effective_order := coalesce(
    p_order_index,
    (
      select coalesce(max(t.order_index), -1) + 1
      from public.topics t
      where t.module_id = p_target_module_id
    )
  );

  insert into public.topics (
    module_id,
    title,
    order_index,
    max_score,
    available_from,
    source_template_id
  ) values (
    p_target_module_id,
    v_template.title,
    v_effective_order,
    100,
    p_available_from,
    p_template_id
  )
  returning id into v_topic_id;

  v_manifest := jsonb_build_object(
    'job', jsonb_build_object(
      'topic_id', v_topic_id,
      'template_id', p_template_id,
      'target_group_id', p_target_group_id,
      'target_course_id', p_target_course_id,
      'target_module_id', p_target_module_id,
      'available_from', p_available_from,
      'order_index', v_effective_order
    ),
    'template', jsonb_build_object(
      'id', v_template.id,
      'title', v_template.title,
      'subject', v_template.subject,
      'exam_type', v_template.exam_type,
      'description', v_template.description
    ),
    'materials', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'template_material_id', ltm.id,
        'type', ltm.type,
        'content', ltm.content,
        'file_path', ltm.file_path,
        'link_url', ltm.link_url,
        'sort_order', ltm.sort_order,
        'target_file_path',
          case
            when ltm.file_path is null then null
            when ltm.type = 'link' then format('topics/%s/links/%s.link', v_topic_id, gen_random_uuid())
            else format(
              'topics/%s/%s/%s',
              v_topic_id,
              ltm.type,
              regexp_replace(ltm.file_path, '^.*/', '')
            )
          end
      ) order by ltm.sort_order, ltm.created_at), '[]'::jsonb)
      from public.lesson_template_materials ltm
      where ltm.template_id = p_template_id
    ),
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'template_task_id', ltt.id,
        'task_kind', ltt.task_kind,
        'catalog_task_id', ltt.catalog_task_id,
        'title', ltt.title,
        'payload', ltt.payload,
        'sort_order', ltt.sort_order
      ) order by ltt.sort_order, ltt.created_at), '[]'::jsonb)
      from public.lesson_template_tasks ltt
      where ltt.template_id = p_template_id
    )
  );

  insert into public.lesson_copy_jobs (
    requested_by,
    template_id,
    target_group_id,
    target_course_id,
    target_module_id,
    requested_available_from,
    requested_order_index,
    topic_id,
    manifest,
    status
  ) values (
    v_profile_id,
    p_template_id,
    p_target_group_id,
    p_target_course_id,
    p_target_module_id,
    p_available_from,
    v_effective_order,
    v_topic_id,
    v_manifest,
    'staged'
  )
  returning id into v_job_id;

  return jsonb_build_object(
    'job_id', v_job_id,
    'topic_id', v_topic_id,
    'manifest', v_manifest
  );
exception
  when others then
    if v_topic_id is not null then
      delete from public.topics where id = v_topic_id;
    end if;
    raise;
end;
$$;

revoke all on function public.stage_lesson_copy(uuid, uuid, uuid, uuid, date, integer) from public, anon;
grant execute on function public.stage_lesson_copy(uuid, uuid, uuid, uuid, date, integer) to authenticated;

-- ------------------------------------------------------------
-- 8. RPC: finalize_lesson_copy
-- ------------------------------------------------------------

create or replace function public.finalize_lesson_copy(
  p_job_id uuid,
  p_material_results jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := auth.uid();
  v_job public.lesson_copy_jobs%rowtype;
  v_topic_id uuid;
  v_material jsonb;
  v_hw_id uuid;
  v_template_task jsonb;
  v_group_teacher_id uuid;
begin
  if v_profile_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select *
    into v_job
  from public.lesson_copy_jobs
  where id = p_job_id
    and requested_by = v_profile_id;

  if not found then
    raise exception 'COPY_JOB_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if v_job.status <> 'staged' then
    raise exception 'COPY_JOB_INVALID_STATE';
  end if;

  v_topic_id := v_job.topic_id;

  if v_topic_id is null then
    raise exception 'COPY_JOB_TOPIC_MISSING';
  end if;

  select g.teacher_id
    into v_group_teacher_id
  from public.groups g
  where g.id = v_job.target_group_id;

  if v_group_teacher_id is null then
    raise exception 'TARGET_GROUP_TEACHER_REQUIRED';
  end if;

  for v_material in
    select value
    from jsonb_array_elements(coalesce(p_material_results, '[]'::jsonb))
  loop
    insert into public.topic_materials (
      topic_id,
      type,
      content,
      file_url,
      link_url,
      source_template_material_id
    ) values (
      v_topic_id,
      v_material->>'type',
      nullif(v_material->>'content', ''),
      nullif(v_material->>'target_file_path', ''),
      nullif(v_material->>'link_url', ''),
      (v_material->>'template_material_id')::uuid
    );
  end loop;

  for v_template_task in
    select value
    from jsonb_array_elements(coalesce(v_job.manifest->'tasks', '[]'::jsonb))
  loop
    insert into public.homeworks (
      topic_id,
      title,
      description,
      due_date,
      max_score,
      created_by,
      teacher_id,
      is_archived,
      source_template_id
    ) values (
      v_topic_id,
      coalesce(nullif(v_template_task->>'title', ''), (v_job.manifest->'template'->>'title') || ' — ДЗ'),
      null,
      null,
      100,
      v_group_teacher_id,
      v_group_teacher_id,
      false,
      v_job.template_id
    )
    returning id into v_hw_id;

    -- Optional expansion into homework_items from payload.
    insert into public.homework_items (
      homework_id,
      item_type,
      catalog_task_id,
      title,
      content_html,
      resource_url,
      position,
      points,
      required
    )
    select
      v_hw_id,
      coalesce(item->>'item_type', 'text'),
      nullif(item->>'catalog_task_id', '')::uuid,
      item->>'title',
      item->>'content_html',
      item->>'resource_url',
      coalesce((item->>'position')::integer, 0),
      nullif(item->>'points', '')::integer,
      coalesce((item->>'required')::boolean, true)
    from jsonb_array_elements(coalesce(v_template_task->'payload'->'items', '[]'::jsonb)) item;
  end loop;

  insert into public.lesson_template_copies (
    template_id,
    topic_id,
    target_group_id,
    target_course_id,
    created_by
  ) values (
    v_job.template_id,
    v_topic_id,
    v_job.target_group_id,
    v_job.target_course_id,
    v_profile_id
  );

  update public.lesson_copy_jobs
  set status = 'finalized',
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'topic_id', v_topic_id,
    'status', 'finalized'
  );
end;
$$;

revoke all on function public.finalize_lesson_copy(uuid, jsonb) from public, anon;
grant execute on function public.finalize_lesson_copy(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 9. RPC: rollback_lesson_copy
-- ------------------------------------------------------------

create or replace function public.rollback_lesson_copy(
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := auth.uid();
  v_job public.lesson_copy_jobs%rowtype;
begin
  if v_profile_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select *
    into v_job
  from public.lesson_copy_jobs
  where id = p_job_id
    and requested_by = v_profile_id;

  if not found then
    raise exception 'COPY_JOB_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if v_job.topic_id is not null then
    delete from public.topic_materials where topic_id = v_job.topic_id;
    delete from public.homework_items
      where homework_id in (select h.id from public.homeworks h where h.topic_id = v_job.topic_id);
    delete from public.homeworks where topic_id = v_job.topic_id;
    delete from public.lesson_template_copies where topic_id = v_job.topic_id;
    delete from public.topics where id = v_job.topic_id;
  end if;

  update public.lesson_copy_jobs
  set status = 'rolled_back',
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'status', 'rolled_back'
  );
end;
$$;

revoke all on function public.rollback_lesson_copy(uuid) from public, anon;
grant execute on function public.rollback_lesson_copy(uuid) to authenticated;

-- ------------------------------------------------------------
-- 10. DO-verification draft
-- ------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'lesson_templates'
  ) then
    raise exception 'verify failed: lesson_templates missing';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'lesson_copy_jobs'
  ) then
    raise exception 'verify failed: lesson_copy_jobs missing';
  end if;

  if not exists (
    select 1 from pg_proc
    where proname = 'stage_lesson_copy'
  ) then
    raise exception 'verify failed: stage_lesson_copy missing';
  end if;

  if not exists (
    select 1 from pg_proc
    where proname = 'finalize_lesson_copy'
  ) then
    raise exception 'verify failed: finalize_lesson_copy missing';
  end if;

  if not exists (
    select 1 from pg_proc
    where proname = 'rollback_lesson_copy'
  ) then
    raise exception 'verify failed: rollback_lesson_copy missing';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'lesson-library'
  ) then
    raise exception 'verify failed: lesson-library bucket missing';
  end if;
end $$;
