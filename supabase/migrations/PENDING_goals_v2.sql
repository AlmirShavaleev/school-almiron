-- Учебные цели в два уровня (письмо ЛК_стиль_настройки_ученика.md, 16.10; решение владельца 16.10).
-- НЕ ПРИМЕНЕНО. Применяет оркестратор после «да» владельца; имя файла — по версии в schema_migrations.
-- Только добавляющая: новая таблица и новые функции. student_exam_goals (глобальная цель) и student_weekly_goals
-- (прежняя автоцель недели §255) не меняются. Повторный прогон — без ошибок.
--
-- Глобальная цель — уже есть: student_exam_goals (subject, goal), пишет set_my_exam_goal. Здесь — только чтение
-- персоналом вместе с целями недели (student_goals_for_staff).
--
-- Регулярные цели — НОВОЕ: `student_regular_goals`, повторяются каждую неделю, пока ученик их не поменяет или не
-- удалит (строка живёт, пока её не удалили; прогресс всегда за текущую неделю, понедельник по Москве). Типы:
--   numbers — «решить N задач по номерам ЕГЭ» (subject + numbers + target). Считает так же, как прежняя цель недели:
--             catalog_counted_solutions (первое верное решение задачи каталога без показанного ответа);
--   topics  — «пройти тему(ы) курса», 1–3 темы. Тема пройдена — то же правило, что в «Моих курсах»
--             (student_home_courses): есть ДЗ темы со статусом submitted/accepted. Прогресс — сколько из выбранных
--             пройдено (к концу недели или раньше — неважно: тема пройдена, цель выполнена);
--   tasks   — «решить N задач в тренировке/каталоге» за неделю: catalog_counted_solutions + первые верные ответы
--             автопроверки уроков (topic_autocheck_answers);
--   days    — «заниматься N дней в неделю»: дни с решённым (student_solve_days) или с ответом автопроверки.
-- Не больше 6 целей у ученика.
--
-- Кто пишет. Только ученик своей строкой: set_my_regular_goal / delete_my_regular_goal (definer, auth.uid()).
-- Темы цели — только из курсов, к которым у ученика есть доступ (course_student_has_access).
-- Кто читает. Ученик — my_regular_goals() (свои с прогрессом). Персонал — student_goals_for_staff(student_id)
-- (auth_is_staff_of_student или админ платформы) и сводку по курсу course_goals_summary(course_id) (course_is_staff):
-- «Цели недели: выполнено k из n» для списка учеников. Только чтение.
--
-- Таблица закрыта целиком: RLS включена, политик нет, прав у anon/authenticated нет — только definer-функции.
-- Порядок выкладки: миграция → фронт (без миграции блок целей в настройках и на главной показывает «не удалось
-- загрузить», остальное работает).

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Таблица
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.student_regular_goals (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('numbers', 'topics', 'tasks', 'days')),
  subject     text check (subject in ('math', 'physics')),
  numbers     int[] not null default '{}',
  topic_ids   uuid[] not null default '{}',
  target      int not null check (target between 1 and 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (kind <> 'numbers' or (subject is not null and cardinality(numbers) between 1 and 5)),
  check (kind <> 'topics'  or cardinality(topic_ids) between 1 and 3),
  check (kind <> 'days'    or target between 1 and 7)
);

create index if not exists student_regular_goals_profile_idx on public.student_regular_goals (profile_id);

alter table public.student_regular_goals enable row level security;
revoke all on table public.student_regular_goals from public, anon, authenticated;

comment on table public.student_regular_goals is
  'Цели недели ученика (16.10): повторяются каждую неделю, пока ученик не поменяет. Типы numbers/topics/tasks/days. Закрыта целиком: пишут set_my_regular_goal/delete_my_regular_goal, читают my_regular_goals, student_goals_for_staff, course_goals_summary.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Прогресс за текущую неделю (внутренняя, без grant)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.regular_goals_progress_of(p_profile_id uuid)
returns table (
  id uuid, kind text, subject text, numbers int[], topic_ids uuid[], topic_titles text[],
  target int, progress int, done boolean, week_start date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with wk as (
    select date_trunc('week', now() at time zone 'Europe/Moscow')::date as d
  ),
  rng as (
    select (select d from wk)::timestamp at time zone 'Europe/Moscow' as t0,
           ((select d from wk) + 7)::timestamp at time zone 'Europe/Moscow' as t1
  ),
  st as (
    select s.id from public.students s where s.profile_id = p_profile_id
  ),
  cat as (
    select c.task_id, c.at, c.subject, c.n
      from public.catalog_counted_solutions(p_profile_id) c
     where c.at >= (select t0 from rng) and c.at < (select t1 from rng)
  ),
  auto as (
    -- Первый верный ответ автопроверки по задаче — за эту неделю.
    select a.task_id, min(a.created_at) as at
      from public.topic_autocheck_answers a
     where a.profile_id = p_profile_id and a.is_correct
     group by a.task_id
    having min(a.created_at) >= (select t0 from rng) and min(a.created_at) < (select t1 from rng)
  ),
  days as (
    select sd.day from public.student_solve_days(p_profile_id) sd
     where sd.day >= (select wk.d from wk) and sd.day < (select wk.d from wk) + 7
    union
    select (a.created_at at time zone 'Europe/Moscow')::date
      from public.topic_autocheck_answers a
     where a.profile_id = p_profile_id
       and a.created_at >= (select t0 from rng) and a.created_at < (select t1 from rng)
  ),
  goals as (
    select g.*,
           case g.kind
             when 'numbers' then (select count(*) from cat where cat.subject = g.subject and cat.n = any(g.numbers))::int
             when 'tasks'   then ((select count(*) from cat where g.subject is null or cat.subject = g.subject)
                                  + (select count(*) from auto))::int
             when 'days'    then (select count(*) from days)::int
             when 'topics'  then (
               select count(*)::int from unnest(g.topic_ids) tid
                where exists (
                  select 1 from public.topic_homework h
                   where h.topic_id = tid
                     and (select a.status::text from public.topic_homework_attempts a
                           where a.homework_id = h.id and a.student_id in (select id from st)
                           order by (a.status = 'accepted') desc, a.attempt_number desc
                           limit 1) in ('submitted', 'accepted')))
           end as progress,
           case when g.kind = 'topics' then cardinality(g.topic_ids) else g.target end as goal_target
      from public.student_regular_goals g
     where g.profile_id = p_profile_id
  )
  select g.id, g.kind, g.subject, g.numbers, g.topic_ids,
         array(select t.title from unnest(g.topic_ids) with ordinality u(tid, ord) join public.topics t on t.id = u.tid order by u.ord),
         g.goal_target, least(g.progress, 9999), g.progress >= g.goal_target, (select d from wk)
    from goals g
   order by g.created_at;
$$;

revoke all on function public.regular_goals_progress_of(uuid) from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Ученик: свои цели с прогрессом, добавить/изменить, удалить
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.my_regular_goals()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    from public.regular_goals_progress_of(auth.uid()) r;
$$;

comment on function public.my_regular_goals() is
  'Цели недели вызывающего ученика с прогрессом за текущую неделю (понедельник по Москве): [{id, kind, subject, numbers, topic_ids, topic_titles, target, progress, done, week_start}].';
revoke all on function public.my_regular_goals() from public, anon;
grant execute on function public.my_regular_goals() to authenticated;

create or replace function public.set_my_regular_goal(
  p_id uuid, p_kind text, p_subject text, p_numbers int[], p_topic_ids uuid[], p_target int
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid := auth.uid();
  v_id      uuid;
  v_topics  uuid[] := coalesce(p_topic_ids, '{}');
begin
  if v_profile is null or not exists (select 1 from public.students s where s.profile_id = v_profile) then
    raise exception 'Цели недели ставит ученик' using errcode = '42501';
  end if;
  if p_kind = 'numbers' and exists (select 1 from unnest(coalesce(p_numbers, '{}')) n where n < 1 or n > 27) then
    raise exception 'Номер задания ЕГЭ — от 1 до 27' using errcode = '22023';
  end if;
  if p_kind = 'topics' and exists (
    select 1 from unnest(v_topics) tid
     where not exists (
       select 1 from public.topics t join public.modules m on m.id = t.module_id
        where t.id = tid and public.course_student_has_access(m.course_id))) then
    raise exception 'Тема не из ваших курсов' using errcode = '42501';
  end if;

  if p_id is null then
    if (select count(*) from public.student_regular_goals where profile_id = v_profile) >= 6 then
      raise exception 'Не больше 6 целей недели' using errcode = '22023';
    end if;
    insert into public.student_regular_goals (profile_id, kind, subject, numbers, topic_ids, target)
    values (v_profile, p_kind, nullif(p_subject, ''), coalesce(p_numbers, '{}'), v_topics,
            case when p_kind = 'topics' then greatest(cardinality(v_topics), 1) else p_target end)
    returning id into v_id;
  else
    update public.student_regular_goals
       set kind = p_kind, subject = nullif(p_subject, ''), numbers = coalesce(p_numbers, '{}'), topic_ids = v_topics,
           target = case when p_kind = 'topics' then greatest(cardinality(v_topics), 1) else p_target end,
           updated_at = now()
     where id = p_id and profile_id = v_profile
    returning id into v_id;
    if v_id is null then
      raise exception 'Цель не найдена' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

comment on function public.set_my_regular_goal(uuid, text, text, int[], uuid[], int) is
  'Ученик добавляет (p_id null) или меняет свою цель недели. numbers: subject + 1–5 номеров 1..27 + target; topics: 1–3 темы своих курсов (target = число тем); tasks: target 1..500; days: target 1..7. Не больше 6 целей.';
revoke all on function public.set_my_regular_goal(uuid, text, text, int[], uuid[], int) from public, anon;
grant execute on function public.set_my_regular_goal(uuid, text, text, int[], uuid[], int) to authenticated;

create or replace function public.delete_my_regular_goal(p_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with d as (
    delete from public.student_regular_goals where id = p_id and profile_id = auth.uid() returning 1
  )
  select exists (select 1 from d);
$$;

revoke all on function public.delete_my_regular_goal(uuid) from public, anon;
grant execute on function public.delete_my_regular_goal(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Персонал: цели ученика и сводка по курсу (только чтение)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.student_goals_for_staff(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
begin
  if not (public.is_admin_or_owner() or public.auth_is_staff_of_student(p_student_id)) then
    raise exception 'Нет доступа к целям этого ученика' using errcode = '42501';
  end if;
  select s.profile_id into v_profile from public.students s where s.id = p_student_id;
  return jsonb_build_object(
    'exam', coalesce((select jsonb_agg(jsonb_build_object('subject', e.subject, 'goal', e.goal) order by e.subject)
                        from public.student_exam_goals e where e.profile_id = v_profile), '[]'::jsonb),
    'weekly', coalesce((select jsonb_agg(to_jsonb(r)) from public.regular_goals_progress_of(v_profile) r), '[]'::jsonb)
  );
end;
$$;

comment on function public.student_goals_for_staff(uuid) is
  'Цели ученика для персонала (auth_is_staff_of_student или админ, иначе 42501): {exam:[{subject, goal}], weekly:[цели недели с прогрессом]}. Только чтение.';
revoke all on function public.student_goals_for_staff(uuid) from public, anon;
grant execute on function public.student_goals_for_staff(uuid) to authenticated;

create or replace function public.course_goals_summary(p_course_id uuid)
returns table (student_id uuid, goals int, done int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет доступа к ученикам этого курса' using errcode = '42501';
  end if;
  return query
  select s.id,
         count(r.id)::int,
         count(r.id) filter (where r.done)::int
    from (select distinct gs.student_id
            from public.group_students gs
            join public.groups g on g.id = gs.group_id
           where g.course_id = p_course_id) cs
    join public.students s on s.id = cs.student_id
    left join lateral public.regular_goals_progress_of(s.profile_id) r on true
   group by s.id;
end;
$$;

comment on function public.course_goals_summary(uuid) is
  'Цели недели учеников курса для персонала (course_is_staff, иначе 42501): по ученику — сколько целей и сколько выполнено на этой неделе.';
revoke all on function public.course_goals_summary(uuid) from public, anon;
grant execute on function public.course_goals_summary(uuid) to authenticated;
