-- ============================================================
-- Homework v2 — stabilization fixes found during pre-frontend backend audit.
-- Does not touch legacy homeworks/* or task_collections/*. Additive/corrective only.
-- ============================================================

-- ── fix 1: hwa_select_scoped let ANY group member read an assignment row, even when the
-- assignment targets only a subset of the group (assign_homework p_student_ids). A student
-- who isn't a recipient must not see the assignment before/without being assigned it.
-- SECURITY DEFINER bypasses RLS on homework_recipients so this can be called from the
-- homework_assignments SELECT policy without recursing back into homework_assignments
-- (homework_recipients' own policies check homework_assignments, which would otherwise
-- re-trigger this policy -> infinite recursion).
create or replace function public.auth_is_recipient_of_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.homework_recipients r join public.students s on s.id = r.student_id
    where r.assignment_id = p_assignment_id and s.profile_id = auth.uid()
  );
$$;
revoke all on function public.auth_is_recipient_of_assignment(uuid) from public, anon;
grant execute on function public.auth_is_recipient_of_assignment(uuid) to authenticated;

drop policy if exists hwa_select_scoped on public.homework_assignments;
create policy hwa_select_scoped on public.homework_assignments
  for select
  using (
    public.is_admin_or_owner()
    or public.auth_is_teacher_of_group(group_id)
    or public.auth_is_curator_of_group(group_id)
    or public.auth_is_recipient_of_assignment(id)
  );

-- ── fix 2: _homework_v2_base treated ANY non-'published' assignment status (including
-- closed/cancelled, which happen AFTER a student may have already submitted/been reviewed)
-- as 'not_published' and hid it entirely from the student. That erased a student's own
-- grade/feedback history the moment a teacher closed the assignment. The "not yet visible"
-- gate should only apply to drafts and future-scheduled publish_at; closed/cancelled must
-- keep showing whatever the last attempt/review state was (new attempts are separately
-- blocked by start_homework_attempt's own status check).
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
      when rec.status = 'draft' or rec.publish_at > now() then 'not_published'
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

-- ── fix 3: score bounds. Attempts/reviews had no non-negative check; submit_homework_review
-- accepted any p_score with no upper bound against the template version's max_score.
alter table public.homework_attempts add constraint homework_attempts_score_nonneg check (score is null or score >= 0);
alter table public.homework_reviews add constraint homework_reviews_score_nonneg check (score is null or score >= 0);

create or replace function public.submit_homework_review(
  p_attempt_id  uuid,
  p_decision    public.homework_review_decision,
  p_score       numeric,
  p_comment     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_att public.homework_attempts%rowtype;
  v_grp_id uuid;
  v_can_review boolean;
  v_review_id uuid;
  v_new_status public.homework_attempt_status;
  v_max_score numeric;
begin
  select a.* into v_att from public.homework_attempts a where a.id = p_attempt_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_att.status not in ('submitted','under_review') then
    raise exception 'ATTEMPT_NOT_REVIEWABLE: status=%', v_att.status using errcode = 'P0001';
  end if;

  select group_id into v_grp_id from public.homework_assignments where id = v_att.assignment_id;
  v_can_review := public.is_admin_or_owner()
    or public.auth_is_teacher_of_group(v_grp_id)
    or public.auth_is_curator_of_group(v_grp_id);
  if not v_can_review then raise exception 'FORBIDDEN: cannot review this attempt' using errcode = 'P0001'; end if;

  if p_score is not null then
    if p_score < 0 then
      raise exception 'INVALID_SCORE: score cannot be negative' using errcode = 'P0001';
    end if;
    select tv.max_score into v_max_score
      from public.homework_assignments a join public.homework_template_versions tv on tv.id = a.template_version_id
      where a.id = v_att.assignment_id;
    if v_max_score is not null and p_score > v_max_score then
      raise exception 'INVALID_SCORE: % exceeds max_score % of this assignment''s template version', p_score, v_max_score
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.homework_reviews (attempt_id, reviewer_id, decision, score, comment)
  values (p_attempt_id, auth.uid(), p_decision, p_score, p_comment)
  returning id into v_review_id;

  v_new_status := p_decision::text::public.homework_attempt_status;

  update public.homework_attempts set status = v_new_status, score = coalesce(p_score, score) where id = p_attempt_id;

  return jsonb_build_object('review_id', v_review_id, 'attempt_id', p_attempt_id, 'status', v_new_status);
end;
$$;

revoke all on function public.submit_homework_review(uuid,public.homework_review_decision,numeric,text) from public, anon;
grant execute on function public.submit_homework_review(uuid,public.homework_review_decision,numeric,text) to authenticated;
