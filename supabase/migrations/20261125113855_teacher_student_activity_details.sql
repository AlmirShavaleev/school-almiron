-- Preserve the existing presence and entry events. Track only a daily total
-- from consecutive foreground heartbeats, with no session or page history.
alter table public.school_presence
  add column if not exists foreground_seen_at timestamptz;

create table teacher_analytics.student_visit_time (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  seconds integer not null check (seconds between 1 and 86400),
  primary key (profile_id, day)
);
alter table teacher_analytics.student_visit_time enable row level security;
revoke all on table teacher_analytics.student_visit_time from public, anon, authenticated;

create function teacher_analytics.touch_student_presence()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := now();
  v_last timestamptz;
  v_first_day date;
  v_today date;
begin
  perform public.school_presence_touch();
  if public.get_my_role()::text is distinct from 'student' then
    return;
  end if;

  -- The presence upsert holds the profile's row lock for this transaction.
  -- One marker per profile prevents multiple tabs from adding the same time.
  select foreground_seen_at into v_last
  from public.school_presence where profile_id = v_user for update;
  if v_last is not null and v_now <= v_last then
    return;
  end if;
  update public.school_presence set foreground_seen_at = v_now where profile_id = v_user;

  if v_last is null or v_now - v_last > interval '90 seconds' then
    return;
  end if;
  v_first_day := (v_last at time zone 'Europe/Moscow')::date;
  v_today := (v_now at time zone 'Europe/Moscow')::date;

  insert into teacher_analytics.student_visit_time as totals (profile_id, day, seconds)
  select v_user, split.day, split.seconds
  from (
    select v_first_day + n as day,
      floor(extract(epoch from
        least(v_now, (v_first_day + n + 1)::timestamp at time zone 'Europe/Moscow')
        - greatest(v_last, (v_first_day + n)::timestamp at time zone 'Europe/Moscow')
      ))::integer as seconds
    from generate_series(0, v_today - v_first_day) n
  ) split
  where split.seconds > 0
  on conflict (profile_id, day)
  do update set seconds = least(86400, totals.seconds + excluded.seconds);
end;
$$;

create function public.school_presence_touch_with_time()
returns void
language sql security invoker set search_path = ''
as $$
  select teacher_analytics.touch_student_presence();
$$;

revoke all on function teacher_analytics.touch_student_presence() from public, anon, authenticated;
grant execute on function teacher_analytics.touch_student_presence() to authenticated;
revoke all on function public.school_presence_touch_with_time() from public, anon, authenticated;
grant execute on function public.school_presence_touch_with_time() to authenticated;

-- Authorize a group through the calling account before resolving any names.
-- Teaching one group on a shared course does not grant the other groups.
create function teacher_analytics.student_roster(p_course_ids uuid[])
returns table (course_id uuid, student_id uuid, profile_id uuid, full_name text)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or coalesce(public.get_my_role()::text, '') not in ('teacher', 'admin', 'owner') then
    raise exception 'Teacher activity requires a staff account' using errcode = '42501';
  end if;

  return query
    select distinct c.id, s.id, p.id, coalesce(nullif(btrim(p.full_name), ''), 'Без имени')
    from public.groups g
    join public.courses c on c.id = g.course_id
    join public.group_students gs on gs.group_id = g.id
    join public.students s on s.id = gs.student_id
    join public.profiles p on p.id = s.profile_id
    where g.is_active
      and c.is_active is not false
      and c.is_template is not true
      and s.is_active is not false
      and p.id <> v_user
      and (p_course_ids is null or c.id = any(p_course_ids))
      and (
        c.owner_id = v_user
        or exists (select 1 from public.teachers t where t.id = g.teacher_id and t.profile_id = v_user)
        or exists (select 1 from public.curators cu where cu.id = g.curator_id and cu.profile_id = v_user)
        or exists (select 1 from public.course_curators cc where cc.course_id = c.id and cc.profile_id = v_user)
      );
end;
$$;
revoke all on function teacher_analytics.student_roster(uuid[]) from public, anon, authenticated;

create function teacher_analytics.online_students(p_course_ids uuid[])
returns table (student_id uuid, full_name text)
language sql stable security definer set search_path = ''
as $$
  select distinct r.student_id, r.full_name
  from teacher_analytics.student_roster(p_course_ids) r
  join public.school_presence p on p.profile_id = r.profile_id
  where p.seen_at > now() - interval '30 minutes' and p.seen_at <= now()
  order by r.full_name, r.student_id;
$$;

create function public.teacher_presence_online(p_course_ids uuid[] default null)
returns table (student_id uuid, full_name text)
language sql stable security invoker set search_path = ''
as $$
  select * from teacher_analytics.online_students(p_course_ids);
$$;

create function teacher_analytics.weekly_student_visits(p_course_ids uuid[])
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with bounds as (
    select (now() at time zone 'Europe/Moscow')::date as today
  ), roster as materialized (
    select distinct student_id, profile_id, full_name from teacher_analytics.student_roster(p_course_ids)
  ), days as (
    select today - n as day from bounds, generate_series(0, 6) n
  ), activity as (
    select r.student_id, r.full_name, jsonb_agg(jsonb_build_object(
      'day', d.day, 'visited', a.profile_id is not null or t.profile_id is not null,
      'first_visit_at', a.visited_at, 'seconds', t.seconds
    ) order by d.day desc) as days
    from roster r cross join days d
    left join public.app_visits a on a.profile_id = r.profile_id and a.visited_on = d.day
    left join teacher_analytics.student_visit_time t on t.profile_id = r.profile_id and t.day = d.day
    group by r.student_id, r.full_name
  )
  select coalesce(jsonb_agg(to_jsonb(activity) order by full_name, student_id), '[]'::jsonb)
  from activity;
$$;

create function public.teacher_student_visits(p_course_ids uuid[] default null)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select teacher_analytics.weekly_student_visits(p_course_ids);
$$;

revoke all on function teacher_analytics.online_students(uuid[]) from public, anon, authenticated;
grant execute on function teacher_analytics.online_students(uuid[]) to authenticated;
revoke all on function public.teacher_presence_online(uuid[]) from public, anon, authenticated;
grant execute on function public.teacher_presence_online(uuid[]) to authenticated;
revoke all on function teacher_analytics.weekly_student_visits(uuid[]) from public, anon, authenticated;
grant execute on function teacher_analytics.weekly_student_visits(uuid[]) to authenticated;
revoke all on function public.teacher_student_visits(uuid[]) from public, anon, authenticated;
grant execute on function public.teacher_student_visits(uuid[]) to authenticated;

-- The headline and the drill-down must describe the same roster and days.
create or replace function teacher_analytics.activity_pulse(p_course_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_today date := (v_now at time zone 'Europe/Moscow')::date;
  v_from timestamptz := ((v_today - 13)::timestamp at time zone 'Europe/Moscow');
  v_result jsonb;
begin
  with roster as materialized (
    select course_id, student_id, profile_id from teacher_analytics.student_roster(p_course_ids)
  ), roster_profiles as materialized (
    select distinct profile_id from roster where profile_id is not null
  ), visits as materialized (
    select v.profile_id, v.visited_on as day
    from roster_profiles r
    join public.app_visits v on v.profile_id = r.profile_id
    where v.visited_on between v_today - 13 and v_today
    union
    select t.profile_id, t.day
    from roster_profiles r
    join teacher_analytics.student_visit_time t on t.profile_id = r.profile_id
    where t.day between v_today - 13 and v_today
  ), visits_by_day as (
    select day, count(*) as total from visits group by day
  ), submissions_by_day as (
    select (a.submitted_at at time zone 'Europe/Moscow')::date as day, count(*) as total
    from public.topic_homework_attempts a
    join public.topic_homework h on h.id = a.homework_id
    join public.topics t on t.id = h.topic_id
    join public.modules m on m.id = t.module_id
    join roster r on r.course_id = m.course_id and r.student_id = a.student_id
    where a.submitted_at between v_from and v_now
      and a.status <> 'draft'
      and t.kind not in ('check', 'control')
    group by 1
  ), completions_by_day as (
    select (e.done_at at time zone 'Europe/Moscow')::date as day, count(*) as total
    from public.topic_done_events(array(select distinct student_id from roster)) e
    join public.topics t on t.id = e.topic_id
    join public.modules m on m.id = t.module_id
    join roster r on r.course_id = m.course_id and r.student_id = e.student_id
    where e.done_at between v_from and v_now
    group by 1
  ), days as (
    select v_today - n as day from generate_series(0, 13) n
  ), reach as (
    select count(*) as visit_days, count(distinct profile_id) as visitors
    from visits where day >= v_today - 6
  )
  select jsonb_build_object(
    'as_of', v_now,
    'days', (
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'visits', coalesce(v.total, 0),
        'submissions', coalesce(s.total, 0),
        'completed', coalesce(c.total, 0)
      ) order by d.day)
      from days d
      left join visits_by_day v using (day)
      left join submissions_by_day s using (day)
      left join completions_by_day c using (day)
    ),
    'enrolled', (select count(distinct student_id) from roster),
    'visited_week', reach.visitors,
    'visit_days_per_visitor', coalesce(round(reach.visit_days::numeric / nullif(reach.visitors, 0), 1), 0),
    'online', (
      select count(*) from roster_profiles r
      join public.school_presence p on p.profile_id = r.profile_id
      where p.seen_at > v_now - interval '30 minutes' and p.seen_at <= v_now
    )
  )
  into v_result
  from reach;

  return v_result;
end;
$$;
