-- Добавки слепка для §219.
-- groups: политика groups_select_all — дословно из 20260730213917. Помощники
-- auth_is_*_of_group в репозитории не лежат (заведены на проде до миграций в
-- git) — здесь восстановлены по смыслу имени, НЕ дословно.
create or replace function auth_is_teacher_of_group(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from groups g join teachers t on t.id = g.teacher_id where g.id = p_group and t.profile_id = auth.uid()) $$;
create or replace function auth_is_curator_of_group(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from groups g join curators c on c.id = g.curator_id where g.id = p_group and c.profile_id = auth.uid()) $$;
create or replace function auth_is_student_in_group(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_students gs join students s on s.id = gs.student_id where gs.group_id = p_group and s.profile_id = auth.uid()) $$;
alter table groups enable row level security;
create policy groups_select_all on public.groups
  for select using (
    is_admin_or_owner()
    or public.course_is_staff(course_id)
    or auth_is_teacher_of_group(id)
    or auth_is_curator_of_group(id)
    or auth_is_student_in_group(id)
  );

-- Уведомления: по _legacy/006_telegram.sql и 20260730125856 (dedup_key).
create type notification_queue_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled');
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id),
  title text not null, message text not null, type text not null default 'info',
  link text, read boolean not null default false, dedup_key text,
  created_at timestamptz not null default now());
create unique index notifications_dedup_key_uq on notifications(dedup_key);
create table telegram_connections (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) unique,
  telegram_chat_id bigint not null unique,
  is_enabled boolean not null default true,
  disconnected_at timestamptz);
create table notification_queue (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id),
  channel text not null default 'telegram', event_type text not null,
  entity_type text, entity_id uuid, deduplication_key text not null,
  payload jsonb not null default '{}', status notification_queue_status not null default 'pending',
  attempts integer not null default 0, scheduled_for timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint notification_queue_dedup_key unique(deduplication_key));
-- RLS как на проде по смыслу: клиентам чужие строки не видны.
alter table notifications enable row level security;
alter table telegram_connections enable row level security;
alter table notification_queue enable row level security;
create policy n_own on notifications for select using (user_id = auth.uid());
create policy tc_select_own on telegram_connections for select using (profile_id = auth.uid());
grant select, insert, update, delete on notifications, telegram_connections, notification_queue to authenticated;
