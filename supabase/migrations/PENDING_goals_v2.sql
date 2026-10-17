-- Цели недели, которые ставит САМ УЧЕНИК (письмо ЛК_стиль_настройки_ученика.md, правка 16.10 17:45;
-- уточнение владельца: «мой кабинет» = кабинет ученика). Отменяет вариант, где цели ставил преподаватель.
-- НЕ ПРИМЕНЕНО. Применяет оркестратор после «да» владельца; имя файла — по версии в schema_migrations.
-- Только добавляющая: новая таблица и функции. student_exam_goals (цель на экзамен) и student_weekly_goals
-- (прежняя автоцель §255) не меняются. Повторный прогон — без ошибок.
--
-- Набор стандартный — 3 цели, у каждой одно число (null — цель не выбрана):
--   days   — заходить на платформу N дней в неделю (3/4/5/6): дни из app_visits (дата по Москве);
--   topics — пройти N тем в неделю (2/3/4/5): тема пройдена — то же правило, что в «Моих курсах»
--            (student_home_courses: ДЗ темы сдано/принято); «за неделю» — сдача той попытки, что сейчас
--            засчитана (принятая, иначе последняя), пришлась на эту неделю;
--   tasks  — решить N задач в тренировке/каталоге (10/20/30/50): первые верные решения задач каталога без
--            показанного ответа (catalog_counted_solutions поверх catalog_task_attempts) + первые верные ответы
--            автопроверки уроков (topic_autocheck_answers).
-- Неделя — пн–вс по Москве. Цели общие для ученика (не по курсам): заходы, темы и задачи считаются по всем курсам.
--
-- Версии по неделям. student_goal_plans — строка на «с какого понедельника действуют эти числа». Цели недели W —
-- последняя строка с valid_from <= W. Ученик меняет цели — новые числа действуют со следующего понедельника, текущая
-- неделя считается по старым; если на текущую неделю целей ещё не было — сразу с этой недели. Поэтому история за
-- прошлые недели считается с теми числами, что действовали тогда.
--
-- Права. Ставит и читает свои — только ученик (set_my_weekly_goals, my_weekly_goals; definer, auth.uid()).
-- Персонал читает (только чтение): course_goals_summary(course_id) — course_is_staff («Цели недели: k из n» и
-- «отстаёт к четвергу» в списке учеников), student_goals_for_staff(student_id) — auth_is_staff_of_student или админ
-- (карточка ученика: цель на экзамен, цели недели, история 8 недель).
-- Таблица закрыта целиком: RLS без политик, прав у anon/authenticated нет — только definer-функции.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Таблица
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.student_goal_plans (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  valid_from  date not null check (extract(isodow from valid_from) = 1),
  days        smallint check (days between 3 and 6),
  topics      smallint check (topics between 2 and 5),
  tasks       smallint check (tasks in (10, 20, 30, 50)),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, valid_from)
);

alter table public.student_goal_plans enable row level security;
revoke all on table public.student_goal_plans from public, anon, authenticated;

comment on table public.student_goal_plans is
  'Цели недели ученика (16.10): days 3–6, topics 2–5, tasks 10/20/30/50, null — не выбрана; valid_from — понедельник, с которого действуют. Пишет set_my_weekly_goals, читают my_weekly_goals, course_goals_summary, student_goals_for_staff.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Внутренние (без grant)
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

-- Цели недели W ученика (действовавшие тогда) с прогрессом: [{kind, target, progress, done}] — только выбранные.
create or replace function public._weekly_goals_json(p_profile_id uuid, p_week date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with g as (
    select p.days, p.topics, p.tasks from public.student_goal_plans p
     where p.profile_id = p_profile_id and p.valid_from <= p_week
     order by p.valid_from desc limit 1
  ),
  pr as (select * from public._weekly_progress_of(p_profile_id, p_week))
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
revoke all on function public._weekly_goals_json(uuid, date) from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Ученик: поставить и прочитать свои цели
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.set_my_weekly_goals(p_days int, p_topics int, p_tasks int)
returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid := auth.uid();
  v_week    date := public._goals_week_start();
  v_from    date;
begin
  if v_profile is null or not exists (select 1 from public.students s where s.profile_id = v_profile) then
    raise exception 'Цели недели ставит ученик' using errcode = '42501';
  end if;
  -- На текущую неделю целей не было — сразу с этой недели; были — со следующего понедельника.
  v_from := case when exists (select 1 from public.student_goal_plans p where p.profile_id = v_profile and p.valid_from <= v_week)
                 then v_week + 7 else v_week end;
  insert into public.student_goal_plans (profile_id, valid_from, days, topics, tasks)
  values (v_profile, v_from, p_days, p_topics, p_tasks)
  on conflict (profile_id, valid_from) do update
    set days = excluded.days, topics = excluded.topics, tasks = excluded.tasks, updated_at = now();
  return v_from;
end;
$$;
comment on function public.set_my_weekly_goals(int, int, int) is
  'Ученик ставит свои цели недели: days 3–6, topics 2–5, tasks 10/20/30/50, null — не выбрана (иначе 23514). Действуют со следующего понедельника; если на эту неделю целей не было — сразу. Возвращает понедельник, с которого действуют.';
revoke all on function public.set_my_weekly_goals(int, int, int) from public, anon;
grant execute on function public.set_my_weekly_goals(int, int, int) to authenticated;

create or replace function public.my_weekly_goals()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with w as (select public._goals_week_start() as d),
       cur as (select p.days, p.topics, p.tasks from public.student_goal_plans p, w
                where p.profile_id = auth.uid() and p.valid_from <= w.d order by p.valid_from desc limit 1),
       nxt as (select p.valid_from, p.days, p.topics, p.tasks from public.student_goal_plans p, w
                where p.profile_id = auth.uid() and p.valid_from > w.d order by p.valid_from limit 1)
  select jsonb_build_object(
    'week_start', (select d from w),
    'current', (select jsonb_build_object('days', days, 'topics', topics, 'tasks', tasks) from cur),
    'next', (select jsonb_build_object('valid_from', valid_from, 'days', days, 'topics', topics, 'tasks', tasks) from nxt),
    'goals', public._weekly_goals_json(auth.uid(), (select d from w)));
$$;
comment on function public.my_weekly_goals() is
  'Свои цели недели ученика: {week_start, current:{days,topics,tasks}|null, next:{valid_from,…}|null — изменения со следующего понедельника, goals:[{kind, target, progress, done}] — текущая неделя}.';
revoke all on function public.my_weekly_goals() from public, anon;
grant execute on function public.my_weekly_goals() to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Персонал: только чтение
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
    select distinct gs.student_id, s.profile_id
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
      join public.students s on s.id = gs.student_id
     where g.course_id = p_course_id
  ),
  gj as (select cs.student_id, public._weekly_goals_json(cs.profile_id, v_week) as j from cs)
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
  'Цели недели учеников курса (course_is_staff, иначе 42501): по ученику — сколько целей поставил, сколько выполнено на этой неделе и отстаёт ли (с четверга, ниже темпа). goals = 0 — ученик целей не ставил.';
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
    'goals', public._weekly_goals_json(v_profile, v_week),
    'history', (
      select jsonb_agg(jsonb_build_object(
               'week_start', w.d,
               'total', jsonb_array_length(h.j),
               'done', (select count(*) from jsonb_array_elements(h.j) e where (e->>'done')::boolean))
             order by w.d)
        from generate_series(0, 7) k
        cross join lateral (select v_week - 7 * (7 - k) as d) w
        cross join lateral (select public._weekly_goals_json(v_profile, w.d) as j) h)
  );
end;
$$;
comment on function public.student_goals_for_staff(uuid) is
  'Цели ученика для персонала, только чтение (auth_is_staff_of_student или админ, иначе 42501): {exam:[{subject, goal}], goals:[цели недели с прогрессом], history:[8 недель: week_start, total, done — с целями, что действовали тогда]}.';
revoke all on function public.student_goals_for_staff(uuid) from public, anon;
grant execute on function public.student_goals_for_staff(uuid) to authenticated;
