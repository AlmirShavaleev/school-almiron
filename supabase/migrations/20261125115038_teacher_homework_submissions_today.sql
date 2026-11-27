create function teacher_analytics.homework_submissions_today(
  p_course_ids uuid[], p_as_of timestamptz
)
returns table (attempt_id uuid, full_name text, topic_title text, submitted_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_start timestamptz := date_trunc('day', v_now at time zone 'Europe/Moscow') at time zone 'Europe/Moscow';
  v_until timestamptz := case when p_as_of between v_start and v_now then p_as_of else v_now end;
begin
  if auth.uid() is null or coalesce(public.get_my_role()::text, '') not in ('teacher', 'admin', 'owner') then
    raise exception 'Teacher homework submissions require a staff account' using errcode = '42501';
  end if;

  -- Use the chart's roster and filters. The chart timestamp limits the list
  -- to the same snapshot without allowing requests for other days.
  return query
    select a.id, r.full_name, t.title::text, a.submitted_at
    from teacher_analytics.student_roster(p_course_ids) r
    join public.topic_homework_attempts a on a.student_id = r.student_id
    join public.topic_homework h on h.id = a.homework_id
    join public.topics t on t.id = h.topic_id
    join public.modules m on m.id = t.module_id and m.course_id = r.course_id
    where a.submitted_at between v_start and v_until
      and a.status <> 'draft'
      and t.kind not in ('check', 'control')
    order by a.submitted_at desc, a.id;
end;
$$;

create function public.teacher_homework_submissions_today(
  p_course_ids uuid[] default null, p_as_of timestamptz default null
)
returns table (attempt_id uuid, full_name text, topic_title text, submitted_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select * from teacher_analytics.homework_submissions_today(p_course_ids, p_as_of);
$$;

revoke all on function teacher_analytics.homework_submissions_today(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function teacher_analytics.homework_submissions_today(uuid[], timestamptz) to authenticated;
revoke all on function public.teacher_homework_submissions_today(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.teacher_homework_submissions_today(uuid[], timestamptz) to authenticated;
