-- DRAFT: do not apply before review.
-- Vector annotations for legacy homework_submissions files.

create table annotation_sets (
  id uuid primary key default uuid_generate_v4(),
  submission_id uuid not null references homework_submissions(id) on delete cascade,
  file_path text not null check (length(btrim(file_path)) > 0),
  page integer not null default 1 check (page >= 1),
  author_id uuid not null references profiles(id) on delete restrict default auth.uid(),
  data jsonb not null default '{}'::jsonb check (
    jsonb_typeof(data) = 'object'
    and pg_column_size(data) <= 2 * 1024 * 1024
  ),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, file_path, page)
);

create index idx_annotation_sets_submission_status
  on annotation_sets(submission_id, status);

create index idx_annotation_sets_author
  on annotation_sets(author_id);

-- The shared trigger function is defined in 001_schema.sql and reused throughout
-- the project. Pin its lookup path before attaching it to this table.
alter function update_updated_at() set search_path = public, pg_temp;

create trigger annotation_sets_updated_at
  before update on annotation_sets
  for each row execute function update_updated_at();

create function prevent_annotation_set_author_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.author_id is distinct from old.author_id then
    raise exception 'annotation_sets.author_id cannot be changed';
  end if;
  return new;
end;
$$;

create trigger annotation_sets_author_immutable
  before update of author_id on annotation_sets
  for each row execute function prevent_annotation_set_author_change();

alter table annotation_sets enable row level security;

revoke all on table annotation_sets from anon;
grant select, insert, update, delete on table annotation_sets to authenticated;

-- Admin/owner and the teacher responsible for the homework can read drafts and
-- published annotations. A student can read only published annotations attached
-- to their own submission.
create policy annotation_sets_select on annotation_sets
  for select using (
    is_admin_or_owner()
    or exists (
      select 1
      from homework_submissions hs
      where hs.id = annotation_sets.submission_id
        and auth_is_teacher_of_homework(hs.homework_id)
    )
    or (
      status = 'published'
      and exists (
        select 1
        from homework_submissions hs
        join students s on s.id = hs.student_id
        where hs.id = annotation_sets.submission_id
          and s.profile_id = auth.uid()
      )
    )
  );

create policy annotation_sets_insert_staff on annotation_sets
  for insert with check (
    author_id = auth.uid()
    and (
      is_admin_or_owner()
      or exists (
        select 1
        from homework_submissions hs
        where hs.id = annotation_sets.submission_id
          and auth_is_teacher_of_homework(hs.homework_id)
      )
    )
  );

create policy annotation_sets_update_staff on annotation_sets
  for update using (
    is_admin_or_owner()
    or exists (
      select 1
      from homework_submissions hs
      where hs.id = annotation_sets.submission_id
        and auth_is_teacher_of_homework(hs.homework_id)
    )
  )
  with check (
    is_admin_or_owner()
    or exists (
      select 1
      from homework_submissions hs
      where hs.id = annotation_sets.submission_id
        and auth_is_teacher_of_homework(hs.homework_id)
    )
  );

create policy annotation_sets_delete_staff on annotation_sets
  for delete using (
    is_admin_or_owner()
    or exists (
      select 1
      from homework_submissions hs
      where hs.id = annotation_sets.submission_id
        and auth_is_teacher_of_homework(hs.homework_id)
    )
  );
