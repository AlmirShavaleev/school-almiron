-- ============================================================
-- Follow-up to 20260722170000: the recipient-scoped hwa_select_scoped policy caused
-- infinite RLS recursion (homework_assignments -> homework_recipients policy ->
-- homework_assignments). Route the check through a SECURITY DEFINER helper instead.
-- ============================================================

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
