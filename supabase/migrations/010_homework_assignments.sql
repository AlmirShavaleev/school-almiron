-- ============================================================
-- HOMEWORK ASSIGNMENTS — Phase A
-- Course topic homework templates -> group/student assignments.
-- Non-destructive: keeps legacy homeworks/homework_submissions data.
-- ============================================================

create extension if not exists "uuid-ossp";

alter type homework_status add value if not exists 'under_review';
alter type homework_status add value if not exists 'revision_requested';
alter type homework_status add value if not exists 'resubmitted';
alter type homework_status add value if not exists 'accepted';

-- ── homeworks as course-topic templates ─────────────────────────────────────
alter table homeworks
  add column if not exists instructions text,
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists is_published boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

-- In the new model due dates live on assignments. Keep due_date only for
-- legacy screens/data and allow new templates to omit it.
alter table homeworks
  alter column due_date drop not null;

drop trigger if exists homeworks_updated_at on homeworks;
create trigger homeworks_updated_at
  before update on homeworks
  for each row execute function update_updated_at();

-- ── Assignment batch/entity ─────────────────────────────────────────────────
create table if not exists homework_assignments (
  id uuid primary key default uuid_generate_v4(),
  homework_id uuid not null references homeworks(id) on delete cascade,
  assigned_by uuid not null references profiles(id) on delete restrict,
  group_id uuid references groups(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  available_from timestamptz,
  due_at timestamptz,
  max_attempts integer not null default 3 check (max_attempts > 0 and max_attempts <= 20),
  allow_late_submission boolean not null default true,
  show_solution_after_accept boolean not null default false,
  status text not null default 'active' check (status in ('draft', 'active', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint homework_assignments_exactly_one_target check (
    (group_id is not null and student_id is null) or
    (group_id is null and student_id is not null)
  )
);

create index if not exists idx_homework_assignments_homework on homework_assignments(homework_id);
create index if not exists idx_homework_assignments_group on homework_assignments(group_id) where group_id is not null;
create index if not exists idx_homework_assignments_student on homework_assignments(student_id) where student_id is not null;
create index if not exists idx_homework_assignments_status_due on homework_assignments(status, due_at);

drop trigger if exists homework_assignments_updated_at on homework_assignments;
create trigger homework_assignments_updated_at
  before update on homework_assignments
  for each row execute function update_updated_at();

-- ── Per-student assignment state ────────────────────────────────────────────
create table if not exists homework_student_assignments (
  id uuid primary key default uuid_generate_v4(),
  assignment_id uuid not null references homework_assignments(id) on delete cascade,
  homework_id uuid not null references homeworks(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  status text not null default 'not_started' check (status in (
    'not_started',
    'in_progress',
    'submitted',
    'under_review',
    'revision_requested',
    'resubmitted',
    'accepted',
    'overdue',
    'cancelled'
  )),
  available_from timestamptz,
  due_at timestamptz,
  attempts_used integer not null default 0 check (attempts_used >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0 and max_attempts <= 20),
  first_opened_at timestamptz,
  submitted_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(assignment_id, student_id)
);

create index if not exists idx_hw_student_assignments_student_status
  on homework_student_assignments(student_id, status, due_at);
create index if not exists idx_hw_student_assignments_homework
  on homework_student_assignments(homework_id);
create index if not exists idx_hw_student_assignments_assignment
  on homework_student_assignments(assignment_id);

drop trigger if exists homework_student_assignments_updated_at on homework_student_assignments;
create trigger homework_student_assignments_updated_at
  before update on homework_student_assignments
  for each row execute function update_updated_at();

-- ── Homework composition ────────────────────────────────────────────────────
create table if not exists homework_items (
  id uuid primary key default uuid_generate_v4(),
  homework_id uuid not null references homeworks(id) on delete cascade,
  item_type text not null check (item_type in ('catalog_task', 'text', 'file', 'link')),
  catalog_task_id uuid,
  title text,
  content_html text,
  resource_url text,
  position integer not null default 0,
  points integer,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  unique(homework_id, position),
  constraint homework_items_catalog_task_required check (
    item_type <> 'catalog_task' or catalog_task_id is not null
  )
);

create index if not exists idx_homework_items_homework_position
  on homework_items(homework_id, position);
create index if not exists idx_homework_items_catalog_task
  on homework_items(catalog_task_id) where catalog_task_id is not null;

-- ── Submission attempts: adapt legacy table, preserve old rows ──────────────
alter table homework_submissions
  add column if not exists student_assignment_id uuid references homework_student_assignments(id) on delete cascade,
  add column if not exists attempt_number integer not null default 1,
  add column if not exists text_answer text,
  add column if not exists max_score integer,
  add column if not exists teacher_comment text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table homework_submissions
  drop constraint if exists homework_submissions_homework_id_student_id_key;

-- Legacy status enum remains for compatibility. The new workflow uses
-- student_assignment_id + attempt_number and keeps prior attempts.
create unique index if not exists homework_submissions_student_assignment_attempt_key
  on homework_submissions(student_assignment_id, attempt_number)
  where student_assignment_id is not null;

create index if not exists idx_hw_submissions_student_assignment
  on homework_submissions(student_assignment_id, attempt_number)
  where student_assignment_id is not null;
create index if not exists idx_hw_submissions_review_queue
  on homework_submissions(status, submitted_at)
  where status in ('submitted', 'revision');

drop trigger if exists homework_submissions_updated_at on homework_submissions;
create trigger homework_submissions_updated_at
  before update on homework_submissions
  for each row execute function update_updated_at();

-- ── Submission files ────────────────────────────────────────────────────────
create table if not exists homework_submission_files (
  id uuid primary key default uuid_generate_v4(),
  submission_id uuid not null references homework_submissions(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in (
    'image/jpeg',
    'image/png',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 25 * 1024 * 1024),
  uploaded_by uuid not null references profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint homework_submission_files_safe_path check (
    storage_path ~ '^homework-submissions/[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+/[^/]+$'
  )
);

create index if not exists idx_homework_submission_files_submission
  on homework_submission_files(submission_id);

-- ── Feedback thread ─────────────────────────────────────────────────────────
create table if not exists homework_feedback_messages (
  id uuid primary key default uuid_generate_v4(),
  submission_id uuid not null references homework_submissions(id) on delete cascade,
  author_profile_id uuid not null references profiles(id) on delete restrict,
  message text not null check (length(trim(message)) > 0),
  attachment_path text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  is_deleted boolean not null default false
);

create index if not exists idx_homework_feedback_submission_created
  on homework_feedback_messages(submission_id, created_at);

-- ── Helper predicates ───────────────────────────────────────────────────────
create or replace function auth_is_teacher_of_homework(hw_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from homeworks h
    join teachers t on t.id = coalesce(h.teacher_id, h.created_by)
    where h.id = hw_id
      and t.profile_id = auth.uid()
  );
$$;

create or replace function auth_is_student_assignment_owner(student_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from homework_student_assignments hsa
    join students s on s.id = hsa.student_id
    where hsa.id = student_assignment_id
      and s.profile_id = auth.uid()
  );
$$;

-- ── Assignment RPC ──────────────────────────────────────────────────────────
create or replace function assign_homework(
  p_homework_id uuid,
  p_group_ids uuid[] default '{}'::uuid[],
  p_student_ids uuid[] default '{}'::uuid[],
  p_available_from timestamptz default null,
  p_due_at timestamptz default null,
  p_max_attempts integer default 3,
  p_allow_late_submission boolean default true,
  p_show_solution_after_accept boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := auth.uid();
  v_role user_role;
  v_teacher_id uuid;
  v_hw homeworks%rowtype;
  v_group_id uuid;
  v_student_id uuid;
  v_assignment_id uuid;
  v_student_assignment_id uuid;
  v_created_assignments integer := 0;
  v_created_student_assignments integer := 0;
  v_created_notifications integer := 0;
  v_due_label text;
begin
  if v_profile_id is null then
    raise exception 'not authenticated';
  end if;

  if p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 20 then
    raise exception 'max_attempts must be between 1 and 20';
  end if;

  if coalesce(array_length(p_group_ids, 1), 0) = 0
     and coalesce(array_length(p_student_ids, 1), 0) = 0 then
    raise exception 'select at least one group or student';
  end if;

  select role into v_role from profiles where id = v_profile_id;
  select id into v_teacher_id from teachers where profile_id = v_profile_id;

  select * into v_hw from homeworks where id = p_homework_id;
  if not found then
    raise exception 'homework not found';
  end if;

  if not (v_role in ('admin', 'owner') or coalesce(v_hw.teacher_id, v_hw.created_by) = v_teacher_id) then
    raise exception 'not allowed to assign this homework';
  end if;

  create temporary table tmp_hw_assign_students (
    student_id uuid primary key,
    assignment_id uuid not null
  ) on commit drop;

  -- Group targets. If the same student appears in multiple selected groups, the
  -- first assignment wins for this batch and the student is not duplicated.
  foreach v_group_id in array coalesce(p_group_ids, '{}'::uuid[]) loop
    if not exists (select 1 from groups where id = v_group_id) then
      raise exception 'group not found: %', v_group_id;
    end if;

    if v_role not in ('admin', 'owner') and not exists (
      select 1 from groups where id = v_group_id and teacher_id = v_teacher_id
    ) then
      raise exception 'not allowed to assign group: %', v_group_id;
    end if;

    insert into homework_assignments (
      homework_id, assigned_by, group_id, available_from, due_at, max_attempts,
      allow_late_submission, show_solution_after_accept, status
    ) values (
      p_homework_id, v_profile_id, v_group_id, p_available_from, p_due_at, p_max_attempts,
      p_allow_late_submission, p_show_solution_after_accept, 'active'
    )
    returning id into v_assignment_id;

    v_created_assignments := v_created_assignments + 1;

    insert into tmp_hw_assign_students(student_id, assignment_id)
    select gs.student_id, v_assignment_id
    from group_students gs
    where gs.group_id = v_group_id
    on conflict (student_id) do nothing;
  end loop;

  -- Individual targets that were not already covered by selected groups.
  foreach v_student_id in array coalesce(p_student_ids, '{}'::uuid[]) loop
    if not exists (select 1 from students where id = v_student_id) then
      raise exception 'student not found: %', v_student_id;
    end if;

    if exists (select 1 from tmp_hw_assign_students where student_id = v_student_id) then
      continue;
    end if;

    if v_role not in ('admin', 'owner') and not exists (
      select 1
      from group_students gs
      join groups g on g.id = gs.group_id
      where gs.student_id = v_student_id
        and g.teacher_id = v_teacher_id
    ) then
      raise exception 'not allowed to assign student: %', v_student_id;
    end if;

    insert into homework_assignments (
      homework_id, assigned_by, student_id, available_from, due_at, max_attempts,
      allow_late_submission, show_solution_after_accept, status
    ) values (
      p_homework_id, v_profile_id, v_student_id, p_available_from, p_due_at, p_max_attempts,
      p_allow_late_submission, p_show_solution_after_accept, 'active'
    )
    returning id into v_assignment_id;

    v_created_assignments := v_created_assignments + 1;

    insert into tmp_hw_assign_students(student_id, assignment_id)
    values (v_student_id, v_assignment_id)
    on conflict (student_id) do nothing;
  end loop;

  v_due_label := coalesce(to_char(p_due_at at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI'), 'без дедлайна');

  for v_student_id, v_assignment_id in
    select student_id, assignment_id from tmp_hw_assign_students
  loop
    insert into homework_student_assignments (
      assignment_id, homework_id, student_id, available_from, due_at, max_attempts, status
    ) values (
      v_assignment_id, p_homework_id, v_student_id, p_available_from, p_due_at, p_max_attempts, 'not_started'
    )
    on conflict (assignment_id, student_id) do nothing
    returning id into v_student_assignment_id;

    if v_student_assignment_id is not null then
      v_created_student_assignments := v_created_student_assignments + 1;

      insert into notifications(user_id, title, message, type)
      select s.profile_id,
             'Новое домашнее задание',
             'Вам назначено ДЗ «' || v_hw.title || '». Срок: ' || v_due_label || '. /student/homeworks/' || v_student_assignment_id,
             'info'
      from students s
      where s.id = v_student_id;

      v_created_notifications := v_created_notifications + 1;

      insert into notification_queue(
        profile_id, channel, event_type, entity_type, entity_id, deduplication_key, payload, status, scheduled_for
      )
      select s.profile_id,
             'telegram',
             'new_homework',
             'homework_student_assignment',
             v_student_assignment_id,
             'new_homework_assignment:' || v_student_assignment_id || ':' || s.profile_id,
             jsonb_build_object(
               'title', v_hw.title,
               'due_date', v_due_label,
               'entity_id', v_student_assignment_id,
               'url', '/student/homeworks/' || v_student_assignment_id
             ),
             'pending',
             now()
      from students s
      where s.id = v_student_id
      on conflict (deduplication_key) do nothing;
    end if;

    v_student_assignment_id := null;
  end loop;

  return jsonb_build_object(
    'homework_id', p_homework_id,
    'assignments_created', v_created_assignments,
    'student_assignments_created', v_created_student_assignments,
    'notifications_created', v_created_notifications
  );
end;
$$;

revoke all on function assign_homework(uuid, uuid[], uuid[], timestamptz, timestamptz, integer, boolean, boolean)
  from public, anon;
grant execute on function assign_homework(uuid, uuid[], uuid[], timestamptz, timestamptz, integer, boolean, boolean)
  to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table homework_assignments enable row level security;
alter table homework_student_assignments enable row level security;
alter table homework_items enable row level security;
alter table homework_submission_files enable row level security;
alter table homework_feedback_messages enable row level security;

drop policy if exists homeworks_select on homeworks;
drop policy if exists homeworks_manage_teacher on homeworks;

create policy homeworks_select on homeworks
  for select using (
    is_admin_or_owner()
    or auth_is_teacher_of_homework(id)
    or exists (
      select 1
      from homework_student_assignments hsa
      join students s on s.id = hsa.student_id
      where hsa.homework_id = homeworks.id
        and s.profile_id = auth.uid()
    )
  );

create policy homeworks_manage_teacher on homeworks
  for all using (
    is_admin_or_owner() or auth_is_teacher_of_homework(id)
  )
  with check (
    is_admin_or_owner()
    or exists (
      select 1 from teachers t
      where t.id = coalesce(homeworks.teacher_id, homeworks.created_by)
        and t.profile_id = auth.uid()
    )
  );

create policy hw_assignments_select on homework_assignments
  for select using (
    is_admin_or_owner()
    or auth_is_teacher_of_homework(homework_id)
    or exists (
      select 1
      from homework_student_assignments hsa
      join students s on s.id = hsa.student_id
      where hsa.assignment_id = homework_assignments.id
        and s.profile_id = auth.uid()
    )
  );

create policy hw_assignments_manage_staff on homework_assignments
  for all using (
    is_admin_or_owner() or auth_is_teacher_of_homework(homework_id)
  )
  with check (
    is_admin_or_owner() or auth_is_teacher_of_homework(homework_id)
  );

create policy hw_student_assignments_select on homework_student_assignments
  for select using (
    is_admin_or_owner()
    or auth_is_teacher_of_homework(homework_id)
    or exists (
      select 1 from students s
      where s.id = homework_student_assignments.student_id
        and s.profile_id = auth.uid()
    )
  );

create policy hw_student_assignments_update_student_progress on homework_student_assignments
  for update using (
    exists (
      select 1 from students s
      where s.id = homework_student_assignments.student_id
        and s.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from students s
      where s.id = homework_student_assignments.student_id
        and s.profile_id = auth.uid()
    )
  );

create policy hw_student_assignments_manage_staff on homework_student_assignments
  for all using (
    is_admin_or_owner() or auth_is_teacher_of_homework(homework_id)
  )
  with check (
    is_admin_or_owner() or auth_is_teacher_of_homework(homework_id)
  );

create policy homework_items_select on homework_items
  for select using (
    is_admin_or_owner()
    or auth_is_teacher_of_homework(homework_id)
    or exists (
      select 1
      from homework_student_assignments hsa
      join students s on s.id = hsa.student_id
      where hsa.homework_id = homework_items.homework_id
        and s.profile_id = auth.uid()
    )
  );

create policy homework_items_manage_staff on homework_items
  for all using (
    is_admin_or_owner() or auth_is_teacher_of_homework(homework_id)
  )
  with check (
    is_admin_or_owner() or auth_is_teacher_of_homework(homework_id)
  );

create policy hw_submission_files_select on homework_submission_files
  for select using (
    is_admin_or_owner()
    or exists (
      select 1
      from homework_submissions hs
      where hs.id = homework_submission_files.submission_id
        and (
          auth_is_teacher_of_homework(hs.homework_id)
          or exists (
            select 1 from students s
            where s.id = hs.student_id and s.profile_id = auth.uid()
          )
        )
    )
  );

create policy hw_submission_files_insert_student on homework_submission_files
  for insert with check (
    uploaded_by = auth.uid()
    and exists (
      select 1
      from homework_submissions hs
      join students s on s.id = hs.student_id
      where hs.id = homework_submission_files.submission_id
        and s.profile_id = auth.uid()
    )
  );

create policy hw_feedback_select on homework_feedback_messages
  for select using (
    is_admin_or_owner()
    or exists (
      select 1
      from homework_submissions hs
      where hs.id = homework_feedback_messages.submission_id
        and (
          auth_is_teacher_of_homework(hs.homework_id)
          or exists (
            select 1 from students s
            where s.id = hs.student_id and s.profile_id = auth.uid()
          )
        )
    )
  );

create policy hw_feedback_insert_participants on homework_feedback_messages
  for insert with check (
    author_profile_id = auth.uid()
    and exists (
      select 1
      from homework_submissions hs
      where hs.id = homework_feedback_messages.submission_id
        and (
          auth_is_teacher_of_homework(hs.homework_id)
          or exists (
            select 1 from students s
            where s.id = hs.student_id and s.profile_id = auth.uid()
          )
        )
    )
  );
