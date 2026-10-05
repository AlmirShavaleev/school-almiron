-- Применено оркестратором 05.10.2026 через MCP apply_migration (§266, часть «trenirovochnye_uroki_fajly»). Версия совпадает с schema_migrations.

insert into storage.buckets (id, name, public, file_size_limit)
values ('topic-autocheck', 'topic-autocheck', false, 5242880)
on conflict (id) do nothing;

create or replace function public.topic_autocheck_object_visible(p_object_name text)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from topic_autocheck_tasks t
     where t.statement_path = p_object_name
       and (public.topic_material_can_manage(t.topic_id) or public.course_student_can_see_topic(t.topic_id))
  ) or exists (
    select 1 from topic_autocheck_tasks t
     where t.solution_path = p_object_name
       and (public.topic_material_can_manage(t.topic_id)
            or (public.course_student_can_see_topic(t.topic_id)
                and public.topic_autocheck_task_closed(t.id, auth.uid())))
  );
$$;

create policy topic_autocheck_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'topic-autocheck' and public.topic_autocheck_object_visible(name));
