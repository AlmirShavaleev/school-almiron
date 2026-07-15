-- ============================================================
-- Fix lesson copy RPCs to use task collections
-- School Almiron
-- Source of truth: live DB
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
  v_group_teacher_profile_id uuid;
  v_collection_id uuid;
  v_collection_title text;
  v_collection_description text;
  v_collection_subject text;
  v_has_catalog_tasks boolean := false;
  v_position integer := 0;
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

  select g.teacher_id, t.profile_id
    into v_group_teacher_id, v_group_teacher_profile_id
  from public.groups g
  join public.teachers t on t.id = g.teacher_id
  where g.id = v_job.target_group_id;

  if v_group_teacher_id is null or v_group_teacher_profile_id is null then
    raise exception 'TARGET_GROUP_TEACHER_REQUIRED';
  end if;

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

  select exists (
    select 1
    from jsonb_array_elements(coalesce(v_job.manifest->'tasks', '[]'::jsonb)) task
    where nullif(task->>'catalog_task_id', '') is not null
  )
  into v_has_catalog_tasks;

  if v_has_catalog_tasks then
    v_collection_title := coalesce(
      nullif(v_job.manifest->'template'->>'title', ''),
      'Подборка задач'
    ) || ' — ДЗ';

    v_collection_description := nullif(v_job.manifest->'template'->>'description', '');

    v_collection_subject := case lower(coalesce(v_job.manifest->'template'->>'subject', ''))
      when 'math' then 'Математика'
      when 'physics' then 'Физика'
      else coalesce(nullif(v_job.manifest->'template'->>'subject', ''), 'Математика')
    end;

    insert into public.task_collections (
      created_by,
      title,
      description,
      subject,
      work_type,
      is_archived
    ) values (
      v_group_teacher_profile_id,
      v_collection_title,
      v_collection_description,
      v_collection_subject,
      'custom',
      false
    )
    returning id into v_collection_id;

    for v_template_task in
      select value
      from jsonb_array_elements(coalesce(v_job.manifest->'tasks', '[]'::jsonb))
      where nullif(value->>'catalog_task_id', '') is not null
      order by coalesce((value->>'sort_order')::integer, 0), value->>'template_task_id'
    loop
      v_position := v_position + 1;

      insert into public.task_collection_items (
        collection_id,
        catalog_task_id,
        position,
        custom_number
      ) values (
        v_collection_id,
        (v_template_task->>'catalog_task_id')::uuid,
        v_position,
        null
      );
    end loop;
  end if;

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
      manifest = jsonb_set(
        coalesce(manifest, '{}'::jsonb),
        '{artifacts}',
        jsonb_build_object(
          'collection_id', v_collection_id,
          'assigned_collection_ids', '[]'::jsonb
        ),
        true
      ),
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'topic_id', v_topic_id,
    'collection_id', v_collection_id,
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
  v_collection_id uuid;
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

  v_collection_id := nullif(v_job.manifest->'artifacts'->>'collection_id', '')::uuid;

  if v_collection_id is not null then
    delete from public.assigned_collections
    where collection_id = v_collection_id;

    delete from public.task_collection_items
    where collection_id = v_collection_id;

    delete from public.task_collections
    where id = v_collection_id;
  end if;

  if v_job.topic_id is not null then
    delete from public.topic_materials
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
    'collection_id', v_collection_id,
    'status', 'rolled_back'
  );
end;
$$;

revoke all on function public.rollback_lesson_copy(uuid) from public, anon;
grant execute on function public.rollback_lesson_copy(uuid) to authenticated;
