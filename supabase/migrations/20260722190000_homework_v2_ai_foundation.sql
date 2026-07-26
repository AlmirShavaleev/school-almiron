-- ============================================================
-- Homework v2 — AI/CV-ready foundation (schema only, no worker/model calls).
-- Additive migration; does not edit 20260722140000..180000.
-- ============================================================

create type public.homework_grading_mode as enum (
  'manual', 'exact_answer', 'numeric_tolerance', 'multiple_choice', 'formula', 'rubric', 'ai_assisted'
);

-- ── per-item grading spec, owned by the immutable template version ──
-- grading_spec is a snapshot taken at authoring time (possibly copied from catalog_tasks) —
-- later catalog edits never retroactively change an already-issued assignment's criteria,
-- because assignments point at a template_version_id whose items/grading_spec never mutate
-- once an assignment references that version (enforced by create_or_update_template_draft's
-- existing "locked once used" rule, unchanged here).
alter table public.homework_template_items
  add column max_score numeric,
  add column grading_mode public.homework_grading_mode not null default 'manual',
  add column grading_spec jsonb not null default '{}'::jsonb,
  add column ai_check_enabled boolean not null default false;

-- ── upload metadata for future CV/OCR page analysis; all nullable, existing upload flow
-- (finalize_homework_attempt) never sets these and keeps working unchanged. ──
alter table public.homework_attempt_files
  add column source_type text check (source_type is null or source_type in ('photo','scan','pdf','digital_ink','other')),
  add column page_number integer,
  add column sha256 text,
  add column width integer,
  add column height integer,
  add column rotation integer,
  add column metadata jsonb not null default '{}'::jsonb;

-- ── future AI job pipeline (schema only; nothing populates or consumes these tables yet) ──
create type public.homework_ai_job_status as enum (
  'queued', 'preprocessing', 'extracting', 'evaluating', 'awaiting_teacher', 'completed', 'failed'
);

create table public.homework_ai_jobs (
  id             uuid primary key default gen_random_uuid(),
  attempt_id     uuid not null references public.homework_attempts(id) on delete cascade,
  status         public.homework_ai_job_status not null default 'queued',
  provider       text,
  model          text,
  model_version  text,
  error_code     text,
  error_message  text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  completed_at   timestamptz
);
create index idx_homework_ai_jobs_attempt on public.homework_ai_jobs (attempt_id);

create type public.homework_ai_evaluation_status as enum (
  'confident', 'needs_review', 'unreadable', 'not_found'
);

create table public.homework_ai_item_evaluations (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references public.homework_ai_jobs(id) on delete cascade,
  template_item_id      uuid not null references public.homework_template_items(id) on delete cascade,
  detected_task_number  text,
  extracted_answer      text,
  recognized_work       text,
  suggested_score       numeric,
  max_score             numeric,
  confidence            numeric,
  status                public.homework_ai_evaluation_status not null default 'needs_review',
  feedback              text,
  -- normalized [0,1] coordinates, e.g. {"page_number":2,"bounding_box":{"x":0.12,"y":0.34,"width":0.71,"height":0.22}}
  evidence              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);
create index idx_homework_ai_item_evaluations_job on public.homework_ai_item_evaluations (job_id);
create index idx_homework_ai_item_evaluations_item on public.homework_ai_item_evaluations (template_item_id);

-- ── RLS: readable by the same staff who can already review the underlying attempt; no
-- direct writes for anyone (only a future SECURITY DEFINER worker/RPC will insert, once
-- built — none exists yet, so these tables stay empty and inert). ──
alter table public.homework_ai_jobs enable row level security;
alter table public.homework_ai_item_evaluations enable row level security;

create policy hwaijobs_select on public.homework_ai_jobs
  for select
  using (exists (
    select 1 from public.homework_attempts att join public.homework_assignments a on a.id = att.assignment_id
    where att.id = attempt_id
      and (public.is_admin_or_owner() or public.auth_is_teacher_of_group(a.group_id) or public.auth_is_curator_of_group(a.group_id))
  ));

create policy hwaieval_select on public.homework_ai_item_evaluations
  for select
  using (exists (
    select 1 from public.homework_ai_jobs j
    join public.homework_attempts att on att.id = j.attempt_id
    join public.homework_assignments a on a.id = att.assignment_id
    where j.id = job_id
      and (public.is_admin_or_owner() or public.auth_is_teacher_of_group(a.group_id) or public.auth_is_curator_of_group(a.group_id))
  ));

-- No INSERT/UPDATE/DELETE policies for authenticated on either table: AI evaluation is
-- explicitly never an official result on its own (see homeworkGrading.ts doc comment) —
-- the only path to an official grade stays submit_homework_review, unchanged by this migration.
