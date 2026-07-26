-- ============================================================
-- get_student_homework_journal only allowed admin/owner or a teacher of the student's groups —
-- the student viewing their OWN journal (MyProgressPage) got an empty result instead of their
-- own data. Add a self-access branch. Additive migration; does not edit 20260723150000.
-- ============================================================

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
declare
  v_is_self boolean;
begin
  select exists (select 1 from public.students s where s.id = p_student_id and s.profile_id = auth.uid())
    into v_is_self;

  if not (
    v_is_self
    or public.is_admin_or_owner()
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
      and (v_is_self or public.is_admin_or_owner() or public.auth_is_teacher_of_group(b.group_id))
    order by b.effective_due_at desc nulls last;
end;
$$;
revoke all on function public.get_student_homework_journal(uuid) from public, anon;
grant execute on function public.get_student_homework_journal(uuid) to authenticated;
