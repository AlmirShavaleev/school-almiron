-- 291_perf_функции — вставить ЦЕЛИКОМ в SQL Editor и нажать Run. Только ДОБАВЛЕНИЕ (функции приёма замеров скорости, админ-экран, cron).
-- Таблицы perf_events / perf_hourly / perf_hourly_load уже созданы оркестратором. Исходник: PENDING_291_perf.sql (md5 079049c3…), разделы 2–5.
set lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Приём пачки
-- ─────────────────────────────────────────────────────────────────────────

-- p_events — jsonb-массив {k, l, ms, s?, d?}; возвращает число записанных.
-- Лимиты: ≤ 200 событий за вызов (лишние отбрасываются), ≤ 1 200 событий
-- профиля за 10 минут (сверх — молча 0: RUM не должен мешать ни ученику, ни базе).
create function public.perf_ingest(p_events jsonb)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_n    integer;
begin
  if v_uid is null or p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;
  if (select count(*) from public.perf_events e
       where e.profile_id = v_uid and e.at > now() - interval '10 minutes') >= 1200 then
    return 0;
  end if;
  select p.role::text into v_role from public.profiles p where p.id = v_uid;

  insert into public.perf_events (kind, label, ms, status, profile_id, role, device)
  select x.k, left(btrim(x.l), 120), least(greatest(x.ms, 0), 600000)::int,
         case when x.s between 0 and 999 then x.s::smallint end,
         v_uid, v_role,
         case when x.d in ('mobile', 'desktop') then x.d else 'unknown' end
    from (
      select e ->> 'k' as k, e ->> 'l' as l,
             case when (e ->> 'ms') ~ '^\d{1,9}(\.\d+)?$' then round((e ->> 'ms')::numeric) end as ms,
             case when (e ->> 's') ~ '^\d{1,3}$' then (e ->> 's')::int end as s,
             e ->> 'd' as d
        from jsonb_array_elements(p_events) with ordinality as a(e, i)
       where i <= 200 and jsonb_typeof(e) = 'object'
    ) x
   where x.k in ('route', 'api', 'nav')
     and x.l is not null and length(btrim(x.l)) between 1 and 120
     and x.ms is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Почасовые агрегаты и чистка (cron)
-- ─────────────────────────────────────────────────────────────────────────

-- Пересчитывает последние p_hours часов (по умолчанию 3) — идемпотентно.
create function public.perf_rollup(p_hours integer default 3)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_from timestamptz := date_trunc('hour', now()) - make_interval(hours => greatest(p_hours, 1) - 1);
  v_n    integer;
begin
  delete from public.perf_hourly where hour >= v_from;
  insert into public.perf_hourly (hour, kind, label, n, p50, p95, max_ms, errors, students)
  select date_trunc('hour', e.at), e.kind, e.label, count(*),
         percentile_disc(0.5) within group (order by e.ms),
         percentile_disc(0.95) within group (order by e.ms),
         max(e.ms),
         count(*) filter (where e.status >= 400),
         count(distinct e.profile_id) filter (where e.role = 'student')
    from public.perf_events e
   where e.at >= v_from
   group by 1, 2, 3;
  get diagnostics v_n = row_count;

  delete from public.perf_hourly_load where hour >= v_from;
  insert into public.perf_hourly_load (hour, students, staff, events)
  select date_trunc('hour', e.at),
         count(distinct e.profile_id) filter (where e.role = 'student'),
         count(distinct e.profile_id) filter (where e.role is distinct from 'student'),
         count(*)
    from public.perf_events e
   where e.at >= v_from
   group by 1;
  return v_n;
end $$;

-- Сырьё — 60 дней, агрегаты — год.
create function public.perf_cleanup()
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  delete from public.perf_events where at < now() - interval '60 days';
  get diagnostics v_n = row_count;
  delete from public.perf_hourly where hour < now() - interval '365 days';
  delete from public.perf_hourly_load where hour < now() - interval '365 days';
  return v_n;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Экран админки «Скорость» (только админ)
-- ─────────────────────────────────────────────────────────────────────────

-- Сводка по меткам за период: p50/p95/max/кол-во; можно по одному профилю.
create function public.admin_perf_summary(p_kind text, p_from timestamptz, p_to timestamptz, p_profile_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'label', x.label, 'n', x.n, 'p50', x.p50, 'p95', x.p95, 'max', x.mx,
             'errors', x.errors, 'students', x.students) order by x.p95 desc, x.n desc)
      from (
        select e.label, count(*)::int as n,
               percentile_disc(0.5) within group (order by e.ms) as p50,
               percentile_disc(0.95) within group (order by e.ms) as p95,
               max(e.ms) as mx,
               (count(*) filter (where e.status >= 400))::int as errors,
               (count(distinct e.profile_id) filter (where e.role = 'student'))::int as students
          from public.perf_events e
         where e.kind = p_kind and e.at >= p_from and e.at < p_to
           and (p_profile_id is null or e.profile_id = p_profile_id)
         group by e.label
         order by 4 desc
         limit 200
      ) x
  ), '[]'::jsonb);
end $$;

-- p95 по часам для метки + ученики в час (пик). Часы — из агрегатов; текущий
-- час досчитывается из сырья, чтобы не ждать cron.
create function public.admin_perf_hourly(p_kind text, p_label text, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  return coalesce((
    with hrs as (
      select h.hour, h.n, h.p50, h.p95 from public.perf_hourly h
       where h.kind = p_kind and h.label = p_label and h.hour >= date_trunc('hour', p_from) and h.hour < p_to
         and h.hour < date_trunc('hour', now())
      union all
      select date_trunc('hour', e.at), count(*)::int,
             percentile_disc(0.5) within group (order by e.ms),
             percentile_disc(0.95) within group (order by e.ms)
        from public.perf_events e
       where e.kind = p_kind and e.label = p_label and e.at >= greatest(p_from, date_trunc('hour', now())) and e.at < p_to
       group by 1
    ),
    load as (
      select l.hour, l.students from public.perf_hourly_load l
       where l.hour >= date_trunc('hour', p_from) and l.hour < date_trunc('hour', now())
      union all
      select date_trunc('hour', now()),
             (count(distinct e.profile_id) filter (where e.role = 'student'))::int
        from public.perf_events e where e.at >= date_trunc('hour', now())
    )
    select jsonb_agg(jsonb_build_object('hour', hrs.hour, 'n', hrs.n, 'p50', hrs.p50, 'p95', hrs.p95,
                                        'students', coalesce(load.students, 0)) order by hrs.hour)
      from hrs left join load on load.hour = hrs.hour
  ), '[]'::jsonb);
end $$;

-- Кто «жалуется»: профили с событиями за период (для фильтра) и последние
-- события выбранного.
create function public.admin_perf_people(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'profile_id', x.profile_id, 'full_name', pr.full_name, 'email', pr.email, 'role', x.role,
             'n', x.n, 'route_p95', x.route_p95) order by x.route_p95 desc nulls last)
      from (
        select e.profile_id, max(e.role) as role, count(*)::int as n,
               percentile_disc(0.95) within group (order by e.ms) filter (where e.kind = 'route') as route_p95
          from public.perf_events e
         where e.at >= p_from and e.at < p_to
         group by e.profile_id
      ) x
      left join public.profiles pr on pr.id = x.profile_id
  ), '[]'::jsonb);
end $$;

create function public.admin_perf_recent(p_profile_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'label', e.label, 'ms', e.ms,
                                        'status', e.status, 'device', e.device) order by e.at desc)
      from (select * from public.perf_events e
             where e.profile_id = p_profile_id
             order by e.at desc
             limit least(greatest(coalesce(p_limit, 100), 1), 500)) e
  ), '[]'::jsonb);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Права и расписание
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  execute 'revoke all on function public.perf_ingest(jsonb) from public, anon';
  execute 'grant execute on function public.perf_ingest(jsonb) to authenticated, service_role';
  foreach f in array array['public.perf_rollup(integer)', 'public.perf_cleanup()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.admin_perf_summary(text, timestamptz, timestamptz, uuid)',
    'public.admin_perf_hourly(text, text, timestamptz, timestamptz)',
    'public.admin_perf_people(timestamptz, timestamptz)',
    'public.admin_perf_recent(uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

do $$
begin
  if to_regclass('cron.job') is not null then
    if not exists (select 1 from cron.job where jobname = 'perf-rollup') then
      perform cron.schedule('perf-rollup', '*/10 * * * *', 'select public.perf_rollup(3)');
    end if;
    if not exists (select 1 from cron.job where jobname = 'perf-cleanup') then
      perform cron.schedule('perf-cleanup', '17 3 * * *', 'select public.perf_cleanup()');
    end if;
  end if;
end $$;
