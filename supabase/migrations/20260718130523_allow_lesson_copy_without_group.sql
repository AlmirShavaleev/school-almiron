-- 0a/4: lesson_template_copies.target_group_id -> nullable
ALTER TABLE public.lesson_template_copies
  ALTER COLUMN target_group_id DROP NOT NULL;

-- 2 (schema): lesson_copy_jobs.target_group_id -> nullable
ALTER TABLE public.lesson_copy_jobs
  ALTER COLUMN target_group_id DROP NOT NULL;

-- ПРАВКА 1: auth_can_copy_to_group_course с обязательной проверкой целостности группы
CREATE OR REPLACE FUNCTION public.auth_can_copy_to_group_course(
  p_group_id uuid DEFAULT NULL,
  p_course_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  with me as (
    select p.id as profile_id, p.role
    from public.profiles p
    where p.id = auth.uid()
  )
  select
    (p_group_id is null or exists (
        select 1 from public.groups g
        where g.id = p_group_id and g.course_id = p_course_id))
    and (
      exists (
        select 1 from public.courses c
        where c.id = p_course_id and c.owner_id = auth.uid()
      )
      or public.is_admin_or_owner()
      or (
        p_group_id is not null
        and exists (
          select 1
          from public.groups g
          left join public.teachers t on t.id = g.teacher_id
          left join public.curators c on c.id = g.curator_id
          cross join me
          where g.id = p_group_id
            and g.course_id = p_course_id
            and (
              me.role in ('admin', 'owner')
              or (me.role = 'teacher' and t.profile_id = me.profile_id)
              or (me.role = 'curator' and c.profile_id = me.profile_id)
            )
        )
      )
    );
$function$;

-- ПРАВКА 2: гранты auth_can_copy_to_group_course (PUBLIC был в proacl)
revoke execute on function public.auth_can_copy_to_group_course(uuid, uuid) from public;
grant  execute on function public.auth_can_copy_to_group_course(uuid, uuid) to authenticated;

-- 3: stage_lesson_copy, group/course/module nullable-совместимая сигнатура (CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION public.stage_lesson_copy(
  p_template_id uuid,
  p_target_group_id uuid DEFAULT NULL,
  p_target_course_id uuid DEFAULT NULL,
  p_target_module_id uuid DEFAULT NULL,
  p_available_from date DEFAULT NULL::date,
  p_order_index integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile_id uuid := auth.uid();
  v_template public.lesson_templates%rowtype;
  v_job_id uuid;
  v_topic_id uuid;
  v_effective_order integer;
  v_manifest jsonb;
begin
  if v_profile_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select *
    into v_template
  from public.lesson_templates
  where id = p_template_id
    and owner_id = v_profile_id;

  if not found then
    raise exception 'TEMPLATE_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if not public.auth_can_copy_to_group_course(p_target_group_id, p_target_course_id) then
    raise exception 'TARGET_GROUP_COURSE_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.modules m
    where m.id = p_target_module_id
      and m.course_id = p_target_course_id
  ) then
    raise exception 'TARGET_MODULE_NOT_IN_TARGET_COURSE';
  end if;

  v_effective_order := coalesce(
    p_order_index,
    (
      select coalesce(max(t.order_index), -1) + 1
      from public.topics t
      where t.module_id = p_target_module_id
    )
  );

  insert into public.topics (
    module_id,
    title,
    order_index,
    max_score,
    available_from,
    source_template_id
  ) values (
    p_target_module_id,
    v_template.title,
    v_effective_order,
    100,
    p_available_from,
    p_template_id
  )
  returning id into v_topic_id;

  v_manifest := jsonb_build_object(
    'job', jsonb_build_object(
      'topic_id', v_topic_id,
      'template_id', p_template_id,
      'target_group_id', p_target_group_id,
      'target_course_id', p_target_course_id,
      'target_module_id', p_target_module_id,
      'available_from', p_available_from,
      'order_index', v_effective_order
    ),
    'template', jsonb_build_object(
      'id', v_template.id,
      'title', v_template.title,
      'subject', v_template.subject,
      'exam_type', v_template.exam_type,
      'description', v_template.description
    ),
    'materials', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'template_material_id', ltm.id,
        'type', ltm.type,
        'content', ltm.content,
        'file_path', ltm.file_path,
        'link_url', ltm.link_url,
        'sort_order', ltm.sort_order,
        'target_file_path',
          case
            when ltm.file_path is null then null
            when ltm.type = 'link' then format('topics/%s/links/%s.link', v_topic_id, gen_random_uuid())
            else format(
              'topics/%s/%s/%s',
              v_topic_id,
              ltm.type,
              regexp_replace(ltm.file_path, '^.*/', '')
            )
          end
      ) order by ltm.sort_order, ltm.created_at), '[]'::jsonb)
      from public.lesson_template_materials ltm
      where ltm.template_id = p_template_id
    ),
    'tasks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'template_task_id', ltt.id,
        'task_kind', ltt.task_kind,
        'catalog_task_id', ltt.catalog_task_id,
        'title', ltt.title,
        'payload', ltt.payload,
        'sort_order', ltt.sort_order
      ) order by ltt.sort_order, ltt.created_at), '[]'::jsonb)
      from public.lesson_template_tasks ltt
      where ltt.template_id = p_template_id
    )
  );

  insert into public.lesson_copy_jobs (
    requested_by,
    template_id,
    target_group_id,
    target_course_id,
    target_module_id,
    requested_available_from,
    requested_order_index,
    topic_id,
    manifest,
    status
  ) values (
    v_profile_id,
    p_template_id,
    p_target_group_id,
    p_target_course_id,
    p_target_module_id,
    p_available_from,
    v_effective_order,
    v_topic_id,
    v_manifest,
    'staged'
  )
  returning id into v_job_id;

  return jsonb_build_object(
    'job_id', v_job_id,
    'topic_id', v_topic_id,
    'manifest', v_manifest
  );
exception
  when others then
    if v_topic_id is not null then
      delete from public.topics where id = v_topic_id;
    end if;
    raise;
end;
$function$;

-- 4: finalize_lesson_copy, fallback created_by = auth.uid() без группы
CREATE OR REPLACE FUNCTION public.finalize_lesson_copy(
  p_job_id uuid,
  p_material_results jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile_id uuid := auth.uid();
  v_job public.lesson_copy_jobs%rowtype;
  v_topic_id uuid;
  v_material jsonb;
  v_template_task jsonb;
  v_group_teacher_id uuid;
  v_collection_owner_profile_id uuid;
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

  if v_job.target_group_id is not null then
    select g.teacher_id, t.profile_id
      into v_group_teacher_id, v_collection_owner_profile_id
    from public.groups g
    join public.teachers t on t.id = g.teacher_id
    where g.id = v_job.target_group_id;

    if v_group_teacher_id is null or v_collection_owner_profile_id is null then
      raise exception 'TARGET_GROUP_TEACHER_REQUIRED';
    end if;
  else
    v_collection_owner_profile_id := v_profile_id;
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
      v_collection_owner_profile_id,
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
$function$;
