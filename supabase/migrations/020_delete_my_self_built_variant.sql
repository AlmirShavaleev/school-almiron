create or replace function public.delete_my_variant(
  p_student_assignment_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile_id uuid := auth.uid();
  v_student_id uuid;
  v_variant_id uuid;
  v_assignment_id uuid;
  v_assignment_student_id uuid;
begin
  if public.current_user_role() <> 'student' then
    raise exception 'FORBIDDEN: only students can delete variants from this section';
  end if;

  select s.id
    into v_student_id
  from public.students s
  where s.profile_id = v_profile_id
    and s.is_active = true
  limit 1;

  if v_student_id is null then
    raise exception 'FORBIDDEN: active student profile not found';
  end if;

  select
    tvsa.variant_id,
    tvsa.assignment_id,
    tvsa.student_id
  into
    v_variant_id,
    v_assignment_id,
    v_assignment_student_id
  from public.test_variant_student_assignments tvsa
  where tvsa.id = p_student_assignment_id
  limit 1;

  if v_variant_id is null then
    raise exception 'NOT_FOUND: variant assignment does not exist';
  end if;

  if v_assignment_student_id <> v_student_id then
    raise exception 'FORBIDDEN: cannot delete another student''s variant';
  end if;

  delete from public.test_variant_answer_attachments
  where student_assignment_id = p_student_assignment_id;

  delete from public.test_variant_answers
  where student_assignment_id = p_student_assignment_id;

  delete from public.test_variant_student_assignments
  where id = p_student_assignment_id;

  delete from public.test_variant_assignments
  where id = v_assignment_id
    and not exists (
      select 1
      from public.test_variant_student_assignments
      where assignment_id = v_assignment_id
    );

  delete from public.test_variant_items
  where variant_id = v_variant_id
    and not exists (
      select 1
      from public.test_variant_student_assignments
      where variant_id = v_variant_id
    )
    and not exists (
      select 1
      from public.test_variant_assignments
      where variant_id = v_variant_id
    );

  delete from public.test_variants
  where id = v_variant_id
    and not exists (
      select 1
      from public.test_variant_student_assignments
      where variant_id = v_variant_id
    )
    and not exists (
      select 1
      from public.test_variant_assignments
      where variant_id = v_variant_id
    );
end;
$$;

grant execute on function public.delete_my_variant(uuid) to authenticated;
