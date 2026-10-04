-- §265. Добавка слепка поверх цепочки §243: course_copy_jobs (подмножество 20260801154048, без RLS — сама
-- topic_copy_stage definer и пишет туда от владельца) — чтобы пробовать копирование темы настоящей
-- topic_copy_stage → course_copy_topic_content (тот же путь, что у копирования курса course_copy_stage).
create table if not exists public.course_copy_jobs (
  id               uuid primary key default gen_random_uuid(),
  requested_by     uuid not null references public.profiles(id) on delete restrict,
  source_course_id uuid references public.courses(id) on delete set null,
  source_topic_id  uuid references public.topics(id)  on delete set null,
  target_course_id uuid references public.courses(id) on delete cascade,
  target_topic_id  uuid references public.topics(id)  on delete cascade,
  kind             text not null check (kind in ('course', 'topic')),
  status           text not null default 'staged' check (status in ('staged', 'finalized', 'rolled_back')),
  files            jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
