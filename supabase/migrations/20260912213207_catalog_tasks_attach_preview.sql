-- Состав отобранного — до прикрепления (§164).
--
-- Подтверждение обязано показывать не только «5 задач», но и из чего они: с
-- автопроверкой или на самопроверку по решению (§162 их различает). Считать
-- это на клиенте нельзя — годность к автопроверке живёт в одной функции
-- (`variant_answer_is_auto_checkable`, §96/§127), и второй её копии не будет.
--
-- Security invoker: каталог и так читается этой ролью, своих прав функция не
-- добавляет.

create or replace function public.catalog_tasks_attach_preview(p_task_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  select jsonb_build_object(
    'total',          count(*),
    'auto_checkable', count(*) filter (where public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)),
    'self_checked',   count(*) filter (where not public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)),
    'part_two',       count(*) filter (where ct.exam_part = 2)
  )
  from public.catalog_tasks ct
  where ct.id = any(coalesce(p_task_ids, '{}'::uuid[]));
$$;

comment on function public.catalog_tasks_attach_preview(uuid[]) is
  'Из чего состоит отобранное: всего, с автопроверкой, на самопроверку, вторая часть. §164';

revoke all on function public.catalog_tasks_attach_preview(uuid[]) from public, anon;
grant execute on function public.catalog_tasks_attach_preview(uuid[]) to authenticated;
