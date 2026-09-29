-- §243. Добавки слепка поверх цепочки §240 (../kontrolnaya_240: слепок §221 +
-- 05_slice_240 + НАСТОЯЩИЕ файлы ДЗ темы, файлов, синхронизации каркаса,
-- копирования, §234 и §240). Здесь — только то, что трогает §243 и чего в
-- цепочке нет. Определения — подмножество настоящих:
--   group_students.joined_at, students.is_active — _legacy/001_schema.sql и
--     колонка прода (её читает teacher_home_overdue, 20260926232039);
--   notification_queue / telegram_connections / notification_queue_status —
--     _legacy/006_telegram.sql;
--   notifications — _legacy/001_schema.sql + link и dedup_key
--     (20260730125856_topic_homework_in_app_notifications.sql);
--   notification_dispatch_errors — 20260802230510 (дословно, без политики);
--   topic_homework_card_title — дословно 20260803170433.
alter table public.group_students add column if not exists joined_at timestamptz not null default now();
alter table public.students       add column if not exists is_active boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_queue_status') then
    create type notification_queue_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled');
  end if;
end $$;

create table if not exists public.telegram_connections (
  id                uuid        primary key default uuid_generate_v4(),
  profile_id        uuid        not null references profiles(id) on delete cascade,
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
  profile_id        uuid                      not null references profiles(id) on delete cascade,
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

create table if not exists public.notifications (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references profiles(id) on delete cascade,
  title      text not null,
  message    text not null,
  type       text not null default 'info',
  read       boolean not null default false,
  link       text,
  dedup_key  text,
  created_at timestamptz not null default now()
);
create unique index if not exists notifications_dedup_key_uq on public.notifications(dedup_key);

-- Клиентские политики этих таблиц в пробах не участвуют: у ученика здесь нет
-- прав вовсе (RLS включена, политик нет) — так видно, что сводку пишет только
-- definer-код.
alter table public.telegram_connections enable row level security;
alter table public.notification_queue   enable row level security;
alter table public.notifications        enable row level security;
revoke all on public.telegram_connections, public.notification_queue, public.notifications from anon, authenticated;

create table if not exists public.notification_dispatch_errors (
  id         uuid primary key default gen_random_uuid(),
  source     text not null,
  entity_id  uuid,
  sqlstate   text,
  message    text,
  created_at timestamptz not null default now()
);
alter table public.notification_dispatch_errors enable row level security;
revoke all on table public.notification_dispatch_errors from public, anon, authenticated;

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
