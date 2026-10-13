set local lock_timeout = '5s';
create table public.perf_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  kind       text not null check (kind in ('route', 'api', 'nav')),
  label      text not null check (length(label) between 1 and 120),
  ms         integer not null check (ms between 0 and 600000),
  status     smallint,
  profile_id uuid not null,
  role       text,
  device     text not null default 'unknown' check (device in ('mobile', 'desktop', 'unknown'))
);
create index perf_events_at_idx on public.perf_events (at);
create index perf_events_profile_idx on public.perf_events (profile_id, at desc);
create table public.perf_hourly (
  hour timestamptz not null, kind text not null, label text not null, n integer not null,
  p50 integer not null, p95 integer not null, max_ms integer not null,
  errors integer not null default 0, students integer not null default 0,
  primary key (hour, kind, label)
);
create table public.perf_hourly_load (
  hour timestamptz primary key, students integer not null, staff integer not null, events integer not null
);
alter table public.perf_events enable row level security;
alter table public.perf_hourly enable row level security;
alter table public.perf_hourly_load enable row level security;
revoke all on public.perf_events from anon, authenticated;
revoke all on public.perf_hourly from anon, authenticated;
revoke all on public.perf_hourly_load from anon, authenticated;