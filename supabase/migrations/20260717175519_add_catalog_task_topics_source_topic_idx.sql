CREATE INDEX IF NOT EXISTS catalog_task_topics_source_topic_id_idx
  ON public.catalog_task_topics (source, topic_id);
