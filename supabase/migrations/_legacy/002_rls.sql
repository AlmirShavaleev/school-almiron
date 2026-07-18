-- ============================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================

-- Enable RLS on all tables
alter table profiles enable row level security;
alter table students enable row level security;
alter table parents enable row level security;
alter table parent_students enable row level security;
alter table teachers enable row level security;
alter table curators enable row level security;
alter table courses enable row level security;
alter table modules enable row level security;
alter table topics enable row level security;
alter table groups enable row level security;
alter table group_students enable row level security;
alter table lessons enable row level security;
alter table attendance enable row level security;
alter table homeworks enable row level security;
alter table homework_submissions enable row level security;
alter table mock_exams enable row level security;
alter table mock_exam_results enable row level security;
alter table achievements enable row level security;
alter table student_achievements enable row level security;
alter table payments enable row level security;
alter table leaderboard_points enable row level security;
alter table recommendations enable row level security;
alter table notifications enable row level security;
alter table webhook_logs enable row level security;

-- Helper function: get current user role
create or replace function get_my_role()
returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable;

-- Helper: check if admin or owner
create or replace function is_admin_or_owner()
returns boolean as $$
  select get_my_role() in ('admin', 'owner');
$$ language sql security definer stable;

-- ============================================================
-- PROFILES
-- ============================================================

-- Everyone can read their own profile
create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());

-- Admin/owner can read all profiles
create policy "profiles_select_admin" on profiles
  for select using (is_admin_or_owner());

-- Teacher/curator can read profiles
create policy "profiles_select_teacher" on profiles
  for select using (get_my_role() in ('teacher', 'curator'));

-- Users can update own profile
create policy "profiles_update_own" on profiles
  for update using (id = auth.uid());

-- Admin can update any profile
create policy "profiles_update_admin" on profiles
  for update using (is_admin_or_owner());

-- Admin can insert profiles
create policy "profiles_insert_admin" on profiles
  for insert with check (is_admin_or_owner() or id = auth.uid());

-- ============================================================
-- STUDENTS
-- ============================================================

create policy "students_select_own" on students
  for select using (profile_id = auth.uid());

create policy "students_select_admin" on students
  for select using (is_admin_or_owner() or get_my_role() in ('teacher', 'curator'));

-- Parent can see their children's student records
create policy "students_select_parent" on students
  for select using (
    get_my_role() = 'parent' and exists (
      select 1 from parent_students ps
      join parents p on p.id = ps.parent_id
      where p.profile_id = auth.uid() and ps.student_id = students.id
    )
  );

create policy "students_insert_admin" on students
  for insert with check (is_admin_or_owner());

create policy "students_update_admin" on students
  for update using (is_admin_or_owner() or get_my_role() = 'teacher');

-- ============================================================
-- PARENTS
-- ============================================================

create policy "parents_select_own" on parents
  for select using (profile_id = auth.uid());

create policy "parents_select_admin" on parents
  for select using (is_admin_or_owner());

create policy "parent_students_select" on parent_students
  for select using (
    is_admin_or_owner() or
    exists (select 1 from parents p where p.id = parent_students.parent_id and p.profile_id = auth.uid())
  );

-- ============================================================
-- TEACHERS
-- ============================================================

create policy "teachers_select_all" on teachers
  for select using (true); -- teachers are visible to everyone

create policy "teachers_update_own" on teachers
  for update using (profile_id = auth.uid());

create policy "teachers_manage_admin" on teachers
  for all using (is_admin_or_owner());

-- ============================================================
-- CURATORS
-- ============================================================

create policy "curators_select_all" on curators
  for select using (is_admin_or_owner() or profile_id = auth.uid());

-- ============================================================
-- COURSES, MODULES, TOPICS (read-only for most)
-- ============================================================

create policy "courses_select_all" on courses
  for select using (true);

create policy "courses_manage_admin" on courses
  for all using (is_admin_or_owner());

create policy "modules_select_all" on modules
  for select using (true);

create policy "modules_manage_admin" on modules
  for all using (is_admin_or_owner());

create policy "topics_select_all" on topics
  for select using (true);

create policy "topics_manage_admin" on topics
  for all using (is_admin_or_owner());

-- ============================================================
-- GROUPS
-- ============================================================

create policy "groups_select_all" on groups
  for select using (
    is_admin_or_owner() or
    get_my_role() in ('teacher', 'curator') or
    -- student is in group
    exists (
      select 1 from group_students gs
      join students s on s.id = gs.student_id
      where gs.group_id = groups.id and s.profile_id = auth.uid()
    ) or
    -- parent's child is in group
    exists (
      select 1 from group_students gs
      join parent_students ps on ps.student_id = gs.student_id
      join parents par on par.id = ps.parent_id
      where gs.group_id = groups.id and par.profile_id = auth.uid()
    )
  );

create policy "groups_manage_admin" on groups
  for all using (is_admin_or_owner());

create policy "group_students_select" on group_students
  for select using (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator') or
    exists (select 1 from students s where s.id = group_students.student_id and s.profile_id = auth.uid()) or
    exists (
      select 1 from parent_students ps join parents p on p.id = ps.parent_id
      where ps.student_id = group_students.student_id and p.profile_id = auth.uid()
    )
  );

create policy "group_students_manage_admin" on group_students
  for all using (is_admin_or_owner());

-- ============================================================
-- LESSONS
-- ============================================================

create policy "lessons_select" on lessons
  for select using (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator') or
    exists (
      select 1 from group_students gs join students s on s.id = gs.student_id
      where gs.group_id = lessons.group_id and s.profile_id = auth.uid()
    ) or
    exists (
      select 1 from group_students gs join parent_students ps on ps.student_id = gs.student_id
      join parents p on p.id = ps.parent_id
      where gs.group_id = lessons.group_id and p.profile_id = auth.uid()
    )
  );

create policy "lessons_manage_teacher" on lessons
  for all using (
    is_admin_or_owner() or
    exists (select 1 from teachers t where t.id = lessons.teacher_id and t.profile_id = auth.uid())
  );

-- ============================================================
-- ATTENDANCE
-- ============================================================

create policy "attendance_select" on attendance
  for select using (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator') or
    exists (select 1 from students s where s.id = attendance.student_id and s.profile_id = auth.uid()) or
    exists (
      select 1 from parent_students ps join parents p on p.id = ps.parent_id
      where ps.student_id = attendance.student_id and p.profile_id = auth.uid()
    )
  );

create policy "attendance_manage_teacher" on attendance
  for all using (
    is_admin_or_owner() or
    exists (
      select 1 from lessons l join teachers t on t.id = l.teacher_id
      where l.id = attendance.lesson_id and t.profile_id = auth.uid()
    )
  );

-- ============================================================
-- HOMEWORKS
-- ============================================================

create policy "homeworks_select" on homeworks
  for select using (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator') or
    exists (
      select 1 from group_students gs join students s on s.id = gs.student_id
      where gs.group_id = homeworks.group_id and s.profile_id = auth.uid()
    ) or
    exists (
      select 1 from group_students gs join parent_students ps on ps.student_id = gs.student_id
      join parents p on p.id = ps.parent_id
      where gs.group_id = homeworks.group_id and p.profile_id = auth.uid()
    )
  );

create policy "homeworks_manage_teacher" on homeworks
  for all using (
    is_admin_or_owner() or
    exists (select 1 from teachers t where t.id = homeworks.created_by and t.profile_id = auth.uid())
  );

-- ============================================================
-- HOMEWORK SUBMISSIONS
-- ============================================================

create policy "hw_submissions_select" on homework_submissions
  for select using (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator') or
    exists (select 1 from students s where s.id = homework_submissions.student_id and s.profile_id = auth.uid()) or
    exists (
      select 1 from parent_students ps join parents p on p.id = ps.parent_id
      where ps.student_id = homework_submissions.student_id and p.profile_id = auth.uid()
    )
  );

create policy "hw_submissions_student_insert" on homework_submissions
  for insert with check (
    exists (select 1 from students s where s.id = homework_submissions.student_id and s.profile_id = auth.uid())
  );

create policy "hw_submissions_teacher_update" on homework_submissions
  for update using (is_admin_or_owner() or get_my_role() = 'teacher');

-- ============================================================
-- MOCK EXAMS
-- ============================================================

create policy "mock_exams_select" on mock_exams
  for select using (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator') or
    exists (
      select 1 from group_students gs join students s on s.id = gs.student_id
      where gs.group_id = mock_exams.group_id and s.profile_id = auth.uid()
    )
  );

create policy "mock_exams_manage" on mock_exams
  for all using (is_admin_or_owner() or get_my_role() = 'teacher');

create policy "mock_exam_results_select" on mock_exam_results
  for select using (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator') or
    exists (select 1 from students s where s.id = mock_exam_results.student_id and s.profile_id = auth.uid()) or
    exists (
      select 1 from parent_students ps join parents p on p.id = ps.parent_id
      where ps.student_id = mock_exam_results.student_id and p.profile_id = auth.uid()
    )
  );

create policy "mock_exam_results_manage" on mock_exam_results
  for all using (is_admin_or_owner() or get_my_role() = 'teacher');

-- ============================================================
-- ACHIEVEMENTS
-- ============================================================

create policy "achievements_select_all" on achievements
  for select using (true);

create policy "achievements_manage_admin" on achievements
  for all using (is_admin_or_owner());

create policy "student_achievements_select" on student_achievements
  for select using (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator') or
    exists (select 1 from students s where s.id = student_achievements.student_id and s.profile_id = auth.uid()) or
    exists (
      select 1 from parent_students ps join parents p on p.id = ps.parent_id
      where ps.student_id = student_achievements.student_id and p.profile_id = auth.uid()
    )
  );

-- ============================================================
-- PAYMENTS
-- ============================================================

create policy "payments_select" on payments
  for select using (
    is_admin_or_owner() or
    exists (select 1 from students s where s.id = payments.student_id and s.profile_id = auth.uid()) or
    exists (
      select 1 from parent_students ps join parents p on p.id = ps.parent_id
      where ps.student_id = payments.student_id and p.profile_id = auth.uid()
    )
  );

create policy "payments_manage_admin" on payments
  for all using (is_admin_or_owner());

-- ============================================================
-- LEADERBOARD
-- ============================================================

create policy "leaderboard_select_all" on leaderboard_points
  for select using (true); -- leaderboard is public within the school

create policy "leaderboard_insert_system" on leaderboard_points
  for insert with check (is_admin_or_owner() or get_my_role() = 'teacher');

-- ============================================================
-- RECOMMENDATIONS
-- ============================================================

create policy "recommendations_select" on recommendations
  for select using (
    is_admin_or_owner() or get_my_role() in ('teacher', 'curator') or
    exists (select 1 from students s where s.id = recommendations.student_id and s.profile_id = auth.uid())
  );

create policy "recommendations_manage" on recommendations
  for all using (is_admin_or_owner() or get_my_role() in ('teacher', 'curator'));

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

create policy "notifications_select_own" on notifications
  for select using (user_id = auth.uid());

create policy "notifications_update_own" on notifications
  for update using (user_id = auth.uid());

create policy "notifications_insert_admin" on notifications
  for insert with check (is_admin_or_owner() or get_my_role() in ('teacher', 'curator'));

-- ============================================================
-- WEBHOOK LOGS
-- ============================================================

create policy "webhook_logs_admin" on webhook_logs
  for all using (is_admin_or_owner());
