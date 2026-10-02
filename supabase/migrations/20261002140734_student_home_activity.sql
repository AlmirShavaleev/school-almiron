-- §254. Главная ученика: серия заходов, календарь активности, «решено задач по
-- неделям», пройденные темы по курсам — ОДНИМ вызовом student_home_activity().
--
-- ПРИМЕНЕНА 02.10 оркестратором (MCP apply_migration, версия 20261002140734); прежде
-- файл назывался PENDING_254.sql. Только добавление:
-- три новые функции, ни одна существующая не меняется, таблицы не трогаются.
--
-- Почему definer: `app_visits` закрыта целиком (§78, RLS без политик, права
-- только у service_role), а «тема пройдена» живёт в topic_done_events(),
-- которую клиенту не выдают. Ученику нужны ровно СВОИ дни — поэтому параметра
-- «чей» у функции нет вовсе: всё считается от auth.uid(), чужое получить нечем.
--
-- Дни — по Москве, как record_app_visit() пишет visited_on
-- ((now() at time zone 'Europe/Moscow')::date) и как остальные даты проекта.
--
-- ── Что такое «решённая задача» (одно определение, student_solved_task_days) ─
--   * ДЗ: строка таблицы проверки (topic_homework_review_tasks) с вердиктом
--     «верно» или «частично» у ПРОВЕРЕННОЙ работы (есть строка в
--     topic_homework_reviews — до вердикта таблица — черновик преподавателя,
--     §199). Дата — сдача работы (submitted_at). Задание одного ДЗ считается
--     один раз: после доработки та же «№ 4» второй раз не прибавляется, датой
--     остаётся первая сдача, где оно засчитано.
--   * Каталог: ровно определение «решено» главной каталога (§246, решение
--     владельца 30.09): отметка «Выполнено» (catalog_task_progress.is_completed)
--     ИЛИ верный ответ в варианте (test_variant_answers.is_correct — это и
--     задачи к уроку §162). Одна задача — один раз, дата — самое раннее из двух.
--   * Пробник: задание с баллом > 0 (mock_exam_task_scores.points); дата — день
--     пробника (starts_at, у старых без окна — date).
--   * Тесты тем: ответ завершённой попытки, засчитанный верно или с баллом > 0;
--     дата — завершение попытки.
-- Решения влияют только на цвет клетки и столбики; в серию день засчитывает
-- заход (app_visits).

-- ── 1. Решённые задачи по дням (внутренняя, клиенту не выдаётся) ────────────
create or replace function public.student_solved_task_days(p_profile_id uuid, p_from date)
returns table (day date, source text, n integer)
language sql
stable
set search_path = public, pg_temp
as $$
  with st as (
    select s.id from public.students s where s.profile_id = p_profile_id
  ),
  hw as (
    select min(a.submitted_at) as at
      from public.topic_homework_review_tasks rt
      join public.topic_homework_attempts a on a.id = rt.attempt_id
     where a.student_id in (select id from st)
       and rt.verdict in ('correct', 'partial')
       and a.submitted_at is not null
       and exists (select 1 from public.topic_homework_reviews r where r.attempt_id = a.id)
     group by a.homework_id, lower(btrim(rt.no))
  ),
  cat_raw as (
    select p.task_id, coalesce(p.completed_at, p.updated_at) as at
      from public.catalog_task_progress p
     where p.user_id = p_profile_id and p.is_completed
    union all
    select i.task_id,
           coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at)
      from public.test_variant_student_assignments sa
      join public.test_variant_answers a on a.student_assignment_id = sa.id
      join public.test_variant_items i on i.id = a.variant_item_id
     where sa.student_id in (select id from st) and a.is_correct
  ),
  cat as (
    select min(at) as at from cat_raw group by task_id
  ),
  mock as (
    select coalesce(me.starts_at, me.date) as at
      from public.mock_exam_task_scores s
      join public.mock_exams me on me.id = s.mock_exam_id
     where s.student_id in (select id from st) and s.points > 0
  ),
  tests as (
    select att.completed_at as at
      from public.topic_test_answers ans
      join public.topic_test_attempts att on att.id = ans.attempt_id
     where att.student_id in (select id from st)
       and att.status = 'completed'
       and (coalesce(ans.is_correct, false) or coalesce(ans.awarded_points, 0) > 0)
  ),
  ev as (
    select 'hw'::text as source, at from hw
    union all select 'catalog', at from cat
    union all select 'mock', at from mock
    union all select 'test', at from tests
  )
  select (ev.at at time zone 'Europe/Moscow')::date as day, ev.source, count(*)::int as n
    from ev
   where ev.at is not null
     and (ev.at at time zone 'Europe/Moscow')::date >= p_from
   group by 1, 2;
$$;

comment on function public.student_solved_task_days(uuid, date) is
  '§254. Решённые задачи ученика по дням (Москва) и источникам: hw (верно/частично в проверенной работе, дата сдачи, задание ДЗ один раз), catalog (как «решено» каталога §246: «Выполнено» или верный ответ варианта, задача один раз), mock (балл > 0, день пробника), test (засчитанный ответ теста темы). Внутренняя: вызывается из student_home_activity.';

revoke all on function public.student_solved_task_days(uuid, date) from public, anon, authenticated;

-- ── 2. Серия и рекорд (внутренняя; «сегодня» — параметр, чтобы пробы могли
--       проверить и «сегодня ещё не заходил») ──────────────────────────────────
-- Серия — непрерывный ряд дней заходов, который кончается СЕГОДНЯ или ВЧЕРА:
-- пока день не кончился, вчерашняя серия не обнуляется. Рекорд — самый длинный
-- ряд за всю историю (не только за окно календаря).
create or replace function public.student_visit_streak(p_profile_id uuid, p_today date)
returns table (streak integer, record integer, visited_today boolean)
language sql
stable
set search_path = public, pg_temp
as $$
  with d as (
    select v.visited_on from public.app_visits v
     where v.profile_id = p_profile_id and v.visited_on <= p_today
  ),
  g as (
    select d.visited_on, d.visited_on - (row_number() over (order by d.visited_on))::int as grp from d
  ),
  runs as (
    select max(g.visited_on) as last_day, count(*)::int as len from g group by g.grp
  )
  select
    coalesce((select r.len from runs r where r.last_day >= p_today - 1 order by r.last_day desc limit 1), 0),
    coalesce((select max(r.len) from runs r), 0),
    exists (select 1 from d where d.visited_on = p_today);
$$;

comment on function public.student_visit_streak(uuid, date) is
  '§254. Серия заходов (ряд дней app_visits, кончающийся p_today или днём раньше), рекорд за всю историю и «заходил ли p_today». Внутренняя: вызывается из student_home_activity.';

revoke all on function public.student_visit_streak(uuid, date) from public, anon, authenticated;

-- ── 3. Главная ученика одним вызовом ─────────────────────────────────────────
create or replace function public.student_home_activity(p_days integer default 84)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_today  date := (now() at time zone 'Europe/Moscow')::date;
  v_days   integer := least(greatest(coalesce(p_days, 84), 7), 371);
  v_from   date;
  v_streak record;
begin
  if v_uid is null then
    raise exception 'student_home_activity: нужен вход' using errcode = '42501';
  end if;

  v_from := v_today - (v_days - 1);
  select * into v_streak from public.student_visit_streak(v_uid, v_today);

  return jsonb_build_object(
    'today',         v_today,
    'from',          v_from,
    'streak',        v_streak.streak,
    'record',        v_streak.record,
    'visited_today', v_streak.visited_today,
    'visits', coalesce((
      select jsonb_agg(v.visited_on order by v.visited_on)
        from public.app_visits v
       where v.profile_id = v_uid and v.visited_on between v_from and v_today
    ), '[]'::jsonb),
    'solved', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', x.day, 'n', x.n,
               'hw', x.hw, 'catalog', x.catalog, 'mock', x.mock, 'test', x.test)
             order by x.day)
        from (
          select s.day,
                 sum(s.n)::int as n,
                 coalesce(sum(s.n) filter (where s.source = 'hw'), 0)::int      as hw,
                 coalesce(sum(s.n) filter (where s.source = 'catalog'), 0)::int as catalog,
                 coalesce(sum(s.n) filter (where s.source = 'mock'), 0)::int    as mock,
                 coalesce(sum(s.n) filter (where s.source = 'test'), 0)::int    as test
            from public.student_solved_task_days(v_uid, v_from) s
           where s.day <= v_today
           group by s.day
        ) x
    ), '[]'::jsonb),
    -- Пройденные темы по курсам ученика. «Пройдена» — только topic_done_events()
    -- (§152/§162, пара с клиентским topicProgress). Знаменатель — темы,
    -- открытые сейчас (topic_open_now, как журнал ДЗ), плюс уже пройденные,
    -- даже если их потом закрыли: «X из Y» не бывает X > Y и не теряет сделанного.
    'courses', coalesce((
      with st as (
        select s.id from public.students s where s.profile_id = v_uid
      ),
      my_courses as (
        select distinct g.course_id
          from public.group_students gs
          join public.groups g on g.id = gs.group_id
         where gs.student_id in (select id from st) and g.course_id is not null
      ),
      done as materialized (
        select distinct e.topic_id
          from public.topic_done_events() e
         where e.student_id in (select id from st)
      ),
      per_topic as (
        select m.course_id, t.id,
               public.topic_open_now(t.is_open, t.available_from) as open_now,
               (t.id in (select topic_id from done)) as is_done
          from public.topics t
          join public.modules m on m.id = t.module_id
         where m.course_id in (select course_id from my_courses)
      )
      select jsonb_agg(jsonb_build_object(
               'course_id', c.course_id,
               'topics_total', coalesce(p.total, 0),
               'topics_done', coalesce(p.done, 0)) order by c.course_id)
        from my_courses c
        left join (
          select course_id,
                 count(*) filter (where open_now or is_done)::int as total,
                 count(*) filter (where is_done)::int as done
            from per_topic group by course_id
        ) p on p.course_id = c.course_id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.student_home_activity(integer) is
  '§254. Главная ученика: дни заходов за p_days (7..371, по умолчанию 84) по Москве, решённые задачи по дням (student_solved_task_days), серия и рекорд (student_visit_streak), пройденные темы по курсам (topic_done_events). Только свои данные — от auth.uid(), параметра «чей» нет.';

revoke all on function public.student_home_activity(integer) from public, anon;
grant execute on function public.student_home_activity(integer) to authenticated;
