-- §288 (часть B) — подключение режима «по прохождению» к воротам ученика.
-- МЕНЯЕТ СУЩЕСТВУЮЩЕЕ (функции ворот §282.2 и прода, триггеры на таблицах
-- автопроверки и проверок ДЗ) — по правилу владельца запускается им в SQL
-- Editor, ПОСЛЕ части A, в спокойное время.
--
-- Для курсов 'schedule' (все нынешние курсы) результат прежний: та же ветка
-- topic_open_now, что в 20261010091021_subscription_sets_282_2.sql и в теле
-- course_student_can_see_topic на проде 11.10. 'progress' берёт набор
-- student_progress_open_topics() из части A — один раз на запрос (initplan),
-- без вызовов на строку.

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Набор видимых уроков ученика (на нём стоят все политики §282.2)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.student_visible_topics()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  with ac as (
    select c.course_id from unnest(public.student_access_courses()) as c(course_id)
  ),
  pc as (
    select ac.course_id from ac where public.course_is_progress(ac.course_id)
  )
  select coalesce(array_agg(x.id), '{}'::uuid[]) from (
    -- по датам — как в §282.2
    select tp.id
      from topics tp
      join modules m on m.id = tp.module_id
     where m.course_id in (select ac.course_id from ac)
       and m.course_id not in (select pc.course_id from pc)
       and public.topic_open_now(tp.is_open, tp.available_from)
    union all
    -- по прохождению — только если такие курсы у ученика есть
    select u.id
      from unnest(case when exists (select 1 from pc) then public.student_progress_open_topics()
                       else '{}'::uuid[] end) as u(id)
  ) x;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Одиночная проверка урока (RPC автопроверки, ДЗ, тестов, storage)
--    Курс не в 'progress' — прежнее тело, одна проба индекса сверху.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.course_student_can_see_topic(p_topic_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from topics t
      join modules m on m.id = t.module_id
     where t.id = p_topic_id
       and public.course_student_has_access(m.course_id)
       and case when public.course_is_progress(m.course_id)
                then p_topic_id = any (public.student_progress_open_topics())
                else public.topic_open_now(t.is_open, t.available_from) end
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Событие «открыт урок по прохождению» — для будущего Telegram
--    После верного/третьего ответа автопроверки и после проверки ДЗ:
--    уроки, открытые причиной prev_closed, пишутся в topic_unlock_events
--    (один раз на пару ученик-урок). Сбой здесь не ломает ответ ученика.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public._topic_unlock_events_for(p_student_id uuid, p_topic_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_course uuid := public.course_of_topic(p_topic_id);
begin
  if v_course is null or p_student_id is null or not public.course_is_progress(v_course) then
    return;
  end if;
  insert into public.topic_unlock_events (student_id, topic_id, reason)
  select ps.student_id, ps.topic_id, ps.open_reason
    from public._progress_state(v_course, array[p_student_id]) ps
   where ps.open and ps.open_reason = 'prev_closed'
  on conflict (student_id, topic_id) do nothing;
exception when others then
  raise warning '§288 topic_unlock_events: % (%)', sqlerrm, sqlstate;
end $$;

create or replace function public._topic_unlock_after_answer()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public._topic_unlock_events_for(
    (select s.id from public.students s where s.profile_id = new.profile_id),
    (select k.topic_id from public.topic_autocheck_tasks k where k.id = new.task_id));
  return null;
end $$;

create or replace function public._topic_unlock_after_review()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public._topic_unlock_events_for(a.student_id, h.topic_id)
     from public.topic_homework_attempts a
     join public.topic_homework h on h.id = a.homework_id
    where a.id = new.attempt_id;
  return null;
end $$;

drop trigger if exists topic_autocheck_answers_unlock on public.topic_autocheck_answers;
create trigger topic_autocheck_answers_unlock
  after insert on public.topic_autocheck_answers
  for each row execute function public._topic_unlock_after_answer();

drop trigger if exists topic_homework_reviews_unlock on public.topic_homework_reviews;
create trigger topic_homework_reviews_unlock
  after insert on public.topic_homework_reviews
  for each row execute function public._topic_unlock_after_review();

do $$
declare
  f text;
begin
  foreach f in array array[
    'public._topic_unlock_events_for(uuid, uuid)',
    'public._topic_unlock_after_answer()',
    'public._topic_unlock_after_review()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
