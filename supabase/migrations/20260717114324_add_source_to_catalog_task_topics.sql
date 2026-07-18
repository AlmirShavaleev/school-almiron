ALTER TABLE public.catalog_task_topics
  ADD COLUMN IF NOT EXISTS source text;
