-- ============================================================
-- Homework v2 — manual verification script.
-- Wrapped in BEGIN/ROLLBACK: run against a live/staging project, leaves no data behind.
-- Uses real course/group/teacher/student ids — replace the constants below for your project.
-- Run via `execute_sql` (Supabase MCP) or `psql -f`.
-- ============================================================

begin;

-- ── fixtures (replace with real ids from your project before running) ──
-- teacher profile that owns/teaches the group below
\set teacher_profile '43396c60-0c26-4c7d-a944-1dfa727353be'
-- a group on a course that has at least one enrolled student
\set course_id '85eba931-bf41-4e4d-bb49-edffca96982b'
\set group_id '32eaf7e1-5d9c-48a2-a447-c8ef228f6c2b'
-- a student profile that IS in the group above
\set student_profile '0e26a665-d3ee-49bd-af49-d9be0cd9c901'
-- a profile that is NOT a student and NOT in the group (used for negative RLS checks)
\set outsider_profile 'ffffffff-ffff-ffff-ffff-ffffffffffff'

create temp table _results (check_name text, passed boolean, detail text);

-- 1) Teacher creates template v1, assigns to group (idempotent request_id)
select set_config('request.jwt.claim.sub', :'teacher_profile', true);
set local role authenticated;

create temp table _t as select public.create_or_update_template_draft(
  null, :'course_id'::uuid, null, 'v2 manual test', null, '{}'::jsonb, 100, null, null
) as tmpl;
create temp table _v as select (tmpl->>'template_version_id')::uuid as tvid, (tmpl->>'template_id')::uuid as template_id from _t;

create temp table _rid as select gen_random_uuid() as rid;
create temp table _a1 as select public.assign_homework(
  (select tvid from _v), :'group_id'::uuid, null, true, now(), now() + interval '7 days', 2, false, (select rid from _rid)
) as asg;
create temp table _a2 as select public.assign_homework(
  (select tvid from _v), :'group_id'::uuid, null, true, now(), now() + interval '7 days', 2, false, (select rid from _rid)
) as asg;
insert into _results select 'idempotent assign_homework returns same result',
  (select asg from _a1) = (select asg from _a2), null;

create temp table _aid as select (asg->>'assignment_id')::uuid as assignment_id from _a1;

-- 2) Editing template after it has an assignment creates a new version; old assignment
--    keeps pointing at v1 (immutability).
create temp table _t2 as select public.create_or_update_template_draft(
  (select template_id from _v), :'course_id'::uuid, null, 'v2 manual test EDITED', 'now with text', '{}'::jsonb, 100, null, null
) as tmpl;
insert into _results select 'editing used template creates new version',
  (select tmpl->>'template_version_id' from _t2) <> (select tvid::text from _v), null;
insert into _results select 'old assignment still references v1',
  (select count(*) = 1 from public.homework_assignments
    where id = (select assignment_id from _aid) and template_version_id = (select tvid from _v)), null;

-- 3) Attempt without recipient is impossible (outsider / non-student rejected)
select set_config('request.jwt.claim.sub', :'outsider_profile', true);
do $$
declare v_aid uuid; v_caught boolean := false;
begin
  select assignment_id into v_aid from _aid;
  begin
    perform public.start_homework_attempt(v_aid);
  exception when others then v_caught := true;
  end;
  insert into _results values ('non-recipient cannot start an attempt', v_caught, null);
end $$;

-- 4) Full attempt/review lifecycle: submit -> return -> resubmit -> accept
select set_config('request.jwt.claim.sub', :'student_profile', true);
create temp table _att1 as select public.start_homework_attempt((select assignment_id from _aid)) as att;
create temp table _attid1 as select (att->>'attempt_id')::uuid as attempt_id from _att1;
select public.finalize_homework_attempt((select attempt_id from _attid1), 'answer 1', null);

select set_config('request.jwt.claim.sub', :'teacher_profile', true);
select public.submit_homework_review((select attempt_id from _attid1), 'returned_for_revision', null, 'fix it');

select set_config('request.jwt.claim.sub', :'student_profile', true);
create temp table _att2 as select public.start_homework_attempt((select assignment_id from _aid)) as att;
create temp table _attid2 as select (att->>'attempt_id')::uuid as attempt_id from _att2;
insert into _results select 'resubmission after return creates attempt_number=2',
  (select (att->>'attempt_number')::int = 2 from _att2), null;
select public.finalize_homework_attempt((select attempt_id from _attid2), 'answer 2', null);

select set_config('request.jwt.claim.sub', :'teacher_profile', true);
select public.submit_homework_review((select attempt_id from _attid2), 'accepted', 95, 'good');

create temp table _row as select * from public.get_my_homework_assignments(null, null) where assignment_id = (select assignment_id from _aid);
insert into _results select 'final category is checked with correct score', (select category = 'checked' and latest_score = 95 from _row), null;

-- 5) max_attempts enforced (assignment above has max_attempts=2, both used)
select set_config('request.jwt.claim.sub', :'student_profile', true);
do $$
declare v_aid uuid; v_caught boolean := false; v_msg text;
begin
  select assignment_id into v_aid from _aid;
  begin
    perform public.start_homework_attempt(v_aid);
  exception when others then get stacked diagnostics v_msg = message_text; v_caught := (v_msg like 'MAX_ATTEMPTS_REACHED%');
  end;
  insert into _results values ('max_attempts blocks a 3rd attempt', v_caught, null);
end $$;

-- 6) forged storage_path prefix rejected by finalize (path not matching attempt namespace)
select set_config('request.jwt.claim.sub', :'teacher_profile', true);
create temp table _t3 as select public.create_or_update_template_draft(
  null, :'course_id'::uuid, null, 'v2 storage test', null, '{}'::jsonb, 100, null, null) as tmpl;
create temp table _v3 as select (tmpl->>'template_version_id')::uuid as tvid from _t3;
create temp table _a3 as select public.assign_homework(
  (select tvid from _v3), :'group_id'::uuid, null, true, now(), now() + interval '7 days', null, true, gen_random_uuid()) as asg;
create temp table _aid3 as select (asg->>'assignment_id')::uuid as assignment_id from _a3;

select set_config('request.jwt.claim.sub', :'student_profile', true);
create temp table _att3 as select public.start_homework_attempt((select assignment_id from _aid3)) as att;
create temp table _attid3 as select (att->>'attempt_id')::uuid as attempt_id from _att3;
do $$
declare v_attempt uuid; v_caught boolean := false; v_msg text;
begin
  select attempt_id into v_attempt from _attid3;
  begin
    perform public.finalize_homework_attempt(v_attempt, null,
      jsonb_build_array(jsonb_build_object('storage_path', 'someone-elses-uid/other-attempt/file.pdf', 'file_name', 'file.pdf')));
  exception when others then get stacked diagnostics v_msg = message_text; v_caught := (v_msg like 'INVALID_STORAGE_PATH%');
  end;
  insert into _results values ('forged storage_path prefix rejected', v_caught, null);
end $$;

-- 7) closed assignment blocks new attempts even under max_attempts / due_at
select set_config('request.jwt.claim.sub', :'teacher_profile', true);
update public.homework_assignments set status = 'closed' where id = (select assignment_id from _aid3);
select set_config('request.jwt.claim.sub', :'student_profile', true);
do $$
declare v_aid uuid; v_caught boolean := false; v_msg text;
begin
  select assignment_id into v_aid from _aid3;
  begin
    perform public.start_homework_attempt(v_aid);
  exception when others then get stacked diagnostics v_msg = message_text; v_caught := (v_msg like 'ASSIGNMENT_NOT_OPEN%');
  end;
  insert into _results values ('closed assignment blocks new attempts', v_caught, null);
end $$;

-- ── summary ──
select check_name, passed from _results order by check_name;
select bool_and(passed) as all_passed from _results;

rollback;
