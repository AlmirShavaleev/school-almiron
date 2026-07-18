begin;

create or replace function public.auth_can_view_student_number_stats(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    case
      when auth.uid() is null then false
      when public.current_user_role() in ('admin', 'owner') then true
      when public.current_user_role() = 'student' then exists (
        select 1
        from public.students s
        where s.id = p_student_id
          and s.profile_id = auth.uid()
      )
      when public.current_user_role() = 'teacher' then exists (
        select 1
        from public.group_students gs
        join public.groups g on g.id = gs.group_id
        join public.teachers t on t.id = g.teacher_id
        where gs.student_id = p_student_id
          and g.is_active = true
          and t.profile_id = auth.uid()
      )
      when public.current_user_role() = 'curator' then exists (
        select 1
        from public.group_students gs
        join public.groups g on g.id = gs.group_id
        join public.curators c on c.id = g.curator_id
        where gs.student_id = p_student_id
          and g.is_active = true
          and c.profile_id = auth.uid()
      )
      else false
    end
$$;

create or replace function public.get_student_number_stats(
  p_student_id uuid,
  p_subject text,
  p_exam_type text,
  p_exam_part integer default 1
)
returns table (
  section_id uuid,
  exam_number integer,
  section_title text,
  subject text,
  exam_type text,
  solved_count bigint,
  fully_correct_count bigint,
  partial_count bigint,
  wrong_count bigint,
  earned_points numeric,
  max_points numeric,
  success_ratio numeric,
  last_solved_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN';
  end if;

  if not public.auth_can_view_student_number_stats(p_student_id) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  with scoped_answers as (
    select
      tva.points_earned::numeric as points_earned,
      coalesce(tva.points_max, tvi.points)::numeric as points_max,
      coalesce(tva.graded_at, tva.submitted_at, tvsa.submitted_at) as solved_at,
      cs.id as section_id,
      cs.exam_number,
      cs.title as section_title,
      cs.subject,
      cs.exam_type
    from public.test_variant_answers tva
    join public.test_variant_student_assignments tvsa
      on tvsa.id = tva.student_assignment_id
    join public.test_variant_items tvi
      on tvi.id = tva.variant_item_id
    join public.test_variants tv
      on tv.id = tvsa.variant_id
    join public.catalog_sections cs
      on cs.id = tvi.section_id
    where tvsa.student_id = p_student_id
      and tvsa.submitted_at is not null
      and cs.subject = p_subject
      and cs.exam_type = p_exam_type
      and tvi.section_id is not null
      and exists (
        select 1
        from public.catalog_tasks ct
        where ct.id = tvi.task_id
          and ct.exam_part is not null
          and ct.exam_part = p_exam_part
          and not (
            tv.source_type = 'student_self_built'
            and (ct.exam_part = 2 or ct.exam_part is null)
          )
      )
  )
  select
    sa.section_id,
    sa.exam_number,
    sa.section_title,
    sa.subject,
    sa.exam_type,
    count(*) as solved_count,
    count(*) filter (where sa.points_earned = sa.points_max) as fully_correct_count,
    count(*) filter (where sa.points_earned > 0 and sa.points_earned < sa.points_max) as partial_count,
    count(*) filter (where sa.points_earned = 0) as wrong_count,
    sum(sa.points_earned) as earned_points,
    sum(sa.points_max) as max_points,
    case
      when sum(sa.points_max) > 0 then round((sum(sa.points_earned) / sum(sa.points_max)) * 100, 1)
      else null
    end as success_ratio,
    max(sa.solved_at) as last_solved_at
  from scoped_answers sa
  group by sa.section_id, sa.exam_number, sa.section_title, sa.subject, sa.exam_type
  order by sa.exam_number nulls last, sa.section_title;
end;
$$;

create index if not exists tvsa_student_submitted_variant_idx
  on public.test_variant_student_assignments(student_id, submitted_at, variant_id)
  where submitted_at is not null;

revoke all on function public.auth_can_view_student_number_stats(uuid) from public, anon;
grant execute on function public.auth_can_view_student_number_stats(uuid) to authenticated;

revoke all on function public.get_student_number_stats(uuid, text, text, integer) from public, anon;
grant execute on function public.get_student_number_stats(uuid, text, text, integer) to authenticated;

commit;
