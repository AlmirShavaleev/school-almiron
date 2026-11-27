-- Longer series for the teacher dashboard, built only from the caller's roster.
create function teacher_analytics.activity_period(p_course_ids uuid[], p_days integer, p_as_of timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_today date := (v_now at time zone 'Europe/Moscow')::date;
  v_start date := v_today - (p_days - 1);
  v_from timestamptz := v_start::timestamp at time zone 'Europe/Moscow';
  v_today_from timestamptz := v_today::timestamp at time zone 'Europe/Moscow';
  v_until timestamptz := case when p_as_of between v_today_from and v_now then p_as_of else v_now end;
  v_bucket text := case when p_days = 365 then 'month' else 'day' end;
  v_step interval := case when p_days = 365 then interval '1 month' else interval '1 day' end;
  v_result jsonb;
begin
  if auth.uid() is null or coalesce(public.get_my_role()::text, '') not in ('teacher', 'admin', 'owner') then
    raise exception 'Teacher activity requires a staff account' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (30, 365) then
    raise exception 'Unsupported teacher activity period' using errcode = '22023';
  end if;

  with roster as materialized (
    select course_id, student_id, profile_id from teacher_analytics.student_roster(p_course_ids)
  ), profiles as materialized (
    select distinct profile_id from roster
  ), visits as (
    select v.profile_id, v.visited_on as day
    from profiles r join public.app_visits v on v.profile_id = r.profile_id
    where v.visited_on between v_start and v_today
    union
    select t.profile_id, t.day
    from profiles r join teacher_analytics.student_visit_time t on t.profile_id = r.profile_id
    where t.day between v_start and v_today
  ), visits_by_bucket as (
    select date_trunc(v_bucket, day::timestamp)::date as bucket, count(*) as total
    from visits group by 1
  ), submissions_by_bucket as (
    select date_trunc(v_bucket, a.submitted_at at time zone 'Europe/Moscow')::date as bucket, count(*) as total
    from public.topic_homework_attempts a
    join public.topic_homework h on h.id = a.homework_id
    join public.topics t on t.id = h.topic_id
    join public.modules m on m.id = t.module_id
    join roster r on r.course_id = m.course_id and r.student_id = a.student_id
    where a.submitted_at between v_from and v_until
      and a.status <> 'draft'
      and t.kind not in ('check', 'control')
    group by 1
  ), buckets as (
    select bucket::date as bucket
    from generate_series(date_trunc(v_bucket, v_start::timestamp), v_today::timestamp, v_step) as dates(bucket)
  )
  select jsonb_build_object(
    'starts_on', v_start,
    'ends_on', v_today,
    'buckets', jsonb_agg(jsonb_build_object(
      'day', b.bucket, 'visits', coalesce(v.total, 0), 'submissions', coalesce(s.total, 0)
    ) order by b.bucket)
  ) into v_result
  from buckets b
  left join visits_by_bucket v using (bucket)
  left join submissions_by_bucket s using (bucket);

  return v_result;
end;
$$;

create function public.teacher_activity_period(p_course_ids uuid[], p_days integer, p_as_of timestamptz default null)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select teacher_analytics.activity_period(p_course_ids, p_days, p_as_of);
$$;

revoke all on function teacher_analytics.activity_period(uuid[], integer, timestamptz) from public, anon, authenticated;
grant execute on function teacher_analytics.activity_period(uuid[], integer, timestamptz) to authenticated;
revoke all on function public.teacher_activity_period(uuid[], integer, timestamptz) from public, anon, authenticated;
grant execute on function public.teacher_activity_period(uuid[], integer, timestamptz) to authenticated;
