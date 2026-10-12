-- §282. Заглушки прод-объектов, на которые опираются миграции подписки — только для прогона в PGlite (src/lib/__tests__/subscriptionSql.test.ts).
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create schema cron;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;

create type public.user_role as enum ('student','parent','teacher','curator','admin','owner');
create table public.profiles (id uuid primary key, email text, full_name text, role public.user_role not null default 'student');
create table public.students (id uuid primary key default gen_random_uuid(), profile_id uuid not null unique references public.profiles(id));
create table public.teachers (id uuid primary key default gen_random_uuid(), profile_id uuid references public.profiles(id));
create table public.courses (id uuid primary key default gen_random_uuid(), title text, is_template boolean not null default false, owner_id uuid);
create table public.groups (id uuid primary key default gen_random_uuid(), course_id uuid unique references public.courses(id), name text, teacher_id uuid, max_students int not null default 30, created_at timestamptz default now());
create table public.group_students (id uuid primary key default gen_random_uuid(), group_id uuid references public.groups(id), student_id uuid references public.students(id), unique (group_id, student_id));
create table public.student_courses (student_id uuid, course_id uuid, status text, expires_at timestamptz);
create table public.modules (id uuid primary key default gen_random_uuid(), course_id uuid);
create table public.topics (id uuid primary key default gen_random_uuid(), module_id uuid);
create table public.mock_exams (id uuid primary key default gen_random_uuid(), group_id uuid);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null, message text not null, type text not null default 'info', read boolean not null default false, created_at timestamptz not null default now(), link text, dedup_key text unique);

create function public.update_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create function public.get_my_role() returns public.user_role language sql stable security definer as $$ select role from public.profiles where id = auth.uid() $$;
create function public.is_admin_or_owner() returns boolean language sql stable security definer as $$ select coalesce(public.get_my_role() in ('admin','owner'), false) $$;
create function public.auth_student_id() returns uuid language sql stable security definer as $$ select id from public.students where profile_id = auth.uid() $$;
create function public.course_of_topic(p uuid) returns uuid language sql stable as $$ select m.course_id from public.topics t join public.modules m on m.id = t.module_id where t.id = p $$;

-- копии прод-триггеров group_students
create function public.check_group_capacity() returns trigger language plpgsql as $$
declare v_max int; v_count int;
begin
  select max_students into v_max from groups where id = new.group_id for update;
  select count(*) into v_count from group_students where group_id = new.group_id;
  if v_count >= v_max then raise exception 'GROUP_FULL'; end if;
  return new;
end $$;
create trigger enforce_group_capacity before insert on public.group_students for each row execute function public.check_group_capacity();
create function public.reject_enrollment_into_template() returns trigger language plpgsql as $$
begin
  if exists (select 1 from groups g join courses c on c.id = g.course_id where g.id = new.group_id and c.is_template) then
    raise exception 'COURSE_IS_TEMPLATE';
  end if;
  return new;
end $$;
create trigger group_students_reject_template before insert on public.group_students for each row execute function public.reject_enrollment_into_template();

-- прежние тела функций, которые миграция заменяет (чтобы create or replace шёл по существующим)
create function public.course_student_has_access(p_course_id uuid) returns boolean language sql stable as $$ select false $$;
create function public.mock_exam_my_student_id(p_mock_exam_id uuid) returns uuid language sql stable as $$ select null::uuid $$;
create function public._topic_autocheck_student_of(p_topic_id uuid, p_profile_id uuid) returns uuid language sql stable as $$ select null::uuid $$;
create function public.auth_is_student_of_topic(p_topic_id uuid) returns boolean language sql stable as $$ select false $$;

-- §282.2: объекты, на которые опираются §284 и наборы тем ученика. Тела функций — как на проде 10.10
-- (кроме course_is_staff, topic_is_timed, topic_homework_condition_open — упрощены: тут проверяется
-- доступ ученика, а не правила персонала и окна ДЗ).
alter table public.topics add column is_open boolean, add column available_from date;
create function public.topic_open_now(p_is_open boolean, p_available_from date) returns boolean language sql stable as $$
  select coalesce(p_is_open, p_available_from is null or p_available_from <= current_date) $$;
create function public.course_is_staff(p_course_id uuid) returns boolean language sql stable security definer as $$
  select p_course_id is not null and (public.is_admin_or_owner()
    or exists (select 1 from public.courses c where c.id = p_course_id and c.owner_id = auth.uid())) $$;
create function public.topic_material_can_manage(p_topic_id uuid) returns boolean language sql stable security definer as $$
  select public.course_is_staff(public.course_of_topic(p_topic_id)) $$;
create function public.course_student_can_see_topic(p_topic_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.topics t join public.modules m on m.id = t.module_id
                  where t.id = p_topic_id and public.topic_open_now(t.is_open, t.available_from)
                    and public.course_student_has_access(m.course_id)) $$;

create table public.topic_homework (id uuid primary key default gen_random_uuid(), topic_id uuid not null references public.topics(id), is_published boolean not null default true);
create table public.topic_homework_attempts (id uuid primary key default gen_random_uuid(), homework_id uuid references public.topic_homework(id), student_id uuid, status text);
create table public.topic_homework_files (id uuid primary key default gen_random_uuid(), homework_id uuid references public.topic_homework(id));
create function public.topic_is_timed(p_topic_id uuid) returns boolean language sql stable as $$ select false $$;
create function public.topic_homework_condition_open(p_homework_id uuid, p_student_id uuid) returns boolean language sql stable as $$ select true $$;
create function public.topic_solution_unlocked(p_topic_id uuid) returns boolean language sql stable security definer as $$
  select not exists (select 1 from public.topic_homework h where h.topic_id = p_topic_id)
      or exists (select 1 from public.topic_homework_attempts a join public.topic_homework h on h.id = a.homework_id
                  where h.topic_id = p_topic_id and a.student_id = public.auth_student_id() and a.status = 'accepted') $$;
create function public.topic_condition_visible(p_topic_id uuid) returns boolean language sql stable security definer as $$
  select not public.topic_is_timed(p_topic_id)
      or exists (select 1 from public.topic_homework h where h.topic_id = p_topic_id
                  and public.topic_homework_condition_open(h.id, public.auth_student_id())) $$;
create table public.topic_subtopic_hidden (topic_id uuid not null, subtopic_code text not null, primary key (topic_id, subtopic_code));
create function public.topic_subtopic_is_hidden(p_topic_id uuid, p_code text) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.topic_subtopic_hidden h where h.topic_id = p_topic_id and h.subtopic_code = p_code) $$;

create table public.topic_material_items (id uuid primary key default gen_random_uuid(), topic_id uuid not null, is_visible boolean not null default true,
  section text, track text not null default 'lesson', subtopic_code text);
create table public.course_lessons (id uuid primary key default gen_random_uuid(), topic_id uuid not null, is_published boolean not null default true);
create table public.topic_tests (id uuid primary key default gen_random_uuid());
create table public.topic_test_assignments (id uuid primary key default gen_random_uuid(), topic_id uuid not null, test_id uuid references public.topic_tests(id));
create table public.topic_autocheck_tasks (id uuid primary key default gen_random_uuid(), topic_id uuid not null);
create table public.topic_catalog_topics (id uuid primary key default gen_random_uuid(), topic_id uuid not null);
create table public.course_study_plans (course_id uuid primary key);
create table public.course_study_plan_items (course_id uuid not null, topic_id uuid not null);
do $$ declare t text; begin
  foreach t in array array['topic_material_items','course_lessons','topic_homework','topic_homework_files','topic_tests','topic_test_assignments',
                           'topic_autocheck_tasks','topic_catalog_topics','topic_subtopic_hidden','course_study_plans','course_study_plan_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
grant usage on schema public, auth to authenticated;

-- §288: порядок уроков и разделов, ответы автопроверки, проверки ДЗ (столбцы — как на проде).
alter table public.topics add column title text, add column order_index integer not null default 0;
alter table public.modules add column title text, add column order_index integer not null default 0;
alter table public.topic_homework add column autocheck boolean not null default false, add column grade_scale text not null default 'hundred';
alter table public.topic_homework_attempts add column attempt_number integer not null default 1, add column created_at timestamptz not null default now();
create table public.topic_autocheck_answers (id uuid primary key default gen_random_uuid(), task_id uuid not null references public.topic_autocheck_tasks(id),
  profile_id uuid not null, attempt_no integer not null default 1, answer_raw text, is_correct boolean not null, created_at timestamptz not null default now());
create table public.topic_homework_reviews (id uuid primary key default gen_random_uuid(), attempt_id uuid not null references public.topic_homework_attempts(id),
  reviewer_id uuid, decision text not null, comment text, score integer, created_at timestamptz not null default now());

-- §288 (часть B): старая таблица материалов и её проверки (тела — как на проде 12.10).
create function public.auth_can_see_topic(p_topic_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.group_students gs join public.groups g on g.id = gs.group_id
                   join public.modules m on m.course_id = g.course_id join public.topics t on t.module_id = m.id
                   join public.students st on st.id = gs.student_id
                  where t.id = p_topic_id and st.profile_id = auth.uid()) $$;
create function public.auth_is_staff_of_topic(p_topic_id uuid) returns boolean language sql stable security definer as $$
  select public.course_is_staff(public.course_of_topic(p_topic_id)) $$;
create table public.topic_materials (id uuid primary key default gen_random_uuid(), topic_id uuid not null);
alter table public.topic_materials enable row level security;
grant select on public.topic_materials to authenticated;
grant select on public.topics, public.modules to authenticated; -- как на проде: программу курса ученик читает

-- §288.1: очередь уведомлений и подключение Telegram (столбцы — как на проде 12.10).
create table public.telegram_connections (id uuid primary key default gen_random_uuid(), profile_id uuid not null, telegram_chat_id bigint,
  is_enabled boolean not null default true, disconnected_at timestamptz);
create table public.notification_queue (id uuid primary key default gen_random_uuid(), profile_id uuid not null, channel text not null default 'telegram',
  event_type text not null, entity_type text, entity_id uuid, deduplication_key text not null unique, payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending', attempts integer not null default 0, scheduled_for timestamptz not null default now());
