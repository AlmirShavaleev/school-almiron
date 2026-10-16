-- Цели недели, которые ставит преподаватель (письмо ЛК_стиль_настройки_ученика.md, правка 16.10 15:46;
-- решение владельца 16.10 — заменяет вариант, где цели выбирал ученик).
-- НЕ ПРИМЕНЕНО. Применяет оркестратор после «да» владельца; имя файла — по версии в schema_migrations.
-- Только добавляющая: новые таблицы и функции. student_exam_goals (цель на экзамен, её ставит ученик) и
-- student_weekly_goals (прежняя автоцель §255) не меняются. Повторный прогон — без ошибок.
--
-- Набор стандартный — 3 цели, у каждой одно число (null — цель выключена):
--   days   — заходить на платформу N дней в неделю (3/4/5/6): дни из app_visits (дата по Москве);
--   topics — пройти N тем в неделю (2/3/4/5): тема пройдена — то же правило, что в «Моих курсах»
--            (student_home_courses: ДЗ темы сдано/принято); «за неделю» — сдача той попытки, что сейчас
--            засчитана (принятая, иначе последняя), пришлась на эту неделю;
--   tasks  — решить N задач в тренировке/каталоге (10/20/30/50): первые верные решения задач каталога без
--            показанного ответа (catalog_counted_solutions — то же, что в прежней цели недели) + первые верные
--            ответы автопроверки уроков (topic_autocheck_answers).
-- Неделя — пн–вс по Москве.
--
-- Где хранится. course_weekly_goals — цели курса (по умолчанию для всех учеников курса);
-- student_weekly_goal_overrides — «своё» для ученика в курсе (нет строки — «как у курса»).
-- Цели не версионируются: история за прошлые недели считается с текущими числами.
--
-- Права. Ставит персонал курса (course_is_staff): course_weekly_goals_set, student_weekly_goals_set.
-- Ученик читает только свои (my_weekly_goals). Персонал читает: course_weekly_goals_get, course_goals_summary
-- (колонка «Цели недели: k из n» и «отстаёт к четвергу»), student_goals_for_staff (карточка ученика, история 8 недель).
-- Таблицы закрыты целиком: RLS без политик, прав у anon/authenticated нет — только definer-функции.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Таблицы
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.course_weekly_goals (
  course_id   uuid primary key references public.courses(id) on delete cascade,
  days        smallint check (days between 3 and 6),
  topics      smallint check (topics between 2 and 5),
  tasks       smallint check (tasks in (10, 20, 30, 50)),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.student_weekly_goal_overrides (
  course_id   uuid not null references public.courses(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  days        smallint check (days between 3 and 6),
  topics      smallint check (topics between 2 and 5),
  tasks       smallint check (tasks in (10, 20, 30, 50)),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (course_id, student_id)
);
create index if not exists student_weekly_goal_overrides_student_idx on public.student_weekly_goal_overrides (student_id);

alter table public.course_weekly_goals enable row level security;
alter table public.student_weekly_goal_overrides enable row level security;
revoke all on table public.course_weekly_goals from public, anon, authenticated;
revoke all on table public.student_weekly_goal_overrides from public, anon, authenticated;

comment on table public.course_weekly_goals is
  'Цели недели курса (16.10): days 3–6, topics 2–5, tasks 10/20/30/50; null — цель выключена. Ставит персонал курса (course_weekly_goals_set).';
comment on table public.student_weekly_goal_overrides is
  'Цели недели ученика в курсе, «своё» вместо «как у курса» (16.10). Ставит персонал курса (student_weekly_goals_set).';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Внутренние: понедельник недели, прогресс, действующие цели (без grant)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public._goals_week_start(p_at timestamptz default now())
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select date_trunc('week', p_at at time zone 'Europe/Moscow')::date;
$$;

create or replace function public._weekly_progress_of(p_profile_id uuid, p_week date)
returns table (days int, topics int, tasks int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with rng as (
    select p_week::timestamp at time zone 'Europe/Moscow' as t0,
           (p_week + 7)::timestamp at time zone 'Europe/Moscow' as t1
  ),
  st as (select s.id from public.students s where s.profile_id = p_profile_id),
  passed as (
    -- Засчитанная попытка по каждому ДЗ (принятая, иначе последняя) — как в student_home_courses.
    select h.topic_id,
           (select a.status::text from public.topic_homework_attempts a
             where a.homework_id = h.id and a.student_id in (select id from st)
             order by (a.status = 'accepted') desc, a.attempt_number desc limit 1) as status,
           (select a.submitted_at from public.topic_homework_attempts a
             where a.homework_id = h.id and a.student_id in (select id from st)
             order by (a.status = 'accepted') desc, a.attempt_number desc limit 1) as at
      from public.topic_homework h
     where exists (select 1 from public.topic_homework_attempts a where a.homework_id = h.id and a.student_id in (select id from st))
  )
  select
    (select count(distinct v.visited_on)::int from public.app_visits v
      where v.profile_id = p_profile_id and v.visited_on >= p_week and v.visited_on < p_week + 7),
    (select count(distinct p.topic_id)::int from passed p
      where p.status in ('submitted', 'accepted') and p.at >= (select t0 from rng) and p.at < (select t1 from rng)),
    ((select count(*) from public.catalog_counted_solutions(p_profile_id) c
       where c.at >= (select t0 from rng) and c.at < (select t1 from rng))
     + (select count(*) from (
         select a.task_id from public.topic_autocheck_answers a
          where a.profile_id = p_profile_id and a.is_correct
          group by a.task_id
         having min(a.created_at) >= (select t0 from rng) and min(a.created_at) < (select t1 from rng)) y))::int;
$$;
revoke all on function public._weekly_progress_of(uuid, date) from public, anon, authenticated;

create or replace function public._effective_weekly_goals(p_course_id uuid, p_student_id uuid)
returns table (days smallint, topics smallint, tasks smallint, custom boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(o.days, case when o.student_id is null then c.days end),
         coalesce(o.topics, case when o.student_id is null then c.topics end),
         coalesce(o.tasks, case when o.student_id is null then c.tasks end),
         o.student_id is not null
    from (select 1) one
    left join public.course_weekly_goals c on c.course_id = p_course_id
    left join public.student_weekly_goal_overrides o on o.course_id = p_course_id and o.student_id = p_student_id;
$$;
revoke all on function public._effective_weekly_goals(uuid, uuid) from public, anon, authenticated;

-- Цели с прогрессом за неделю: [{kind, target, progress, done}] — только включённые.
create or replace function public._weekly_goals_json(p_course_id uuid, p_student_id uuid, p_week date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with g as (select * from public._effective_weekly_goals(p_course_id, p_student_id)),
       pr as (select * from public._weekly_progress_of((select s.profile_id from public.students s where s.id = p_student_id), p_week))
  select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb)
    from (
      select 1 as ord, jsonb_build_object('kind', 'days', 'target', g.days, 'progress', pr.days, 'done', pr.days >= g.days) as j
        from g, pr where g.days is not null
      union all
      select 2, jsonb_build_object('kind', 'topics', 'target', g.topics, 'progress', pr.topics, 'done', pr.topics >= g.topics)
        from g, pr where g.topics is not null
      union all
      select 3, jsonb_build_object('kind', 'tasks', 'target', g.tasks, 'progress', pr.tasks, 'done', pr.tasks >= g.tasks)
        from g, pr where g.tasks is not null
    ) x;
$$;
revoke all on function public._weekly_goals_json(uuid, uuid, date) from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Ученик: свои цели недели по курсам (только чтение)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.my_weekly_goals()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with st as (select s.id from public.students s where s.profile_id = auth.uid()),
       cs as (
         select distinct g.course_id, c.title
           from public.group_students gs
           join public.groups g on g.id = gs.group_id
           join public.courses c on c.id = g.course_id
          where gs.student_id in (select id from st)
       )
  select coalesce(jsonb_agg(jsonb_build_object(
           'course_id', cs.course_id, 'course_title', cs.title,
           'week_start', public._goals_week_start(),
           'goals', public._weekly_goals_json(cs.course_id, (select id from st limit 1), public._goals_week_start()))
         order by cs.title), '[]'::jsonb)
    from cs
   where jsonb_array_length(public._weekly_goals_json(cs.course_id, (select id from st limit 1), public._goals_week_start())) > 0;
$$;
comment on function public.my_weekly_goals() is
  'Цели недели вызывающего ученика по курсам (их ставит преподаватель) с прогрессом за текущую неделю: [{course_id, course_title, week_start, goals:[{kind, target, progress, done}]}].';
revoke all on function public.my_weekly_goals() from public, anon;
grant execute on function public.my_weekly_goals() to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Персонал: поставить цели курсу и ученику
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.course_weekly_goals_get(p_course_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет доступа к целям этого курса' using errcode = '42501';
  end if;
  return coalesce((select jsonb_build_object('days', c.days, 'topics', c.topics, 'tasks', c.tasks)
                     from public.course_weekly_goals c where c.course_id = p_course_id),
                  jsonb_build_object('days', null, 'topics', null, 'tasks', null));
end;
$$;
revoke all on function public.course_weekly_goals_get(uuid) from public, anon;
grant execute on function public.course_weekly_goals_get(uuid) to authenticated;

create or replace function public.course_weekly_goals_set(p_course_id uuid, p_days int, p_topics int, p_tasks int)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет доступа к целям этого курса' using errcode = '42501';
  end if;
  if p_days is null and p_topics is null and p_tasks is null then
    delete from public.course_weekly_goals where course_id = p_course_id;
    return;
  end if;
  insert into public.course_weekly_goals (course_id, days, topics, tasks, updated_by)
  values (p_course_id, p_days, p_topics, p_tasks, auth.uid())
  on conflict (course_id) do update
    set days = excluded.days, topics = excluded.topics, tasks = excluded.tasks,
        updated_by = excluded.updated_by, updated_at = now();
end;
$$;
comment on function public.course_weekly_goals_set(uuid, int, int, int) is
  'Цели недели курса для всех учеников (course_is_staff, иначе 42501): days 3–6, topics 2–5, tasks 10/20/30/50, null — выключена; все null — целей нет.';
revoke all on function public.course_weekly_goals_set(uuid, int, int, int) from public, anon;
grant execute on function public.course_weekly_goals_set(uuid, int, int, int) to authenticated;

create or replace function public.student_weekly_goals_set(
  p_course_id uuid, p_student_id uuid, p_custom boolean, p_days int, p_topics int, p_tasks int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет доступа к целям этого курса' using errcode = '42501';
  end if;
  if not exists (select 1 from public.group_students gs join public.groups g on g.id = gs.group_id
                  where g.course_id = p_course_id and gs.student_id = p_student_id) then
    raise exception 'Ученик не в этом курсе' using errcode = '22023';
  end if;
  if not coalesce(p_custom, false) then
    delete from public.student_weekly_goal_overrides where course_id = p_course_id and student_id = p_student_id;
    return;
  end if;
  insert into public.student_weekly_goal_overrides (course_id, student_id, days, topics, tasks, updated_by)
  values (p_course_id, p_student_id, p_days, p_topics, p_tasks, auth.uid())
  on conflict (course_id, student_id) do update
    set days = excluded.days, topics = excluded.topics, tasks = excluded.tasks,
        updated_by = excluded.updated_by, updated_at = now();
end;
$$;
comment on function public.student_weekly_goals_set(uuid, uuid, boolean, int, int, int) is
  'Цели недели ученика в курсе (course_is_staff): p_custom=false — «как у курса» (своё удаляется), true — «своё» с числами (null — цель выключена).';
revoke all on function public.student_weekly_goals_set(uuid, uuid, boolean, int, int, int) from public, anon;
grant execute on function public.student_weekly_goals_set(uuid, uuid, boolean, int, int, int) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Персонал: сводка по курсу и карточка ученика (только чтение)
-- ──────────────────────────────────────────────────────────────────────────
-- «Отстаёт к четвергу»: с четверга (4-й день недели) хоть одна цель ниже темпа — прогресс меньше
-- ceil(цель × прошедшие дни / 7).
create or replace function public.course_goals_summary(p_course_id uuid)
returns table (student_id uuid, goals int, done int, behind boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_week date := public._goals_week_start();
  v_dow  int  := extract(isodow from now() at time zone 'Europe/Moscow')::int;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет доступа к ученикам этого курса' using errcode = '42501';
  end if;
  return query
  with cs as (
    select distinct gs.student_id
      from public.group_students gs join public.groups g on g.id = gs.group_id
     where g.course_id = p_course_id
  ),
  gj as (select cs.student_id, public._weekly_goals_json(p_course_id, cs.student_id, v_week) as j from cs)
  select gj.student_id,
         jsonb_array_length(gj.j)::int,
         (select count(*)::int from jsonb_array_elements(gj.j) e where (e->>'done')::boolean),
         v_dow >= 4 and exists (
           select 1 from jsonb_array_elements(gj.j) e
            where (e->>'progress')::int < ceil((e->>'target')::numeric * v_dow / 7))
    from gj;
end;
$$;
comment on function public.course_goals_summary(uuid) is
  'Цели недели учеников курса (course_is_staff, иначе 42501): по ученику — сколько целей, сколько выполнено на этой неделе и отстаёт ли (с четверга, ниже темпа).';
revoke all on function public.course_goals_summary(uuid) from public, anon;
grant execute on function public.course_goals_summary(uuid) to authenticated;

create or replace function public.student_goals_for_staff(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_week    date := public._goals_week_start();
begin
  if not (public.is_admin_or_owner() or public.auth_is_staff_of_student(p_student_id)) then
    raise exception 'Нет доступа к целям этого ученика' using errcode = '42501';
  end if;
  select s.profile_id into v_profile from public.students s where s.id = p_student_id;
  return jsonb_build_object(
    'exam', coalesce((select jsonb_agg(jsonb_build_object('subject', e.subject, 'goal', e.goal) order by e.subject)
                        from public.student_exam_goals e where e.profile_id = v_profile), '[]'::jsonb),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'course_id', c.id, 'course_title', c.title,
               'custom', (select eg.custom from public._effective_weekly_goals(c.id, p_student_id) eg),
               'course_goals', (select jsonb_build_object('days', cw.days, 'topics', cw.topics, 'tasks', cw.tasks)
                                  from public.course_weekly_goals cw where cw.course_id = c.id),
               'own_goals', (select jsonb_build_object('days', o.days, 'topics', o.topics, 'tasks', o.tasks)
                               from public.student_weekly_goal_overrides o where o.course_id = c.id and o.student_id = p_student_id),
               'goals', public._weekly_goals_json(c.id, p_student_id, v_week),
               'history', (
                 select jsonb_agg(jsonb_build_object(
                          'week_start', w.d,
                          'total', jsonb_array_length(h.j),
                          'done', (select count(*) from jsonb_array_elements(h.j) e where (e->>'done')::boolean))
                        order by w.d)
                   from generate_series(0, 7) k
                   cross join lateral (select v_week - 7 * (7 - k) as d) w
                   cross join lateral (select public._weekly_goals_json(c.id, p_student_id, w.d) as j) h)
             ) order by c.title)
        from public.courses c
       where c.id in (select g.course_id from public.group_students gs join public.groups g on g.id = gs.group_id
                       where gs.student_id = p_student_id)
         and (public.is_admin_or_owner() or public.course_is_staff(c.id))), '[]'::jsonb)
  );
end;
$$;
comment on function public.student_goals_for_staff(uuid) is
  'Цели ученика для персонала (auth_is_staff_of_student или админ, иначе 42501): {exam:[{subject, goal}], courses:[{course_id, course_title, custom, course_goals, own_goals, goals:[цели недели с прогрессом], history:[8 недель: week_start, total, done]}]}. Только курсы, где вызывающий — персонал.';
revoke all on function public.student_goals_for_staff(uuid) from public, anon;
grant execute on function public.student_goals_for_staff(uuid) to authenticated;
