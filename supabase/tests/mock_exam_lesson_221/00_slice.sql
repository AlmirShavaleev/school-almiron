-- Уменьшенный слепок схемы для проб §218. Редакции помощников и политик
-- mock_exams / mock_exam_results — дословно из supabase/migrations
-- (_legacy/002_rls.sql; course_is_admin — 20260725222605; course_is_staff —
-- 20260727203959). groups / group_students без RLS: их политики здесь не
-- проверяются.
create extension if not exists "uuid-ossp";
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon;

create type user_role as enum ('student', 'parent', 'teacher', 'curator', 'admin', 'owner');
create type subject_type as enum ('physics', 'math');
create type exam_type as enum ('ege', 'oge');

create table profiles (id uuid primary key, full_name text, role user_role not null default 'student');
create table teachers (id uuid primary key default uuid_generate_v4(), profile_id uuid references profiles(id));
create table curators (id uuid primary key default uuid_generate_v4(), profile_id uuid references profiles(id));
create table students (id uuid primary key default uuid_generate_v4(), profile_id uuid references profiles(id));
create table courses (id uuid primary key default uuid_generate_v4(), title text, owner_id uuid);
create table groups (id uuid primary key default uuid_generate_v4(), name text, course_id uuid references courses(id), teacher_id uuid references teachers(id), curator_id uuid references curators(id));
create table group_students (group_id uuid references groups(id), student_id uuid references students(id), primary key (group_id, student_id));
create table course_curators (course_id uuid references courses(id), profile_id uuid references profiles(id));

create table mock_exams (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  subject subject_type not null,
  exam_type exam_type not null,
  group_id uuid references groups(id) on delete set null,
  date timestamptz not null,
  max_score integer not null default 100,
  created_by uuid references teachers(id),
  created_at timestamptz not null default now()
);
create table mock_exam_results (
  id uuid primary key default uuid_generate_v4(),
  mock_exam_id uuid not null references mock_exams(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  score integer not null,
  part1_score integer,
  part2_score integer,
  notes text,
  created_at timestamptz not null default now(),
  unique(mock_exam_id, student_id)
);
grant select, insert, update, delete on all tables in schema public to authenticated;

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

alter table mock_exams enable row level security;
alter table mock_exam_results enable row level security;
create table parents (id uuid primary key default uuid_generate_v4(), profile_id uuid);
create table parent_students (parent_id uuid, student_id uuid);
grant select on parents, parent_students to authenticated;

create policy "mock_exams_select" on mock_exams
  for select using (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator') or
    exists (
      select 1 from group_students gs join students s on s.id = gs.student_id
      where gs.group_id = mock_exams.group_id and s.profile_id = auth.uid()
    )
  );
create policy "mock_exams_manage" on mock_exams
  for all using (is_admin_or_owner() or get_my_role() = 'teacher');
create policy "mock_exam_results_select" on mock_exam_results
  for select using (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator') or
    exists (select 1 from students s where s.id = mock_exam_results.student_id and s.profile_id = auth.uid()) or
    exists (
      select 1 from parent_students ps join parents p on p.id = ps.parent_id
      where ps.student_id = mock_exam_results.student_id and p.profile_id = auth.uid()
    )
  );
create policy "mock_exam_results_manage" on mock_exam_results
  for all using (is_admin_or_owner() or get_my_role() = 'teacher');
