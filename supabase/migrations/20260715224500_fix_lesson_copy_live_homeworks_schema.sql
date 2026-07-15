-- ============================================================
-- Fix lesson copy RPCs against live homeworks schema
-- School Almiron
-- Source of truth: live DB, not stale migration files
-- ============================================================

create or replace function public.finalize_lesson_copy(
  p_job_id uuid,
  p_material_results jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := auth.uid();
  v_job public.lesson_copy_jobs%rowtype;
  v_topic_id uuid;
  v_material jsonb;
  v_template_task jsonb;
  v_group_teacher_id uuid;
  v_due_at timestamptz;
  v_task_description text;
begin
  if v_profile_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select *
    into v_job
  from public.lesson_copy_jobs
  where id = p_job_id
    and requested_by = v_profile_id;

  if not found then
    raise exception 'COPY_JOB_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if v_job.status <> 'staged' then
    raise exception 'COPY_JOB_INVALID_STATE';
  end if;

  v_topic_id := v_job.topic_id;

  if v_topic_id is null then
    raise exception 'COPY_JOB_TOPIC_MISSING';
  end if;

  select g.teacher_id
    into v_group_teacher_id
  from public.groups g
  where g.id = v_job.target_group_id;

  if v_group_teacher_id is null then
    raise exception 'TARGET_GROUP_TEACHER_REQUIRED';
  end if;

  v_due_at := coalesce(
    v_job.requested_available_from::timestamptz + interval '7 days',
    now() + interval '14 days'
  );

  for v_material in
    select value
    from jsonb_array_elements(coalesce(p_material_results, '[]'::jsonb))
  loop
    insert into public.topic_materials (
      topic_id,
      type,
      content,
      file_url,
      link_url,
      source_template_material_id
    ) values (
      v_topic_id,
      v_material->>'type',
      nullif(v_material->>'content', ''),
      nullif(v_material->>'target_file_path', ''),
      nullif(v_material->>'link_url', ''),
      (v_material->>'template_material_id')::uuid
    );
  end loop;

  for v_template_task in
    select value
    from jsonb_array_elements(coalesce(v_job.manifest->'tasks', '[]'::jsonb))
  loop
    select nullif(
      trim(
        string_agg(
          nullif(
            trim(
              regexp_replace(
                regexp_replace(
                  coalesce(
                    item->>'content_html',
                    item->>'title',
                    item->>'resource_url',
                    ''
                  ),
                  '<[^>]+>',
                  ' ',
                  'g'
                ),
                '\s+',
                ' ',
                'g'
              )
            ),
            ''
          ),
          E'\n\n'
          order by coalesce((item->>'position')::integer, 0)
        )
      ),
      ''
    )
      into v_task_description
    from jsonb_array_elements(coalesce(v_template_task->'payload'->'items', '[]'::jsonb)) item;

    insert into public.homeworks (
      topic_id,
      title,
      description,
      due_date,
      max_score,
      created_by,
      teacher_id,
      is_archived,
      source_template_id
    ) values (
      v_topic_id,
      coalesce(
        nullif(v_template_task->>'title', ''),
        nullif(v_job.manifest->'template'->>'title', ''),
        'Домашнее задание'
      ),
      coalesce(
        v_task_description,
        nullif(v_job.manifest->'template'->>'description', '')
      ),
      v_due_at,
      100,
      v_group_teacher_id,
      v_group_teacher_id,
      true,
      v_job.template_id
    );
  end loop;

  insert into public.lesson_template_copies (
    template_id,
    topic_id,
    target_group_id,
    target_course_id,
    created_by
  ) values (
    v_job.template_id,
    v_topic_id,
    v_job.target_group_id,
    v_job.target_course_id,
    v_profile_id
  );

  update public.lesson_copy_jobs
  set status = 'finalized',
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'topic_id', v_topic_id,
    'status', 'finalized'
  );
end;
$$;

revoke all on function public.finalize_lesson_copy(uuid, jsonb) from public, anon;
grant execute on function public.finalize_lesson_copy(uuid, jsonb) to authenticated;

create or replace function public.rollback_lesson_copy(
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := auth.uid();
  v_job public.lesson_copy_jobs%rowtype;
begin
  if v_profile_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select *
    into v_job
  from public.lesson_copy_jobs
  where id = p_job_id
    and requested_by = v_profile_id;

  if not found then
    raise exception 'COPY_JOB_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if v_job.topic_id is not null then
    delete from public.topic_materials
    where topic_id = v_job.topic_id;

    delete from public.homeworks
    where topic_id = v_job.topic_id;

    delete from public.lesson_template_copies
    where topic_id = v_job.topic_id;

    delete from public.topics
    where id = v_job.topic_id;
  end if;

  update public.lesson_copy_jobs
  set status = 'rolled_back',
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'status', 'rolled_back'
  );
end;
$$;

revoke all on function public.rollback_lesson_copy(uuid) from public, anon;
grant execute on function public.rollback_lesson_copy(uuid) to authenticated;
