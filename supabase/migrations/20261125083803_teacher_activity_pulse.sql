-- Aggregate teacher dashboard activity without exposing raw visit or presence rows.
create schema if not exists teacher_analytics;
revoke all on schema teacher_analytics from public, anon, authenticated;
grant usage on schema teacher_analytics to authenticated;

create or replace function teacher_analytics.activity_pulse(p_course_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_role text := public.get_my_role()::text;
  v_now timestamptz := now();
  v_today date := (v_now at time zone 'Europe/Moscow')::date;
  v_from timestamptz := ((v_today - 13)::timestamp at time zone 'Europe/Moscow');
  v_result jsonb;
begin
  if v_user is null or coalesce(v_role, '') not in ('teacher', 'admin', 'owner') then
    raise exception 'Teacher activity requires a staff account' using errcode = '42501';
  end if;

  with own_groups as materialized (
    select g.id, g.course_id
    from public.groups g
    join public.courses c on c.id = g.course_id
    where g.is_active
      and c.is_active is not false
      and c.is_template is not true
      and (p_course_ids is null or c.id = any(p_course_ids))
      and public.course_is_staff(c.id)
      -- An administrator using this teacher dashboard is scoped to their own courses too.
      and (
        v_role = 'teacher'
        or c.owner_id = v_user
        or exists (
          select 1 from public.groups tg join public.teachers t on t.id = tg.teacher_id
          where tg.course_id = c.id and t.profile_id = v_user
        )
        or exists (
          select 1 from public.groups cg join public.curators cu on cu.id = cg.curator_id
          where cg.course_id = c.id and cu.profile_id = v_user
        )
        or exists (
          select 1 from public.course_curators cc
          where cc.course_id = c.id and cc.profile_id = v_user
        )
      )
  ), roster as materialized (
    select distinct g.course_id, s.id as student_id, s.profile_id
    from own_groups g
    join public.group_students gs on gs.group_id = g.id
    join public.students s on s.id = gs.student_id
    where s.is_active is not false
      and s.profile_id is distinct from v_user
  ), roster_profiles as materialized (
    select distinct profile_id from roster where profile_id is not null
  ), visits as materialized (
    select v.profile_id, v.visited_on as day
    from roster_profiles r
    join public.app_visits v on v.profile_id = r.profile_id
    where v.visited_on between v_today - 13 and v_today
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

revoke all on function teacher_analytics.activity_pulse(uuid[]) from public, anon, authenticated;
grant execute on function teacher_analytics.activity_pulse(uuid[]) to authenticated;

create or replace function public.teacher_activity_pulse(p_course_ids uuid[] default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select teacher_analytics.activity_pulse(p_course_ids);
$$;

revoke all on function public.teacher_activity_pulse(uuid[]) from public, anon, authenticated;
grant execute on function public.teacher_activity_pulse(uuid[]) to authenticated;

comment on function public.teacher_activity_pulse(uuid[]) is
  'Teacher dashboard: aggregate 14-day visits, homework submissions and strict topic completion, plus weekly reach and recent presence. Scoped to own active courses, with optional further course filtering. Moscow calendar.';
