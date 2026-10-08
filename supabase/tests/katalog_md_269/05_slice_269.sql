-- §269. Добавка к цепочке §262 (../otvety_262: слепки §254–§256 + 05_slice_262, миграции §254–§256, 262a, 262b).
-- Только то, что читают PENDING_269 и пробы, в колонках прода (src/types/database.ts, information_schema прода 08.10):
--  • роль service_role (BYPASSRLS, как в Supabase) — загрузчик и catalog_replace_task_v2;
--  • storage.buckets / storage.objects (каркас Supabase Storage) — бакет catalog-figures и его политики;
--  • catalog_tasks: external_id bigint (на проде bigint), source_url, created_at, updated_at, уникальность
--    (subject, exam_type, external_id), индекс catalog_tasks_counts_covering_idx (как на проде, §268);
--  • catalog_task_topics, task_collection_items (FK на catalog_tasks, как на проде);
--  • варианты: колонки, которые пишет submit_variant / answer_topic_task (прод);
--  • courses.subject / exam_type (catalog_my_overview, cte mine) — текстом, на проде enum;
--  • course_student_can_see_topic — ЗАГЛУШКА «да» (доступ к теме здесь не проверяем, только вердикт).
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text
);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon, service_role;
grant all on storage.objects, storage.buckets to authenticated, service_role;

alter table public.catalog_tasks alter column external_id type bigint;
alter table public.catalog_tasks
  add column if not exists source_url text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();
-- На проде unique (subject, exam_type, external_id); здесь у задач слепков §255/§262 номер 0 у многих — уникальность
-- только для номеров ≠ 0 (catalog_replace_task_v2 на неё и опирается).
create unique index catalog_tasks_subject_exam_extid_key on public.catalog_tasks (subject, exam_type, external_id) where external_id <> 0;
create index if not exists catalog_tasks_counts_covering_idx on public.catalog_tasks (is_published, subject, exam_type) include (id);

create table public.catalog_task_topics (
  task_id uuid not null references public.catalog_tasks(id) on delete cascade, topic_id uuid not null,
  is_primary boolean not null default false, source text, primary key (task_id, topic_id)
);
create table public.task_collection_items (
  id uuid primary key default gen_random_uuid(), collection_id uuid not null,
  catalog_task_id uuid not null references public.catalog_tasks(id) on delete restrict,
  position integer not null, unique (collection_id, catalog_task_id), unique (collection_id, position)
);
alter table public.test_variant_items add constraint test_variant_items_task_id_fkey foreign key (task_id) references public.catalog_tasks(id);

alter table public.test_variant_items
  add column points integer not null default 1,
  add column grading_type text not null default 'auto',
  add column position integer not null default 0;
alter table public.test_variant_student_assignments
  add column started_at timestamptz, add column completed_at timestamptz,
  add column answered_count integer, add column correct_count integer,
  add column score numeric, add column max_score numeric, add column percentage numeric,
  add column grading_status text, add column auto_score numeric, add column manual_review_count integer,
  add column attempts_used integer not null default 0, add column updated_at timestamptz;
alter table public.test_variant_answers
  add column answer_raw text, add column answer_normalized text,
  add column has_attachment boolean not null default false,
  add column points_earned numeric, add column points_max numeric,
  add column grading_status text, add column first_answered_at timestamptz;
alter table public.test_variant_answers add constraint test_variant_answers_sa_item_key unique (student_assignment_id, variant_item_id);

alter table public.courses add column if not exists subject text, add column if not exists exam_type text;

create or replace function public.course_student_can_see_topic(p_topic_id uuid)
returns boolean language sql stable as $$ select true $$;
