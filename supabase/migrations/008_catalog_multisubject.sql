-- 008_catalog_multisubject.sql
-- Adds subject/exam_type to catalog_topics and catalog_tasks,
-- replaces global UNIQUE(external_id) with composite UNIQUE(subject, exam_type, external_id),
-- and updates RPC functions to support subject filtering.

-- ── 1. Add subject/exam_type to catalog_topics ─────────────────────────────────
ALTER TABLE catalog_topics
  ADD COLUMN IF NOT EXISTS subject   text NOT NULL DEFAULT 'Математика',
  ADD COLUMN IF NOT EXISTS exam_type text NOT NULL DEFAULT 'ЕГЭ';

-- ── 2. Add subject/exam_type to catalog_tasks ──────────────────────────────────
ALTER TABLE catalog_tasks
  ADD COLUMN IF NOT EXISTS subject   text NOT NULL DEFAULT 'Математика',
  ADD COLUMN IF NOT EXISTS exam_type text NOT NULL DEFAULT 'ЕГЭ';

-- ── 3. Backfill existing math data ─────────────────────────────────────────────
UPDATE catalog_topics SET subject = 'Математика', exam_type = 'ЕГЭ'
  WHERE subject = 'Математика';

UPDATE catalog_tasks SET subject = 'Математика', exam_type = 'ЕГЭ'
  WHERE subject = 'Математика';

-- ── 4. Drop old global UNIQUE(external_id) constraints ─────────────────────────
ALTER TABLE catalog_sections DROP CONSTRAINT IF EXISTS catalog_sections_external_id_key;
ALTER TABLE catalog_topics   DROP CONSTRAINT IF EXISTS catalog_topics_external_id_key;
ALTER TABLE catalog_tasks    DROP CONSTRAINT IF EXISTS catalog_tasks_external_id_key;

-- ── 5. Add composite UNIQUE(subject, exam_type, external_id) ───────────────────
ALTER TABLE catalog_sections
  ADD CONSTRAINT catalog_sections_subject_exam_extid_key
  UNIQUE (subject, exam_type, external_id);

ALTER TABLE catalog_topics
  ADD CONSTRAINT catalog_topics_subject_exam_extid_key
  UNIQUE (subject, exam_type, external_id);

ALTER TABLE catalog_tasks
  ADD CONSTRAINT catalog_tasks_subject_exam_extid_key
  UNIQUE (subject, exam_type, external_id);

-- ── 6. Update RPC: get_catalog_section_counts — add optional subject filter ────
CREATE OR REPLACE FUNCTION get_catalog_section_counts(
  p_subject   text DEFAULT NULL,
  p_exam_type text DEFAULT NULL
)
RETURNS TABLE (section_id uuid, task_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT t.section_id, COUNT(*)::bigint
  FROM   catalog_tasks t
  JOIN   catalog_sections s ON s.id = t.section_id
  WHERE  t.is_published = true
    AND  (p_subject   IS NULL OR s.subject   = p_subject)
    AND  (p_exam_type IS NULL OR s.exam_type = p_exam_type)
  GROUP  BY t.section_id;
$$;

GRANT EXECUTE ON FUNCTION get_catalog_section_counts(text, text) TO authenticated;

-- ── 7. get_catalog_topic_ids — section_id already identifies subject ────────────
CREATE OR REPLACE FUNCTION get_catalog_topic_ids(p_section_id uuid)
RETURNS TABLE (topic_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT DISTINCT tt.topic_id
  FROM   catalog_task_topics tt
  JOIN   catalog_tasks        t  ON t.id = tt.task_id
  WHERE  t.section_id   = p_section_id
    AND  t.is_published = true;
$$;

GRANT EXECUTE ON FUNCTION get_catalog_topic_ids(uuid) TO authenticated;

-- ── 8. get_catalog_topic_counts ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_catalog_topic_counts(p_section_id uuid)
RETURNS TABLE (topic_id uuid, task_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT tt.topic_id, COUNT(DISTINCT t.id)::bigint
  FROM   catalog_task_topics tt
  JOIN   catalog_tasks        t  ON t.id = tt.task_id
  WHERE  t.section_id   = p_section_id
    AND  t.is_published = true
  GROUP  BY tt.topic_id;
$$;

GRANT EXECUTE ON FUNCTION get_catalog_topic_counts(uuid) TO authenticated;

-- ── 9. Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS catalog_sections_subject_idx
  ON catalog_sections (subject, exam_type) WHERE is_published = true;

CREATE INDEX IF NOT EXISTS catalog_tasks_subject_idx
  ON catalog_tasks (subject, exam_type);

CREATE INDEX IF NOT EXISTS catalog_topics_subject_idx
  ON catalog_topics (subject, exam_type);
