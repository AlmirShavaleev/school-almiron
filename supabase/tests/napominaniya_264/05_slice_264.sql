-- §264. Добавка к цепочке §261 (../uchenik_261/run.sh: слепки §254–§257 + 05_slice_261, применённые миграции
-- §217, §254–§257, §261 в 4 частях) — то, что читают функции PENDING_264. СТРОГО по миграциям репозитория:
--
--  таблица.колонка / функция                           │ где в миграциях репозитория
--  ────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────
--  students.is_active, courses.is_active              │ _legacy/001_schema.sql (is_active boolean not null default true)
--  notification_queue_status, notification_queue,      │ _legacy/006_telegram.sql (create type / create table, ДОСЛОВНО
--    telegram_connections                              │   колонки; uuid_generate_v4)
--  notification_prefs (user_id, homework, checked,     │ таблица создана вне репозитория (до _legacy/006); колонки — как
--    overdue, lesson, telegram)                        │   в слепке §233 (../teacher_home_233/05_slice_233.sql) и
--                                                      │   src/types/database.ts; lesson_changed — _legacy/006,
--                                                      │   telegram_variant_assignments — _legacy/014
--  topic_homework_attempt_files (attempt_id, …)        │ 20260726073913_topic_homework.sql (create table)
--  topic_homework_attempts.auto_submitted,             │ 20260928122420_kontrolnaya_timed_work.sql (ДОСЛОВНО таблица
--    topic_homework_personal_windows,                  │   личных окон и функция topic_homework_student_window)
--    topic_homework_student_window(…)                  │
--  mock_exams.duration_minutes                         │ 20260926051556_mock_exam_lesson_window_sheet_photos.sql
--                                                      │   (starts_at — уже в слепке §254)
--  topic_test_attempts.started_at                      │ 20260726130727_topic_tests.sql (not null default now())
--  роль service_role                                   │ есть у Supabase (execute для кандидатов — только ей)
--  cron.job / cron.schedule(text,text,text)             │ ЭМУЛЯЦИЯ pg_cron (только имя/расписание/команда): проверяем,
--                                                      │   что do-блок PENDING_264 ставит задание один раз
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to service_role;

-- _legacy/001_schema.sql
alter table public.students add column if not exists is_active boolean not null default true;
alter table public.courses add column if not exists is_active boolean not null default true;

-- _legacy/006_telegram.sql
do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_queue_status') then
    create type notification_queue_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled');
  end if;
end $$;
create table if not exists public.telegram_connections (
  id                uuid        primary key default uuid_generate_v4(),
  profile_id        uuid        not null references public.profiles(id) on delete cascade,
  telegram_chat_id  bigint      not null,
  telegram_username text,
  is_enabled        boolean     not null default true,
  connected_at      timestamptz not null default now(),
  disconnected_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint telegram_connections_profile_id_key unique(profile_id),
  constraint telegram_connections_chat_id_key unique(telegram_chat_id)
);
create table if not exists public.notification_queue (
  id                uuid                      primary key default uuid_generate_v4(),
  profile_id        uuid                      not null references public.profiles(id) on delete cascade,
  channel           text                      not null default 'telegram',
  event_type        text                      not null,
  entity_type       text,
  entity_id         uuid,
  deduplication_key text                      not null,
  payload           jsonb                     not null default '{}',
  status            notification_queue_status not null default 'pending',
  attempts          integer                   not null default 0,
  scheduled_for     timestamptz               not null default now(),
  processing_at     timestamptz,
  sent_at           timestamptz,
  last_error        text,
  created_at        timestamptz               not null default now(),
  constraint notification_queue_dedup_key unique(deduplication_key)
);
alter table public.telegram_connections enable row level security;
alter table public.notification_queue enable row level security;

-- notification_prefs: слепок §233 + _legacy/006 (lesson_changed) + _legacy/014 (telegram_variant_assignments).
-- Политики на проде — свои у ученика на свою строку; здесь — та же суть (только своя строка), чтобы проба
-- «ученик выключает вид у себя» шла под RLS.
create table public.notification_prefs (
  user_id  uuid primary key references public.profiles(id),
  homework boolean not null default true,
  checked  boolean not null default true,
  overdue  boolean not null default true,
  lesson   boolean not null default true,
  telegram boolean not null default false
);
alter table public.notification_prefs add column if not exists lesson_changed boolean not null default true;
alter table public.notification_prefs add column if not exists telegram_variant_assignments boolean not null default true;
alter table public.notification_prefs enable row level security;
create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 20260726073913_topic_homework.sql
create table public.topic_homework_attempt_files (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null references public.topic_homework_attempts(id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0),
  position     integer not null default 0 check (position >= 0)
);
alter table public.topic_homework_attempt_files enable row level security;

-- 20260928122420_kontrolnaya_timed_work.sql (ДОСЛОВНО)
alter table public.topic_homework_attempts
  add column if not exists auto_submitted boolean not null default false;
create table if not exists public.topic_homework_personal_windows (
  homework_id uuid not null references public.topic_homework(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  opens_at    timestamptz not null,
  closes_at   timestamptz not null,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (homework_id, student_id),
  constraint topic_homework_personal_windows_order_check check (closes_at > opens_at)
);
alter table public.topic_homework_personal_windows enable row level security;
create or replace function public.topic_homework_student_window(p_homework_id uuid, p_student_id uuid)
returns table (opens_at timestamptz, closes_at timestamptz, personal boolean)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select case when w.homework_id is not null then w.opens_at else h.opens_at end,
         case when w.homework_id is not null then w.closes_at else h.closes_at end,
         w.homework_id is not null
    from topic_homework h
    left join topic_homework_personal_windows w
      on w.homework_id = h.id and w.student_id = p_student_id
   where h.id = p_homework_id;
$function$;

-- 20260926051556_mock_exam_lesson_window_sheet_photos.sql
alter table public.mock_exams
  add column if not exists duration_minutes smallint not null default 240 check (duration_minutes between 10 and 720);

-- 20260726130727_topic_tests.sql
alter table public.topic_test_attempts add column if not exists started_at timestamptz not null default now();

-- Эмуляция pg_cron (без планировщика): задания по имени.
create schema if not exists cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null);
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$$;

-- Стык §263 (добавлено оркестратором при сведении §263+§264): кандидаты «нет фото» читают
-- work_activity.opened_at. Таблица — ДОСЛОВНО колонки из 20261003175143_work_mode_part1_activity_active_works_policies.sql
-- (без внешних ключей: цель слепка — только чтение кандидатов; права/политики §263 проверяет ../rezhim_263).
create table if not exists public.work_activity (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null,
  homework_id    uuid,
  mock_exam_id   uuid,
  opened_at      timestamptz,
  away_count     integer not null default 0 check (away_count >= 0),
  away_seconds   integer not null default 0 check (away_seconds >= 0),
  last_away_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint work_activity_one_target check (num_nonnulls(homework_id, mock_exam_id) = 1)
);
