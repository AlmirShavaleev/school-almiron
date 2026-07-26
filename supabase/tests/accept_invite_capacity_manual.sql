-- ============================================================
-- accept_student_invite — capacity re-check manual verification.
-- Wrapped in BEGIN/ROLLBACK: run against a live/staging project, leaves no data behind.
-- Fully self-contained fixtures (no real project ids needed).
-- teachers/students rows are auto-provisioned by sync_role_record_trigger on profiles insert.
-- Run via `execute_sql` (Supabase MCP) or `psql -f`.
-- ============================================================

begin;

create temp table _results (check_name text, passed boolean, detail text);

insert into auth.users (id, email, email_confirmed_at) values
  (gen_random_uuid(), 'cap-teacher@example.com', now()),
  (gen_random_uuid(), 'cap-student-a@example.com', now()),
  (gen_random_uuid(), 'cap-student-b@example.com', now());

create temp table _ids as
select
  (select id from auth.users where email = 'cap-teacher@example.com') as teacher_profile,
  (select id from auth.users where email = 'cap-student-a@example.com') as student_a_profile,
  (select id from auth.users where email = 'cap-student-b@example.com') as student_b_profile;

insert into public.profiles (id, email, full_name, role)
select teacher_profile, 'cap-teacher@example.com', 'Cap Teacher', 'teacher'::public.user_role from _ids
union all
select student_a_profile, 'cap-student-a@example.com', 'Cap Student A', 'student'::public.user_role from _ids
union all
select student_b_profile, 'cap-student-b@example.com', 'Cap Student B', 'student'::public.user_role from _ids;

-- teachers/students rows auto-created by sync_role_record_trigger
create temp table _teacher as select id from public.teachers where profile_id = (select teacher_profile from _ids);
create temp table _student_a as select id from public.students where profile_id = (select student_a_profile from _ids);
create temp table _student_b as select id from public.students where profile_id = (select student_b_profile from _ids);

create temp table _course as
with ins as (
  insert into public.courses (title, subject, exam_type, owner_id, is_draft, is_active)
  select 'Cap Test Course', 'math', 'ege', teacher_profile, true, true from _ids
  returning id
)
select * from ins;

-- max_students = 1: only the first accept should fit
create temp table _group as
with ins as (
  insert into public.groups (name, course_id, teacher_id, type, max_students)
  select 'Cap Test Group', (select id from _course), (select id from _teacher), 'group', 1
  returning id
)
select * from ins;

grant select, insert on _results, _ids, _teacher, _student_a, _student_b, _course, _group to authenticated;

-- ── teacher creates two invites into the same 1-seat group ──
select set_config('request.jwt.claim.sub', (select teacher_profile::text from _ids), true);
set local role authenticated;

create temp table _inv_a as
select * from public.create_student_invite((select id from _group), 'Student A');
create temp table _inv_b as
select * from public.create_student_invite((select id from _group), 'Student B');

reset role;
grant select on _inv_a, _inv_b to authenticated;

-- ── student A accepts first: group has 0/1, should succeed ──
select set_config('request.jwt.claim.sub', (select student_a_profile::text from _ids), true);
set local role authenticated;

do $$
begin
  perform * from public.accept_student_invite((select token from _inv_a));
end $$;

insert into _results
select 'student A accepts into free seat (0/1) succeeds',
  exists (select 1 from public.group_students gs join _student_a sa on sa.id = gs.student_id where gs.group_id = (select id from _group)),
  null;

reset role;

-- ── student B accepts second: group now 1/1, must be rejected with GROUP_ALREADY_FULL ──
select set_config('request.jwt.claim.sub', (select student_b_profile::text from _ids), true);
set local role authenticated;

create temp table _b_result (raised boolean, message text);
do $$
begin
  perform * from public.accept_student_invite((select token from _inv_b));
  insert into _b_result values (false, null);
exception when others then
  insert into _b_result values (true, SQLERRM);
end $$;

insert into _results
select 'student B rejected from full group (1/1) with GROUP_ALREADY_FULL',
  (select raised from _b_result) and (select message from _b_result) like 'GROUP_ALREADY_FULL%',
  (select message from _b_result);

insert into _results
select 'student B was NOT added to group_students',
  NOT exists (select 1 from public.group_students gs join _student_b sb on sb.id = gs.student_id where gs.group_id = (select id from _group)),
  null;

reset role;

-- ── student A re-accepting same (already-accepted) invite: idempotent, no false capacity error ──
select set_config('request.jwt.claim.sub', (select student_a_profile::text from _ids), true);
set local role authenticated;

create temp table _a_reaccept (raised boolean, message text);
do $$
begin
  perform * from public.accept_student_invite((select token from _inv_a));
  insert into _a_reaccept values (false, null);
exception when others then
  insert into _a_reaccept values (true, SQLERRM);
end $$;

insert into _results
select 'student A re-accept fails with INVITE_NOT_PENDING (not GROUP_ALREADY_FULL)',
  (select raised from _a_reaccept) and (select message from _a_reaccept) like 'INVITE_NOT_PENDING%',
  (select message from _a_reaccept);

reset role;

select * from _results order by check_name;

rollback;
