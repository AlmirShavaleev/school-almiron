-- Применено оркестратором 05.10.2026 через MCP apply_migration (§266, часть «trenirovochnye_uroki_prava»). Версия совпадает с schema_migrations.

create policy topic_autocheck_tasks_select on public.topic_autocheck_tasks
  for select to authenticated
  using (public.topic_material_can_manage(topic_id) or public.course_student_can_see_topic(topic_id));

create policy topic_autocheck_answers_select on public.topic_autocheck_answers
  for select to authenticated
  using (profile_id = auth.uid() or public.topic_autocheck_task_can_manage(task_id));

grant select (id, topic_id, code, position, statement_path, answer_type, digits_any_order, unit, created_at, updated_at)
  on public.topic_autocheck_tasks to authenticated;
grant select on public.topic_autocheck_answers to authenticated;
