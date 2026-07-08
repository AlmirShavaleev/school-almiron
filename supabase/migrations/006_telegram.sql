-- ============================================================
-- TELEGRAM NOTIFICATIONS — MVP (Phase 1 schema)
-- Migration 006
-- Idempotent: safe to re-run.
-- Depends on existing helpers: is_admin_or_owner(), get_my_role(),
--   update_updated_at(); extensions uuid-ossp, pgcrypto.
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_queue_status') then
    create type notification_queue_status as enum (
      'pending', 'processing', 'sent', 'failed', 'cancelled'
    );
  end if;
end $$;

-- ============================================================
-- TELEGRAM CONNECTIONS
-- ============================================================

create table if not exists telegram_connections (
  id                uuid        primary key default uuid_generate_v4(),
  profile_id        uuid        not null references profiles(id) on delete cascade,
  telegram_chat_id  bigint      not null,
  telegram_username text,
  is_enabled        boolean     not null default true,
  connected_at      timestamptz not null default now(),
  disconnected_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- один активный Telegram chat на профиль
  constraint telegram_connections_profile_id_key unique(profile_id),
  -- один chat_id нельзя привязать к разным профилям
  constraint telegram_connections_chat_id_key unique(telegram_chat_id)
);

create index if not exists idx_telegram_connections_profile on telegram_connections(profile_id);
create index if not exists idx_telegram_connections_chat_id on telegram_connections(telegram_chat_id);

-- ============================================================
-- TELEGRAM LINK TOKENS (одноразовые, 15 минут, хранится только hash)
-- ============================================================

create table if not exists telegram_link_tokens (
  id         uuid        primary key default uuid_generate_v4(),
  profile_id uuid        not null references profiles(id) on delete cascade,
  token_hash text        not null unique,  -- SHA-256, не открытый токен
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_telegram_link_tokens_profile on telegram_link_tokens(profile_id);
create index if not exists idx_telegram_link_tokens_hash    on telegram_link_tokens(token_hash);

-- ============================================================
-- NOTIFICATION QUEUE
-- ============================================================

create table if not exists notification_queue (
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
  -- защита от повторной отправки
  constraint notification_queue_dedup_key unique(deduplication_key)
);

create index if not exists idx_notification_queue_status  on notification_queue(status, scheduled_for)
  where status = 'pending';
create index if not exists idx_notification_queue_profile on notification_queue(profile_id);
create index if not exists idx_notification_queue_dedup   on notification_queue(deduplication_key);

-- ============================================================
-- EXTEND notification_prefs: add lesson_changed
--   (existing categories reused: homework→new_homework, lesson→reminder,
--    checked→homework_reviewed, telegram→channel toggle)
-- ============================================================

alter table notification_prefs
  add column if not exists lesson_changed boolean not null default true;

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

drop trigger if exists telegram_connections_updated_at on telegram_connections;
create trigger telegram_connections_updated_at
  before update on telegram_connections
  for each row execute function update_updated_at();

-- ============================================================
-- SECURITY DEFINER HELPERS (search_path pinned to public)
-- ============================================================

-- Очистка просроченных/использованных одноразовых токенов
create or replace function cleanup_telegram_tokens()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from telegram_link_tokens
  where used_at is not null
     or expires_at < now() - interval '1 hour';
end;
$$;

-- Атомарное взятие пачки из очереди (защита от двух параллельных workers)
create or replace function claim_notification_queue(batch_size integer default 20)
returns setof notification_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update notification_queue
  set    status        = 'processing',
         processing_at = now()
  where  id in (
    select id from notification_queue
    where  status = 'pending'
      and  scheduled_for <= now()
      and  attempts < 3
    order  by scheduled_for
    limit  batch_size
    for update skip locked
  )
  returning *;
end;
$$;

-- Отзываем лишние EXECUTE grants; оставляем только service_role
revoke all on function claim_notification_queue(integer) from public, anon, authenticated;
revoke all on function cleanup_telegram_tokens()         from public, anon, authenticated;
grant execute on function claim_notification_queue(integer) to service_role;
grant execute on function cleanup_telegram_tokens()         to service_role;

-- ============================================================
-- RLS
-- ============================================================

alter table telegram_connections enable row level security;
alter table telegram_link_tokens enable row level security;
alter table notification_queue   enable row level security;

-- ---------- telegram_connections ----------
-- Запись только service_role (edge functions). Authenticated — только чтение.
drop policy if exists tc_select_own   on telegram_connections;
drop policy if exists tc_select_admin on telegram_connections;
drop policy if exists tc_insert_service on telegram_connections;
drop policy if exists tc_update_own   on telegram_connections;
drop policy if exists tc_delete_own   on telegram_connections;

create policy tc_select_own on telegram_connections
  for select using (profile_id = auth.uid());

create policy tc_select_admin on telegram_connections
  for select using (is_admin_or_owner());

-- ---------- telegram_link_tokens ----------
-- Никаких политик для authenticated/anon → доступ только service_role.
-- (Frontend никогда не читает токены напрямую.)

-- ---------- notification_queue ----------
-- student НЕ читает очередь. Только admin/owner (журнал).
drop policy if exists nq_select_own        on notification_queue;
drop policy if exists nq_select_admin      on notification_queue;
drop policy if exists nq_insert_staff      on notification_queue;
drop policy if exists nq_update_admin_retry on notification_queue;
drop policy if exists nq_delete_admin      on notification_queue;

create policy nq_select_admin on notification_queue
  for select using (is_admin_or_owner());

-- Персонал может ставить уведомления в очередь (для фаз 2/3)
create policy nq_insert_staff on notification_queue
  for insert with check (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator')
  );

-- admin/owner может только сбросить failed → pending (повторная отправка).
-- Нельзя вручную пометить как 'sent' — with check ограничивает целевой статус.
create policy nq_update_admin_retry on notification_queue
  for update using (is_admin_or_owner())
  with check (status = 'pending');

create policy nq_delete_admin on notification_queue
  for delete using (is_admin_or_owner());
