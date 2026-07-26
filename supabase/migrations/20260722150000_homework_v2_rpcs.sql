-- ============================================================
-- Homework v2 — RPCs (Phase A, step 2/3)
-- ============================================================

-- ── create_or_update_template_draft ──────────────────────────
-- Creates a template on first call (p_template_id null). On later calls, updates the
-- latest version in place UNLESS that version is already referenced by an assignment,
-- in which case a new version is created (immutability once used).
create or replace function public.create_or_update_template_draft(
  p_template_id  uuid,
  p_course_id    uuid,
  p_topic_id     uuid,
  p_title        text,
  p_instructions text,
  p_pdf_config   jsonb,
  p_max_score    numeric,
  p_items        jsonb,   -- [{catalog_task_id, position, custom_number}]
  p_files        jsonb    -- [{storage_path, original_filename, mime_type, size_bytes}]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_template_id uuid;
  v_version_id uuid;
  v_version_no int;
  v_locked boolean;
  v_item jsonb;
  v_file jsonb;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role not in ('teacher','admin','owner') then
    raise exception 'FORBIDDEN: role % cannot manage homework templates' , v_role using errcode = 'P0001';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'TITLE_REQUIRED' using errcode = 'P0001';
  end if;

  if p_template_id is null then
    if not (public.is_admin_or_owner() or public.auth_is_course_owner(p_course_id)) then
      raise exception 'FORBIDDEN: not course owner' using errcode = 'P0001';
    end if;
    insert into public.homework_templates (course_id, topic_id, title, created_by, status)
    values (p_course_id, p_topic_id, p_title, auth.uid(), 'active')
    returning id into v_template_id;
    v_version_no := 1;
  else
    select id into v_template_id from public.homework_templates
      where id = p_template_id
        and (public.is_admin_or_owner() or public.auth_is_course_owner(course_id) or created_by = auth.uid())
      for update;
    if v_template_id is null then
      raise exception 'TEMPLATE_NOT_FOUND' using errcode = 'P0001';
    end if;
    update public.homework_templates set title = p_title, topic_id = p_topic_id where id = v_template_id;

    select v.id, v.version into v_version_id, v_version_no
      from public.homework_template_versions v
      where v.template_id = v_template_id
      order by v.version desc limit 1;

    if v_version_id is not null then
      select exists(select 1 from public.homework_assignments where template_version_id = v_version_id) into v_locked;
      if not v_locked then
        -- latest version unused by any assignment yet: edit it in place
        update public.homework_template_versions
          set instructions = p_instructions, pdf_config = coalesce(p_pdf_config, '{}'::jsonb), max_score = p_max_score
          where id = v_version_id;
        delete from public.homework_template_items where template_version_id = v_version_id;
        delete from public.homework_template_files where template_version_id = v_version_id;
      else
        v_version_id := null; -- force new version below
      end if;
    end if;
    if v_version_id is null then
      v_version_no := coalesce(v_version_no, 0) + 1;
    end if;
  end if;

  if v_version_id is null then
    insert into public.homework_template_versions
      (template_id, version, instructions, pdf_config, max_score, created_by)
    values
      (v_template_id, v_version_no, p_instructions, coalesce(p_pdf_config, '{}'::jsonb), p_max_score, auth.uid())
    returning id into v_version_id;
  end if;

  if p_items is not null then
    for v_item in select * from jsonb_array_elements(p_items) loop
      insert into public.homework_template_items (template_version_id, catalog_task_id, position, custom_number)
      values (
        v_version_id,
        (v_item->>'catalog_task_id')::uuid,
        (v_item->>'position')::int,
        nullif(v_item->>'custom_number','')
      );
    end loop;
  end if;

  if p_files is not null then
    for v_file in select * from jsonb_array_elements(p_files) loop
      insert into public.homework_template_files (template_version_id, storage_path, original_filename, mime_type, size_bytes)
      values (
        v_version_id,
        v_file->>'storage_path',
        v_file->>'original_filename',
        v_file->>'mime_type',
        nullif(v_file->>'size_bytes','')::bigint
      );
    end loop;
  end if;

  return jsonb_build_object('template_id', v_template_id, 'template_version_id', v_version_id, 'version', v_version_no);
end;
$$;

revoke all on function public.create_or_update_template_draft(uuid,uuid,uuid,text,text,jsonb,numeric,jsonb,jsonb) from public, anon;
grant execute on function public.create_or_update_template_draft(uuid,uuid,uuid,text,text,jsonb,numeric,jsonb,jsonb) to authenticated;

-- ── assign_homework ───────────────────────────────────────────
create or replace function public.assign_homework(
  p_template_version_id  uuid,
  p_group_id             uuid,
  p_student_ids          uuid[],       -- null => whole group
  p_publish_now          boolean,
  p_publish_at           timestamptz,
  p_due_at               timestamptz,
  p_max_attempts         integer,
  p_allow_late           boolean,
  p_request_id           uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_grp public.groups%rowtype;
  v_template_course_id uuid;
  v_assignment_id uuid;
  v_publish_at timestamptz;
  v_status public.homework_assignment_status;
  v_existing jsonb;
  v_recipient_count int;
  v_result jsonb;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role not in ('teacher','admin','owner') then
    raise exception 'FORBIDDEN: role % cannot assign homework', v_role using errcode = 'P0001';
  end if;

  if p_request_id is not null then
    select result into v_existing from public.homework_assignment_requests
      where teacher_id = auth.uid() and request_id = p_request_id and status = 'completed';
    if v_existing is not null then return v_existing; end if;

    begin
      insert into public.homework_assignment_requests (teacher_id, request_id, status)
      values (auth.uid(), p_request_id, 'pending');
    exception when unique_violation then
      select result into v_existing from public.homework_assignment_requests
        where teacher_id = auth.uid() and request_id = p_request_id;
      if v_existing is null then raise exception 'IDEMPOTENCY_IN_PROGRESS' using errcode = 'P0001'; end if;
      return v_existing;
    end;
  end if;

  select * into v_grp from public.groups where id = p_group_id for update;
  if not found then raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001'; end if;
  if not (public.is_admin_or_owner() or (v_grp.teacher_id in (select id from public.teachers where profile_id = auth.uid()))) then
    raise exception 'FORBIDDEN: not your group' using errcode = 'P0001';
  end if;

  select t.course_id into v_template_course_id
    from public.homework_template_versions v join public.homework_templates t on t.id = v.template_id
    where v.id = p_template_version_id;
  if v_template_course_id is null then raise exception 'TEMPLATE_VERSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_template_course_id is distinct from v_grp.course_id then
    raise exception 'GROUP_COURSE_MISMATCH' using errcode = 'P0001';
  end if;

  if p_due_at is null or p_publish_at is null or p_due_at <= p_publish_at then
    raise exception 'INVALID_DATES: due_at must be after publish_at' using errcode = 'P0001';
  end if;

  v_publish_at := case when p_publish_now then now() else p_publish_at end;
  v_status := 'published';

  insert into public.homework_assignments
    (template_version_id, group_id, teacher_id, status, publish_at, due_at, max_attempts, allow_late_submission)
  values
    (p_template_version_id, p_group_id, auth.uid(), v_status, v_publish_at, p_due_at, p_max_attempts, coalesce(p_allow_late, true))
  returning id into v_assignment_id;

  if p_student_ids is not null and array_length(p_student_ids, 1) > 0 then
    insert into public.homework_recipients (assignment_id, student_id)
    select v_assignment_id, gs.student_id
      from public.group_students gs
      where gs.group_id = p_group_id and gs.student_id = any(p_student_ids)
    on conflict do nothing;
  else
    insert into public.homework_recipients (assignment_id, student_id)
    select v_assignment_id, gs.student_id
      from public.group_students gs
      where gs.group_id = p_group_id
    on conflict do nothing;
  end if;

  select count(*) into v_recipient_count from public.homework_recipients where assignment_id = v_assignment_id;
  if v_recipient_count = 0 then
    raise exception 'NO_RECIPIENTS: group has no matching students' using errcode = 'P0001';
  end if;

  v_result := jsonb_build_object(
    'assignment_id', v_assignment_id,
    'group_id', p_group_id,
    'template_version_id', p_template_version_id,
    'recipient_count', v_recipient_count,
    'publish_at', v_publish_at,
    'due_at', p_due_at
  );

  if p_request_id is not null then
    update public.homework_assignment_requests
      set status = 'completed', result = v_result, completed_at = now()
      where teacher_id = auth.uid() and request_id = p_request_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.assign_homework(uuid,uuid,uuid[],boolean,timestamptz,timestamptz,integer,boolean,uuid) from public, anon;
grant execute on function public.assign_homework(uuid,uuid,uuid[],boolean,timestamptz,timestamptz,integer,boolean,uuid) to authenticated;

-- ── start_homework_attempt ────────────────────────────────────
-- Returns an existing draft attempt if one exists, else creates a new one. Serializes
-- concurrent calls for the same (assignment_id, student_id) via advisory lock so two
-- simultaneous submits cannot race the attempt_number allocation.
create or replace function public.start_homework_attempt(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id uuid;
  v_assignment public.homework_assignments%rowtype;
  v_recipient public.homework_recipients%rowtype;
  v_last_status public.homework_attempt_status;
  v_last_decision public.homework_review_decision;
  v_attempt_count int;
  v_attempt_id uuid;
  v_next_no int;
  v_effective_due timestamptz;
begin
  select id into v_student_id from public.students where profile_id = auth.uid();
  if v_student_id is null then raise exception 'NOT_A_STUDENT' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text || ':' || v_student_id::text, 0));

  select * into v_assignment from public.homework_assignments where id = p_assignment_id;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_recipient from public.homework_recipients
    where assignment_id = p_assignment_id and student_id = v_student_id;
  if not found then raise exception 'NOT_A_RECIPIENT' using errcode = 'P0001'; end if;

  if v_assignment.status not in ('published') then
    raise exception 'ASSIGNMENT_NOT_OPEN: status=%', v_assignment.status using errcode = 'P0001';
  end if;
  if v_assignment.publish_at > now() then
    raise exception 'ASSIGNMENT_NOT_PUBLISHED_YET' using errcode = 'P0001';
  end if;

  select count(*) into v_attempt_count from public.homework_attempts
    where assignment_id = p_assignment_id and student_id = v_student_id;

  select status into v_last_status from public.homework_attempts
    where assignment_id = p_assignment_id and student_id = v_student_id
    order by attempt_number desc limit 1;

  if v_last_status = 'draft' then
    select id into v_attempt_id from public.homework_attempts
      where assignment_id = p_assignment_id and student_id = v_student_id and status = 'draft'
      order by attempt_number desc limit 1;
    return jsonb_build_object('attempt_id', v_attempt_id, 'reused', true);
  end if;

  if v_assignment.max_attempts is not null and v_attempt_count >= v_assignment.max_attempts then
    raise exception 'MAX_ATTEMPTS_REACHED' using errcode = 'P0001';
  end if;

  select r.decision into v_last_decision
    from public.homework_reviews r
    join public.homework_attempts a on a.id = r.attempt_id
    where a.assignment_id = p_assignment_id and a.student_id = v_student_id
    order by r.created_at desc limit 1;

  v_effective_due := coalesce(v_recipient.due_at_override, v_assignment.due_at);

  if now() > v_effective_due and not v_assignment.allow_late_submission and v_last_decision is distinct from 'returned_for_revision' then
    raise exception 'PAST_DUE: late submission not allowed' using errcode = 'P0001';
  end if;

  v_next_no := v_attempt_count + 1;
  insert into public.homework_attempts (assignment_id, student_id, attempt_number, status)
  values (p_assignment_id, v_student_id, v_next_no, 'draft')
  returning id into v_attempt_id;

  update public.homework_recipients set viewed_at = coalesce(viewed_at, now())
    where assignment_id = p_assignment_id and student_id = v_student_id;

  return jsonb_build_object('attempt_id', v_attempt_id, 'attempt_number', v_next_no, 'reused', false);
end;
$$;

revoke all on function public.start_homework_attempt(uuid) from public, anon;
grant execute on function public.start_homework_attempt(uuid) to authenticated;

-- ── finalize_homework_attempt ─────────────────────────────────
-- Validates each storage path server-side (owner + prefix) before attaching files and
-- moving the attempt to 'submitted'. Client never gets to assert whose object it is.
create or replace function public.finalize_homework_attempt(
  p_attempt_id     uuid,
  p_answer_text    text,
  p_storage_paths  jsonb  -- [{storage_path, file_name, mime_type, size}]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id uuid;
  v_att public.homework_attempts%rowtype;
  v_path jsonb;
  v_owner uuid;
  v_expected_prefix text;
  v_count int;
begin
  select id into v_student_id from public.students where profile_id = auth.uid();
  if v_student_id is null then raise exception 'NOT_A_STUDENT' using errcode = 'P0001'; end if;

  select * into v_att from public.homework_attempts where id = p_attempt_id and student_id = v_student_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_att.status not in ('draft') then
    raise exception 'ATTEMPT_NOT_EDITABLE: status=%', v_att.status using errcode = 'P0001';
  end if;

  v_expected_prefix := auth.uid()::text || '/' || p_attempt_id::text || '/';

  if p_storage_paths is not null then
    for v_path in select * from jsonb_array_elements(p_storage_paths) loop
      if left(v_path->>'storage_path', length(v_expected_prefix)) <> v_expected_prefix then
        raise exception 'INVALID_STORAGE_PATH: % is outside the allowed prefix', v_path->>'storage_path' using errcode = 'P0001';
      end if;

      select owner into v_owner from storage.objects
        where bucket_id = 'homework-attempts' and name = v_path->>'storage_path';
      if v_owner is null then
        raise exception 'STORAGE_OBJECT_NOT_FOUND: %', v_path->>'storage_path' using errcode = 'P0001';
      end if;
      if v_owner is distinct from auth.uid() then
        raise exception 'FORBIDDEN: storage object not owned by caller' using errcode = 'P0001';
      end if;

      insert into public.homework_attempt_files (attempt_id, storage_path, file_name, mime_type, size)
      values (p_attempt_id, v_path->>'storage_path', v_path->>'file_name', v_path->>'mime_type', nullif(v_path->>'size','')::bigint);
    end loop;
  end if;

  select count(*) into v_count from public.homework_attempt_files where attempt_id = p_attempt_id;
  if v_count = 0 and (p_answer_text is null or btrim(p_answer_text) = '') then
    raise exception 'EMPTY_SUBMISSION: attach a file or provide an answer' using errcode = 'P0001';
  end if;

  update public.homework_attempts
    set answer_text = p_answer_text, status = 'submitted', submitted_at = now()
    where id = p_attempt_id;

  return jsonb_build_object('attempt_id', p_attempt_id, 'status', 'submitted');
end;
$$;

revoke all on function public.finalize_homework_attempt(uuid,text,jsonb) from public, anon;
grant execute on function public.finalize_homework_attempt(uuid,text,jsonb) to authenticated;

-- ── submit_homework_review ────────────────────────────────────
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
