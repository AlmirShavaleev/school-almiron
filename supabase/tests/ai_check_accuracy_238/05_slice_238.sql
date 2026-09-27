-- §238. Добавки слепка поверх ../mock_exam_lesson_221/00_slice.sql (профили, роли,
-- auth.uid(), is_admin_or_owner — дословно из _legacy/002_rls.sql).
-- Таблицы — подмножество настоящих колонок: topic_homework_attempts и
-- topic_homework_reviews по 20260726073913_topic_homework.sql,
-- topic_homework_ai_jobs по 20260730225053_topic_homework_ai_check_jobs.sql +
-- 20260915111443_ai_jobs_tasks_and_dropped_findings.sql. Помощники прав
-- попытки — заглушки (здесь проверяется не они, а гейт is_admin_or_owner):
-- таблица topic_homework_review_tasks создаётся НАСТОЯЩЕЙ миграцией §199.
create type public.topic_homework_review_decision as enum ('accepted', 'returned_for_revision');

create table public.topic_homework_attempts (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id),
  status     text not null default 'submitted',
  created_at timestamptz not null default now()
);
create table public.topic_homework_reviews (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references public.topic_homework_attempts(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision    public.topic_homework_review_decision not null,
  comment     text,
  created_at  timestamptz not null default now()
);
create table public.topic_homework_ai_jobs (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null references public.topic_homework_attempts(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  tasks        jsonb,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.topic_homework_attempts enable row level security;
alter table public.topic_homework_reviews enable row level security;
alter table public.topic_homework_ai_jobs enable row level security;

-- Заглушки помощников прав попытки (нужны настоящей миграции §199).
create or replace function public.topic_homework_attempt_can_review(p_attempt_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin_or_owner() or get_my_role() = 'teacher';
$$;
create or replace function public.topic_homework_attempt_is_own(p_attempt_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from topic_homework_attempts a join students s on s.id = a.student_id
                  where a.id = p_attempt_id and s.profile_id = auth.uid());
$$;
