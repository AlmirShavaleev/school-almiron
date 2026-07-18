alter table public.lesson_templates
  add column if not exists catalog_topic_id uuid references public.catalog_topics(id) on delete set null;

create index if not exists idx_lesson_templates_catalog_topic_id
  on public.lesson_templates(catalog_topic_id);
