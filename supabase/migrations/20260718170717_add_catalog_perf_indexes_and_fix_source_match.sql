-- 1. Составной индекс под счётчики разделов
CREATE INDEX IF NOT EXISTS catalog_tasks_section_published_idx
  ON public.catalog_tasks (section_id, is_published);

-- 2. get_catalog_topic_counts_by_source: source = p_source -> IS NOT DISTINCT FROM
CREATE OR REPLACE FUNCTION public.get_catalog_topic_counts_by_source(
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
  where tt.source is not distinct from p_source and t.subject = p_subject
    and t.exam_type = p_exam_type and t.is_published = true
  group by tt.topic_id
$$;

revoke execute on function public.get_catalog_topic_counts_by_source(text,text,text) from public;
grant  execute on function public.get_catalog_topic_counts_by_source(text,text,text) to authenticated;

-- 3. get_catalog_section_task_counts_by_source: то же исправление
CREATE OR REPLACE FUNCTION public.get_catalog_section_task_counts_by_source(
  p_subject text, p_exam_type text, p_source text
) returns table (section_id uuid, task_count bigint, completed_count bigint)
language sql stable security invoker as $$
  with links as (
    select distinct parent.id as section_id, tt.task_id
    from public.catalog_task_topics tt
    join public.catalog_topics leaf   on leaf.id = tt.topic_id
    join public.catalog_topics parent on parent.id = leaf.parent_id
    join public.catalog_tasks t       on t.id = tt.task_id
    where tt.source is not distinct from p_source
      and t.subject = p_subject
      and t.exam_type = p_exam_type
      and t.is_published = true
  ),
  user_done as (
    select ctp.task_id from public.catalog_task_progress ctp
    where ctp.user_id = auth.uid() and ctp.is_completed = true
    group by ctp.task_id
  )
  select l.section_id,
         count(distinct l.task_id)::bigint,
         count(distinct ud.task_id)::bigint
  from links l
  left join user_done ud on ud.task_id = l.task_id
  group by grouping sets ((l.section_id), ())
$$;

revoke execute on function public.get_catalog_section_task_counts_by_source(text,text,text) from public;
grant  execute on function public.get_catalog_section_task_counts_by_source(text,text,text) to authenticated;
