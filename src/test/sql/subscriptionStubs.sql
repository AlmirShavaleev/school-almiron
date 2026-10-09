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
create function public.get_my_role() returns public.user_role language sql stable as $$ select role from public.profiles where id = auth.uid() $$;
create function public.is_admin_or_owner() returns boolean language sql stable as $$ select coalesce(public.get_my_role() in ('admin','owner'), false) $$;
create function public.auth_student_id() returns uuid language sql stable as $$ select id from public.students where profile_id = auth.uid() $$;
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
