-- §233. Добавки слепка поверх цепочки §231 — только то, что читают функции главной.
-- Колонки и таблицы — подмножество настоящих (по миграциям 20260726073913_topic_homework,
-- 20260726203833_topic_homework_deadline_grades_notify, _legacy/006_telegram.sql);
-- RLS на них здесь не проверяется: функции главной — definer, клиенту таблицы
-- главной не нужны.
alter table courses        add column if not exists is_active   boolean not null default true;
alter table courses        add column if not exists is_template boolean not null default false;
alter table topics         add column if not exists is_open        boolean;
alter table topics         add column if not exists available_from date;
alter table students       add column if not exists is_active   boolean not null default true;
alter table group_students add column if not exists joined_at   timestamptz not null default now();

-- Дословно: 20260803085614_topic_open_toggle.sql
create or replace function public.topic_open_now(p_is_open boolean, p_available_from date)
returns boolean
language sql
stable
as $function$
  select coalesce(p_is_open, p_available_from is null or p_available_from <= current_date);
$function$;

-- Дословно: 20260803170433_notification_card_titles_and_iso_due_date.sql
create or replace function public.topic_homework_card_title(
  p_topic_title text,
  p_hw_title    text
) returns text
  language sql
  immutable
as $function$
  select case
    when nullif(btrim(coalesce(p_hw_title, '')), '') is null then btrim(coalesce(p_topic_title, ''))
    when lower(btrim(p_hw_title)) = lower(btrim(coalesce(p_topic_title, ''))) then btrim(coalesce(p_topic_title, ''))
    when lower(btrim(p_hw_title)) in ('домашнее задание', 'дз') then btrim(coalesce(p_topic_title, ''))
    when nullif(btrim(coalesce(p_topic_title, '')), '') is not null
     and position(lower(btrim(p_topic_title)) in lower(btrim(p_hw_title))) > 0
      then btrim(p_topic_title)
    when nullif(btrim(coalesce(p_topic_title, '')), '') is null then btrim(p_hw_title)
    else btrim(p_topic_title) || ' — ' || btrim(p_hw_title)
  end;
$function$;

create type public.topic_homework_attempt_status as enum ('draft', 'submitted', 'accepted', 'returned_for_revision');
create type public.topic_homework_review_decision as enum ('accepted', 'returned_for_revision');

create table public.topic_homework (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid not null unique references public.topics(id) on delete cascade,
  title        text not null,
  is_published boolean not null default false,
  created_by   uuid references public.profiles(id),
  due_at       date,
  grade_scale  text check (grade_scale in ('five', 'hundred')),
  created_at   timestamptz not null default now()
);
create table public.topic_homework_attempts (
  id             uuid primary key default gen_random_uuid(),
  homework_id    uuid not null references public.topic_homework(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  attempt_number integer not null check (attempt_number >= 1),
  status         public.topic_homework_attempt_status not null default 'draft',
  submitted_at   timestamptz,
  created_at     timestamptz not null default now(),
  constraint topic_homework_attempts_unique_number unique (homework_id, student_id, attempt_number)
);
create table public.topic_homework_reviews (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references public.topic_homework_attempts(id) on delete cascade,
  reviewer_id uuid references public.profiles(id),
  decision    public.topic_homework_review_decision not null,
  score       integer check (score >= 0 and score <= 100),
  created_at  timestamptz not null default now()
);
alter table public.topic_homework enable row level security;
alter table public.topic_homework_attempts enable row level security;
alter table public.topic_homework_reviews enable row level security;

create table public.notification_prefs (
  user_id  uuid primary key references public.profiles(id),
  homework boolean not null default true,
  checked  boolean not null default true,
  overdue  boolean not null default true,
  lesson   boolean not null default true,
  telegram boolean not null default false
);
alter table public.notification_prefs enable row level security;
alter table public.notification_queue add column if not exists sent_at timestamptz;
alter table public.notification_queue add column if not exists last_error text;
