-- §288.1 — «урок открыт ученику» во всех функциях, которые считали открытость
-- по topic_open_now, + Telegram «Открыт урок» + файлы course-materials только
-- открытых уроков. МЕНЯЕТ СУЩЕСТВУЮЩЕЕ — запускает владелец в SQL Editor,
-- целиком, в спокойное время, после §288 A/B (20261012071100/071200).
--
-- Решения владельца (письмо §290, 12.10): ДЗ в курсах 'progress' публикуется
-- сразу (ворота RLS всё равно прячут ДЗ закрытого урока); в обзорах персонала
-- «открыт» для 'progress' = «открыт хотя бы одному ученику курса»;
-- осиротевшие файлы course-materials не трогать.
--
-- Как устроено (без вызова функции на строку — урок 10.10):
--   • progress_open_by_student(курсы, ученики) → jsonb {"ученик:урок": открыт}
--     и progress_open_any(курсы) → jsonb {"урок": открыт хотя бы одному} —
--     только по курсам 'progress', считаются ОДИН раз на запрос (подзапрос
--     без ссылок на строку = initplan);
--   • topic_open_with(флаги, ключ, is_open, дата) — маленькая SQL-функция
--     (встраивается в запрос): есть ключ во флагах — он, иначе прежний
--     topic_open_now. Для курсов 'schedule' (сейчас — все) флагов нет, и
--     результат функций строго прежний по построению.
--   • Тела 17 функций меняются заменой ровно одного вызова topic_open_now; если
--     ожидаемого текста нет (тело на проде изменилось) — ошибка, ничего не
--     меняется.

-- Одна транзакция: любая ошибка (в т.ч. «тело на проде изменилось») откатывает всё.
begin;
set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Флаги открытости по прохождению и общий вызов
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.progress_open_by_student(p_course_ids uuid[], p_student_ids uuid[])
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with pairs as (
    select x.course_id, x.student_id
      from (
        select g.course_id, gs.student_id
          from group_students gs join groups g on g.id = gs.group_id
         where (p_course_ids is null or g.course_id = any (p_course_ids))
           and (p_student_ids is null or gs.student_id = any (p_student_ids))
        union
        select sc.course_id, sc.student_id
          from student_courses sc
         where sc.status in ('active', 'trial') and (sc.expires_at is null or sc.expires_at > now())
           and (p_course_ids is null or sc.course_id = any (p_course_ids))
           and (p_student_ids is null or sc.student_id = any (p_student_ids))
      ) x
     where x.course_id is not null
       and (p_course_ids is not null or p_student_ids is not null)
       and exists (select 1 from course_unlock_modes u where u.course_id = x.course_id and u.mode = 'progress')
  ),
  per_course as (
    select course_id, array_agg(student_id) as students from pairs group by course_id
  )
  select coalesce(jsonb_object_agg(ps.student_id::text || ':' || ps.topic_id::text, ps.open), '{}'::jsonb)
    from per_course pc
    cross join lateral public._progress_state(pc.course_id, pc.students) ps;
$$;

-- Урок курса 'progress' открыт хотя бы одному его ученику (нет учеников — закрыт).
create or replace function public.progress_open_any(p_course_ids uuid[])
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with pc as (
    select c.course_id from unnest(p_course_ids) as c(course_id)
     where exists (select 1 from course_unlock_modes u where u.course_id = c.course_id and u.mode = 'progress')
  ),
  st as (
    select ps.topic_id, bool_or(ps.open) as any_open
      from pc cross join lateral public._progress_state(pc.course_id, public._course_student_ids(pc.course_id)) ps
     group by ps.topic_id
  )
  select coalesce(jsonb_object_agg(t.id::text, coalesce(st.any_open, false)), '{}'::jsonb)
    from pc
    join modules m on m.course_id = pc.course_id
    join topics t on t.module_id = m.id
    left join st on st.topic_id = t.id;
$$;

-- Встраиваемая: без SECURITY DEFINER и SET, один SELECT.
create or replace function public.topic_open_with(p_flags jsonb, p_key text, p_is_open boolean, p_available_from date)
returns boolean
language sql stable
as $$
  select coalesce((p_flags ->> p_key)::boolean, public.topic_open_now(p_is_open, p_available_from));
$$;

revoke all on function public.progress_open_by_student(uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.progress_open_any(uuid[]) from public, anon, authenticated;
grant execute on function public.progress_open_by_student(uuid[], uuid[]) to service_role;
grant execute on function public.progress_open_any(uuid[]) to service_role;
grant execute on function public.topic_open_with(jsonb, text, boolean, date) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Замена вызова в 17 функциях (ровно одна подстрока в каждой)
-- ─────────────────────────────────────────────────────────────────────────

do $patch$
declare
  r     record;
  d     text;
  v_old constant text := 'public.topic_open_now(t.is_open, t.available_from)';
begin
  for r in
    select * from (values
      -- ── один ученик: флаги по нему
      ('public.get_student_topic_journal(uuid, uuid)', v_old,
       'public.topic_open_with((select public.progress_open_by_student(null, array[p_student_id])), p_student_id::text || '':'' || t.id::text, t.is_open, t.available_from)'),
      ('public.student_active_works(uuid)', v_old,
       'public.topic_open_with((select public.progress_open_by_student(null, array[p_student_id])), p_student_id::text || '':'' || t.id::text, t.is_open, t.available_from)'),
      ('public.student_work_rows(uuid)', v_old,
       'public.topic_open_with((select public.progress_open_by_student(null, array[p_student_id])), p_student_id::text || '':'' || t.id::text, t.is_open, t.available_from)'),
      ('public.student_week_plan()', v_old,
       'public.topic_open_with((select public.progress_open_by_student(null, array[v_student])), v_student::text || '':'' || t.id::text, t.is_open, t.available_from)'),
      ('public.student_home_activity(integer)', v_old,
       'public.topic_open_with((select public.progress_open_by_student(null, array(select id from st))), (select id from st limit 1)::text || '':'' || t.id::text, t.is_open, t.available_from)'),
      ('public.my_course_assessments(uuid)', 'public.topic_open_now(w.is_open, w.available_from)',
       'public.topic_open_with((select public.progress_open_by_student(null, array[v_student])), v_student::text || '':'' || w.topic_id::text, w.is_open, w.available_from)'),
      -- ── уведомления: по ученику (напоминания — ещё фильтр ниже, в hw_rows)
      ('public.topic_homework_digest_flush(timestamp with time zone)', v_old,
       'public.topic_open_with((select public.progress_open_by_student(null, array(select s2.id from public.students s2 where s2.profile_id = v_p.profile_id))), d.student_id::text || '':'' || t.id::text, t.is_open, t.available_from)'),
      ('public.student_reminder_candidates(timestamp with time zone, text[])', v_old,
       'public.topic_open_with((select public.progress_open_any(array(select distinct rr.course_id from roster rr))), t.id::text, t.is_open, t.available_from)'),
      ('public.teacher_home_overdue(uuid[])', v_old,
       'public.topic_open_with((select public.progress_open_by_student(array(select sc2.course_id from sc sc2), null)), s.id::text || '':'' || t.id::text, t.is_open, t.available_from)'),
      -- ── обзоры персонала: «открыт хотя бы одному ученику курса»
      ('public.course_homework_grades(uuid)', v_old,
       'public.topic_open_with((select public.progress_open_any(array[p_course_id])), t.id::text, t.is_open, t.available_from)'),
      ('public.course_stats_files_internal(uuid)', v_old,
       'public.topic_open_with((select public.progress_open_any(array[p_course_id])), t.id::text, t.is_open, t.available_from)'),
      ('public.course_stats_students(uuid, text)', v_old,
       'public.topic_open_with((select public.progress_open_any(array[p_course_id])), t.id::text, t.is_open, t.available_from)'),
      ('public.course_stats_summary(uuid, text)', v_old,
       'public.topic_open_with((select public.progress_open_any(array[p_course_id])), t.id::text, t.is_open, t.available_from)'),
      ('public.study_plan_board(uuid)', v_old,
       'public.topic_open_with((select public.progress_open_any(array[p_course_id])), t.id::text, t.is_open, t.available_from)'),
      ('public.teacher_courses_overview(uuid[])', v_old,
       'public.topic_open_with((select public.progress_open_any(array(select id from sc))), t.id::text, t.is_open, t.available_from)'),
      -- ── автопубликация: в 'progress' ДЗ публикуется сразу (решение владельца)
      ('public._topic_homework_autopublish(uuid[], text)', v_old,
       '(public.course_is_progress(m.course_id) or public.topic_open_now(t.is_open, t.available_from))')
    ) as x(fn, old_text, new_text)
  loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if (length(d) - length(replace(d, r.old_text, ''))) / length(r.old_text) <> 1 then
      raise exception '§288.1: в % ожидался ровно один вызов «%» — тело на проде изменилось, сверить вручную', r.fn, r.old_text;
    end if;
    execute replace(d, r.old_text, r.new_text);
  end loop;

  -- Напоминания: ДЗ урока, открытого хотя бы одному, — каждому ученику только
  -- если урок открыт ЕМУ (фильтр в hw_rows; для 'schedule' флагов нет — true).
  d := pg_get_functiondef('public.student_reminder_candidates(timestamp with time zone, text[])'::regprocedure);
  if d !~ 'where hw\.kind = any \(p\.kinds\)(\s+)\),(\s+)timed as \(' then
    raise exception '§288.1: student_reminder_candidates — не найден конец hw_rows, сверить вручную';
  end if;
  execute regexp_replace(d, 'where hw\.kind = any \(p\.kinds\)(\s+)\),(\s+)timed as \(',
    'where hw.kind = any (p.kinds)'
    || ' and public.topic_open_with((select public.progress_open_by_student(array(select distinct rr.course_id from roster rr), null)), r.student_id::text || '':'' || hw.topic_id::text, true, null)'
    || '\1),\2timed as (');
end $patch$;

-- study_plan_freeze_topic_internal (план занятий пишет is_open) не трогаем:
-- план — механизм курсов по датам, в 'progress' is_open не читается.

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Telegram «Открыт урок»: событие → очередь уведомлений
--    Тело — как в 20261012071200 (§288 B), добавлена постановка в
--    notification_queue (канал telegram, только при подключённом боте; галочку
--    «Домашние задания» проверяет process-notification-queue).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public._topic_unlock_events_for(p_student_id uuid, p_topic_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_course uuid;
begin
  select m.course_id into v_course
    from public.topics t join public.modules m on m.id = t.module_id
   where t.id = p_topic_id;
  if v_course is null or p_student_id is null
     or not exists (select 1 from public.course_unlock_modes u
                     where u.course_id = v_course and u.mode = 'progress') then
    return;
  end if;
  begin
    -- Подключён ли бот — до вставки: в одном операторе соседние CTE не видят
    -- строк друг друга, поэтому notified_at ставится сразу при записи события.
    with conn as (
      select exists (select 1 from public.telegram_connections tc
                       join public.students st on st.profile_id = tc.profile_id
                      where st.id = p_student_id and tc.is_enabled
                        and tc.disconnected_at is null and tc.telegram_chat_id is not null) as ok
    ),
    ins as (
      insert into public.topic_unlock_events (student_id, topic_id, reason, notified_at)
      select ps.student_id, ps.topic_id, ps.open_reason, case when conn.ok then now() end
        from public._progress_state(v_course, array[p_student_id]) ps, conn
       where ps.open and ps.open_reason = 'prev_closed'
      on conflict (student_id, topic_id) do nothing
      returning student_id, topic_id, notified_at
    )
    insert into public.notification_queue
      (profile_id, channel, event_type, entity_type, entity_id, deduplication_key, payload, status, attempts, scheduled_for)
    select st.profile_id, 'telegram', 'topic_unlocked', 'topic', ins.topic_id,
           'topic_unlocked:' || ins.student_id || ':' || ins.topic_id,
           jsonb_build_object(
             'course_title', c.title,
             'title', t.title,
             'link', case when g.id is not null then '/my-course/' || g.id || '/topic/' || t.id end),
           'pending', 0, now()
      from ins
      join public.students st on st.id = ins.student_id
      join public.topics t on t.id = ins.topic_id
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
      left join lateral (
        select g2.id from public.groups g2 join public.group_students gs on gs.group_id = g2.id
         where g2.course_id = c.id and gs.student_id = ins.student_id limit 1
      ) g on true
     where ins.notified_at is not null
    on conflict (deduplication_key) do nothing;
  exception when others then
    raise warning '§288 topic_unlock_events: % (%)', sqlerrm, sqlstate;
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Файлы course-materials — только открытых ученику уроков (оба режима)
--    Тело — как в §288 B, условие «урок в наборе ворот» вместо ветки только
--    для 'progress'. Набор student_visible_topics() — тот же, что у политик.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.auth_is_student_of_topic(p_topic_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from topics tp
    join modules m on m.id = tp.module_id
    join groups g  on g.course_id = m.course_id
    join group_students gs on gs.group_id = g.id
    join students s on s.id = gs.student_id
    where tp.id = p_topic_id and s.profile_id = auth.uid()
      and (not exists (select 1 from subscription_tariffs t where t.course_id = g.course_id)
           or public.subscription_access_ok(s.id, g.course_id))
  )
  and p_topic_id = any (public.student_visible_topics());
$$;

commit;
