-- ============================================================
-- Homework v2 — anti-abuse rate limiting + content constraints (stabilization, step 2).
-- New additive migration; 20260722140000/150000/160000/170000/170001 are not edited.
-- ============================================================

-- ── generic per-actor/per-action rate limit log ──────────────
create table public.homework_action_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null,
  action      text not null,
  created_at  timestamptz not null default now()
);
create index idx_homework_action_log_lookup on public.homework_action_log (actor_id, action, created_at desc);

alter table public.homework_action_log enable row level security;
-- No policies granted to authenticated: only SECURITY DEFINER functions read/write this table.

-- Prunes old rows so the table doesn't grow unbounded; called opportunistically inside the
-- enforcement function rather than requiring a separate cron job.
create or replace function public._prune_homework_action_log()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.homework_action_log where created_at < now() - interval '2 hours';
$$;
revoke all on function public._prune_homework_action_log() from public, anon, authenticated;

-- p_max_per_minute/p_max_per_hour: null disables that window's check. Serializes concurrent
-- calls for the same (actor, action) via advisory lock so parallel requests can't all read
-- "count = 0" and slip through together.
create or replace function public._enforce_homework_rate_limit(
  p_actor uuid, p_action text, p_max_per_minute int, p_max_per_hour int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_minute_count int;
  v_hour_count int;
  v_oldest_in_window timestamptz;
  v_retry_after int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_action, 1));

  if random() < 0.05 then perform public._prune_homework_action_log(); end if;

  if p_max_per_minute is not null then
    select count(*), min(created_at) into v_minute_count, v_oldest_in_window
      from public.homework_action_log
      where actor_id = p_actor and action = p_action and created_at > now() - interval '1 minute';
    if v_minute_count >= p_max_per_minute then
      v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest_in_window + interval '1 minute' - now())))::int);
      raise exception 'RATE_LIMITED:%', v_retry_after using errcode = 'P0001';
    end if;
  end if;

  if p_max_per_hour is not null then
    select count(*), min(created_at) into v_hour_count, v_oldest_in_window
      from public.homework_action_log
      where actor_id = p_actor and action = p_action and created_at > now() - interval '1 hour';
    if v_hour_count >= p_max_per_hour then
      v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest_in_window + interval '1 hour' - now())))::int);
      raise exception 'RATE_LIMITED:%', v_retry_after using errcode = 'P0001';
    end if;
  end if;

  insert into public.homework_action_log (actor_id, action) values (p_actor, p_action);
end;
$$;
revoke all on function public._enforce_homework_rate_limit(uuid,text,int,int) from public, anon, authenticated;

-- ── content limits (checked server-side; storage.objects.metadata is server-set on actual
-- upload and NOT trusted from client input — the previous finalize_homework_attempt only
-- validated ownership/prefix, not size/mime, and trusted the client-supplied mime_type/size
-- fields for informational display only). ──
-- homework_attempts.answer_text bound as defense-in-depth alongside the RPC-level check.
alter table public.homework_attempts add constraint homework_attempts_answer_text_len check (answer_text is null or char_length(answer_text) <= 20000);

-- ── start_homework_attempt: add rate limiting (3/min, 15/hour combined with finalize) ──
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

  -- Rate limit only actually-new attempts, not resumption of an existing draft above — a
  -- student re-opening the same unfinished attempt shouldn't burn their action budget.
  perform public._enforce_homework_rate_limit(v_student_id, 'homework_attempt_action', 3, 15);

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

-- ── finalize_homework_attempt: rate limit + real content validation against storage.objects
-- server-set metadata (size/mimetype), not the client-supplied JSON fields ──
create or replace function public.finalize_homework_attempt(
  p_attempt_id     uuid,
  p_answer_text    text,
  p_storage_paths  jsonb
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
  v_metadata jsonb;
  v_size bigint;
  v_mime text;
  v_total_size bigint := 0;
  v_file_count int := 0;
  v_expected_prefix text;
  v_count int;
  c_max_files constant int := 10;
  c_max_file_size constant bigint := 20 * 1024 * 1024;   -- 20 MB
  c_max_total_size constant bigint := 100 * 1024 * 1024; -- 100 MB
  c_allowed_mime constant text[] := array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];
begin
  select id into v_student_id from public.students where profile_id = auth.uid();
  if v_student_id is null then raise exception 'NOT_A_STUDENT' using errcode = 'P0001'; end if;

  select * into v_att from public.homework_attempts where id = p_attempt_id and student_id = v_student_id for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_att.status not in ('draft') then
    raise exception 'ATTEMPT_NOT_EDITABLE: status=%', v_att.status using errcode = 'P0001';
  end if;

  perform public._enforce_homework_rate_limit(v_student_id, 'homework_attempt_action', 3, 15);

  if p_answer_text is not null and char_length(p_answer_text) > 20000 then
    raise exception 'ANSWER_TOO_LONG: ответ длиннее 20000 символов' using errcode = 'P0001';
  end if;

  v_expected_prefix := auth.uid()::text || '/' || p_attempt_id::text || '/';

  if p_storage_paths is not null then
    v_file_count := jsonb_array_length(p_storage_paths);
    if v_file_count > c_max_files then
      raise exception 'TOO_MANY_FILES: максимум % файлов на попытку', c_max_files using errcode = 'P0001';
    end if;

    for v_path in select * from jsonb_array_elements(p_storage_paths) loop
      if left(v_path->>'storage_path', length(v_expected_prefix)) <> v_expected_prefix then
        raise exception 'INVALID_STORAGE_PATH: % is outside the allowed prefix', v_path->>'storage_path' using errcode = 'P0001';
      end if;

      select owner, metadata into v_owner, v_metadata from storage.objects
        where bucket_id = 'homework-attempts' and name = v_path->>'storage_path';
      if v_owner is null then
        raise exception 'STORAGE_OBJECT_NOT_FOUND: %', v_path->>'storage_path' using errcode = 'P0001';
      end if;
      if v_owner is distinct from auth.uid() then
        raise exception 'FORBIDDEN: storage object not owned by caller' using errcode = 'P0001';
      end if;

      -- size/mimetype come from storage.objects.metadata (set by the storage service on
      -- actual upload), never from the client-supplied p_storage_paths fields.
      v_size := nullif(v_metadata->>'size', '')::bigint;
      v_mime := v_metadata->>'mimetype';

      if v_size is null or v_size > c_max_file_size then
        raise exception 'FILE_TOO_LARGE: файл % больше % МБ', v_path->>'file_name', c_max_file_size / 1024 / 1024 using errcode = 'P0001';
      end if;
      if v_mime is null or not (v_mime = any(c_allowed_mime)) then
        raise exception 'INVALID_FILE_TYPE: недопустимый тип файла %', coalesce(v_mime, 'unknown') using errcode = 'P0001';
      end if;

      v_total_size := v_total_size + v_size;
      if v_total_size > c_max_total_size then
        raise exception 'ATTEMPT_TOO_LARGE: суммарный размер файлов больше % МБ', c_max_total_size / 1024 / 1024 using errcode = 'P0001';
      end if;

      insert into public.homework_attempt_files (attempt_id, storage_path, file_name, mime_type, size)
      values (p_attempt_id, v_path->>'storage_path', v_path->>'file_name', v_mime, v_size);
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

-- ── assign_homework: teacher-scoped rate limit (separate bucket from student limits) ──
create or replace function public.assign_homework(
  p_template_version_id  uuid,
  p_group_id             uuid,
  p_student_ids          uuid[],
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

  -- A repeated call with the SAME request_id returns above before this point, so it never
  -- consumes another slot of the teacher's rate budget.
  perform public._enforce_homework_rate_limit(auth.uid(), 'assign_homework', 20, 200);

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

-- ── storage upload rate limit: a BEFORE INSERT trigger covers uploads regardless of which
-- client code path performs them, not just our own hook. ──
create or replace function public._enforce_homework_attachment_upload_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.bucket_id = 'homework-attempts' then
    perform public._enforce_homework_rate_limit(coalesce(new.owner, auth.uid()), 'homework_attachment_upload', 10, 60);
  end if;
  return new;
end;
$$;

create trigger homework_attachment_upload_rate_limit
  before insert on storage.objects
  for each row execute function public._enforce_homework_attachment_upload_rate_limit();
