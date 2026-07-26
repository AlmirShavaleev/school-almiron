-- ============================================================
-- Homework v2 — create_or_update_template_draft now persists per-item grading fields
-- (max_score/grading_mode/grading_spec/ai_check_enabled), needed by the new Template Builder.
-- Previously it only wrote catalog_task_id/position/custom_number, silently dropping the
-- grading columns added in 20260722190000. Additive migration; does not edit prior files.
-- ============================================================

create or replace function public.create_or_update_template_draft(
  p_template_id  uuid,
  p_course_id    uuid,
  p_topic_id     uuid,
  p_title        text,
  p_instructions text,
  p_pdf_config   jsonb,
  p_max_score    numeric,
  p_items        jsonb,   -- [{catalog_task_id, position, custom_number, max_score, grading_mode, grading_spec, ai_check_enabled}]
  p_files        jsonb
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
        update public.homework_template_versions
          set instructions = p_instructions, pdf_config = coalesce(p_pdf_config, '{}'::jsonb), max_score = p_max_score
          where id = v_version_id;
        delete from public.homework_template_items where template_version_id = v_version_id;
        delete from public.homework_template_files where template_version_id = v_version_id;
      else
        v_version_id := null;
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
      insert into public.homework_template_items
        (template_version_id, catalog_task_id, position, custom_number, max_score, grading_mode, grading_spec, ai_check_enabled)
      values (
        v_version_id,
        (v_item->>'catalog_task_id')::uuid,
        (v_item->>'position')::int,
        nullif(v_item->>'custom_number',''),
        nullif(v_item->>'max_score','')::numeric,
        coalesce(nullif(v_item->>'grading_mode','')::public.homework_grading_mode, 'manual'),
        coalesce(v_item->'grading_spec', '{}'::jsonb),
        coalesce((v_item->>'ai_check_enabled')::boolean, false)
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
