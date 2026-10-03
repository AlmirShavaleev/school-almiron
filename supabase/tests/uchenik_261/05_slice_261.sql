-- §261. Добавка к слепкам §254 (../glavnaya_254/00_slice_254.sql), §255 (../prognoz_255/05_slice_255.sql),
-- §256 (../katalog_prognoz_256/05_slice_256.sql) и §257 (../dostizheniya_257/05_slice_257.sql).
-- СТРОГО по миграциям репозитория (урок §255). Ниже — КАЖДАЯ колонка, которую читают PENDING_261.sql и
-- применённая миграция отчёта §217 (20260925184917, её прогоняем как есть перед PENDING_261), и где она есть.
--
--  таблица.колонка                                   │ где в миграциях репозитория                                │ в слепке
--  ──────────────────────────────────────────────────┼────────────────────────────────────────────────────────────┼─────────
--  topics.kind ('lesson' | 'check' | 'control')       │ 20260928122420_kontrolnaya_timed_work (add column kind +   │ здесь
--                                                     │   check topics_kind_check)                                 │
--  topic_homework.opens_at, closes_at                 │ 20260928122420 (add column opens_at/closes_at + check)     │ здесь
--  topic_homework.is_published                        │ 20260726073913_topic_homework                              │ §254
--  topic_homework.due_at, grade_scale                 │ 20260726203833_topic_homework_deadline_grades_notify       │ §254
--  topic_homework.title                               │ 20260726073913                                             │ §254
--  topics.is_open, available_from, title, module_id   │ 20260803085614_topic_open_toggle (topic_open_now)          │ §254
--  topic_homework_attempts.id, homework_id,           │ 20260726073913; 20261001074629_course_assessment_grades    │ §254
--     student_id, status, attempt_number,             │   (last_att: attempt_number, status, submitted_at)         │
--     submitted_at, created_at                        │                                                            │
--  topic_homework_reviews.id, attempt_id, decision,   │ 20260726073913; 20261001074629 (last_review: rv.id,        │ §254
--     score, created_at                               │   rv.decision, rv.score, rv.created_at)                    │
--  topic_homework_review_tasks.points, max_points     │ 20261003075220_ai_points_by_criteria (add column points /  │ здесь
--                                                     │   max_points + check points_le_max)                        │
--  topic_homework_review_tasks.attempt_id, verdict    │ 20260917194018 / 20260922081120                            │ §254
--  students.grade                                     │ _legacy/001_schema (students.grade integer not null        │ здесь
--                                                     │   default 11); читает 20260925184917                       │
--  student_feedback_notes                             │ 20260809114602_student_feedback_notes (create table)       │ здесь
--  video_watch_daily (student_id, day, seconds)       │ 20260917230035_video_watch_daily (create table)            │ здесь
--  material_views (profile_id, viewed_on)             │ 20260808220907_school_analytics_material_views_and_rpcs    │ здесь
--  mock_exam_results (mock_exam_id, student_id,       │ _legacy/001_schema (create table mock_exam_results);       │ здесь
--     score, part1_score, part2_score)                │   читает 20260925184917                                    │
--  student_report_next_steps                          │ 20260925184917 — создаёт сама миграция                     │ миграция
--  student_achievements, achievement_rules()          │ 20261002194006                                             │ миграция
--  student_daily_tasks, student_weekly_goals,         │ 20261002174213                                             │ миграция
--     catalog_task_attempts                           │                                                            │
--  student_exam_goals                                 │ 20261002152136                                             │ миграция
--  courses.title, groups.name, mock_exams.title/date  │ слепок §254 (читают 20260925184917, 20261001074629)        │ §254
--
-- Функции, которые зовут новые: student_exam_evidence_rows, student_kim_zone_shares, catalog_counted_solutions,
-- student_solve_days, student_solve_streak (20261002174335), catalog_reward_rules (20261002174213),
-- student_catalog_week_for_staff (20261002174501), student_achievements_for_staff (20261002194103),
-- topic_open_now (слепок §254, дословно), is_admin_or_owner / auth_is_staff_of_student (слепок §255).

-- 20260928122420_kontrolnaya_timed_work.sql
alter table public.topics add column if not exists kind text not null default 'lesson';
alter table public.topics drop constraint if exists topics_kind_check;
alter table public.topics add constraint topics_kind_check
  check (kind = any (array['lesson', 'check', 'control']::text[]));
alter table public.topic_homework
  add column if not exists opens_at timestamptz,
  add column if not exists closes_at timestamptz;
alter table public.topic_homework
  add constraint topic_homework_window_check
  check ((opens_at is null) = (closes_at is null) and (closes_at is null or closes_at > opens_at));

-- 20261003075220_ai_points_by_criteria.sql
alter table public.topic_homework_review_tasks
  add column if not exists points numeric
    check (points is null or points >= 0),
  add column if not exists max_points numeric
    check (max_points is null or max_points > 0);
alter table public.topic_homework_review_tasks
  add constraint topic_homework_review_tasks_points_le_max
  check (points is null or (max_points is not null and points <= max_points));

-- _legacy/001_schema.sql
alter table public.students add column grade integer not null default 11;
create table public.mock_exam_results (
  id uuid primary key default uuid_generate_v4(),
  mock_exam_id uuid not null references public.mock_exams(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  score integer not null,
  part1_score integer,
  part2_score integer,
  notes text,
  created_at timestamptz not null default now(),
  unique (mock_exam_id, student_id)
);

-- 20260809114602_student_feedback_notes.sql
create table if not exists public.student_feedback_notes (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  kind        text not null check (kind in ('ai_draft', 'saved')),
  body        text not null check (length(btrim(body)) > 0),
  model       text,
  created_at  timestamptz not null default now()
);
alter table public.student_feedback_notes enable row level security;

-- 20260917230035_video_watch_daily.sql
create table if not exists public.video_watch_daily (
  student_id       uuid        not null references public.profiles(id) on delete cascade,
  item_id          uuid        not null references public.topic_material_items(id) on delete cascade,
  day              date        not null,
  seconds          integer     not null default 0,
  max_position     integer     not null default 0,
  duration_seconds integer,
  updated_at       timestamptz not null default now(),
  primary key (student_id, item_id, day)
);
alter table public.video_watch_daily enable row level security;

-- 20260808220907_school_analytics_material_views_and_rpcs.sql
create table if not exists public.material_views (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id    uuid not null references public.topic_material_items(id) on delete cascade,
  topic_id   uuid not null references public.topics(id) on delete cascade,
  viewed_on  date not null,
  primary key (profile_id, item_id, viewed_on)
);
alter table public.material_views enable row level security;
