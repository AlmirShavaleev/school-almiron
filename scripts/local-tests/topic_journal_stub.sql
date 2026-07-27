-- Заглушки боевой схемы для локальной проверки get_student_topic_journal.
-- Повторяют только то, чего касается функция: минимум колонок, те же имена
-- и те же вспомогательные функции доступа (auth.uid, is_admin_or_owner,
-- auth_is_teacher_of_group), чтобы поведенческие тесты ролями были честными.

create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$ begin
  create type topic_homework_attempt_status as enum ('draft','submitted','returned_for_revision','accepted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type topic_homework_review_decision as enum ('accepted','returned_for_revision');
exception when duplicate_object then null; end $$;

do $$ begin
  create type topic_test_attempt_status as enum ('in_progress','completed');
exception when duplicate_object then null; end $$;

create table profiles (
  id uuid primary key,
  full_name text,
  role text not null
);

create table teachers (id uuid primary key, profile_id uuid references profiles(id));
create table curators (id uuid primary key, profile_id uuid references profiles(id));

create table students (
  id uuid primary key,
  profile_id uuid references profiles(id),
  full_name text
);

create table courses (
  id uuid primary key,
  title text not null,
  owner_id uuid
);

create table groups (
  id uuid primary key,
  name text,
  course_id uuid references courses(id),
  teacher_id uuid references teachers(id),
  curator_id uuid references curators(id)
);

create table group_students (
  group_id uuid references groups(id),
  student_id uuid references students(id),
  primary key (group_id, student_id)
);

create table modules (
  id uuid primary key,
  course_id uuid references courses(id),
  title text,
  order_index int not null default 0
);

create table topics (
  id uuid primary key,
  module_id uuid references modules(id),
  title text,
  order_index int not null default 0,
  available_from date
);

create table topic_homework (
  id uuid primary key,
  topic_id uuid references topics(id),
  title text not null,
  is_published boolean not null default true,
  due_at date,
  grade_scale text
);

create table topic_homework_attempts (
  id uuid primary key,
  homework_id uuid references topic_homework(id),
  student_id uuid references students(id),
  attempt_number int not null,
  status topic_homework_attempt_status not null,
  submitted_at timestamptz
);

create table topic_homework_reviews (
  id uuid primary key,
  attempt_id uuid references topic_homework_attempts(id),
  reviewer_id uuid,
  decision topic_homework_review_decision not null,
  comment text,
  score int,
  created_at timestamptz not null default now()
);

create table topic_tests (
  id uuid primary key,
  title text not null
);

create table topic_test_assignments (
  id uuid primary key,
  test_id uuid references topic_tests(id),
  topic_id uuid references topics(id)
);

create table topic_test_attempts (
  id uuid primary key,
  assignment_id uuid references topic_test_assignments(id),
  test_id uuid references topic_tests(id),
  student_id uuid references students(id),
  status topic_test_attempt_status not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_points int,
  max_points int
);

-- Хелперы доступа — копии боевых
create or replace function public.get_my_role() returns text
language sql stable security definer set search_path to 'public' as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.is_admin_or_owner() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.get_my_role() in ('admin', 'owner');
$$;

create or replace function public.auth_is_teacher_of_group(grp_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from groups g join teachers t on t.id = g.teacher_id
     where g.id = grp_id and t.profile_id = auth.uid()
  );
$$;

-- Роли PostgREST
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to anon, authenticated;
