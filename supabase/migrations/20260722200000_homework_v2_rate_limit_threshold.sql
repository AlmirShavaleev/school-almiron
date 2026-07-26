-- ============================================================
-- Homework v2 — rate limit threshold revision.
-- Audit: a student legitimately submitting 10 different homework assignments within an hour
-- (10 start + 10 finalize = 20 actions against the shared 'homework_attempt_action' bucket)
-- was hitting the old 15/hour cap well before finishing normal work. The 1-minute anti-burst
-- cap (3/min) already blocks rapid-fire spam/bot behavior and is untouched here — only the
-- hourly ceiling changes. New additive migration; 20260722180000 is not edited.
-- ============================================================

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

  perform public._enforce_homework_rate_limit(v_student_id, 'homework_attempt_action', 3, 60);

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
  c_max_file_size constant bigint := 20 * 1024 * 1024;
  c_max_total_size constant bigint := 100 * 1024 * 1024;
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

  perform public._enforce_homework_rate_limit(v_student_id, 'homework_attempt_action', 3, 60);

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
