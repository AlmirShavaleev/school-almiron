-- §255. Добавка к слепку §254 (../glavnaya_254/00_slice_254.sql) — то, что читают функции §255 (миграции 20261002152136…153604).
-- Колонки и таблицы — подмножество настоящих:
--   courses.subject/exam_type/owner_id и enum-ы — src/types/database.ts;
--   topics.ege_task_numbers, student_subject_targets + политики — 20260925182457 (ДОСЛОВНО политики);
--   mock_exam_templates, mock_exams.template_id/subject/exam_type/group_id — 20260925201156;
--   topic_test_assignments(test_id, topic_id) + topic_test_attempts.assignment_id (тема теста — через назначение,
--   у topic_tests своей topic_id НЕТ — сверено оркестратором с продом 02.10), topic_test_items.task_id/max_points — 20260726130727;
--   catalog_sections / catalog_tasks — src/types/database.ts;
--   teachers / curators / course_curators, groups.teacher_id/curator_id;
--   course_is_staff — 20260727203959 (дословно), course_is_admin — 20260725222605,
--   auth_is_staff_of_student — 20260730213917, is_admin_or_owner/get_my_role — _legacy/002_rls,
--   auth_student_id — как в слепке kontrolnaya_240.
create type public.subject_type as enum ('physics', 'math', 'algebra', 'geometry', 'probability_statistics');
create type public.exam_type as enum ('ege', 'oge');

alter table public.courses add column subject public.subject_type, add column exam_type public.exam_type, add column owner_id uuid;
alter table public.topics add column ege_task_numbers smallint[] not null default '{}'::smallint[];

create table public.teachers (id uuid primary key default gen_random_uuid(), profile_id uuid references public.profiles(id));
create table public.curators (id uuid primary key default gen_random_uuid(), profile_id uuid references public.profiles(id));
create table public.course_curators (course_id uuid references public.courses(id), profile_id uuid references public.profiles(id));
alter table public.groups add column teacher_id uuid references public.teachers(id), add column curator_id uuid references public.curators(id);

create table public.mock_exam_templates (
  id uuid primary key default gen_random_uuid(), subject public.subject_type not null, exam_type public.exam_type not null,
  year smallint not null, title text not null, max_points smallint[] not null, part1_last smallint not null, score_scale smallint[]
);
alter table public.mock_exams add column subject public.subject_type, add column exam_type public.exam_type,
  add column template_id uuid references public.mock_exam_templates(id), add column group_id uuid references public.groups(id);

create table public.topic_test_assignments (
  id uuid primary key default gen_random_uuid(), test_id uuid not null references public.topic_tests(id),
  topic_id uuid not null references public.topics(id)
);
alter table public.topic_test_attempts add column assignment_id uuid references public.topic_test_assignments(id);
create table public.catalog_sections (
  id uuid primary key default gen_random_uuid(), subject text not null, exam_type text not null, exam_number int,
  title text not null, position int not null default 0, is_published boolean not null default true
);
create table public.catalog_tasks (
  id uuid primary key default gen_random_uuid(), section_id uuid not null references public.catalog_sections(id),
  is_published boolean not null default true
);
alter table public.topic_test_items add column task_id uuid references public.catalog_tasks(id), add column max_points smallint not null default 1;

-- ── права (как на проде) ──────────────────────────────────────────────────
create or replace function get_my_role()
returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable;
create or replace function is_admin_or_owner()
returns boolean as $$
  select get_my_role() in ('admin', 'owner');
$$ language sql security definer stable;
create or replace function public.course_is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid() and p.role in ('admin', 'owner')
  );
$$;
create or replace function public.course_is_staff(p_course_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
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
    or exists (select 1 from course_curators cc
                where cc.course_id = p_course_id and cc.profile_id = auth.uid())
  );
$$;
create or replace function public.auth_is_staff_of_student(stu_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from group_students gs
      join groups g on g.id = gs.group_id
    where gs.student_id = stu_id
      and public.course_is_staff(g.course_id)
  )
$$;
create or replace function public.auth_student_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select s.id from students s where s.profile_id = auth.uid() limit 1 $$;

-- ── student_subject_targets: таблица и политики ДОСЛОВНО из 20260925182457 ─
create table if not exists public.student_subject_targets (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.students(id) on delete cascade,
  subject      public.subject_type not null,
  exam_type    public.exam_type    not null,
  target_score smallint not null check (target_score between 0 and 100),
  updated_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint student_subject_targets_unique unique (student_id, subject, exam_type)
);
alter table public.student_subject_targets enable row level security;
grant select, insert, update, delete on public.student_subject_targets to authenticated;
create policy student_subject_targets_select
  on public.student_subject_targets
  for select to authenticated
  using (
    public.is_admin_or_owner()
    or public.auth_is_staff_of_student(student_id)
    or student_id = public.auth_student_id()
  );
create policy student_subject_targets_staff_insert
  on public.student_subject_targets
  for insert to authenticated
  with check (
    (public.is_admin_or_owner() or public.auth_is_staff_of_student(student_id))
    and updated_by = auth.uid()
  );
create policy student_subject_targets_staff_update
  on public.student_subject_targets
  for update to authenticated
  using (
    public.is_admin_or_owner()
    or public.auth_is_staff_of_student(student_id)
  )
  with check (
    (public.is_admin_or_owner() or public.auth_is_staff_of_student(student_id))
    and updated_by = auth.uid()
  );
create policy student_subject_targets_staff_delete
  on public.student_subject_targets
  for delete to authenticated
  using (
    public.is_admin_or_owner()
    or public.auth_is_staff_of_student(student_id)
  );

-- Таблицы-источники: RLS включена (ученику напрямую — только политики, которых тут нет).
alter table public.mock_exams enable row level security;
alter table public.catalog_sections enable row level security;
alter table public.catalog_tasks enable row level security;

-- Как у Supabase: новые таблицы в public получают ВСЕ права anon/authenticated
-- (слепок §254 эмулирует только select). Тогда revoke в миграции §255 обязан
-- сработать по-настоящему, иначе проба «ученик пишет цель напрямую» покажет дыру.
alter default privileges in schema public grant all on tables to anon, authenticated;
