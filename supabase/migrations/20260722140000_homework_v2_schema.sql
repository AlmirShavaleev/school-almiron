-- ============================================================
-- Homework v2 — schema (Phase A, step 1/3)
-- New system alongside legacy homeworks/* and task_collections/*.
-- Neither legacy system is touched or dropped here (Phase B, separate).
-- ============================================================

-- ── enums ─────────────────────────────────────────────────────
create type public.homework_template_status as enum ('draft','active','archived');
create type public.homework_assignment_status as enum ('draft','published','closed','cancelled');
create type public.homework_attempt_status as enum ('draft','submitted','under_review','returned_for_revision','accepted','rejected');
create type public.homework_review_decision as enum ('accepted','returned_for_revision','rejected');

-- ── homework_templates (logical entity, id stable across versions) ──
create table public.homework_templates (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  topic_id    uuid references public.topics(id) on delete set null,
  title       text not null,
  created_by  uuid not null references public.profiles(id),
  status      public.homework_template_status not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger homework_templates_updated_at
  before update on public.homework_templates
  for each row execute function public.set_updated_at();

-- ── homework_template_versions (immutable once referenced by an assignment) ──
create table public.homework_template_versions (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.homework_templates(id) on delete cascade,
  version       integer not null check (version > 0),
  instructions  text,
  pdf_config    jsonb not null default '{}'::jsonb,
  max_score     numeric,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  unique (template_id, version)
);

create index idx_homework_template_versions_template on public.homework_template_versions (template_id, version desc);

-- ── homework_template_items (catalog tasks that make up a version) ──
create table public.homework_template_items (
  id                 uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.homework_template_versions(id) on delete cascade,
  catalog_task_id    uuid not null references public.catalog_tasks(id) on delete restrict,
  position           integer not null check (position > 0),
  custom_number      text,
  created_at         timestamptz not null default now(),
  unique (template_version_id, catalog_task_id),
  unique (template_version_id, position)
);

create index idx_homework_template_items_version on public.homework_template_items (template_version_id, position);
create index idx_homework_template_items_task on public.homework_template_items (catalog_task_id);

-- ── homework_template_files (attachments on a version) ──
create table public.homework_template_files (
  id                   uuid primary key default gen_random_uuid(),
  template_version_id  uuid not null references public.homework_template_versions(id) on delete cascade,
  storage_path         text not null,
  original_filename    text not null,
  mime_type             text,
  size_bytes            bigint,
  created_at            timestamptz not null default now()
);

create index idx_homework_template_files_version on public.homework_template_files (template_version_id);

-- ── homework_assignments (a version handed out to a group) ──
create table public.homework_assignments (
  id                     uuid primary key default gen_random_uuid(),
  template_version_id    uuid not null references public.homework_template_versions(id) on delete restrict,
  group_id               uuid not null references public.groups(id) on delete cascade,
  teacher_id             uuid not null references public.profiles(id),
  status                 public.homework_assignment_status not null default 'draft',
  publish_at             timestamptz not null,
  due_at                 timestamptz not null,
  max_attempts           integer check (max_attempts is null or max_attempts > 0),
  allow_late_submission  boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (due_at > publish_at)
);

create trigger homework_assignments_updated_at
  before update on public.homework_assignments
  for each row execute function public.set_updated_at();

create index idx_homework_assignments_group on public.homework_assignments (group_id);
create index idx_homework_assignments_template_version on public.homework_assignments (template_version_id);
create index idx_homework_assignments_teacher on public.homework_assignments (teacher_id);

-- ── homework_recipients (snapshot of who the assignment applies to) ──
create table public.homework_recipients (
  assignment_id     uuid not null references public.homework_assignments(id) on delete cascade,
  student_id        uuid not null references public.students(id) on delete cascade,
  assigned_at       timestamptz not null default now(),
  viewed_at         timestamptz,
  due_at_override   timestamptz,
  is_excused        boolean not null default false,
  excused_reason    text,
  primary key (assignment_id, student_id)
);

create index idx_homework_recipients_student on public.homework_recipients (student_id);

-- ── homework_attempts (one row per submission attempt) ──
create table public.homework_attempts (
  id               uuid primary key default gen_random_uuid(),
  assignment_id    uuid not null,
  student_id       uuid not null,
  attempt_number   integer not null check (attempt_number > 0),
  status           public.homework_attempt_status not null default 'draft',
  answer_text      text,
  submitted_at     timestamptz,
  score            numeric,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (assignment_id, student_id, attempt_number),
  foreign key (assignment_id, student_id)
    references public.homework_recipients (assignment_id, student_id) on delete cascade
);

create trigger homework_attempts_updated_at
  before update on public.homework_attempts
  for each row execute function public.set_updated_at();

create index idx_homework_attempts_assignment_student on public.homework_attempts (assignment_id, student_id);
create index idx_homework_attempts_status on public.homework_attempts (status);

-- ── homework_attempt_files (only written by finalize_homework_attempt RPC) ──
create table public.homework_attempt_files (
  id            uuid primary key default gen_random_uuid(),
  attempt_id    uuid not null references public.homework_attempts(id) on delete cascade,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text,
  size          bigint,
  created_at    timestamptz not null default now()
);

create index idx_homework_attempt_files_attempt on public.homework_attempt_files (attempt_id);

-- ── homework_reviews (append-only history) ──
create table public.homework_reviews (
  id            uuid primary key default gen_random_uuid(),
  attempt_id    uuid not null references public.homework_attempts(id) on delete cascade,
  reviewer_id   uuid not null references public.profiles(id),
  decision      public.homework_review_decision not null,
  score         numeric,
  comment       text,
  created_at    timestamptz not null default now()
);

create index idx_homework_reviews_attempt on public.homework_reviews (attempt_id, created_at desc);

-- ── idempotency table for assign_homework RPC (same pattern as distribution_flow_requests) ──
create table public.homework_assignment_requests (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references public.profiles(id),
  request_id     uuid not null,
  status         text not null default 'pending' check (status in ('pending','completed')),
  result         jsonb,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  unique (teacher_id, request_id)
);

-- ============================================================
-- RLS
-- ============================================================
alter table public.homework_templates          enable row level security;
alter table public.homework_template_versions   enable row level security;
alter table public.homework_template_items       enable row level security;
alter table public.homework_template_files       enable row level security;
alter table public.homework_assignments          enable row level security;
alter table public.homework_recipients           enable row level security;
alter table public.homework_attempts             enable row level security;
alter table public.homework_attempt_files        enable row level security;
alter table public.homework_reviews              enable row level security;
alter table public.homework_assignment_requests  enable row level security;

-- templates: teacher who owns the course (or admin/owner) manages; any staff/student
-- with a group on that course can read (mirrors homeworks_select reasoning, scoped to course).
create policy hwt_manage_owner on public.homework_templates
  for all
  using (public.is_admin_or_owner() or public.auth_is_course_owner(course_id) or created_by = auth.uid())
  with check (public.is_admin_or_owner() or public.auth_is_course_owner(course_id) or created_by = auth.uid());

create policy hwt_select_staff_or_student on public.homework_templates
  for select
  using (
    public.is_admin_or_owner()
    or public.auth_is_course_owner(course_id)
    or created_by = auth.uid()
    or exists (
      select 1 from public.groups g
      where g.course_id = homework_templates.course_id
        and (public.auth_is_teacher_of_group(g.id) or public.auth_is_curator_of_group(g.id) or public.auth_is_student_in_group(g.id))
    )
  );

-- versions/items/files: readable/writable through the parent template's rules
create policy hwtv_manage on public.homework_template_versions
  for all
  using (exists (select 1 from public.homework_templates t where t.id = template_id
    and (public.is_admin_or_owner() or public.auth_is_course_owner(t.course_id) or t.created_by = auth.uid())))
  with check (exists (select 1 from public.homework_templates t where t.id = template_id
    and (public.is_admin_or_owner() or public.auth_is_course_owner(t.course_id) or t.created_by = auth.uid())));

create policy hwtv_select on public.homework_template_versions
  for select
  using (exists (select 1 from public.homework_templates t where t.id = template_id
    and (public.is_admin_or_owner() or public.auth_is_course_owner(t.course_id) or t.created_by = auth.uid()
      or exists (select 1 from public.groups g where g.course_id = t.course_id
        and (public.auth_is_teacher_of_group(g.id) or public.auth_is_curator_of_group(g.id) or public.auth_is_student_in_group(g.id))))));

create policy hwti_manage on public.homework_template_items
  for all
  using (exists (select 1 from public.homework_template_versions v join public.homework_templates t on t.id = v.template_id
    where v.id = template_version_id and (public.is_admin_or_owner() or public.auth_is_course_owner(t.course_id) or t.created_by = auth.uid())))
  with check (exists (select 1 from public.homework_template_versions v join public.homework_templates t on t.id = v.template_id
    where v.id = template_version_id and (public.is_admin_or_owner() or public.auth_is_course_owner(t.course_id) or t.created_by = auth.uid())));

create policy hwti_select on public.homework_template_items
  for select
  using (exists (select 1 from public.homework_template_versions v where v.id = template_version_id));

create policy hwtf_manage on public.homework_template_files
  for all
  using (exists (select 1 from public.homework_template_versions v join public.homework_templates t on t.id = v.template_id
    where v.id = template_version_id and (public.is_admin_or_owner() or public.auth_is_course_owner(t.course_id) or t.created_by = auth.uid())))
  with check (exists (select 1 from public.homework_template_versions v join public.homework_templates t on t.id = v.template_id
    where v.id = template_version_id and (public.is_admin_or_owner() or public.auth_is_course_owner(t.course_id) or t.created_by = auth.uid())));

create policy hwtf_select on public.homework_template_files
  for select
  using (exists (select 1 from public.homework_template_versions v where v.id = template_version_id));

-- assignments: teacher manages own group's assignments; group staff + recipients read
create policy hwa_manage_teacher on public.homework_assignments
  for all
  using (public.is_admin_or_owner() or (teacher_id = auth.uid() and public.auth_is_teacher_of_group(group_id)))
  with check (public.is_admin_or_owner() or (teacher_id = auth.uid() and public.auth_is_teacher_of_group(group_id)));

create policy hwa_select_scoped on public.homework_assignments
  for select
  using (
    public.is_admin_or_owner()
    or public.auth_is_teacher_of_group(group_id)
    or public.auth_is_curator_of_group(group_id)
    or (public.auth_is_student_in_group(group_id) and status = 'published' and publish_at <= now())
  );

-- recipients: teacher of the assignment's group manages; student sees only own row
create policy hwr_manage_teacher on public.homework_recipients
  for all
  using (exists (select 1 from public.homework_assignments a where a.id = assignment_id
    and (public.is_admin_or_owner() or (a.teacher_id = auth.uid() and public.auth_is_teacher_of_group(a.group_id)))))
  with check (exists (select 1 from public.homework_assignments a where a.id = assignment_id
    and (public.is_admin_or_owner() or (a.teacher_id = auth.uid() and public.auth_is_teacher_of_group(a.group_id)))));

create policy hwr_select_staff on public.homework_recipients
  for select
  using (exists (select 1 from public.homework_assignments a where a.id = assignment_id
    and (public.is_admin_or_owner() or public.auth_is_teacher_of_group(a.group_id) or public.auth_is_curator_of_group(a.group_id))));

create policy hwr_select_own on public.homework_recipients
  for select
  using (exists (select 1 from public.students s where s.id = student_id and s.profile_id = auth.uid()));

create policy hwr_update_own_viewed on public.homework_recipients
  for update
  using (exists (select 1 from public.students s where s.id = student_id and s.profile_id = auth.uid()))
  with check (exists (select 1 from public.students s where s.id = student_id and s.profile_id = auth.uid()));

-- attempts: student manages own draft attempts directly (submit happens via RPC which
-- runs as the same user, so ordinary RLS still applies inside it); staff of the group review.
create policy hwatt_select on public.homework_attempts
  for select
  using (
    public.is_admin_or_owner()
    or exists (select 1 from public.homework_assignments a where a.id = assignment_id
      and (public.auth_is_teacher_of_group(a.group_id) or public.auth_is_curator_of_group(a.group_id)))
    or exists (select 1 from public.students s where s.id = student_id and s.profile_id = auth.uid())
  );

create policy hwatt_student_insert on public.homework_attempts
  for insert
  with check (exists (select 1 from public.students s where s.id = student_id and s.profile_id = auth.uid()));

create policy hwatt_student_update_own_draft on public.homework_attempts
  for update
  using (status in ('draft','returned_for_revision') and exists (select 1 from public.students s where s.id = student_id and s.profile_id = auth.uid()))
  with check (exists (select 1 from public.students s where s.id = student_id and s.profile_id = auth.uid()));

create policy hwatt_staff_update on public.homework_attempts
  for update
  using (public.is_admin_or_owner() or exists (select 1 from public.homework_assignments a where a.id = assignment_id
    and (public.auth_is_teacher_of_group(a.group_id) or public.auth_is_curator_of_group(a.group_id))));

-- attempt files: readable by the same audience as the attempt; writes only via
-- finalize_homework_attempt (SECURITY DEFINER) — no direct INSERT policy for authenticated.
create policy hwaf_select on public.homework_attempt_files
  for select
  using (exists (select 1 from public.homework_attempts att where att.id = attempt_id
    and (
      public.is_admin_or_owner()
      or exists (select 1 from public.homework_assignments a where a.id = att.assignment_id
        and (public.auth_is_teacher_of_group(a.group_id) or public.auth_is_curator_of_group(a.group_id)))
      or exists (select 1 from public.students s where s.id = att.student_id and s.profile_id = auth.uid())
    )));

-- reviews: staff of the group insert/read; student reads own attempt's reviews.
create policy hwrev_select on public.homework_reviews
  for select
  using (exists (select 1 from public.homework_attempts att where att.id = attempt_id
    and (
      public.is_admin_or_owner()
      or exists (select 1 from public.homework_assignments a where a.id = att.assignment_id
        and (public.auth_is_teacher_of_group(a.group_id) or public.auth_is_curator_of_group(a.group_id)))
      or exists (select 1 from public.students s where s.id = att.student_id and s.profile_id = auth.uid())
    )));

create policy hwrev_staff_insert on public.homework_reviews
  for insert
  with check (reviewer_id = auth.uid() and exists (select 1 from public.homework_attempts att
    join public.homework_assignments a on a.id = att.assignment_id
    where att.id = attempt_id and (public.is_admin_or_owner() or public.auth_is_teacher_of_group(a.group_id) or public.auth_is_curator_of_group(a.group_id))));

-- idempotency table: owner-only, service-side (RPCs run SECURITY DEFINER so this mostly
-- guards against direct client access)
create policy hwareq_own on public.homework_assignment_requests
  for all
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

-- ============================================================
-- storage bucket for attempt uploads
-- ============================================================
insert into storage.buckets (id, name, public)
values ('homework-attempts', 'homework-attempts', false)
on conflict (id) do nothing;

-- Upload allowed only under a path prefixed by the uploader's own profile id; ownership of
-- the *attempt* itself is verified server-side by finalize_homework_attempt, not by this
-- policy — this policy only stops one user from writing into another user's namespace.
create policy "homework_attachments_owner_write" on storage.objects
  for insert
  with check (
    bucket_id = 'homework-attempts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "homework_attachments_owner_read" on storage.objects
  for select
  using (
    bucket_id = 'homework-attempts'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin_or_owner()
      or exists (
        select 1 from public.homework_attempt_files f
        join public.homework_attempts att on att.id = f.attempt_id
        join public.homework_assignments a on a.id = att.assignment_id
        where f.storage_path = storage.objects.name
          and (public.auth_is_teacher_of_group(a.group_id) or public.auth_is_curator_of_group(a.group_id))
      )
    )
  );
