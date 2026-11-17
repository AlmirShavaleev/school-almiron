-- Read-only equivalence checks for catalogue count optimization.
-- Run on a staging DB after applying the migration.
-- Also run supabase/tests/catalog_subscription_subject_access.sql
-- to verify a physics-only subscriber cannot read math catalogue data.

BEGIN READ ONLY;

-- Compare old and new counter semantics for full access, math-only and no access.
-- No session identity or production user data is modified.
WITH directions AS (
  SELECT label, allowed
    FROM (VALUES
      ('all', ARRAY['Математика|ЕГЭ', 'Физика|ЕГЭ']::text[]),
      ('math', ARRAY['Математика|ЕГЭ']::text[]),
      ('none', ARRAY[]::text[])
    ) AS d(label, allowed)
),
legacy AS (
  SELECT d.label, t.section_id,
         count(*)::bigint AS task_count,
         count(*) FILTER (WHERE t.exam_part = 1)::bigint AS part1_count,
         count(*) FILTER (WHERE t.exam_part = 2)::bigint AS part2_count
    FROM directions d
    JOIN public.catalog_tasks t
      ON (t.subject || '|' || t.exam_type) = ANY(d.allowed)
    JOIN public.catalog_sections s ON s.id = t.section_id
      AND (s.subject || '|' || s.exam_type) = ANY(d.allowed)
   WHERE t.is_published
   GROUP BY d.label, t.section_id
),
optimized AS (
  WITH authorized AS MATERIALIZED (
    SELECT d.label, split_part(a.direction,'|',1) AS subject,
           split_part(a.direction,'|',2) AS exam_type
      FROM directions d CROSS JOIN LATERAL unnest(d.allowed) a(direction)
  )
  SELECT sd.label, t.section_id,
         count(*)::bigint AS task_count,
         count(*) FILTER (WHERE t.exam_part = 1)::bigint AS part1_count,
         count(*) FILTER (WHERE t.exam_part = 2)::bigint AS part2_count
    FROM public.catalog_sections s
    JOIN authorized sd ON sd.subject=s.subject AND sd.exam_type=s.exam_type
    JOIN public.catalog_tasks t ON t.section_id=s.id
    JOIN authorized td ON td.label=sd.label AND td.subject=t.subject AND td.exam_type=t.exam_type
   WHERE t.is_published
   GROUP BY sd.label, t.section_id
)
SELECT 'old_minus_new' AS mismatch, count(*) AS mismatch_rows
  FROM (SELECT * FROM legacy EXCEPT SELECT * FROM optimized) t
UNION ALL
SELECT 'new_minus_old', count(*)
  FROM (SELECT * FROM optimized EXCEPT SELECT * FROM legacy) t;

-- Inspect RPC result under the database session's current access. In a
-- normal privileged session without JWT claims, the function should return
-- no rows because catalog_subscription_directions() returns an empty array.
SELECT count(*) AS visible_sections
  FROM public.get_catalog_section_counts(NULL, NULL);

ROLLBACK;
