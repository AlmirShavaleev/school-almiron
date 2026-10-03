-- §264 — Напоминания ученикам в Telegram + сводка класса.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration одной транзакцией, после чего файл
-- переименовывается в <version>_<name>.sql точно по записи в supabase_migrations.schema_migrations
-- (MIGRATIONS.md). Только добавляющая и повторяемая: create table if not exists, add column if not exists,
-- create or replace function, политики и задание pg_cron — через «если ещё нет». Ни одного drop.
--
-- Что здесь:
--   1. course_reminder_settings            — НОВАЯ таблица: какие напоминания включены в курсе (учитель, вкладка
--      курса «Настройки»). Нет строки — значения по умолчанию (всё, кроме «Пробник завтра»). RLS через
--      course_is_staff: читать и писать — только персонал курса; anon — ничего; удаления нет.
--   2. notification_prefs.remind_*          — НОВЫЕ колонки: ученик выключает виды у себя в «Настройках»
--      (по умолчанию всё включено). Политики notification_prefs не меняются: свою строку ученик и так пишет сам.
--   3. student_reminder_candidates(now, kinds) — НОВАЯ definer, только service_role: ФАКТЫ для edge-функции
--      student-reminders (кандидаты по видам + журнал напоминаний за сутки). Кто/когда/лимит/текст решает
--      чистый модуль supabase/functions/_shared/student-reminders.ts (vitest), не SQL.
--   4. course_summary_for_staff(course)    — НОВАЯ definer: «Сводка» класса одним вызовом. Переиспользует
--      внутренние функции §261 (student_forecast_evidence_of, student_work_rows) и §256
--      (student_solve_streak, student_solve_days, student_catalog_week_for_staff) — правил здесь нет, только сбор.
--      Только course_is_staff, иначе 42501; anon — нет execute.
--   5. Задание pg_cron 'student-reminders' — раз в 5 минут зовёт edge-функцию, секрет из vault (как у
--      process-notification-queue и lesson-reminder-scheduler, 20260808193515). Если задание уже есть — не трогаем.

-- ══ 1. Настройки напоминаний курса ══════════════════════════════════════════════════════════════════
create table if not exists public.course_reminder_settings (
  course_id       uuid primary key references public.courses(id) on delete cascade,
  hw_due_tomorrow boolean not null default true,
  hw_overdue      boolean not null default true,
  check_soon      boolean not null default true,
  no_photo        boolean not null default true,
  streak          boolean not null default true,
  mock_tomorrow   boolean not null default false,
  updated_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now()
);

comment on table public.course_reminder_settings is
  '§264. Какие Telegram-напоминания ученикам включены в курсе (вкладка курса «Настройки»). Нет строки — по умолчанию: всё, кроме «Пробник завтра». Читает student_reminder_candidates. Писать — персонал курса (course_is_staff).';

alter table public.course_reminder_settings enable row level security;
revoke all on table public.course_reminder_settings from anon;
revoke all on table public.course_reminder_settings from authenticated;
grant select, insert, update on table public.course_reminder_settings to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'course_reminder_settings'
                   and policyname = 'course_reminder_settings_staff_select') then
    create policy course_reminder_settings_staff_select on public.course_reminder_settings
      for select to authenticated using (public.course_is_staff(course_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'course_reminder_settings'
                   and policyname = 'course_reminder_settings_staff_insert') then
    create policy course_reminder_settings_staff_insert on public.course_reminder_settings
      for insert to authenticated with check (public.course_is_staff(course_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'course_reminder_settings'
                   and policyname = 'course_reminder_settings_staff_update') then
    create policy course_reminder_settings_staff_update on public.course_reminder_settings
      for update to authenticated using (public.course_is_staff(course_id)) with check (public.course_is_staff(course_id));
  end if;
end $$;

-- ══ 2. Выключатели ученика ══════════════════════════════════════════════════════════════════════════
alter table public.notification_prefs
  add column if not exists remind_hw_due_tomorrow boolean not null default true,
  add column if not exists remind_hw_overdue      boolean not null default true,
  add column if not exists remind_check_soon      boolean not null default true,
  add column if not exists remind_no_photo        boolean not null default true,
  add column if not exists remind_streak          boolean not null default true,
  add column if not exists remind_mock_tomorrow   boolean not null default true;

comment on column public.notification_prefs.remind_hw_due_tomorrow is '§264. Напоминание «Срок ДЗ завтра» (ученик может выключить).';
comment on column public.notification_prefs.remind_hw_overdue is '§264. Напоминание «Срок ДЗ прошёл».';
comment on column public.notification_prefs.remind_check_soon is '§264. Напоминание «Скоро проверочная».';
comment on column public.notification_prefs.remind_no_photo is '§264. Напоминание «Нет фото в работе».';
comment on column public.notification_prefs.remind_streak is '§264. Напоминание «Серия прервётся».';
comment on column public.notification_prefs.remind_mock_tomorrow is '§264. Напоминание «Пробник завтра».';

-- ══ 3. Кандидаты напоминаний — факты для edge-функции ════════════════════════════════════════════════
-- Ответ: { now, today, candidates: [...], log: [...] } (jsonb, а не набор строк: у PostgREST потолок строк на
-- ответ, а в 19:00 кандидатов у школы может быть больше).
--
-- Получатели — ученики (students.is_active) с активным подключением Telegram (telegram_connections: включено, не
-- отключено) и общим выключателем notification_prefs.telegram: без Telegram ничего не считаем (серия — дорогая).
-- Правила по видам (момент — в модуле; здесь только отбор по сроку/окну с запасом):
--   hw_due_tomorrow / hw_overdue — опубликованное ДЗ урока (topics.kind = 'lesson'), тема открыта
--     (topic_open_now — единственное правило открытости), срок due_at = завтра / вчера (по Москве);
--     done — есть попытка с submitted_at (первая сдача, правило §259).
--   check_soon — работа по времени (check/control), опубликована; окно ученика — topic_homework_student_window
--     (личное §240, если есть, иначе общее; единственное место правила); начало в (now, now + 1 день];
--     done — есть попытка не-черновик.
--   no_photo — то же окно, конец в (now, now + 1 день], начало уже наступило; has_draft — черновик есть,
--     has_photo — у черновика есть файл (topic_homework_attempt_files, как автосдача §240), opened — отметка
--     «открыл условие» §263 (агент a263): до неё false, «открыл» = есть черновик. СТЫК: когда §263 даст
--     отметку, заменить «false as opened» на её проверку — модуль уже учитывает поле.
--   streak — student_solve_streak(profile, сегодня) (§256, одно определение серии); считается только когда
--     'streak' в p_kinds (окно 18:30–22:00); course_on — вид включён хотя бы в одном курсе ученика.
--   mock_tomorrow — пробник с началом (mock_exams.starts_at) завтра по Москве, ученики его группы; конец —
--     starts_at + duration_minutes (§221).
-- course_on — course_reminder_settings курса (нет строки — по умолчанию), student_on — notification_prefs.remind_*.
-- log — напоминания этих учеников за последние 36 часов (ключ, статус, scheduled_for): дедупликация и лимит в день.
create or replace function public.student_reminder_candidates(p_now timestamptz default now(), p_kinds text[] default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
-- Оценка стоимости у построчной функции окна (topic_homework_student_window, rows 1000 по умолчанию) раздувает
-- план до порога JIT: компиляция стоила ~2 с при выполнении в миллисекунды (локальный замер). JIT здесь не нужен.
set jit = off
as $$
  with params as (
    select (p_now at time zone 'Europe/Moscow')::date as today,
           coalesce(p_kinds, array['hw_due_tomorrow', 'hw_overdue', 'check_soon', 'no_photo', 'streak', 'mock_tomorrow']) as kinds
  ),
  rcpt as materialized (
    select s.id as student_id, s.profile_id,
           np.remind_hw_due_tomorrow, np.remind_hw_overdue, np.remind_check_soon,
           np.remind_no_photo, np.remind_streak, np.remind_mock_tomorrow
      from public.students s
      join public.telegram_connections tc
        on tc.profile_id = s.profile_id and tc.is_enabled and tc.disconnected_at is null
      join public.notification_prefs np on np.user_id = s.profile_id and np.telegram
     where s.is_active
  ),
  roster as materialized (
    select distinct g.id as group_id, g.course_id, r.student_id
      from rcpt r
      join public.group_students gs on gs.student_id = r.student_id
      join public.groups g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where c.is_active
  ),
  settings as (
    select c.course_id,
           coalesce(s.hw_due_tomorrow, true) as hw_due_tomorrow, coalesce(s.hw_overdue, true) as hw_overdue,
           coalesce(s.check_soon, true) as check_soon, coalesce(s.no_photo, true) as no_photo,
           coalesce(s.streak, true) as streak, coalesce(s.mock_tomorrow, false) as mock_tomorrow
      from (select distinct course_id from roster) c
      left join public.course_reminder_settings s on s.course_id = c.course_id
  ),
  -- ДЗ уроков со сроком завтра / вчера.
  hw as (
    select h.id as homework_id, h.topic_id, m.course_id, h.due_at,
           coalesce(nullif(btrim(t.title), ''), h.title) as title,
           case when h.due_at = p.today + 1 then 'hw_due_tomorrow' else 'hw_overdue' end as kind
      from params p
      join public.topic_homework h on h.due_at in (p.today + 1, p.today - 1)
      join public.topics t on t.id = h.topic_id
      join public.modules m on m.id = t.module_id
     where h.is_published and t.kind = 'lesson'
       and public.topic_open_now(t.is_open, t.available_from)
       and m.course_id in (select course_id from roster)
  ),
  hw_rows as (
    select hw.kind, hw.homework_id::text || ':' || hw.due_at::text as event_key,
           r.student_id, r.course_id, r.group_id, hw.homework_id as entity_id, hw.title,
           null::text as work_kind, null::timestamptz as opens_at, null::timestamptz as closes_at, hw.due_at as due_date,
           '/my-course/' || r.group_id || '/topic/' || hw.topic_id as link,
           exists (select 1 from public.topic_homework_attempts a
                    where a.homework_id = hw.homework_id and a.student_id = r.student_id
                      and a.submitted_at is not null) as done,
           false as has_draft, false as has_photo, false as opened, 0 as streak, false as solved_today
      from hw
      join roster r on r.course_id = hw.course_id
      cross join params p
     where hw.kind = any (p.kinds)
  ),
  -- Работы по времени, у которых общее или чьё-то личное окно касается ближайших суток.
  timed as (
    select h.id as homework_id, h.topic_id, m.course_id, t.kind as work_kind,
           coalesce(nullif(btrim(t.title), ''), h.title) as title
      from public.topic_homework h
      join public.topics t on t.id = h.topic_id
      join public.modules m on m.id = t.module_id
     where h.is_published and t.kind in ('check', 'control')
       and m.course_id in (select course_id from roster)
       and (
         (h.opens_at <= p_now + interval '1 day' and h.closes_at > p_now)
         or exists (select 1 from public.topic_homework_personal_windows pw
                     where pw.homework_id = h.id
                       and pw.opens_at <= p_now + interval '1 day' and pw.closes_at > p_now)
       )
  ),
  tw as materialized (
    select ti.*, r.student_id, r.group_id, w.opens_at, w.closes_at,
           exists (select 1 from public.topic_homework_attempts a
                    where a.homework_id = ti.homework_id and a.student_id = r.student_id
                      and a.status <> 'draft') as done,
           exists (select 1 from public.topic_homework_attempts a
                    where a.homework_id = ti.homework_id and a.student_id = r.student_id
                      and a.status = 'draft') as has_draft,
           exists (select 1 from public.topic_homework_attempts a
                     join public.topic_homework_attempt_files f on f.attempt_id = a.id
                    where a.homework_id = ti.homework_id and a.student_id = r.student_id
                      and a.status = 'draft') as has_photo
      from timed ti
      join roster r on r.course_id = ti.course_id
      cross join lateral public.topic_homework_student_window(ti.homework_id, r.student_id) w
     where w.opens_at is not null
  ),
  timed_rows as (
    select k.kind,
           tw.homework_id::text || ':' || floor(extract(epoch from case when k.kind = 'check_soon' then tw.opens_at else tw.closes_at end))::bigint::text as event_key,
           tw.student_id, tw.course_id, tw.group_id, tw.homework_id as entity_id, tw.title,
           tw.work_kind, tw.opens_at, tw.closes_at, null::date as due_date,
           '/my-course/' || tw.group_id || '/topic/' || tw.topic_id as link,
           tw.done, tw.has_draft, tw.has_photo,
           false as opened,  -- СТЫК §263: отметка «открыл условие» (a263)
           0 as streak, false as solved_today
      from tw
      cross join params p
      cross join (values ('check_soon'), ('no_photo')) as k(kind)
     where k.kind = any (p.kinds)
       and case when k.kind = 'check_soon'
                then tw.opens_at > p_now and tw.opens_at <= p_now + interval '1 day'
                else tw.opens_at <= p_now + interval '1 day' and tw.closes_at > p_now
                     and tw.closes_at <= p_now + interval '1 day'
           end
  ),
  -- Серия: только когда окно серии открыто.
  streak_rows as (
    select 'streak'::text as kind, p.today::text as event_key,
           r.student_id, null::uuid as course_id, null::uuid as group_id, null::uuid as entity_id,
           ''::text as title, null::text as work_kind, null::timestamptz as opens_at, null::timestamptz as closes_at,
           null::date as due_date, '/student'::text as link,
           false as done, false as has_draft, false as has_photo, false as opened,
           x.streak, x.solved_today
      from params p
      join rcpt r on 'streak' = any (p.kinds)
      cross join lateral public.student_solve_streak(r.profile_id, p.today) x
     where x.streak > 0
       and exists (select 1 from roster ro where ro.student_id = r.student_id)
  ),
  mock as (
    select me.id as exam_id, me.title, me.group_id, g.course_id, me.starts_at,
           me.starts_at + make_interval(mins => me.duration_minutes) as ends_at
      from params p
      join public.mock_exams me on 'mock_tomorrow' = any (p.kinds)
      join public.groups g on g.id = me.group_id
     where me.starts_at is not null
       and (me.starts_at at time zone 'Europe/Moscow')::date = p.today + 1
  ),
  mock_rows as (
    select 'mock_tomorrow'::text as kind,
           mk.exam_id::text || ':' || floor(extract(epoch from mk.starts_at))::bigint::text as event_key,
           r.student_id, mk.course_id, mk.group_id, mk.exam_id as entity_id,
           coalesce(nullif(btrim(mk.title), ''), 'Пробник') as title,
           null::text as work_kind, mk.starts_at as opens_at, mk.ends_at as closes_at, null::date as due_date,
           '/my-course/' || mk.group_id || '?mock=' || mk.exam_id as link,
           false as done, false as has_draft, false as has_photo, false as opened, 0 as streak, false as solved_today
      from mock mk
      join roster r on r.group_id = mk.group_id
  ),
  allrows as (
    select * from hw_rows
    union all select * from timed_rows
    union all select * from streak_rows
    union all select * from mock_rows
  ),
  cand as (
    select a.*, rc.profile_id,
           case a.kind
             when 'streak' then coalesce((select bool_or(st.streak) from roster ro join settings st on st.course_id = ro.course_id
                                           where ro.student_id = a.student_id), false)
             else coalesce((select case a.kind
                                     when 'hw_due_tomorrow' then st.hw_due_tomorrow
                                     when 'hw_overdue'      then st.hw_overdue
                                     when 'check_soon'      then st.check_soon
                                     when 'no_photo'        then st.no_photo
                                     when 'mock_tomorrow'   then st.mock_tomorrow
                                   end
                              from settings st where st.course_id = a.course_id), false)
           end as course_on,
           case a.kind
             when 'hw_due_tomorrow' then rc.remind_hw_due_tomorrow
             when 'hw_overdue'      then rc.remind_hw_overdue
             when 'check_soon'      then rc.remind_check_soon
             when 'no_photo'        then rc.remind_no_photo
             when 'streak'          then rc.remind_streak
             when 'mock_tomorrow'   then rc.remind_mock_tomorrow
           end as student_on
      from allrows a
      join rcpt rc on rc.student_id = a.student_id
  )
  select jsonb_build_object(
    'now', p_now,
    'today', (select today from params),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', c.kind, 'event_key', c.event_key, 'profile_id', c.profile_id, 'student_id', c.student_id,
               'course_id', c.course_id, 'group_id', c.group_id, 'entity_id', c.entity_id, 'title', c.title,
               'work_kind', c.work_kind, 'opens_at', c.opens_at, 'closes_at', c.closes_at, 'due_date', c.due_date,
               'link', c.link, 'done', c.done, 'has_draft', c.has_draft, 'has_photo', c.has_photo, 'opened', c.opened,
               'streak', c.streak, 'solved_today', c.solved_today, 'telegram', true,
               'course_on', c.course_on, 'student_on', c.student_on)
             order by c.profile_id, c.kind, c.event_key)
        from cand c), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', q.profile_id, 'key', q.deduplication_key,
                                          'status', q.status, 'scheduled_for', q.scheduled_for)
             order by q.profile_id, q.scheduled_for)
        from public.notification_queue q
       where q.event_type = 'student_reminder'
         and q.scheduled_for >= p_now - interval '36 hours'
         and q.profile_id in (select profile_id from cand)), '[]'::jsonb)
  );
$$;

comment on function public.student_reminder_candidates(timestamptz, text[]) is
  '§264. Факты для Telegram-напоминаний учеников (edge-функция student-reminders, крон раз в 5 минут): кандидаты по видам (срок ДЗ завтра/вчера — правило «сдано» §259; работа по времени — окно ученика §240, черновик и фото; серия §256; пробник завтра), включено ли в курсе и у ученика, и журнал напоминаний за 36 часов. Кому/когда/лимит/текст решает supabase/functions/_shared/student-reminders.ts. Только service_role.';

revoke all on function public.student_reminder_candidates(timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.student_reminder_candidates(timestamptz, text[]) to service_role;

-- ══ 4. Сводка класса ═══════════════════════════════════════════════════════════════════════════════
-- Ученики групп курса (с профилем), по каждому:
--   forecast  — свидетельства прогноза на сейчас: student_forecast_evidence_of(profile, now()) (§261, то же, что у
--               ученика на главной), только по предмету курса и только у ЕГЭ по математике/физике; без названий
--               номеров и правил каталога (названия — один раз в ответе); свидетельства — компактными массивами
--               (ev), зоны номеров — n/zone/share. Модель — клиент (egeForecast.ts): прогноз, «за 30 дн.» и
--               сравнение с моментом 7 дней назад.
--   assessments / homeworks — student_work_rows(student) (§261: первая сдача §259, вердикт и баллы учителя) по
--               ЭТОМУ курсу; «ДЗ вовремя k/n» — клиент той же homeworkDeadline (§259), что карточка ученика.
--   catalog   — student_catalog_week_for_staff (§256): задач за 7 дней, верно.
--   streak / solved_today — student_solve_streak (§256); last_solved — последний день с решением (student_solve_days).
--   last_seen — последний день на сайте: заход (app_visits), сдача ДЗ, проверка ответа в каталоге, тест темы —
--               тот же набор, что «Кто пропал» (school_dormant_students), плюс каталог.
-- Только персонал курса (course_is_staff, включая админа платформы) — иначе 42501.
create or replace function public.course_summary_for_staff(p_course_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
set jit = off
as $$
declare
  v_course record;
  v_today  date := (now() at time zone 'Europe/Moscow')::date;
  v_ege    boolean;
begin
  if auth.uid() is null then
    raise exception 'course_summary_for_staff: нужен вход' using errcode = '42501';
  end if;
  if p_course_id is null then
    raise exception 'course_summary_for_staff: нужен курс' using errcode = '22023';
  end if;
  if not public.course_is_staff(p_course_id) then
    raise exception 'ACCESS_DENIED: только персонал курса' using errcode = '42501';
  end if;

  select c.id, c.title, c.subject::text as subject, c.exam_type::text as exam_type
    into v_course
    from public.courses c where c.id = p_course_id;
  if not found then
    raise exception 'Курс не найден' using errcode = 'P0002';
  end if;
  v_ege := v_course.exam_type = 'ege' and v_course.subject in ('math', 'physics');

  return (
    with roster as materialized (
      select distinct on (s.id) s.id as student_id, s.profile_id,
             coalesce(nullif(btrim(p.full_name), ''), 'Ученик') as name
        from public.groups g
        join public.group_students gs on gs.group_id = g.id
        join public.students s on s.id = gs.student_id
        join public.profiles p on p.id = s.profile_id
       where g.course_id = p_course_id
       order by s.id
    ),
    per as materialized (
      select r.student_id, r.profile_id, r.name,
             case when v_ege then public.student_forecast_evidence_of(r.profile_id, now()) end as fc,
             public.student_catalog_week_for_staff(r.student_id) as cat,
             st.streak, st.solved_today,
             (select max(d.day) from public.student_solve_days(r.profile_id) d where d.day <= v_today) as last_solved,
             greatest(
               (select max(v.visited_on) from public.app_visits v where v.profile_id = r.profile_id),
               (select max((a.submitted_at at time zone 'Europe/Moscow')::date) from public.topic_homework_attempts a
                 where a.student_id = r.student_id),
               (select max((ca.created_at at time zone 'Europe/Moscow')::date) from public.catalog_task_attempts ca
                 where ca.profile_id = r.profile_id),
               (select max((coalesce(ta.completed_at, ta.started_at) at time zone 'Europe/Moscow')::date)
                  from public.topic_test_attempts ta where ta.student_id = r.student_id)
             ) as last_seen
        from roster r
        cross join lateral public.student_solve_streak(r.profile_id, v_today) st
    ),
    works as materialized (
      select r.student_id, w.*
        from roster r
        cross join lateral public.student_work_rows(r.student_id) w
       where w.course_id = p_course_id
    )
    select jsonb_build_object(
      'course', jsonb_build_object('id', v_course.id, 'title', v_course.title,
                                   'subject', v_course.subject, 'exam_type', v_course.exam_type),
      'now', now(),
      'today', v_today,
      'forecast_enabled', v_ege,
      'titles', case when v_ege then coalesce((
        select jsonb_agg(x) from per, jsonb_array_elements(per.fc->'titles') x
         where per.student_id = (select min(student_id::text)::uuid from per where fc is not null)
           and x->>'subject' = v_course.subject), '[]'::jsonb) else '[]'::jsonb end,
      'students', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'student_id', p.student_id,
                 'name', p.name,
                 'forecast', case when p.fc is null then null else jsonb_build_object(
                   'now', p.fc->'now',
                   'subjects', coalesce((select jsonb_agg(x) from jsonb_array_elements(p.fc->'subjects') x
                                          where x->>'subject' = v_course.subject), '[]'::jsonb),
                   'numbers', coalesce((select jsonb_agg(jsonb_build_object('n', x->'n', 'zone', x->'zone', 'share', x->'share'))
                                          from jsonb_array_elements(p.fc->'numbers') x
                                         where x->>'subject' = v_course.subject), '[]'::jsonb),
                   -- Компактно: [номера, источник, доля верного, когда, заданий в КИМ пробника] — на классе из 25
                   -- активных учеников объекты со всеми ключами весили бы мегабайты; модели хватает этих полей.
                   'ev', coalesce((select jsonb_agg(jsonb_build_array(x->'ns', x->'source', x->'score', x->'at', x->'kim_total'))
                                     from jsonb_array_elements(p.fc->'evidence') x
                                    where x->>'subject' = v_course.subject), '[]'::jsonb)) end,
                 'assessments', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'title', w.title, 'subject', w.subject, 'exam_type', w.exam_type, 'kind', w.kind,
                            'date', w.work_date, 'status', w.status, 'score', w.score, 'grade_scale', w.grade_scale,
                            'points', w.points, 'points_max', w.points_max)
                          order by w.work_date desc nulls last, w.title)
                     from works w where w.student_id = p.student_id and w.grp = 'assessment'), '[]'::jsonb),
                 'homeworks', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'title', w.title, 'subject', w.subject, 'exam_type', w.exam_type,
                            'due_at', w.due_at, 'first_submitted_at', w.first_submitted_at,
                            'status', w.status, 'score', w.score, 'grade_scale', w.grade_scale)
                          order by w.due_at desc nulls last, w.title)
                     from works w where w.student_id = p.student_id and w.grp = 'homework'), '[]'::jsonb),
                 'catalog', p.cat,
                 'streak', coalesce(p.streak, 0),
                 'solved_today', coalesce(p.solved_today, false),
                 'last_solved', p.last_solved,
                 'last_seen', p.last_seen)
               order by p.name, p.student_id)
          from per p), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.course_summary_for_staff(uuid) is
  '§264. «Сводка» класса одним вызовом: по каждому ученику групп курса — свидетельства прогноза (student_forecast_evidence_of, §261; модель — клиент), проверочные и ДЗ курса (student_work_rows, §261), каталог за 7 дней (student_catalog_week_for_staff), серия и последний день с решением (§256), последний день на сайте. Только персонал курса (course_is_staff), иначе 42501.';

revoke all on function public.course_summary_for_staff(uuid) from public, anon;
grant execute on function public.course_summary_for_staff(uuid) to authenticated;

-- ══ 5. Задание pg_cron ══════════════════════════════════════════════════════════════════════════════
-- Как 20260808193515_cron_jobs_snapshot: секрет — из vault по имени 'cron_secret' (в тексте команды его нет),
-- URL — домен проекта. Уже есть задание с таким именем — не трогаем (повторный прогон ничего не меняет).
-- Расписание */5 — как у очереди: напоминание на ближайшие 5 минут ставится со scheduled_for = момент
-- (LOOKAHEAD_MS в модуле), и очередь отправляет его в свой первый такт после момента.
do $mig$
begin
  if to_regclass('cron.job') is not null
     and not exists (select 1 from cron.job where jobname = 'student-reminders') then
    perform cron.schedule(
      'student-reminders',
      '*/5 * * * *',
      $cron$
    SELECT net.http_post(
      url     := 'https://kthfozyfruorwjhvvsbw.supabase.co/functions/v1/student-reminders',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
      ),
      body    := '{}'::jsonb
    );
  $cron$
    );
  end if;
end
$mig$;
