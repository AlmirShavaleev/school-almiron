-- ============================================================
-- Homework v2 — dashboard/journal read-models (integration cutover, step 1).
-- All four reuse the same _homework_v2_base category vocabulary (new/to_do/under_review/
-- returned_for_revision/checked/overdue) so no two callers can disagree on what a status means.
-- Additive migration; existing RPCs (get_my_homework_assignments/get_homework_assignment_stats/
-- get_homework_review_queue_v2/_homework_v2_base) are not modified.
-- ============================================================

-- ── get_teacher_homework_summary ──────────────────────────────
create or replace function public.get_teacher_homework_summary()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select b.* from public._homework_v2_base(null, null, null) b
    where public.is_admin_or_owner() or public.auth_is_teacher_of_group(b.group_id)
  ),
  today as (select date_trunc('day', now()) as d),
  week as (select date_trunc('week', now()) as w)
  select jsonb_build_object(
    'active_assignments', (select count(distinct assignment_id) from mine where status = 'published'),
    'scheduled_assignments', (select count(distinct assignment_id) from mine where status = 'published' and publish_at > now()),
    'attempts_awaiting_review', (select count(*) from mine where category = 'under_review'),
    'returned_for_revision', (select count(*) from mine where category = 'returned_for_revision'),
    'overdue_recipients', (select count(*) from mine where overdue and not is_excused),
    'accepted_today', (select count(*) from mine, today where latest_review_decision = 'accepted' and latest_reviewed_at >= today.d),
    'accepted_this_week', (select count(*) from mine, week where latest_review_decision = 'accepted' and latest_reviewed_at >= week.w),
    'groups_with_overdue_homework', (select count(distinct group_id) from mine where overdue and not is_excused),
    'recently_assigned', coalesce((
      select jsonb_agg(x order by x.publish_at desc) from (
        select distinct assignment_id, template_title, group_name, publish_at, due_at
        from mine order by publish_at desc limit 5
      ) x
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.get_teacher_homework_summary() from public, anon;
grant execute on function public.get_teacher_homework_summary() to authenticated;

-- ── get_student_homework_summary ──────────────────────────────
create or replace function public.get_student_homework_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id uuid;
  v_result jsonb;
begin
  select id into v_student_id from public.students where profile_id = auth.uid();
  if v_student_id is null then
    return jsonb_build_object('new', 0, 'to_do', 0, 'under_review', 0, 'returned_for_revision', 0,
      'checked', 0, 'overdue', 0, 'nearest_due_at', null, 'nearest_assignment_id', null);
  end if;

  with mine as (
    select * from public._homework_v2_base(v_student_id, null, null) where category <> 'not_published'
  ),
  nearest as (
    select assignment_id, effective_due_at from mine
    where category in ('new','to_do','returned_for_revision')
    order by effective_due_at asc nulls last limit 1
  )
  select jsonb_build_object(
    'new', (select count(*) from mine where category = 'new'),
    'to_do', (select count(*) from mine where category = 'to_do'),
    'under_review', (select count(*) from mine where category = 'under_review'),
    'returned_for_revision', (select count(*) from mine where category = 'returned_for_revision'),
    'checked', (select count(*) from mine where category = 'checked'),
    'overdue', (select count(*) from mine where overdue and not is_excused),
    'nearest_due_at', (select effective_due_at from nearest),
    'nearest_assignment_id', (select assignment_id from nearest)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.get_student_homework_summary() from public, anon;
grant execute on function public.get_student_homework_summary() to authenticated;

-- ── get_student_homework_journal ──────────────────────────────
-- Teacher sees only assignments in groups they teach; never another teacher's assignments
-- for the same student (auth_is_teacher_of_group gate per row, not a blanket "same student").
create or replace function public.get_student_homework_journal(p_student_id uuid)
returns table (
  assignment_id uuid, template_id uuid, template_version_id uuid, title text,
  course_id uuid, course_title text, group_id uuid, group_title text,
  effective_due_at timestamptz, viewed_at timestamptz,
  latest_attempt_id uuid, latest_attempt_number int, latest_attempt_status public.homework_attempt_status,
  latest_score numeric, latest_review_decision public.homework_review_decision, latest_review_comment text,
  submitted_at timestamptz, is_overdue boolean, ui_category text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (
    public.is_admin_or_owner()
    or exists (
      select 1 from public.students s
      join public.group_students gs on gs.student_id = s.id
      join public.groups g on g.id = gs.group_id
      where s.id = p_student_id and public.auth_is_teacher_of_group(g.id)
    )
  ) then
    return;
  end if;

  return query
    select
      b.assignment_id, b.template_id, b.template_version_id, b.template_title,
      b.course_id, c.title, b.group_id, b.group_name,
      b.effective_due_at, b.viewed_at,
      b.latest_attempt_id, b.latest_attempt_number, b.latest_attempt_status,
      b.latest_score, b.latest_review_decision, b.latest_review_comment,
      b.latest_submitted_at, b.overdue, b.category
    from public._homework_v2_base(p_student_id, null, null) b
    join public.courses c on c.id = b.course_id
    where b.category <> 'not_published'
      and (public.is_admin_or_owner() or public.auth_is_teacher_of_group(b.group_id))
    order by b.effective_due_at desc nulls last;
end;
$$;
revoke all on function public.get_student_homework_journal(uuid) from public, anon;
grant execute on function public.get_student_homework_journal(uuid) to authenticated;

-- ── get_course_homework_summary ───────────────────────────────
create or replace function public.get_course_homework_summary(p_course_id uuid, p_topic_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with tpl as (
    select t.id from public.homework_templates t
    where t.course_id = p_course_id and (p_topic_id is null or t.topic_id = p_topic_id)
      and (public.is_admin_or_owner() or public.auth_is_course_owner(t.course_id) or t.created_by = auth.uid()
        or exists (select 1 from public.groups g where g.course_id = t.course_id
          and (public.auth_is_teacher_of_group(g.id) or public.auth_is_curator_of_group(g.id))))
  ),
  rows as (
    select b.* from public._homework_v2_base(null, null, null) b
    where b.template_id in (select id from tpl)
      and (public.is_admin_or_owner() or public.auth_is_teacher_of_group(b.group_id) or public.auth_is_curator_of_group(b.group_id))
  )
  select jsonb_build_object(
    'templates_count', (select count(*) from tpl),
    'active_assignments_count', (select count(distinct assignment_id) from rows where status = 'published'),
    'scheduled_assignments_count', (select count(distinct assignment_id) from rows where status = 'published' and publish_at > now()),
    'recipients_count', (select count(*) from rows),
    'submitted_count', (select count(*) filter (where latest_attempt_status is not null) from rows),
    'awaiting_review_count', (select count(*) from rows where category = 'under_review'),
    'returned_count', (select count(*) from rows where category = 'returned_for_revision'),
    'accepted_count', (select count(*) from rows where latest_review_decision = 'accepted'),
    'overdue_count', (select count(*) from rows where overdue and not is_excused)
  );
$$;
revoke all on function public.get_course_homework_summary(uuid,uuid) from public, anon;
grant execute on function public.get_course_homework_summary(uuid,uuid) to authenticated;
