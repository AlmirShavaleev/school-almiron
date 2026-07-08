-- Fix variant group assignment RPCs.
-- Root cause: previous functions used ON CONFLICT ON CONSTRAINT for unique indexes.

alter table public.notifications
  add column if not exists link text;

create or replace function public.assign_test_variant(
  p_variant_id uuid,
  p_student_ids uuid[] default '{}'::uuid[],
  p_group_ids uuid[] default '{}'::uuid[],
  p_available_from timestamptz default null,
  p_due_at timestamptz default null,
  p_max_attempts integer default 1,
  p_allow_retry boolean default false,
  p_show_answers_after_submit boolean default false,
  p_show_solutions_after_submit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_caller_id uuid;
  v_variant record;
  v_max_att integer;
  v_gid uuid;
  v_sid uuid;
  v_assignment_id uuid;
  v_group_student_ids uuid[];
  v_all_student_ids uuid[] := '{}';
  v_deduped_ids uuid[] := '{}';
  v_groups_assigned integer := 0;
  v_unique_students integer := 0;
  v_students_created integer := 0;
  v_duplicates_skipped integer := 0;
  v_already_assigned integer := 0;
  v_empty_groups integer := 0;
  v_warnings text[] := '{}';
  v_profile_id uuid;
  v_due_text text;
begin
  v_role := public.current_user_role();
  v_caller_id := auth.uid();

  if v_role not in ('teacher', 'admin', 'owner') then
    raise exception 'FORBIDDEN: only teacher/admin/owner can assign variants';
  end if;

  select * into v_variant
  from public.test_variants
  where id = p_variant_id;

  if not found then
    raise exception 'NOT_FOUND: variant % does not exist', p_variant_id;
  end if;

  if v_role = 'teacher' and v_variant.created_by <> v_caller_id then
    raise exception 'FORBIDDEN: teacher can only assign own variants';
  end if;

  if v_variant.tasks_count = 0 then
    raise exception 'EMPTY_VARIANT: cannot assign a variant with no tasks';
  end if;

  if v_variant.status <> 'ready' then
    v_warnings := array_append(v_warnings, 'variant_not_ready: вариант еще в статусе draft');
  end if;

  if coalesce(array_length(p_group_ids, 1), 0) = 0
     and coalesce(array_length(p_student_ids, 1), 0) = 0 then
    raise exception 'NO_TARGET: at least one group or student must be specified';
  end if;

  if p_max_attempts < 1 then
    raise exception 'INVALID_ATTEMPTS: max_attempts must be at least 1';
  end if;

  v_max_att := p_max_attempts;
  if not p_allow_retry then
    v_max_att := 1;
  end if;

  if p_due_at is not null and p_available_from is not null and p_due_at < p_available_from then
    raise exception 'INVALID_DATES: due_at must be after available_from';
  end if;

  if p_due_at is not null and p_due_at < now() then
    raise exception 'INVALID_DATES: due_at cannot be in the past';
  end if;

  foreach v_gid in array coalesce(p_group_ids, '{}')
  loop
    if v_role = 'teacher' and not exists (
      select 1
      from public.groups g
      join public.teachers t on t.id = g.teacher_id
      where g.id = v_gid
        and g.is_active = true
        and t.profile_id = v_caller_id
    ) then
      raise exception 'FORBIDDEN: teacher does not own group %', v_gid;
    end if;

    select coalesce(array_agg(distinct gs.student_id), '{}')
    into v_group_student_ids
    from public.group_students gs
    join public.students s on s.id = gs.student_id
    where gs.group_id = v_gid
      and s.is_active = true;

    if coalesce(array_length(v_group_student_ids, 1), 0) = 0 then
      v_empty_groups := v_empty_groups + 1;
      v_warnings := array_append(v_warnings, format('empty_group:%s:В группе нет учеников', v_gid));
      continue;
    end if;

    if exists (
      select 1
      from public.test_variant_assignments
      where variant_id = p_variant_id
        and group_id = v_gid
        and status <> 'cancelled'
    ) then
      v_already_assigned := v_already_assigned + 1;
      v_warnings := array_append(v_warnings, format('already_assigned_group:%s:Вариант уже назначен этой группе', v_gid));
      v_all_student_ids := v_all_student_ids || v_group_student_ids;
      continue;
    end if;

    insert into public.test_variant_assignments (
      variant_id, assigned_by, group_id,
      available_from, due_at, max_attempts, allow_retry,
      show_answers_after_submit, show_solutions_after_submit, status
    )
    values (
      p_variant_id, v_caller_id, v_gid,
      p_available_from, p_due_at, v_max_att, p_allow_retry,
      p_show_answers_after_submit, p_show_solutions_after_submit, 'assigned'
    )
    on conflict (variant_id, group_id) where group_id is not null do update
      set assigned_by = excluded.assigned_by,
          status = 'assigned',
          available_from = excluded.available_from,
          due_at = excluded.due_at,
          max_attempts = excluded.max_attempts,
          allow_retry = excluded.allow_retry,
          show_answers_after_submit = excluded.show_answers_after_submit,
          show_solutions_after_submit = excluded.show_solutions_after_submit,
          updated_at = now()
      where public.test_variant_assignments.status = 'cancelled'
    returning id into v_assignment_id;

    if v_assignment_id is null then
      v_already_assigned := v_already_assigned + 1;
      v_warnings := array_append(v_warnings, format('already_assigned_group:%s:Вариант уже назначен этой группе', v_gid));
      v_all_student_ids := v_all_student_ids || v_group_student_ids;
      continue;
    end if;

    v_groups_assigned := v_groups_assigned + 1;
    v_all_student_ids := v_all_student_ids || v_group_student_ids;
  end loop;

  foreach v_sid in array coalesce(p_student_ids, '{}')
  loop
    if v_role = 'teacher' and not exists (
      select 1
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
      join public.teachers t on t.id = g.teacher_id
      where gs.student_id = v_sid
        and t.profile_id = v_caller_id
    ) then
      raise exception 'FORBIDDEN: teacher cannot assign to student %', v_sid;
    end if;

    v_all_student_ids := array_append(v_all_student_ids, v_sid);
  end loop;

  select coalesce(array_agg(distinct s), '{}')
  into v_deduped_ids
  from unnest(coalesce(v_all_student_ids, '{}')) as s;

  v_unique_students := coalesce(array_length(v_deduped_ids, 1), 0);
  v_duplicates_skipped := coalesce(array_length(v_all_student_ids, 1), 0) - v_unique_students;

  foreach v_sid in array coalesce(p_student_ids, '{}')
  loop
    insert into public.test_variant_assignments (
      variant_id, assigned_by, student_id,
      available_from, due_at, max_attempts, allow_retry,
      show_answers_after_submit, show_solutions_after_submit, status
    )
    values (
      p_variant_id, v_caller_id, v_sid,
      p_available_from, p_due_at, v_max_att, p_allow_retry,
      p_show_answers_after_submit, p_show_solutions_after_submit, 'assigned'
    )
    on conflict (variant_id, student_id) where student_id is not null do nothing
    returning id into v_assignment_id;
  end loop;

  foreach v_sid in array v_deduped_ids
  loop
    select tva.id into v_assignment_id
    from public.test_variant_assignments tva
    where tva.variant_id = p_variant_id
      and tva.student_id = v_sid
      and tva.status <> 'cancelled'
    limit 1;

    if v_assignment_id is null then
      select tva.id into v_assignment_id
      from public.test_variant_assignments tva
      join public.group_students gs on gs.group_id = tva.group_id
      where tva.variant_id = p_variant_id
        and gs.student_id = v_sid
        and tva.status <> 'cancelled'
      order by tva.created_at
      limit 1;
    end if;

    if v_assignment_id is null then
      continue;
    end if;

    insert into public.test_variant_student_assignments (
      assignment_id, variant_id, student_id,
      available_from, due_at, max_attempts, status
    )
    values (
      v_assignment_id, p_variant_id, v_sid,
      p_available_from, p_due_at, v_max_att, 'not_started'
    )
    on conflict (variant_id, student_id) do nothing;

    if found then
      v_students_created := v_students_created + 1;

      select s.profile_id into v_profile_id
      from public.students s
      where s.id = v_sid;

      v_due_text := case
        when p_due_at is not null then 'Дедлайн: ' || to_char(p_due_at at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI')
        else 'Без дедлайна'
      end;

      if v_profile_id is not null and not exists (
        select 1
        from public.notifications n
        where n.user_id = v_profile_id
          and n.title = 'Назначен новый вариант'
          and n.message = format('%s. %s', v_variant.title, v_due_text)
      ) then
        insert into public.notifications (user_id, title, message, type, link)
        values (
          v_profile_id,
          'Назначен новый вариант',
          format('%s. %s', v_variant.title, v_due_text),
          'info',
          '/student/variants'
        );
      end if;
    else
      v_already_assigned := v_already_assigned + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'groups_assigned', v_groups_assigned,
    'unique_students', v_unique_students,
    'students_created', v_students_created,
    'duplicates_skipped', v_duplicates_skipped,
    'already_assigned', v_already_assigned,
    'empty_groups', v_empty_groups,
    'warnings', to_jsonb(v_warnings)
  );
end;
$$;

create or replace function public.update_variant_assignment(
  p_assignment_id uuid,
  p_available_from timestamptz default null,
  p_due_at timestamptz default null,
  p_max_attempts integer default null,
  p_allow_retry boolean default null,
  p_show_answers_after_submit boolean default null,
  p_show_solutions_after_submit boolean default null
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
  v_from timestamptz;
  v_due timestamptz;
  v_max_att integer;
  v_allow_retry boolean;
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

  v_from := coalesce(p_available_from, v_asgn.available_from);
  v_due := coalesce(p_due_at, v_asgn.due_at);

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
  set available_from = p_available_from,
      due_at = p_due_at,
      max_attempts = v_max_att,
      allow_retry = v_allow_retry,
      show_answers_after_submit = coalesce(p_show_answers_after_submit, show_answers_after_submit),
      show_solutions_after_submit = coalesce(p_show_solutions_after_submit, show_solutions_after_submit),
      updated_at = now()
  where id = p_assignment_id;

  update public.test_variant_student_assignments
  set available_from = p_available_from,
      due_at = p_due_at,
      max_attempts = v_max_att,
      updated_at = now()
  where assignment_id = p_assignment_id
    and status not in ('completed', 'cancelled');

  return jsonb_build_object('ok', true, 'assignment_id', p_assignment_id);
end;
$$;

create or replace function public.cancel_variant_assignment(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
  v_caller uuid;
begin
  v_role := public.current_user_role();
  v_caller := auth.uid();

  if v_role = 'teacher' then
    if not exists (
      select 1
      from public.test_variant_assignments
      where id = p_assignment_id
        and assigned_by = v_caller
    ) then
      raise exception 'FORBIDDEN';
    end if;
  elsif v_role not in ('admin', 'owner') then
    raise exception 'FORBIDDEN';
  end if;

  update public.test_variant_assignments
  set status = 'cancelled',
      updated_at = now()
  where id = p_assignment_id;

  update public.test_variant_student_assignments
  set status = 'cancelled',
      updated_at = now()
  where assignment_id = p_assignment_id
    and status <> 'completed';

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.sync_group_assignment(p_assignment_id uuid)
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
  v_sid uuid;
  v_added integer := 0;
  v_skipped integer := 0;
  v_profile_id uuid;
begin
  v_role := public.current_user_role();
  v_caller := auth.uid();

  select * into v_asgn
  from public.test_variant_assignments
  where id = p_assignment_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_asgn.group_id is null then
    raise exception 'NOT_GROUP_ASSIGNMENT';
  end if;

  if v_role = 'teacher' and v_asgn.assigned_by <> v_caller then
    raise exception 'FORBIDDEN';
  elsif v_role not in ('teacher', 'admin', 'owner') then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_variant
  from public.test_variants
  where id = v_asgn.variant_id;

  for v_sid in
    select gs.student_id
    from public.group_students gs
    join public.students s on s.id = gs.student_id
    where gs.group_id = v_asgn.group_id
      and s.is_active = true
  loop
    insert into public.test_variant_student_assignments (
      assignment_id, variant_id, student_id,
      available_from, due_at, max_attempts, status
    )
    values (
      p_assignment_id, v_asgn.variant_id, v_sid,
      v_asgn.available_from, v_asgn.due_at, v_asgn.max_attempts, 'not_started'
    )
    on conflict (variant_id, student_id) do nothing;

    if found then
      v_added := v_added + 1;

      select s.profile_id into v_profile_id
      from public.students s
      where s.id = v_sid;

      if v_profile_id is not null and not exists (
        select 1
        from public.notifications n
        where n.user_id = v_profile_id
          and n.title = 'Назначен новый вариант'
          and n.message = format('%s. %s', v_variant.title, coalesce('Дедлайн: ' || to_char(v_asgn.due_at at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI'), 'Без дедлайна'))
      ) then
        insert into public.notifications (user_id, title, message, type, link)
        values (
          v_profile_id,
          'Назначен новый вариант',
          format('%s. %s', v_variant.title, coalesce('Дедлайн: ' || to_char(v_asgn.due_at at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI'), 'Без дедлайна')),
          'info',
          '/student/variants'
        );
      end if;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'skipped', v_skipped);
end;
$$;
