-- Optimise catalogue counters while preserving per-subscription scope.
-- Baseline on 2026-11-17: catalog_tasks ~22.5k rows.
-- Deployment: take baseline of RPC outputs / pg_stat_statements before applying.
-- This migration changes no data, RLS policies, grants, tables or indexes.

CREATE OR REPLACE FUNCTION public.get_catalog_section_counts(
  p_subject text DEFAULT NULL::text,
  p_exam_type text DEFAULT NULL::text
)
RETURNS TABLE(section_id uuid, task_count bigint, part1_count bigint, part2_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Compute the caller's allowed directions ONCE.
  -- DISTINCT prevents multiplication if subscription directions are repeated.
  WITH allowed_directions AS MATERIALIZED (
    SELECT DISTINCT
      split_part(a.direction, '|', 1) AS subject,
      split_part(a.direction, '|', 2) AS exam_type
    FROM unnest((SELECT public.catalog_subscription_directions())) AS a(direction)
  )
  SELECT t.section_id,
         count(*)::bigint AS task_count,
         count(*) FILTER (WHERE t.exam_part = 1)::bigint AS part1_count,
         count(*) FILTER (WHERE t.exam_part = 2)::bigint AS part2_count
    FROM public.catalog_sections s
    JOIN allowed_directions sd
      ON sd.subject = s.subject AND sd.exam_type = s.exam_type
    JOIN public.catalog_tasks t
      ON t.section_id = s.id
    JOIN allowed_directions td
      ON td.subject = t.subject AND td.exam_type = t.exam_type
   WHERE t.is_published
     AND (p_subject IS NULL OR s.subject = p_subject)
     AND (p_exam_type IS NULL OR s.exam_type = p_exam_type)
   GROUP BY t.section_id;
$$;

-- No CREATE/REPLACE of catalog_subscription_directions, RLS or EXECUTE grants:
-- existing function owner and permissions remain unchanged.

CREATE OR REPLACE FUNCTION public.get_catalog_section_topic_tree(p_section_id uuid)
RETURNS TABLE(
  id uuid, external_id bigint, parent_id uuid, title text, slug text,
  "position" integer, task_count bigint, completed_count bigint
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH links AS (
    SELECT tt.topic_id, tt.task_id
      FROM public.catalog_task_topics tt
      JOIN public.catalog_tasks t ON t.id = tt.task_id
     WHERE t.section_id = p_section_id
       AND t.is_published
       AND tt.source IS DISTINCT FROM 'ai_physics_v1'
  ),
  agg AS (
    -- The PK of catalog_task_topics is (task_id, topic_id).
    -- The PK of catalog_task_progress is (user_id, task_id).
    -- Thus neither join can duplicate a given (topic_id, task_id).
    SELECT l.topic_id,
           count(*) AS task_count,
           count(ctp.task_id) AS completed_count
      FROM links l
      LEFT JOIN public.catalog_task_progress ctp
        ON ctp.task_id = l.task_id
       AND ctp.user_id = auth.uid()
       AND ctp.is_completed
     GROUP BY l.topic_id
  )
  SELECT tp.id, tp.external_id, tp.parent_id, tp.title, tp.slug, tp."position",
         a.task_count, a.completed_count
    FROM agg a
    JOIN public.catalog_topics tp ON tp.id = a.topic_id
   WHERE tp.is_published
   ORDER BY tp."position";
$$;
