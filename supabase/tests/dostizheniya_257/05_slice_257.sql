-- §257. Добавка к слепкам §254 (../glavnaya_254/00_slice_254.sql), §255 (../prognoz_255/05_slice_255.sql) и
-- §256 (../katalog_prognoz_256/05_slice_256.sql). СТРОГО по миграциям репозитория (урок §255).
-- Ниже — КАЖДАЯ колонка и функция, которую читает или пишет PENDING_257.sql, и файл, где она есть.
--
--  таблица.колонка / функция                          │ где в миграциях репозитория                         │ в слепке
--  ───────────────────────────────────────────────────┼─────────────────────────────────────────────────────┼──────────
--  profiles.id (FK новых таблиц)                      │ _legacy (базовая), читают все миграции §254–§256     │ §254
--  students.id, profile_id                            │ 20261002153604 (my_subjects), 20261002174501         │ §254
--  group_students.group_id, student_id; groups.id,    │ 20261002174501 (student_daily_task: s→gs→g→c)        │ §254/§255
--     course_id; courses.id, subject, exam_type       │                                                      │
--  topic_homework.id, topic_id                       │ 20260726073913_topic_homework                        │ §254
--  topic_homework.due_at, grade_scale                 │ 20260726203833_topic_homework_deadline_grades_notify │ §254
--                                                     │   (add column due_at date, grade_scale text)         │
--  topic_homework_attempts.id, homework_id,           │ 20260726073913; 20261002174501 (first_sub)           │ §254
--     student_id, submitted_at                        │                                                      │
--  topic_homework_reviews.attempt_id, decision,       │ 20260726073913; 20261002174501 (last_accept)         │ §254
--     score, created_at                               │                                                      │
--  topic_test_attempts.id, student_id, status,        │ 20260726130727_topic_tests (create table)            │ §254
--     completed_at                                    │                                                      │
--  mock_exam_task_scores.mock_exam_id, student_id,    │ 20260925201156_mock_exam_templates_and_task_scores   │ §254
--     points                                          │                                                      │
--  mock_exams.id, starts_at, date                     │ 20260926051556 (starts_at); 20261002174501 (mock)    │ §254
--  mock_exams.exam_type, template_id                  │ 20260925201156 (template_id); exam_type — базовая    │ §255
--                                                     │   таблица, читают 20260925184917 и 20261002153604    │
--                                                     │   (mock_rows: me.exam_type), src/types/database.ts   │
--  mock_exam_templates.id, score_scale                │ 20260925201156 (create table … score_scale)          │ §255
--  catalog_task_attempts.id, profile_id, task_id,     │ 20261002174213_catalog_practice_rules_and_tables     │ миграция
--     verdict, revealed_before, created_at            │                                                      │
--  student_daily_tasks, student_weekly_goals          │ 20261002174213                                        │ миграция
--  student_exam_goals.profile_id, subject, goal       │ 20261002152136_student_exam_goals                    │ миграция
--  catalog_counted_solutions, student_solve_days,     │ 20261002174335_catalog_practice_evidence_check_reveal│ миграция
--     student_kim_zone_shares, student_exam_evidence_rows                                                  │
--  catalog_reward_rules, catalog_zone_points,         │ 20261002174213                                        │ миграция
--     catalog_zone_milestone                          │                                                      │
--  topic_done_events()                                │ 20260927153810_trenirovka_training_track (дословно)  │ §254
--  is_admin_or_owner, auth_is_staff_of_student        │ _legacy/002_rls, 20260730213917                      │ §255
--  mock_exam_test_score(integer, smallint[])          │ 20260925201156 — ДОСЛОВНО ниже                       │ здесь
--
-- Новых колонок у существующих таблиц PENDING_257 не требует; недоставало только mock_exam_test_score.

-- Дословно: 20260925201156_mock_exam_templates_and_task_scores.sql
create or replace function public.mock_exam_test_score(p_primary integer, p_scale smallint[])
returns integer
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_primary is null then null
    when p_scale is null or coalesce(array_length(p_scale, 1), 0) = 0 then p_primary
    else p_scale[p_primary + 1]
  end;
$$;
