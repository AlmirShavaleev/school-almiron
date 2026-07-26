-- ============================================================
-- Homework v2 — read models (Phase A, step 2b/3)
-- Single source of truth for "UI category" so student view, teacher stats
-- and review queue never disagree on what a given attempt means.
-- ============================================================

create type public.homework_v2_row as (
  assignment_id uuid, template_id uuid, template_version_id uuid, template_title text,
  course_id uuid, group_id uuid, group_name text, student_id uuid, student_name text,
  status public.homework_assignment_status, publish_at timestamptz, due_at timestamptz,
  due_at_override timestamptz, effective_due_at timestamptz, viewed_at timestamptz,
  is_excused boolean, max_attempts int, allow_late_submission boolean,
  attempts_count int, latest_attempt_id uuid, latest_attempt_number int,
  latest_attempt_status public.homework_attempt_status, latest_submitted_at timestamptz,
  latest_score numeric, latest_review_decision public.homework_review_decision,
  latest_review_comment text, latest_reviewed_at timestamptz,
  category text, overdue boolean
);

create or replace function public._homework_v2_base(p_student_id uuid, p_assignment_id uuid, p_group_id uuid)
returns setof public.homework_v2_row
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with rec as (
    select
      a.id as assignment_id, tv.template_id, tv.id as template_version_id, t.title as template_title,
      t.course_id, a.group_id, g.name as group_name, r.student_id, pr.full_name as student_name,
      a.status, a.publish_at, a.due_at, r.due_at_override,
      coalesce(r.due_at_override, a.due_at) as effective_due_at,
      r.viewed_at, r.is_excused, a.max_attempts, a.allow_late_submission
    from public.homework_recipients r
    join public.homework_assignments a on a.id = r.assignment_id
    join public.homework_template_versions tv on tv.id = a.template_version_id
    join public.homework_templates t on t.id = tv.template_id
    join public.groups g on g.id = a.group_id
    join public.students s on s.id = r.student_id
    join public.profiles pr on pr.id = s.profile_id
    where (p_student_id is null or r.student_id = p_student_id)
      and (p_assignment_id is null or a.id = p_assignment_id)
      and (p_group_id is null or a.group_id = p_group_id)
  ),
  attempts_agg as (
    select assignment_id, student_id, count(*) as attempts_count
    from public.homework_attempts group by assignment_id, student_id
  ),
  latest_attempt as (
    select distinct on (assignment_id, student_id)
      id, assignment_id, student_id, attempt_number, status, submitted_at, score
    from public.homework_attempts
    order by assignment_id, student_id, attempt_number desc
  ),
  latest_review as (
    -- review of the latest attempt specifically (not "most recent review by clock time" —
    -- those coincide in practice but the former is the actually correct definition and
    -- avoids a same-timestamp tie between attempts, since now() is frozen per transaction).
    select distinct on (rv.attempt_id)
      rv.attempt_id, rv.decision, rv.comment, rv.created_at as reviewed_at
    from public.homework_reviews rv
    order by rv.attempt_id, rv.created_at desc, rv.id desc
  )
  select
    rec.assignment_id, rec.template_id, rec.template_version_id, rec.template_title,
    rec.course_id, rec.group_id, rec.group_name, rec.student_id, rec.student_name,
    rec.status, rec.publish_at, rec.due_at, rec.due_at_override, rec.effective_due_at,
    rec.viewed_at, rec.is_excused, rec.max_attempts, rec.allow_late_submission,
    coalesce(aa.attempts_count, 0) as attempts_count,
    la.id as latest_attempt_id, la.attempt_number as latest_attempt_number,
    la.status as latest_attempt_status, la.submitted_at as latest_submitted_at, la.score as latest_score,
    lr.decision as latest_review_decision, lr.comment as latest_review_comment, lr.reviewed_at as latest_reviewed_at,
    case
      when rec.status <> 'published' or rec.publish_at > now() then 'not_published'
      when la.status is null and rec.viewed_at is null then 'new'
      when la.status is null or la.status = 'draft' then 'to_do'
      when la.status in ('submitted','under_review') then 'under_review'
      when la.status = 'returned_for_revision' then 'returned_for_revision'
      when la.status in ('accepted','rejected') then 'checked'
      else 'to_do'
    end as category,
    (rec.effective_due_at < now() and coalesce(la.status, 'draft') not in ('accepted')) as overdue
  from rec
  left join attempts_agg aa on aa.assignment_id = rec.assignment_id and aa.student_id = rec.student_id
  left join latest_attempt la on la.assignment_id = rec.assignment_id and la.student_id = rec.student_id
  left join latest_review lr on lr.attempt_id = la.id;
$$;

revoke all on function public._homework_v2_base(uuid,uuid,uuid) from public, anon, authenticated;

-- ── get_my_homework_assignments ───────────────────────────────
-- Student: own assignments only (regardless of p_student_id). Staff: p_student_id required
-- or scoped via p_group_id, gated by group access.
create or replace function public.get_my_homework_assignments(p_group_id uuid default null, p_student_id uuid default null)
returns setof public.homework_v2_row
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_self_student_id uuid;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  select id into v_self_student_id from public.students where profile_id = auth.uid();

  if v_role = 'student' then
    if v_self_student_id is null then return; end if;
    return query select * from public._homework_v2_base(v_self_student_id, null, null)
      where category <> 'not_published';
    return;
  end if;

  if not (v_role in ('teacher','curator','admin','owner')) then
    return;
  end if;

  if p_group_id is not null and not (
    public.is_admin_or_owner() or public.auth_is_teacher_of_group(p_group_id) or public.auth_is_curator_of_group(p_group_id)
  ) then
    raise exception 'FORBIDDEN: not staff of this group' using errcode = 'P0001';
  end if;

  return query
    select b.* from public._homework_v2_base(p_student_id, null, p_group_id) b
    where public.is_admin_or_owner()
       or public.auth_is_teacher_of_group(b.group_id)
       or public.auth_is_curator_of_group(b.group_id);
end;
$$;

revoke all on function public.get_my_homework_assignments(uuid,uuid) from public, anon;
grant execute on function public.get_my_homework_assignments(uuid,uuid) to authenticated;

-- ── get_homework_assignment_stats ─────────────────────────────
create or replace function public.get_homework_assignment_stats(p_assignment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid;
  v_result jsonb;
begin
  select group_id into v_group_id from public.homework_assignments where id = p_assignment_id;
  if v_group_id is null then raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if not (public.is_admin_or_owner() or public.auth_is_teacher_of_group(v_group_id) or public.auth_is_curator_of_group(v_group_id)) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'assigned', count(*),
    'excused', count(*) filter (where is_excused),
    'viewed', count(*) filter (where viewed_at is not null and not is_excused),
    'not_started', count(*) filter (where category = 'to_do' and not is_excused),
    'submitted', count(*) filter (where latest_attempt_status = 'submitted' and not is_excused),
    'under_review', count(*) filter (where category = 'under_review' and not is_excused),
    'returned_for_revision', count(*) filter (where category = 'returned_for_revision' and not is_excused),
    'accepted', count(*) filter (where latest_review_decision = 'accepted' and not is_excused),
    'rejected', count(*) filter (where latest_review_decision = 'rejected' and not is_excused),
    'overdue', count(*) filter (where overdue and not is_excused)
  ) into v_result
  from public._homework_v2_base(null, p_assignment_id, null);

  return v_result;
end;
$$;

revoke all on function public.get_homework_assignment_stats(uuid) from public, anon;
grant execute on function public.get_homework_assignment_stats(uuid) to authenticated;

-- ── get_homework_review_queue_v2 ──────────────────────────────
create or replace function public.get_homework_review_queue_v2(
  p_mode text default 'pending',   -- pending | returned | checked
  p_group_id uuid default null,
  p_course_id uuid default null,
  p_limit int default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_category text;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  if not (v_role in ('teacher','curator','admin','owner')) then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;
  if p_mode not in ('pending','returned','checked') then
    raise exception 'INVALID_MODE: %', p_mode using errcode = 'P0001';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'INVALID_LIMIT' using errcode = 'P0001';
  end if;

  v_category := case p_mode when 'pending' then 'under_review' when 'returned' then 'returned_for_revision' else 'checked' end;

  return (
    select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(b) order by b.effective_due_at asc nulls last), '[]'::jsonb))
    from public._homework_v2_base(null, null, p_group_id) b
    where b.category = v_category
      and (public.is_admin_or_owner() or public.auth_is_teacher_of_group(b.group_id) or public.auth_is_curator_of_group(b.group_id))
      and (p_course_id is null or b.course_id = p_course_id)
    limit p_limit
  );
end;
$$;

revoke all on function public.get_homework_review_queue_v2(text,uuid,uuid,int) from public, anon;
grant execute on function public.get_homework_review_queue_v2(text,uuid,uuid,int) to authenticated;
