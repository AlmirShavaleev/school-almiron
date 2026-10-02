-- §254. Слепок схемы для проб главной ученика — ТОЛЬКО то, что читают функции
-- PENDING_254.sql. Таблицы и колонки — подмножество настоящих (по миграциям
-- 20260804134923_app_visits_and_admin_school_stats + 20260909213307 (visited_at),
-- 20260726073913_topic_homework, 20260917194018_topic_homework_review_tasks,
-- 20260922081120 (unsolved), 20260726130727_topic_tests, 20260925201156 и
-- 20260926051556 (mock_exams.starts_at), 20260912201800 (closed_by), каталог —
-- по src/types/database.ts). app_visits — как на проде: RLS без политик, права
-- отозваны у anon/authenticated. topic_open_now и topic_done_events — ДОСЛОВНО
-- (последние редакции: 20260803085614_topic_open_toggle.sql,
-- 20260927153810_trenirovka_training_track.sql).
--
-- Права по умолчанию — как у Supabase: всё новое в public исполнимо anon и
-- authenticated. Поэтому revoke в PENDING_254 обязан сработать по-настоящему,
-- иначе проба «внутренняя функция закрыта» покажет дыру.
create extension if not exists "uuid-ossp";
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon;
alter default privileges in schema public grant execute on functions to anon, authenticated;
alter default privileges in schema public grant select on tables to anon, authenticated;

create type user_role as enum ('student', 'parent', 'teacher', 'curator', 'admin', 'owner');
create type public.topic_homework_attempt_status as enum ('draft', 'submitted', 'accepted', 'returned_for_revision');
create type public.topic_homework_review_decision as enum ('accepted', 'returned_for_revision');
create type public.topic_test_attempt_status as enum ('in_progress', 'completed');

create table public.profiles (id uuid primary key, full_name text, role user_role not null default 'student');
create table public.students (id uuid primary key default uuid_generate_v4(), profile_id uuid references public.profiles(id));
create table public.courses (id uuid primary key default uuid_generate_v4(), title text);
create table public.modules (id uuid primary key default uuid_generate_v4(), course_id uuid references public.courses(id), title text);
create table public.topics (
  id uuid primary key default uuid_generate_v4(), module_id uuid references public.modules(id), title text,
  is_open boolean, available_from date
);
create table public.groups (id uuid primary key default uuid_generate_v4(), name text, course_id uuid references public.courses(id));
create table public.group_students (group_id uuid references public.groups(id), student_id uuid references public.students(id), primary key (group_id, student_id));

create table public.app_visits (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  visited_on date not null,
  visited_at timestamptz,
  primary key (profile_id, visited_on)
);
alter table public.app_visits enable row level security;
revoke all on table public.app_visits from anon, authenticated;

create table public.topic_homework (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null unique references public.topics(id) on delete cascade,
  title text not null default 'ДЗ', is_published boolean not null default true, due_at date,
  grade_scale text check (grade_scale in ('five', 'hundred'))
);
create table public.topic_homework_attempts (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.topic_homework(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  attempt_number integer not null default 1,
  status public.topic_homework_attempt_status not null default 'draft',
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.topic_homework_reviews (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.topic_homework_attempts(id) on delete cascade,
  decision public.topic_homework_review_decision not null,
  score integer, created_at timestamptz not null default now()
);
create table public.topic_homework_review_tasks (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.topic_homework_attempts(id) on delete cascade,
  no text not null check (length(btrim(no)) between 1 and 16),
  verdict text not null default 'unchecked'
    check (verdict in ('correct', 'wrong', 'partial', 'unchecked', 'unsolved')),
  constraint topic_homework_review_tasks_attempt_no_key unique (attempt_id, no)
);
alter table public.topic_homework enable row level security;
alter table public.topic_homework_attempts enable row level security;
alter table public.topic_homework_reviews enable row level security;
alter table public.topic_homework_review_tasks enable row level security;

create table public.catalog_task_progress (
  user_id uuid not null references public.profiles(id), task_id uuid not null,
  is_completed boolean not null default false, completed_at timestamptz, updated_at timestamptz,
  primary key (user_id, task_id)
);
alter table public.catalog_task_progress enable row level security;

create table public.test_variants (id uuid primary key default gen_random_uuid(), topic_id uuid references public.topics(id));
create table public.test_variant_items (id uuid primary key default gen_random_uuid(), variant_id uuid references public.test_variants(id), task_id uuid not null);
create table public.test_variant_assignments (id uuid primary key default gen_random_uuid(), variant_id uuid references public.test_variants(id), topic_id uuid references public.topics(id));
create table public.test_variant_student_assignments (
  id uuid primary key default gen_random_uuid(), assignment_id uuid references public.test_variant_assignments(id),
  student_id uuid references public.students(id), submitted_at timestamptz
);
create table public.test_variant_answers (
  id uuid primary key default gen_random_uuid(),
  student_assignment_id uuid not null references public.test_variant_student_assignments(id),
  variant_item_id uuid not null references public.test_variant_items(id),
  is_correct boolean, closed_by text,
  submitted_at timestamptz, graded_at timestamptz,
  last_changed_at timestamptz not null default now(), created_at timestamptz not null default now()
);
alter table public.test_variant_answers enable row level security;

create table public.mock_exams (id uuid primary key default gen_random_uuid(), title text, date timestamptz not null, starts_at timestamptz);
create table public.mock_exam_task_scores (
  id uuid primary key default gen_random_uuid(),
  mock_exam_id uuid not null references public.mock_exams(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  task_number smallint not null check (task_number >= 1),
  points smallint not null check (points >= 0),
  constraint mock_exam_task_scores_unique unique (mock_exam_id, student_id, task_number)
);
alter table public.mock_exam_task_scores enable row level security;

create table public.topic_tests (id uuid primary key default gen_random_uuid(), title text);
create table public.topic_test_items (id uuid primary key default gen_random_uuid(), test_id uuid references public.topic_tests(id));
create table public.topic_test_attempts (
  id uuid primary key default gen_random_uuid(), test_id uuid not null references public.topic_tests(id),
  student_id uuid not null references public.students(id),
  status public.topic_test_attempt_status not null default 'in_progress', completed_at timestamptz
);
create table public.topic_test_answers (
  id uuid primary key default gen_random_uuid(), attempt_id uuid not null references public.topic_test_attempts(id),
  item_id uuid not null references public.topic_test_items(id), awarded_points integer, is_correct boolean
);
alter table public.topic_test_answers enable row level security;

create table public.topic_material_items (
  id uuid primary key default gen_random_uuid(), topic_id uuid references public.topics(id),
  kind text not null default 'file', section text, track text not null default 'ege'
);
create table public.topic_section_marks (
  student_id uuid references public.students(id), topic_id uuid references public.topics(id),
  group_key text not null, marked_at timestamptz not null default now(),
  primary key (student_id, topic_id, group_key)
);
alter table public.topic_section_marks enable row level security;

-- Дословно: 20260803085614_topic_open_toggle.sql
create or replace function public.topic_open_now(p_is_open boolean, p_available_from date)
returns boolean
language sql
stable
as $function$
  select coalesce(p_is_open, p_available_from is null or p_available_from <= current_date);
$function$;

-- Дословно: 20260927153810_trenirovka_training_track.sql (последняя редакция topic_done_events)
CREATE OR REPLACE FUNCTION public.topic_done_events()
 RETURNS TABLE(student_id uuid, topic_id uuid, done_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with task_totals as (
    select v.topic_id, count(tvi.id) as n
      from public.test_variants v
      join public.test_variant_items tvi on tvi.variant_id = v.id
     where v.topic_id is not null
     group by v.topic_id
  ),
  tg as (
    select t.id as topic_id,
      exists (
        select 1 from public.topic_material_items mi
         where mi.topic_id = t.id
           and (mi.kind = 'video' or mi.section in ('notes', 'theory'))
           and mi.track = 'ege'
      ) as has_theory,
      exists (
        select 1 from public.topic_material_items mi
         where mi.topic_id = t.id
           and mi.section in ('tasks', 'task_solution', 'worksheet_tasks')
           and mi.track = 'ege'
      ) as has_lesson,
      (
        exists (select 1 from public.topic_homework h where h.topic_id = t.id)
        or exists (
          select 1 from public.topic_material_items mi
           where mi.topic_id = t.id
             and mi.section in ('worksheet_homework', 'solution')
             and mi.track = 'ege'
        )
      ) as has_homework,
      coalesce((select tt.n from task_totals tt where tt.topic_id = t.id), 0) > 0 as has_tasks,
      coalesce((select tt.n from task_totals tt where tt.topic_id = t.id), 0) as tasks_total
    from public.topics t
  ),
  -- Кандидаты — те, кто хоть что-то сделал по теме. Принятой работой тоже:
  -- тема, у которой есть только группа ДЗ, отметок не имеет вовсе, и по одним
  -- отметкам такая пара потерялась бы. Задачи к уроку — тот же случай.
  cand as (
    select m.student_id, m.topic_id from public.topic_section_marks m
    union
    select a.student_id, h.topic_id
      from public.topic_homework_attempts a
      join public.topic_homework h on h.id = a.homework_id
     where a.status = 'accepted'
    union
    select tvsa.student_id, tva.topic_id
      from public.test_variant_answers ans
      join public.test_variant_student_assignments tvsa on tvsa.id = ans.student_assignment_id
      join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
     where tva.topic_id is not null
  ),
  ev as (
    select c.student_id, c.topic_id,
           tg.has_theory, tg.has_lesson, tg.has_homework, tg.has_tasks, tg.tasks_total,
           (select max(m.marked_at) from public.topic_section_marks m
             where m.student_id = c.student_id and m.topic_id = c.topic_id
               and m.group_key = 'theory') as theory_at,
           (select max(m.marked_at) from public.topic_section_marks m
             where m.student_id = c.student_id and m.topic_id = c.topic_id
               and m.group_key = 'lesson') as lesson_at,
           (select max(r.created_at) from public.topic_homework_reviews r
              join public.topic_homework_attempts a on a.id = r.attempt_id
              join public.topic_homework h on h.id = a.homework_id
             where a.student_id = c.student_id and h.topic_id = c.topic_id
               and a.status = 'accepted' and r.decision = 'accepted') as hw_at,
           -- Момент закрытия ПОСЛЕДНЕЙ задачи, и только если закрыты все.
           (select case
                     when count(*) filter (where ans.closed_by is not null) >= tg.tasks_total
                          and tg.tasks_total > 0
                     then max(ans.last_changed_at) filter (where ans.closed_by is not null)
                   end
              from public.test_variant_answers ans
              join public.test_variant_student_assignments tvsa on tvsa.id = ans.student_assignment_id
              join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
             where tva.topic_id = c.topic_id
               and tvsa.student_id = c.student_id) as tasks_at
      from cand c
      join tg on tg.topic_id = c.topic_id
  )
  select ev.student_id, ev.topic_id,
         -- День, когда тема стала пройденной, — момент ПОСЛЕДНЕГО из нужных
         -- событий. Ненужные группы обнуляются явно: случайная отметка по
         -- группе, которой у темы нет, не должна двигать дату вперёд.
         greatest(
           case when ev.has_theory   then ev.theory_at end,
           case when ev.has_lesson   then ev.lesson_at end,
           case when ev.has_homework then ev.hw_at     end,
           case when ev.has_tasks    then ev.tasks_at  end
         ) as done_at
    from ev
   where (ev.has_theory or ev.has_lesson or ev.has_homework or ev.has_tasks)
     and (not ev.has_theory   or ev.theory_at is not null)
     and (not ev.has_lesson   or ev.lesson_at is not null)
     and (not ev.has_homework or ev.hw_at     is not null)
     and (not ev.has_tasks    or ev.tasks_at  is not null);
$function$;
