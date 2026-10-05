-- Применено оркестратором 05.10.2026 через MCP apply_migration (§266, часть «trenirovochnye_uroki_tablicy»). Версия совпадает с schema_migrations.

alter table public.topics add column if not exists lesson_format text;
alter table public.topics drop constraint if exists topics_lesson_format_check;
alter table public.topics add constraint topics_lesson_format_check
  check (lesson_format is null or lesson_format in ('training', 'ege'));

alter table public.topic_homework add column if not exists autocheck boolean not null default false;

create table if not exists public.topic_autocheck_tasks (
  id               uuid primary key default gen_random_uuid(),
  topic_id         uuid not null references public.topics(id) on delete cascade,
  code             text not null check (length(btrim(code)) between 1 and 64),
  position         integer not null default 0 check (position >= 0),
  statement_path   text not null check (length(btrim(statement_path)) between 1 and 500),
  solution_path    text check (solution_path is null or length(btrim(solution_path)) between 1 and 500),
  answer_type      text not null check (answer_type in ('number', 'digits')),
  answer_value     numeric,
  answer_tol       numeric not null default 0 check (answer_tol >= 0),
  answer_text      text,
  digits_any_order boolean not null default false,
  unit             text check (unit is null or length(unit) <= 40),
  source_task_id   uuid references public.topic_autocheck_tasks(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint topic_autocheck_tasks_code_key unique (topic_id, code),
  constraint topic_autocheck_tasks_answer_chk check (
    (answer_type = 'number' and answer_value is not null)
    or (answer_type = 'digits' and answer_text ~ '^[0-9]+$')
  )
);

create index if not exists topic_autocheck_tasks_topic_idx  on public.topic_autocheck_tasks (topic_id, position);
create index if not exists topic_autocheck_tasks_source_idx on public.topic_autocheck_tasks (source_task_id);

create table if not exists public.topic_autocheck_answers (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.topic_autocheck_tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  attempt_no integer not null check (attempt_no between 1 and 3),
  answer_raw text not null check (length(answer_raw) between 1 and 200),
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  constraint topic_autocheck_answers_attempt_key unique (task_id, profile_id, attempt_no)
);

create index if not exists topic_autocheck_answers_profile_idx on public.topic_autocheck_answers (profile_id, task_id);

alter table public.topic_autocheck_tasks   enable row level security;
alter table public.topic_autocheck_answers enable row level security;
revoke all on table public.topic_autocheck_tasks   from public, anon, authenticated;
revoke all on table public.topic_autocheck_answers from public, anon, authenticated;
