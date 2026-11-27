set local lock_timeout = '5s';

alter table public.perf_events
  alter column profile_id drop not null,
  add column build_id text,
  add column resource_url text,
  add column error_type text,
  add column client_at timestamptz,
  add column tab_id uuid;

create unique index perf_events_asset_diagnostic_unique
  on public.perf_events (tab_id, client_at, build_id, error_type, coalesce(resource_url, ''))
  where tab_id is not null;

-- One private operational row per authenticated sender. The digest never
-- enters perf_events and cannot be supplied by the HTTP payload.
create table public.perf_ingest_rate (
  sender_hash bytea primary key,
  next_at timestamptz not null
);
create index perf_ingest_rate_next_at_idx on public.perf_ingest_rate (next_at);
alter table public.perf_ingest_rate enable row level security;
revoke all on table public.perf_ingest_rate from public, anon, authenticated, service_role;

create or replace function public.perf_ingest(p_events jsonb)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_count integer;
  v_now timestamptz := clock_timestamp();
  v_reserved timestamptz;
begin
  if v_uid is null or p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;
  if jsonb_array_length(p_events) = 0 then
    return 0;
  end if;

  -- Token bucket with a burst of 12 and one slot replenished every five seconds.
  -- ON CONFLICT serializes competing requests for the same sender, including
  -- requests from different tabs and cases where no events are accepted.
  insert into public.perf_ingest_rate as rate (sender_hash, next_at)
  values (sha256(convert_to('almiron:perf-ingest:' || v_uid::text, 'UTF8')), v_now + interval '5 seconds')
  on conflict (sender_hash) do update
     set next_at = greatest(rate.next_at, v_now) + interval '5 seconds'
   where greatest(rate.next_at, v_now) + interval '5 seconds' <= v_now + interval '1 minute'
  returning next_at into v_reserved;
  if v_reserved is null then
    return 0;
  end if;

  if (select count(*) from public.perf_events e
       where e.profile_id = v_uid and e.at > now() - interval '10 minutes') >= 1200 then
    return 0;
  end if;
  select p.role::text into v_role from public.profiles p where p.id = v_uid;

  with incoming as (
    select e ->> 'k' as kind, left(btrim(e ->> 'l'), 120) as label,
           case when (e ->> 'ms') ~ '^\d{1,9}(\.\d+)?$' then least(round((e ->> 'ms')::numeric), 600000)::integer end as ms,
           case when (e ->> 's') ~ '^\d{1,3}$' then (e ->> 's')::smallint end as status,
           case when (e ->> 'd') in ('mobile', 'desktop') then e ->> 'd' else 'unknown' end as device,
           case when (e ->> 'build_id') ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then e ->> 'build_id' end as build_id,
           case when length(e ->> 'resource_url') <= 200
                  and (e ->> 'resource_url') ~ '^/assets/([A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(m?js|css)$'
                then e ->> 'resource_url' end as resource_url,
           case when (e ->> 'error_type') in ('chunk_js', 'chunk_css', 'runtime') then e ->> 'error_type' end as error_type,
           case when (e ->> 'client_ms') ~ '^[0-9]{13}$' then to_timestamp((e ->> 'client_ms')::double precision / 1000) end as client_at,
           case when (e ->> 'tab_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                then (e ->> 'tab_id')::uuid end as tab_id,
           i
      from jsonb_array_elements(p_events) with ordinality as a(e, i)
     where i <= 200 and jsonb_typeof(e) = 'object'
  ), diagnostics as (
    select * from incoming
     where kind = 'nav' and ms is not null
       and ((label = 'error asset' and error_type in ('chunk_js', 'chunk_css'))
         or (label = 'error runtime' and error_type = 'runtime'))
       and build_id is not null and tab_id is not null
       and client_at between now() - interval '14 days' and now() + interval '1 hour'
     order by i limit 20
  )
  insert into public.perf_events
    (kind, label, ms, status, profile_id, role, device, build_id, resource_url, error_type, client_at, tab_id)
  select kind, label, ms, status, null, null, device, build_id,
         case when error_type <> 'runtime' then resource_url end, error_type, client_at, tab_id
    from diagnostics
  union all
  select kind, case when kind = 'nav' and label like 'error %' then 'error legacy' else label end,
         ms, status, v_uid, v_role, device, null, null, null, null, null
    from incoming
   where kind in ('route', 'api', 'nav') and length(label) >= 1 and ms is not null
     and not (kind = 'nav' and label in ('error asset', 'error runtime'))
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.perf_ingest(jsonb) from public, anon;
grant execute on function public.perf_ingest(jsonb) to authenticated, service_role;
