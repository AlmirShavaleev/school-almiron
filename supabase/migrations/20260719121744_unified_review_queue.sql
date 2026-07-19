create function public._review_queue_base(
  p_course_id uuid,
  p_group_id uuid,
  p_student_id uuid,
  p_source_type text,
  p_status text[],
  p_due_before timestamptz,
  p_due_after timestamptz
)
returns table (
  source text, submission_id uuid, assignment_id uuid, student_id uuid, student_name text,
  course_id uuid, course_title text, group_ids uuid[], group_titles text[],
  topic_id uuid, topic_title text, lesson_id uuid, title text,
  due_at timestamptz, submitted_at timestamptz, reviewed_at timestamptz,
  status text, score numeric, has_files boolean, is_overdue boolean
)
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  with roster as (
    select distinct
      h.id as homework_id, s.id as student_id,
      c.id as course_id, c.title as course_title,
      tp.id as topic_id, tp.title as topic_title,
      g.id as group_id, g.name as group_name
    from homeworks h
    join topics tp on tp.id = h.topic_id
    join modules m on m.id = tp.module_id
    join courses c on c.id = m.course_id
    join groups g on g.course_id = c.id
    join group_students gs on gs.group_id = g.id
    join students s on s.id = gs.student_id
    where h.is_archived = false
      and auth_is_staff_of_homework_course(h.id)
  ),
  legacy_groups as (
    select
      homework_id, student_id,
      (array_agg(course_id))[1] as course_id,
      (array_agg(course_title))[1] as course_title,
      (array_agg(topic_id))[1] as topic_id,
      (array_agg(topic_title))[1] as topic_title,
      array_agg(group_id order by group_name, group_id) as group_ids,
      array_agg(group_name order by group_name, group_id) as group_titles
    from roster
    group by homework_id, student_id
  ),
  legacy as (
    select
      'legacy_homework'::text as source,
      hs.id as submission_id,
      h.id as assignment_id,
      lg.student_id,
      pr.full_name as student_name,
      lg.course_id, lg.course_title,
      lg.group_ids, lg.group_titles,
      lg.topic_id, lg.topic_title,
      h.lesson_id,
      h.title,
      h.due_date as due_at,
      hs.submitted_at,
      hs.checked_at as reviewed_at,
      case coalesce(hs.status::text, 'not_submitted')
        when 'checked' then 'accepted'
        when 'revision' then 'returned'
        else coalesce(hs.status::text, 'not_submitted')
      end as status,
      hs.score::numeric,
      exists(select 1 from homework_submission_files f where f.submission_id = hs.id) as has_files
    from legacy_groups lg
    join homeworks h on h.id = lg.homework_id
    join students s on s.id = lg.student_id
    join profiles pr on pr.id = s.profile_id
    left join homework_submissions hs on hs.homework_id = h.id and hs.student_id = s.id
    where (p_course_id is null or lg.course_id = p_course_id)
      and (p_group_id is null or p_group_id = any(lg.group_ids))
      and (p_student_id is null or lg.student_id = p_student_id)
  ),
  new_system as (
    select
      'task_collection'::text as source,
      ts.id as submission_id,
      ac.id as assignment_id,
      s.id as student_id,
      pr.full_name as student_name,
      coalesce(c_chain.id, c_fallback.id) as course_id,
      coalesce(c_chain.title, c_fallback.title) as course_title,
      case when g.id is not null then array[g.id] else array[]::uuid[] end as group_ids,
      case when g.id is not null then array[g.name] else array[]::text[] end as group_titles,
      tp.id as topic_id, tp.title as topic_title,
      ac.lesson_id,
      tcol.title,
      ac.due_date as due_at,
      ts.submitted_at,
      ts.reviewed_at,
      coalesce(ts.status, 'not_submitted') as status,
      ts.score,
      (ts.files is not null and array_length(ts.files,1) > 0) as has_files
    from assigned_collections ac
    join task_collections tcol on tcol.id = ac.collection_id
    join assigned_collection_members acm on acm.assigned_id = ac.id
    join students s on s.id = acm.student_id
    join profiles pr on pr.id = s.profile_id
    left join task_submissions ts on ts.assigned_id = ac.id and ts.student_id = s.id
    left join lessons l on l.id = ac.lesson_id
    left join topics tp on tp.id = l.topic_id
    left join modules m on m.id = tp.module_id
    left join courses c_chain on c_chain.id = m.course_id
    left join courses c_fallback on c_fallback.id = l.course_id
    left join groups g on g.id = ac.group_id
    where ac.status = 'active'
      and auth_can_review_task_submission(ac.id)
      and (p_course_id is null or coalesce(c_chain.id, c_fallback.id) = p_course_id)
      and (p_group_id is null or g.id = p_group_id)
      and (p_student_id is null or s.id = p_student_id)
  ),
  unioned as (
    select *, (due_at is not null and due_at < now() and status in ('not_submitted','submitted')) as is_overdue
    from legacy where p_source_type is null or p_source_type = 'legacy_homework'
    union all
    select *, (due_at is not null and due_at < now() and status in ('not_submitted','submitted')) as is_overdue
    from new_system where p_source_type is null or p_source_type = 'task_collection'
  )
  select
    source, submission_id, assignment_id, student_id, student_name,
    course_id, course_title, group_ids, group_titles, topic_id, topic_title,
    lesson_id, title, due_at, submitted_at, reviewed_at, status, score, has_files, is_overdue
  from unioned u
  where (p_status is null or u.status = any(p_status))
    and (p_due_before is null or u.due_at <= p_due_before)
    and (p_due_after is null or u.due_at >= p_due_after);
$$;

revoke execute on function public._review_queue_base(uuid,uuid,uuid,text,text[],timestamptz,timestamptz) from public;

create function public.get_review_queue(
  p_mode text default 'pending',
  p_course_id uuid default null,
  p_group_id uuid default null,
  p_student_id uuid default null,
  p_source_type text default null,
  p_status text[] default null,
  p_due_before timestamptz default null,
  p_due_after timestamptz default null,
  p_cursor jsonb default null,
  p_limit int default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_statuses text[]; v_sort_field text; v_desc boolean;
  v_cursor_sort_value timestamptz; v_cursor_has_sort_value boolean;
  v_cursor_source text; v_cursor_assignment_id uuid; v_cursor_student_id uuid; v_cursor_mode text;
  v_result jsonb;
  v_valid_statuses text[] := array['not_submitted','submitted','returned','accepted','rejected'];
begin
  if not (select get_my_role() = any(array['teacher','curator','admin','owner']::user_role[])) then
    return jsonb_build_object('items', '[]'::jsonb, 'has_more', false, 'next_cursor', null);
  end if;

  if p_mode not in ('pending','returned','checked','all') then
    raise exception 'invalid p_mode: %, expected pending|returned|checked|all', p_mode
      using errcode = 'invalid_parameter_value';
  end if;

  if p_status is not null and exists (select 1 from unnest(p_status) s where s <> all (v_valid_statuses)) then
    raise exception 'invalid p_status value in %, expected subset of %', p_status, v_valid_statuses
      using errcode = 'invalid_parameter_value';
  end if;

  if p_source_type is not null and p_source_type not in ('legacy_homework','task_collection') then
    raise exception 'invalid p_source_type: %', p_source_type using errcode = 'invalid_parameter_value';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100, got %', p_limit
      using errcode = 'invalid_parameter_value';
  end if;

  v_statuses := case
    when p_status is not null then p_status
    when p_mode = 'pending' then array['submitted']
    when p_mode = 'returned' then array['returned']
    when p_mode = 'checked' then array['accepted','rejected']
    else null
  end;

  v_sort_field := case when p_mode in ('returned','checked') then 'reviewed_at' else 'due_at' end;
  v_desc := (p_mode = 'checked');

  if p_cursor is not null then
    if not (p_cursor ? 'mode' and p_cursor ? 'has_sort_value' and p_cursor ? 'source' and p_cursor ? 'assignment_id' and p_cursor ? 'student_id') then
      raise exception 'malformed p_cursor: missing required keys' using errcode = 'invalid_parameter_value';
    end if;
    v_cursor_mode := p_cursor->>'mode';
    if v_cursor_mode is distinct from p_mode then
      raise exception 'cursor mode mismatch: cursor is for mode=%, called with mode=%', v_cursor_mode, p_mode
        using errcode = 'invalid_parameter_value';
    end if;
    v_cursor_has_sort_value := (p_cursor->>'has_sort_value')::boolean;
    v_cursor_sort_value := case when v_cursor_has_sort_value then (p_cursor->>'sort_value')::timestamptz else null end;
    v_cursor_source := p_cursor->>'source';
    v_cursor_assignment_id := (p_cursor->>'assignment_id')::uuid;
    v_cursor_student_id := (p_cursor->>'student_id')::uuid;
    if v_cursor_source not in ('legacy_homework','task_collection') then
      raise exception 'malformed p_cursor.source: %', v_cursor_source using errcode = 'invalid_parameter_value';
    end if;
  end if;

  with base as (
    select *,
      case when v_sort_field = 'reviewed_at' then reviewed_at else due_at end as sort_value
    from public._review_queue_base(p_course_id, p_group_id, p_student_id, p_source_type, v_statuses, p_due_before, p_due_after)
  ),
  paged as (
    select *
    from base b
    where p_cursor is null
      or (
        not v_desc and (
          (v_cursor_has_sort_value and b.sort_value is not null
            and (b.sort_value, b.source, b.assignment_id, b.student_id) > (v_cursor_sort_value, v_cursor_source, v_cursor_assignment_id, v_cursor_student_id))
          or (v_cursor_has_sort_value and b.sort_value is null)
          or (not v_cursor_has_sort_value and b.sort_value is null
            and (b.source, b.assignment_id, b.student_id) > (v_cursor_source, v_cursor_assignment_id, v_cursor_student_id))
        )
        or v_desc and (
          (v_cursor_has_sort_value and b.sort_value is not null and (
            b.sort_value < v_cursor_sort_value
            or (b.sort_value = v_cursor_sort_value
                and (b.source, b.assignment_id, b.student_id) > (v_cursor_source, v_cursor_assignment_id, v_cursor_student_id))
          ))
          or (v_cursor_has_sort_value and b.sort_value is null)
          or (not v_cursor_has_sort_value and b.sort_value is null
            and (b.source, b.assignment_id, b.student_id) > (v_cursor_source, v_cursor_assignment_id, v_cursor_student_id))
        )
      )
  ),
  numbered as (
    select
      p.*,
      row_number() over (
        order by
          case when not v_desc then p.sort_value end asc nulls last,
          case when v_desc then p.sort_value end desc nulls last,
          p.source asc, p.assignment_id asc, p.student_id asc
      ) as rn
    from paged p
    order by
      case when not v_desc then p.sort_value end asc nulls last,
      case when v_desc then p.sort_value end desc nulls last,
      p.source asc, p.assignment_id asc, p.student_id asc
    limit (p_limit + 1)
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(to_jsonb(n) - 'rn' - 'sort_value' order by n.rn) from numbered n where n.rn <= p_limit),
      '[]'::jsonb
    ),
    'has_more', exists (select 1 from numbered n where n.rn = p_limit + 1),
    'next_cursor', (
      select jsonb_build_object(
        'mode', p_mode,
        'has_sort_value', (n.sort_value is not null),
        'sort_value', n.sort_value,
        'source', n.source,
        'assignment_id', n.assignment_id,
        'student_id', n.student_id
      )
      from numbered n
      where n.rn = p_limit and exists (select 1 from numbered n2 where n2.rn = p_limit + 1)
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_review_queue(text,uuid,uuid,uuid,text,text[],timestamptz,timestamptz,jsonb,int) from public;
grant execute on function public.get_review_queue(text,uuid,uuid,uuid,text,text[],timestamptz,timestamptz,jsonb,int) to authenticated;

create function public.get_review_queue_counts(
  p_course_id uuid default null,
  p_group_id uuid default null,
  p_student_id uuid default null,
  p_source_type text default null
)
returns jsonb
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'source', source,
    'status', status,
    'bucket', case status
      when 'submitted' then 'pending'
      when 'returned' then 'returned'
      when 'accepted' then 'checked'
      when 'rejected' then 'checked'
      else 'other'
    end,
    'count', cnt
  )), '[]'::jsonb)
  from (
    select source, status, count(*) as cnt
    from public._review_queue_base(p_course_id, p_group_id, p_student_id, p_source_type, null, null, null)
    where get_my_role() = any(array['teacher','curator','admin','owner']::user_role[])
    group by source, status
  ) g;
$$;

revoke execute on function public.get_review_queue_counts(uuid,uuid,uuid,text) from public;
grant execute on function public.get_review_queue_counts(uuid,uuid,uuid,text) to authenticated;
