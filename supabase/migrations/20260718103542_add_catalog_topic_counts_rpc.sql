create or replace function public.get_catalog_topic_counts_by_source(
  p_subject text, p_exam_type text, p_source text
) returns table (topic_id uuid, task_count bigint, completed_count bigint)
language sql stable security invoker as $$
  with user_done as (
    select ctp.task_id from public.catalog_task_progress ctp
    where ctp.user_id = auth.uid() and ctp.is_completed = true
    group by ctp.task_id
  )
  select tt.topic_id, count(*)::bigint, count(ud.task_id)::bigint
  from public.catalog_task_topics tt
  join public.catalog_tasks t on t.id = tt.task_id
  left join user_done ud on ud.task_id = tt.task_id
  where tt.source = p_source and t.subject = p_subject
    and t.exam_type = p_exam_type and t.is_published = true
  group by tt.topic_id
$$;

revoke execute on function public.get_catalog_topic_counts_by_source(text,text,text) from public;
grant  execute on function public.get_catalog_topic_counts_by_source(text,text,text) to authenticated;
