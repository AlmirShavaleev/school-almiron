-- §247. Добавки слепка поверх ../mock_exam_lesson_221/00_slice.sql (профили, роли anon/authenticated,
-- auth.uid(), is_admin_or_owner — дословно из _legacy/002_rls.sql).
-- Таблицы ДЗ темы — подмножество настоящих колонок по 20260726073913_topic_homework.sql и
-- 20260726203833_topic_homework_deadline_grades_notify.sql (grade_scale, reviews.score).
-- Помощники прав попытки — заглушки (нужны настоящей миграции таблицы проверки §199,
-- которая здесь применяется целиком). Роль service_role и ПРИВИЛЕГИИ ПО УМОЛЧАНИЮ — как в
-- Supabase: всё новое в public автоматически получает anon/authenticated/service_role, поэтому
-- проба «закрыто от authenticated» проверяет, что revoke в PENDING_247 действительно срабатывает.
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

create type public.topic_homework_attempt_status as enum ('draft', 'submitted', 'accepted', 'returned_for_revision');
create type public.topic_homework_review_decision as enum ('accepted', 'returned_for_revision');

create table public.topic_homework (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  instructions text,
  grade_scale  text check (grade_scale in ('five', 'hundred'))
);
create table public.topic_homework_attempts (
  id             uuid primary key default gen_random_uuid(),
  homework_id    uuid not null references public.topic_homework(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  attempt_number integer not null default 1,
  status         public.topic_homework_attempt_status not null default 'draft',
  submitted_at   timestamptz,
  created_at     timestamptz not null default now()
);
create table public.topic_homework_reviews (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references public.topic_homework_attempts(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision    public.topic_homework_review_decision not null,
  comment     text,
  score       integer check (score >= 0 and score <= 100),
  created_at  timestamptz not null default now()
);
create table public.topic_homework_attempt_files (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null references public.topic_homework_attempts(id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text,
  position     integer not null default 0
);
alter table public.topic_homework enable row level security;
alter table public.topic_homework_attempts enable row level security;
alter table public.topic_homework_reviews enable row level security;
alter table public.topic_homework_attempt_files enable row level security;

create or replace function public.topic_homework_attempt_can_review(p_attempt_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin_or_owner() or get_my_role() = 'teacher';
$$;
create or replace function public.topic_homework_attempt_is_own(p_attempt_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from topic_homework_attempts a join students s on s.id = a.student_id
                  where a.id = p_attempt_id and s.profile_id = auth.uid());
$$;
