-- Fix variant assignment deadline updates and expose student-facing assignment list.
-- Root cause of NULL deadlines: update_variant_assignment validated coalesced values
-- but wrote raw nullable params into the assignment tables.

create or replace function public.update_variant_assignment(
  p_assignment_id uuid,
  p_available_from timestamptz default null,
  p_due_at timestamptz default null,
  p_max_attempts integer default null,
  p_allow_retry boolean default null,
  p_show_answers_after_submit boolean default null,
  p_show_solutions_after_submit boolean default null,
  p_clear_available_from boolean default false,
  p_clear_due_at boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_caller uuid;
  v_asgn record;
  v_variant record;
  v_from timestamptz;
  v_due timestamptz;
  v_old_due timestamptz;
  v_due_changed boolean;
  v_max_att integer;
  v_allow_retry boolean;
  v_message text;
begin
  v_role := public.current_user_role();
  v_caller := auth.uid();

  select * into v_asgn
  from public.test_variant_assignments
  where id = p_assignment_id;

  if not found then
    raise exception 'NOT_FOUND: assignment % does not exist', p_assignment_id;
  end if;

  if v_role = 'teacher' and v_asgn.assigned_by <> v_caller then
    raise exception 'FORBIDDEN';
  elsif v_role not in ('teacher', 'admin', 'owner') then
    raise exception 'FORBIDDEN';
  end if;

  v_old_due := v_asgn.due_at;
  v_from := case
    when p_clear_available_from then null
    else coalesce(p_available_from, v_asgn.available_from)
  end;
  v_due := case
    when p_clear_due_at then null
    else coalesce(p_due_at, v_asgn.due_at)
  end;

  if v_due is not null and v_from is not null and v_due < v_from then
    raise exception 'INVALID_DATES: due_at must be after available_from';
  end if;

  if v_due is not null and v_due < now() then
    raise exception 'INVALID_DATES: due_at cannot be in the past';
  end if;

  v_allow_retry := coalesce(p_allow_retry, v_asgn.allow_retry);
  v_max_att := coalesce(p_max_attempts, v_asgn.max_attempts);

  if v_max_att < 1 then
    raise exception 'INVALID_ATTEMPTS: max_attempts must be at least 1';
  end if;

  if not v_allow_retry then
    v_max_att := 1;
  end if;

  update public.test_variant_assignments
  set available_from = v_from,
      due_at = v_due,
      max_attempts = v_max_att,
      allow_retry = v_allow_retry,
      show_answers_after_submit = coalesce(p_show_answers_after_submit, show_answers_after_submit),
      show_solutions_after_submit = coalesce(p_show_solutions_after_submit, show_solutions_after_submit),
      updated_at = now()
  where id = p_assignment_id;

  update public.test_variant_student_assignments
  set available_from = v_from,
      due_at = v_due,
      max_attempts = v_max_att,
      updated_at = now()
  where assignment_id = p_assignment_id
    and status not in ('completed', 'cancelled');

  v_due_changed := v_due is distinct from v_old_due;

  if v_due_changed then
    select * into v_variant
    from public.test_variants
    where id = v_asgn.variant_id;

    v_message := case
      when v_due is null then format('%s. Дедлайн отменён', v_variant.title)
      else format('%s. Новый дедлайн: %s', v_variant.title, to_char(v_due at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI'))
    end;

    insert into public.notifications (user_id, title, message, type, link)
    select s.profile_id,
           'Изменён дедлайн варианта',
           v_message,
           'info',
           '/student/variants'
    from public.test_variant_student_assignments tvsa
    join public.students s on s.id = tvsa.student_id
    where tvsa.assignment_id = p_assignment_id
      and tvsa.status <> 'cancelled'
      and s.profile_id is not null
      and not exists (
        select 1
        from public.notifications n
        where n.user_id = s.profile_id
          and n.title = 'Изменён дедлайн варианта'
          and n.message = v_message
          and n.link = '/student/variants'
      );
  end if;

  return jsonb_build_object(
    'ok', true,
    'assignment_id', p_assignment_id,
    'due_changed', v_due_changed
  );
end;
$$;

create or replace function public.get_my_variant_assignments()
returns table (
  id uuid,
  assignment_id uuid,
  variant_id uuid,
  student_id uuid,
  status text,
  available_from timestamptz,
  due_at timestamptz,
  max_attempts integer,
  attempts_used integer,
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  variant_title text,
  variant_description text,
  variant_subject text,
  variant_exam_type text,
  variant_tasks_count integer,
  variant_status text,
  assignment_status text,
  group_name text,
  teacher_name text
)
language sql
security definer
set search_path to 'public'
as $$
  select
    tvsa.id,
    tvsa.assignment_id,
    tvsa.variant_id,
    tvsa.student_id,
    tvsa.status,
    tvsa.available_from,
    tvsa.due_at,
    tvsa.max_attempts,
    tvsa.attempts_used,
    tvsa.started_at,
    tvsa.submitted_at,
    tvsa.completed_at,
    tvsa.created_at,
    tvsa.updated_at,
    tv.title as variant_title,
    tv.description as variant_description,
    tv.subject as variant_subject,
    tv.exam_type as variant_exam_type,
    tv.tasks_count as variant_tasks_count,
    tv.status as variant_status,
    tva.status as assignment_status,
    g.name as group_name,
    coalesce(group_teacher_profile.full_name, assigned_by_profile.full_name, variant_owner_profile.full_name) as teacher_name
  from public.test_variant_student_assignments tvsa
  join public.students s on s.id = tvsa.student_id
  join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
  join public.test_variants tv on tv.id = tvsa.variant_id
  left join public.groups g on g.id = tva.group_id
  left join public.teachers gt on gt.id = g.teacher_id
  left join public.profiles group_teacher_profile on group_teacher_profile.id = gt.profile_id
  left join public.profiles assigned_by_profile on assigned_by_profile.id = tva.assigned_by
  left join public.profiles variant_owner_profile on variant_owner_profile.id = tv.created_by
  where public.current_user_role() = 'student'
    and s.profile_id = auth.uid()
    and tvsa.status <> 'cancelled'
    and tva.status <> 'cancelled'
  order by tvsa.created_at desc;
$$;

grant execute on function public.get_my_variant_assignments() to authenticated;
