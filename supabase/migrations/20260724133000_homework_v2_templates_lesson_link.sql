alter table public.homework_templates
  add column if not exists lesson_id uuid references public.lessons(id) on delete set null;

create index if not exists idx_homework_templates_lesson_id
  on public.homework_templates (lesson_id);
