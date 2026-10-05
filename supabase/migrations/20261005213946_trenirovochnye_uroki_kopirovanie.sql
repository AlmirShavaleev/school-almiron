-- Применено оркестратором 05.10.2026 через MCP apply_migration (§266, часть «trenirovochnye_uroki_kopirovanie»). Версия совпадает с schema_migrations.

do $mig$
declare
  d  text;
  n0 text;
begin
  d := pg_get_functiondef('public._topic_homework_autopublish(uuid[], text)'::regprocedure);
  if position('h.autocheck' in d) > 0 then
    return;
  end if;
  n0 := d;
  d := regexp_replace(d,
         $re$or exists \(select 1 from topic_homework_files f where f\.homework_id = h\.id\)\)$re$,
         'or exists (select 1 from topic_homework_files f where f.homework_id = h.id) or h.autocheck)');
  if d = n0 then
    raise exception '§266: в _topic_homework_autopublish не найдено условие «есть файл»';
  end if;
  execute d;
end
$mig$;

create or replace function public.course_copy_topic_content(
  p_source_topic_id uuid,
  p_target_topic_id uuid,
  p_mode text,
  p_shift_days integer
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row record;
  v_hw_id uuid;
  v_new_hw_id uuid;
  v_variant_id uuid;
  v_new_variant_id uuid;
begin
  update topics tgt
     set is_open = nullif(src.is_open, true),
         kind = src.kind,
         lesson_format = src.lesson_format
    from topics src
   where tgt.id = p_target_topic_id
     and src.id = p_source_topic_id;

  for v_row in
    select * from topic_material_items
     where topic_id = p_source_topic_id
     order by position, created_at
  loop
    insert into topic_material_items (
      topic_id, kind, title, content, url, storage_path,
      file_name, mime_type, size_bytes, position, is_visible, section,
      created_by, source_item_id, track, subtopic_code, subtopic_title
    ) values (
      p_target_topic_id, v_row.kind, v_row.title, v_row.content,
      v_row.url, v_row.storage_path, v_row.file_name, v_row.mime_type, v_row.size_bytes,
      v_row.position, v_row.is_visible, v_row.section, auth.uid(), v_row.id,
      v_row.track, v_row.subtopic_code, v_row.subtopic_title
    );
  end loop;

  insert into topic_autocheck_tasks (
    topic_id, code, position, statement_path, solution_path, answer_type,
    answer_value, answer_tol, answer_text, digits_any_order, unit, source_task_id
  )
  select p_target_topic_id, k.code, k.position, k.statement_path, k.solution_path, k.answer_type,
         k.answer_value, k.answer_tol, k.answer_text, k.digits_any_order, k.unit, k.id
    from topic_autocheck_tasks k
   where k.topic_id = p_source_topic_id
  on conflict (topic_id, code) do nothing;

  select id into v_hw_id from topic_homework where topic_id = p_source_topic_id;
  if v_hw_id is not null then
    insert into topic_homework (topic_id, title, instructions, is_published, created_by, due_at, grade_scale, source_homework_id, autocheck)
    select p_target_topic_id, title, instructions, false, auth.uid(),
           public.course_copy_shift_date(due_at, p_mode, p_shift_days), grade_scale, id, autocheck
      from topic_homework where id = v_hw_id
    returning id into v_new_hw_id;

    for v_row in
      select * from topic_homework_files where homework_id = v_hw_id order by position
    loop
      insert into topic_homework_files (homework_id, storage_path, original_filename, mime_type, size_bytes, position, source_file_id)
      values (v_new_hw_id, v_row.storage_path, v_row.original_filename, v_row.mime_type, v_row.size_bytes, v_row.position, v_row.id);
    end loop;
  end if;

  insert into topic_test_assignments (test_id, topic_id, assigned_by)
  select test_id, p_target_topic_id, auth.uid()
    from topic_test_assignments where topic_id = p_source_topic_id;

  select id into v_variant_id from test_variants where topic_id = p_source_topic_id;

  if v_variant_id is not null
     and not exists (select 1 from test_variants where topic_id = p_target_topic_id)
  then
    insert into test_variants (
      title, description, subject, exam_type, status, created_by,
      settings, tasks_count, source_type, topic_id
    )
    select title, description, subject, exam_type, status, auth.uid(),
           settings, tasks_count, source_type, p_target_topic_id
      from test_variants where id = v_variant_id
    returning id into v_new_variant_id;

    insert into test_variant_items (
      variant_id, task_id, position, section_id, topic_id, points, grading_type
    )
    select v_new_variant_id, task_id, position, section_id, topic_id, points, grading_type
      from test_variant_items where variant_id = v_variant_id;
  end if;

  return '[]'::jsonb;
end
$function$;
