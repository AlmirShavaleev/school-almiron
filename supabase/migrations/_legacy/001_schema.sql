-- ============================================================
-- ALMIRON SCHOOL — Full Schema Migration
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

create type user_role as enum ('student', 'parent', 'teacher', 'curator', 'admin', 'owner');
create type homework_status as enum ('not_submitted', 'submitted', 'checked', 'revision');
create type lesson_status as enum ('scheduled', 'completed', 'cancelled');
create type payment_status as enum ('pending', 'paid', 'overdue', 'refunded');
create type league_type as enum ('bronze', 'silver', 'gold', 'platinum', 'academic');
create type subject_type as enum ('physics', 'math');
create type exam_type as enum ('ege', 'oge');

-- ============================================================
-- PROFILES (linked to auth.users)
-- ============================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  phone text,
  avatar_url text,
  role user_role not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- STUDENTS
-- ============================================================

create table students (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  grade integer not null default 11,
  target_exam exam_type not null default 'ege',
  target_subject subject_type not null default 'physics',
  target_score integer default 80,
  xp_points integer not null default 0,
  league league_type not null default 'bronze',
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- PARENTS
-- ============================================================

create table parents (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table parent_students (
  id uuid primary key default uuid_generate_v4(),
  parent_id uuid not null references parents(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  unique(parent_id, student_id)
);

-- ============================================================
-- TEACHERS
-- ============================================================

create table teachers (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  subjects subject_type[] not null default '{}',
  bio text,
  hourly_rate numeric(10,2),
  rating numeric(3,2) default 5.0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- CURATORS
-- ============================================================

create table curators (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ============================================================
-- COURSES & STRUCTURE
-- ============================================================

create table courses (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  subject subject_type not null,
  exam_type exam_type not null,
  description text,
  price numeric(10,2) not null default 0,
  duration_weeks integer default 36,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table modules (
  id uuid primary key default uuid_generate_v4(),
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

create table topics (
  id uuid primary key default uuid_generate_v4(),
  module_id uuid not null references modules(id) on delete cascade,
  title text not null,
  order_index integer not null default 0,
  max_score integer not null default 100,
  created_at timestamptz not null default now()
);

-- ============================================================
-- GROUPS
-- ============================================================

create table groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  course_id uuid references courses(id) on delete set null,
  teacher_id uuid references teachers(id) on delete set null,
  curator_id uuid references curators(id) on delete set null,
  max_students integer not null default 15,
  schedule_days text[], -- e.g. ['monday', 'wednesday']
  schedule_time time,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table group_students (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique(group_id, student_id)
);

-- ============================================================
-- LESSONS
-- ============================================================

create table lessons (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  topic_id uuid references topics(id) on delete set null,
  teacher_id uuid not null references teachers(id) on delete cascade,
  title text not null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 90,
  status lesson_status not null default 'scheduled',
  zoom_link text,
  recording_url text,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ATTENDANCE
-- ============================================================

create table attendance (
  id uuid primary key default uuid_generate_v4(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  present boolean not null default false,
  late boolean not null default false,
  excuse text,
  marked_at timestamptz,
  unique(lesson_id, student_id)
);

-- ============================================================
-- HOMEWORKS
-- ============================================================

create table homeworks (
  id uuid primary key default uuid_generate_v4(),
  lesson_id uuid references lessons(id) on delete set null,
  group_id uuid not null references groups(id) on delete cascade,
  topic_id uuid references topics(id) on delete set null,
  title text not null,
  description text,
  due_date timestamptz not null,
  max_score integer not null default 100,
  created_by uuid not null references teachers(id),
  created_at timestamptz not null default now()
);

create table homework_submissions (
  id uuid primary key default uuid_generate_v4(),
  homework_id uuid not null references homeworks(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  status homework_status not null default 'not_submitted',
  answer_text text,
  file_url text,
  score integer,
  feedback text,
  submitted_at timestamptz,
  checked_at timestamptz,
  checked_by uuid references teachers(id),
  unique(homework_id, student_id)
);

-- ============================================================
-- MOCK EXAMS
-- ============================================================

create table mock_exams (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  subject subject_type not null,
  exam_type exam_type not null,
  group_id uuid references groups(id) on delete set null,
  date timestamptz not null,
  max_score integer not null default 100,
  created_by uuid references teachers(id),
  created_at timestamptz not null default now()
);

create table mock_exam_results (
  id uuid primary key default uuid_generate_v4(),
  mock_exam_id uuid not null references mock_exams(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  score integer not null,
  part1_score integer,
  part2_score integer,
  notes text,
  created_at timestamptz not null default now(),
  unique(mock_exam_id, student_id)
);

-- ============================================================
-- ACHIEVEMENTS
-- ============================================================

create table achievements (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  icon text not null default '🏆',
  xp_reward integer not null default 0,
  condition_type text not null, -- 'attendance', 'homework', 'score', 'streak', 'exam'
  condition_value integer not null default 0,
  created_at timestamptz not null default now()
);

create table student_achievements (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  achievement_id uuid not null references achievements(id) on delete cascade,
  earned_at timestamptz not null default now(),
  unique(student_id, achievement_id)
);

-- ============================================================
-- PAYMENTS
-- ============================================================

create table payments (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  amount numeric(10,2) not null,
  status payment_status not null default 'pending',
  description text,
  due_date date not null,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- LEADERBOARD POINTS (log)
-- ============================================================

create table leaderboard_points (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  points integer not null,
  reason text not null, -- 'homework', 'attendance', 'exam', 'achievement'
  reference_id uuid, -- foreign key to relevant entity
  created_at timestamptz not null default now()
);

-- ============================================================
-- RECOMMENDATIONS
-- ============================================================

create table recommendations (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references students(id) on delete cascade,
  topic_id uuid references topics(id) on delete set null,
  text text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'info', -- 'info', 'warning', 'success', 'error'
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- WEBHOOK LOGS (for automation tracking)
-- ============================================================

create table webhook_logs (
  id uuid primary key default uuid_generate_v4(),
  event_type text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending', -- 'pending', 'sent', 'failed'
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_profiles_role on profiles(role);
create index idx_students_profile on students(profile_id);
create index idx_group_students_group on group_students(group_id);
create index idx_group_students_student on group_students(student_id);
create index idx_lessons_group on lessons(group_id);
create index idx_lessons_scheduled on lessons(scheduled_at);
create index idx_attendance_lesson on attendance(lesson_id);
create index idx_attendance_student on attendance(student_id);
create index idx_homeworks_group on homeworks(group_id);
create index idx_hw_submissions_student on homework_submissions(student_id);
create index idx_hw_submissions_homework on homework_submissions(homework_id);
create index idx_payments_student on payments(student_id);
create index idx_notifications_user on notifications(user_id);
create index idx_leaderboard_student on leaderboard_points(student_id);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at();
