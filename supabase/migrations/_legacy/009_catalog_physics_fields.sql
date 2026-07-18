-- 009_catalog_physics_fields.sql
-- Adds physics-specific task fields (plan and grading criteria)

ALTER TABLE catalog_tasks
  ADD COLUMN IF NOT EXISTS solution_plan_html   text,
  ADD COLUMN IF NOT EXISTS grade_criteria_html  text;
