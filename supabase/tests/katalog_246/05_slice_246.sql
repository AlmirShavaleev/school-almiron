-- §246. Слепок поверх ../mock_exam_lesson_221/00_slice.sql (роли, auth.uid(),
-- profiles/students/courses/groups/group_students). Здесь — то, что читает
-- catalog_my_overview(): предмет и экзамен курса (enum, как на проде), таблицы
-- каталога и вариантов в тех колонках, что есть в src/types/database.ts.
-- RLS включена так же «закрыто», как на проде: ученик видит только свою
-- отметку, строки вариантов — ничьи; функция читает всё сама (definer).
alter table courses add column subject subject_type;
alter table courses add column exam_type exam_type;

create table catalog_sections (
  id uuid primary key default gen_random_uuid(), external_id int not null default 0,
  subject text not null, exam_type text not null, exam_number int, title text not null default '',
  position int not null default 0, is_published boolean not null default true
);
create table catalog_tasks (
  id uuid primary key default gen_random_uuid(), external_id int not null default 0,
  section_id uuid not null references catalog_sections(id), subject text not null default '', exam_type text not null default '',
  statement_html text not null default '', is_published boolean not null default true, exam_part int, position int not null default 0
);
create index catalog_tasks_section_published_idx on catalog_tasks (section_id, is_published);
create table catalog_task_progress (
  user_id uuid not null references profiles(id), task_id uuid not null references catalog_tasks(id),
  is_completed boolean not null default true, completed_at timestamptz, updated_at timestamptz default now(),
  primary key (user_id, task_id)
);
create table test_variant_student_assignments (
  id uuid primary key default gen_random_uuid(), assignment_id uuid, variant_id uuid, student_id uuid not null references students(id),
  submitted_at timestamptz
);
create table test_variant_items (
  id uuid primary key default gen_random_uuid(), variant_id uuid, task_id uuid not null, position int not null default 0
);
create table test_variant_answers (
  id uuid primary key default gen_random_uuid(), student_assignment_id uuid not null references test_variant_student_assignments(id),
  variant_item_id uuid not null references test_variant_items(id), is_correct boolean,
  submitted_at timestamptz, graded_at timestamptz, last_changed_at timestamptz not null default now(), created_at timestamptz not null default now()
);

grant select on catalog_sections, catalog_tasks to authenticated;
grant select, insert, update, delete on catalog_task_progress to authenticated;
grant select on test_variant_student_assignments, test_variant_items, test_variant_answers to authenticated;
alter table catalog_task_progress enable row level security;
create policy own on catalog_task_progress using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table test_variant_student_assignments enable row level security;
alter table test_variant_items enable row level security;
alter table test_variant_answers enable row level security;

-- Детерминированные id проб: probe.id('m1a') и т. п.
create schema probe;
create function probe.id(k text) returns uuid language sql immutable as $$ select md5(k)::uuid $$;
grant usage on schema probe to authenticated, anon;
grant execute on function probe.id(text) to authenticated, anon;
