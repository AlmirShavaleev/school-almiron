-- §233. Главная преподавателя (дизайн v2, шаг 4): «что делать сегодня».
--
-- Только добавляющая: одна новая таблица (журнал напоминаний) и пять новых
-- функций. Существующие таблицы, политики и функции не тронуты. Повторный
-- прогон — без ошибок (проба в supabase/tests/teacher_home_233/run.sh).
--
-- ──────────────────────────────────────────────────────────────────────────
-- Зачем расчёт в базе
-- ──────────────────────────────────────────────────────────────────────────
-- Главная отвечает на четыре вопроса: что ждёт проверки, кто не сдал ДЗ к
-- сроку, кто просел, что ближайшее. Три последних собираются из ростера,
-- попыток, вердиктов, итогов пробников, бланков и фото по ВСЕМ курсам
-- преподавателя — клиентом это десяток запросов с `!inner`-джойнами, где
-- любая политика молча выбросит строки (симптом «нет данных», CLAUDE.md), а
-- «есть ли у ученика Telegram» клиенту не видно вовсе (telegram_connections
-- закрыта: tc_select_own). Поэтому один вызов `teacher_home` — definer,
-- который сам сужает всё до курсов, где вызывающий — персонал
-- (`course_is_staff`, правило проекта, своей копии нет).
--
-- Чего здесь НЕТ намеренно:
--   * ДЗ на проверке — их считает клиент тем же кодом, что очередь проверки
--     (`buildQueueWorks` + `isSubmittedLate`, src/lib/homeworkQueue.ts):
--     «39 работ» на главной и в очереди обязаны совпадать, а правило
--     «просрочено» — одно (сдано позже срока).
--   * Решение «просел / не просел» — его принимает клиент
--     (src/lib/teacherHome.ts, `detectDrop`) по рядам, которые отдаёт база:
--     правило с порогами и подписью живёт в одном месте, с тестами на
--     границы. База отдаёт только последние 8 результатов на ученика.
--
-- Владелец платформы в режиме учителя (роль admin + своя строка teachers):
-- `course_is_staff` отвечает ему «да» на любой курс, поэтому клиент передаёт
-- `p_course_ids` — «свои» курсы из `useMyTeachingScope` (то же сужение, что у
-- очереди проверки). Функция пересекает их с `course_is_staff`: чужой курс
-- в списке ничего не открывает. null — все курсы, где вызывающий персонал
-- (так зовёт настоящий преподаватель: RLS-сужение у него и так по курсам).

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Журнал напоминаний «Не сдали к сроку»
-- ──────────────────────────────────────────────────────────────────────────
-- Пара «ДЗ + ученик» — одна строка на каждое отправленное напоминание.
-- Нужна для защиты от повтора: тому же ученику по тому же ДЗ второй раз за
-- 24 часа не шлём. Проверка в базе, а не на экране: два преподавателя курса
-- или две вкладки не должны разбудить ученика дважды.
--
-- Отдельная таблица, а не поиск по notification_queue: очередь чистится и
-- переписывается воркером (status, attempts), и в ней одна строка на
-- сообщение, а не на пару «ДЗ + ученик» (одно сообщение может напоминать о
-- двух ДЗ).
create table if not exists public.topic_homework_reminders (
  id          uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.topic_homework(id) on delete cascade,
  student_id  uuid not null references public.students(id)       on delete cascade,
  sent_by     uuid references public.profiles(id) on delete set null,
  sent_at     timestamptz not null default now(),
  -- deduplication_key строки notification_queue, с которой ушло сообщение.
  queue_key   text
);

comment on table public.topic_homework_reminders is
  '§233. Напоминания «срок ДЗ прошёл» с главной преподавателя: пара ДЗ + ученик на каждое отправленное. По ней база не пускает повтор той же паре раньше чем через 24 часа. Пишет только remind_overdue_homework; клиенту закрыта целиком (RLS без политик).';

create index if not exists topic_homework_reminders_pair_idx
  on public.topic_homework_reminders (homework_id, student_id, sent_at desc);

alter table public.topic_homework_reminders enable row level security;
-- Политик нет: читать и писать — только definer-функциями ниже.
revoke all on public.topic_homework_reminders from anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Внутренние помощники (execute у клиента отозван)
-- ──────────────────────────────────────────────────────────────────────────

-- Курсы и группы, о которых главная говорит вызывающему.
-- Шаблоны курсов (учеников нет) и выключенные курсы — не говорит.
create or replace function public.teacher_home_scope(p_course_ids uuid[])
returns table (course_id uuid, course_title text, group_id uuid, group_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.title, g.id, g.name
    from public.courses c
    join public.groups g on g.course_id = c.id
   where public.course_is_staff(c.id)
     and (p_course_ids is null or c.id = any (p_course_ids))
     and c.is_template is not true
     and c.is_active is not false;
$$;

-- «Не сдали к сроку»: ученик группы, срок опубликованного и открытого
-- ученику ДЗ прошёл, а сдачи нет. Одна строка — пара «ДЗ + ученик».
--
--   * Срок — ДЕНЬ (topic_homework.due_at — date). «Прошёл» — день срока
--     раньше сегодняшнего по Москве (тот же смысл, что `isOverdue` в
--     src/lib/topicHomework.ts: в день срока ещё можно сдать).
--   * ДЗ без срока сюда не попадает никогда.
--   * «Сдачи нет» — ни одной попытки в состояниях submitted /
--     returned_for_revision / accepted. Черновик — не сдача.
--   * Видно ли ДЗ ученику — `is_published` и `topic_open_now` (правило
--     открытости темы одно, копию не пишем).
--   * Ученик, пришедший в группу в день срока или позже, долгом это ДЗ не
--     считает: срок прошёл до него.
--   * Выключенный ученик (students.is_active = false) — не в списке.
--
-- telegram: 'ok' — подключён и напоминания о просрочке не выключены
-- (notification_prefs.telegram и .overdue — те же галочки, которые смотрит
-- process-notification-queue); 'none' — подключения нет; 'muted' —
-- подключён, но сам выключил Telegram-уведомления или «Просроченное ДЗ».
create or replace function public.teacher_home_overdue(p_course_ids uuid[])
returns table (
  homework_id uuid, topic_id uuid, course_id uuid, course_title text,
  group_id uuid, group_name text, topic_title text, card_title text,
  student_id uuid, profile_id uuid, student_name text, due_date date,
  telegram text, reminded_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  with sc as (select * from public.teacher_home_scope(p_course_ids)),
       today as (select (now() at time zone 'Europe/Moscow')::date as d)
  select th.id, t.id, sc.course_id, sc.course_title,
         sc.group_id, sc.group_name, t.title,
         public.topic_homework_card_title(t.title, th.title),
         s.id, s.profile_id, coalesce(nullif(btrim(p.full_name), ''), 'Ученик'),
         th.due_at,
         case
           when tc.profile_id is null then 'none'
           when coalesce(np.telegram, false) and coalesce(np.overdue, true) then 'ok'
           else 'muted'
         end,
         (select max(r.sent_at)
            from public.topic_homework_reminders r
           where r.homework_id = th.id and r.student_id = s.id
             and r.sent_at > now() - interval '24 hours')
    from sc
    cross join today
    join public.modules m         on m.course_id = sc.course_id
    join public.topics t          on t.module_id = m.id
    join public.topic_homework th on th.topic_id = t.id
    join public.group_students gs on gs.group_id = sc.group_id
    join public.students s        on s.id = gs.student_id
    left join public.profiles p   on p.id = s.profile_id
    left join public.telegram_connections tc
           on tc.profile_id = s.profile_id and tc.is_enabled
          and tc.disconnected_at is null and tc.telegram_chat_id is not null
    left join public.notification_prefs np on np.user_id = s.profile_id
   where th.is_published
     and th.due_at is not null
     and public.topic_open_now(t.is_open, t.available_from)
     and th.due_at < today.d
     and s.is_active is not false
     and (gs.joined_at is null
          or (gs.joined_at at time zone 'Europe/Moscow')::date < th.due_at)
     and not exists (
       select 1 from public.topic_homework_attempts a
        where a.homework_id = th.id and a.student_id = s.id
          and a.status in ('submitted', 'returned_for_revision', 'accepted'));
$$;

revoke all on function public.teacher_home_scope(uuid[])   from public, anon, authenticated;
revoke all on function public.teacher_home_overdue(uuid[]) from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. teacher_home — всё, что главной нужно из базы, одним вызовом
-- ──────────────────────────────────────────────────────────────────────────
-- Возвращает jsonb:
--   today, now          — «сегодня» по Москве и часы базы (экран не верит
--                         часам телефона: «вчера / 2 дня назад» от них);
--   groups              — группы курсов главной (подпись строк ДЗ);
--   mock_pending        — пробники с работами, ждущими проверки: по пробнику
--                         число работ и самая давняя (ученик, момент);
--   overdue             — «Не сдали к сроку» (см. teacher_home_overdue);
--   series              — последние результаты учеников для «Просели»:
--                         hw — до 8 процентов по проверенным ДЗ (балл/максимум
--                         шкалы, как в §217), mocks — до 8 итогов пробников;
--                         только у кого данных на правило хватает (8 ДЗ или
--                         2 пробника);
--   upcoming            — сроки ДЗ и старты пробников на 7 дней вперёд (МСК).
--
-- Пробник «ждёт проверки» — ЗЕРКАЛО `workRow` (src/lib/mockExamV3.ts),
-- состояния waiting и partial (`NEEDS_CHECK`): у шаблона N номеров, баллы
-- стоят не по всем, и есть либо работа (бланк сдан или с ответами, фото),
-- либо хоть один балл; кроме тех, кто пишет прямо сейчас (окно идёт, бланк
-- не сдан) и пробников, которые ещё не начались. Меняется одно — меняется
-- и второе.
create or replace function public.teacher_home(p_course_ids uuid[] default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_out   jsonb;
begin
  with
  sc as (select * from public.teacher_home_scope(p_course_ids)),

  -- ── Пробники, ждущие проверки ─────────────────────────────────────────
  mock_work as (
    select me.id as mock_exam_id, me.title, me.date, sc.group_name, gs.student_id,
           array_length(tpl.max_points, 1) as n,
           (select count(distinct ts.task_number)
              from public.mock_exam_task_scores ts
             where ts.mock_exam_id = me.id and ts.student_id = gs.student_id
               and ts.task_number between 1 and array_length(tpl.max_points, 1)) as scored,
           sh.submitted_at,
           coalesce((select bool_or(btrim(coalesce(a, '')) <> '') from unnest(sh.answers) a), false) as has_answers,
           (select count(*) from public.mock_exam_photos ph
             where ph.mock_exam_id = me.id and ph.student_id = gs.student_id) as photos,
           (select max(ph.created_at) from public.mock_exam_photos ph
             where ph.mock_exam_id = me.id and ph.student_id = gs.student_id) as last_photo,
           me.starts_at,
           me.starts_at + make_interval(mins => me.duration_minutes) as ends_at
      from sc
      join public.mock_exams me          on me.group_id = sc.group_id
      join public.mock_exam_templates tpl on tpl.id = me.template_id
      join public.group_students gs      on gs.group_id = sc.group_id
      join public.students s             on s.id = gs.student_id
      left join public.mock_exam_sheets sh on sh.mock_exam_id = me.id and sh.student_id = gs.student_id
     where (me.starts_at is null or me.starts_at <= now())
       and s.is_active is not false
  ),
  mock_pending_rows as (
    select *, coalesce(submitted_at, last_photo, ends_at, date) as at
      from mock_work
     where n > 0
       and scored < n
       and (scored > 0 or photos > 0 or submitted_at is not null or has_answers)
       and not (starts_at is not null and now() < ends_at and submitted_at is null)
  ),
  mock_pending as (
    select mock_exam_id, title, group_name,
           count(*)::int as works,
           (array_agg(student_id order by at, student_id))[1] as oldest_student_id,
           min(at) as oldest_at
      from mock_pending_rows
     group by mock_exam_id, title, group_name
  ),

  -- ── Ряды для «Просели» ────────────────────────────────────────────────
  -- Проверенная работа ДЗ = последняя попытка с баллом по шкале (пятёрка или
  -- сотня). Процент — балл / максимум шкалы, тот же расчёт, что в отчёте
  -- §217 (student_progress_report) и scorePercent клиента; скобка 0..100 —
  -- оттуда же (в базе лежат баллы выше шкалы). Шкалы нет — работы в ряду нет.
  hw_scored as (
    select sc.course_id, a.student_id, th.id as homework_id,
           coalesce(a.submitted_at, a.created_at) as at,
           round(least(100, greatest(0,
             case th.grade_scale when 'five' then r.score / 5.0 * 100
                                 when 'hundred' then r.score / 100.0 * 100 end))::numeric, 2) as pct,
           row_number() over (partition by a.student_id, th.id order by a.attempt_number desc) as rn
      from sc
      join public.modules m         on m.course_id = sc.course_id
      join public.topics t          on t.module_id = m.id
      join public.topic_homework th on th.topic_id = t.id
      join public.group_students gs on gs.group_id = sc.group_id
      join public.topic_homework_attempts a
        on a.homework_id = th.id and a.student_id = gs.student_id and a.status <> 'draft'
      join lateral (
        select rv.score from public.topic_homework_reviews rv
         where rv.attempt_id = a.id
         order by rv.created_at desc
         limit 1
      ) r on true
     where r.score is not null
       and th.grade_scale in ('five', 'hundred')
  ),
  hw_last as (
    select course_id, student_id, pct, at,
           row_number() over (partition by course_id, student_id order by at desc, homework_id) as k
      from hw_scored where rn = 1
  ),
  hw_series as (
    select course_id, student_id, jsonb_agg(pct order by at, k desc) as hw, count(*) as n
      from hw_last where k <= 8
     group by course_id, student_id
  ),
  mock_last as (
    select sc.course_id, mr.student_id, mr.score,
           -- Тестовый балл: у шаблона есть таблица перевода или пробник
           -- старый, без шаблона (итог туда вносили сразу по 100-балльной).
           case when me.template_id is null or tpl.score_scale is not null then 'test' else 'primary' end as unit,
           coalesce(me.starts_at, me.date) as at,
           row_number() over (partition by sc.course_id, mr.student_id
                              order by coalesce(me.starts_at, me.date) desc, me.id) as k
      from sc
      join public.mock_exams me          on me.group_id = sc.group_id
      join public.group_students gs      on gs.group_id = sc.group_id
      join public.mock_exam_results mr   on mr.mock_exam_id = me.id and mr.student_id = gs.student_id
      left join public.mock_exam_templates tpl on tpl.id = me.template_id
     where mr.score is not null
  ),
  mock_series as (
    select course_id, student_id,
           jsonb_agg(jsonb_build_object('score', score, 'unit', unit) order by at, k desc) as mocks,
           count(*) as n
      from mock_last where k <= 8
     group by course_id, student_id
  ),
  series as (
    select coalesce(h.course_id, ms.course_id) as course_id,
           coalesce(h.student_id, ms.student_id) as student_id,
           coalesce(h.hw, '[]'::jsonb) as hw,
           coalesce(ms.mocks, '[]'::jsonb) as mocks
      from hw_series h
      full join mock_series ms on ms.course_id = h.course_id and ms.student_id = h.student_id
     where coalesce(h.n, 0) >= 8 or coalesce(ms.n, 0) >= 2
  ),

  -- ── Ближайшее: 7 дней вперёд по Москве ────────────────────────────────
  upcoming as (
    select 'homework'::text as kind, th.id, t.id as topic_id, sc.course_id, sc.group_name,
           t.title, th.due_at as day, null::text as time
      from sc
      join public.modules m         on m.course_id = sc.course_id
      join public.topics t          on t.module_id = m.id
      join public.topic_homework th on th.topic_id = t.id
     where th.is_published and th.due_at is not null
       and th.due_at between v_today and v_today + 7
    union all
    select 'mock', me.id, null, sc.course_id, sc.group_name,
           me.title, (me.starts_at at time zone 'Europe/Moscow')::date,
           to_char(me.starts_at at time zone 'Europe/Moscow', 'HH24:MI')
      from sc
      join public.mock_exams me on me.group_id = sc.group_id
     where me.starts_at >= now()
       and (me.starts_at at time zone 'Europe/Moscow')::date <= v_today + 7
  )

  select jsonb_build_object(
    'today', v_today,
    'now', now(),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
                 'course_id', course_id, 'course_title', course_title,
                 'group_id', group_id, 'name', group_name) order by group_name) from sc), '[]'::jsonb),
    'mock_pending', coalesce((select jsonb_agg(jsonb_build_object(
                 'mock_exam_id', mock_exam_id, 'title', title, 'group_name', group_name,
                 'works', works, 'oldest_student_id', oldest_student_id,
                 'oldest_at', oldest_at) order by oldest_at) from mock_pending), '[]'::jsonb),
    'overdue', coalesce((select jsonb_agg(jsonb_build_object(
                 'homework_id', o.homework_id, 'topic_id', o.topic_id, 'course_id', o.course_id,
                 'group_id', o.group_id, 'group_name', o.group_name, 'title', o.topic_title,
                 'student_id', o.student_id, 'student_name', o.student_name,
                 'due_date', o.due_date, 'telegram', o.telegram, 'reminded_at', o.reminded_at)
                 order by o.due_date desc, o.student_name)
               from public.teacher_home_overdue(p_course_ids) o), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object(
                 'student_id', se.student_id,
                 'student_name', coalesce(nullif(btrim(p.full_name), ''), 'Ученик'),
                 'course_id', se.course_id,
                 'group_name', (select string_agg(distinct x.group_name, ' · ') from sc x where x.course_id = se.course_id),
                 'hw', se.hw, 'mocks', se.mocks))
               from series se
               join public.students s on s.id = se.student_id
               left join public.profiles p on p.id = s.profile_id
              where s.is_active is not false), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object(
                 'kind', kind, 'id', id, 'topic_id', topic_id, 'course_id', course_id,
                 'group_name', group_name, 'title', title, 'day', day, 'time', time)
                 order by day, time nulls first, title) from upcoming), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.teacher_home(uuid[]) is
  '§233. Главная преподавателя одним вызовом: пробники на проверке, «Не сдали к сроку», ряды для «Просели», ближайшие сроки и пробники. Только курсы, где вызывающий — персонал (course_is_staff), p_course_ids сужает (владелец в режиме учителя). ДЗ на проверке считает клиент кодом очереди.';

revoke all on function public.teacher_home(uuid[]) from public, anon;
grant execute on function public.teacher_home(uuid[]) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. «Напомнить всем» — одно сообщение в Telegram каждому должнику
-- ──────────────────────────────────────────────────────────────────────────
-- remind_overdue_homework(курсы | null, ученики | null)
--   Должники берутся ЗАНОВО из teacher_home_overdue, а не из того, что
--   прислал экран: напомнить можно только настоящему должнику своего курса.
--   p_student_ids — «те, кого видно на экране»; null — все должники.
--
-- Правила:
--   * ученик из p_student_ids, которого нет ни в одной группе курсов
--     вызывающего, — отказ 42501 целиком (не «тихо пропустить»: это попытка
--     написать чужому ученику);
--   * каждому должнику — ОДНО сообщение со всеми его просроченными ДЗ,
--     которым за последние 24 часа напоминания ещё не было; пары, которым
--     было, — `already`, повторно не уходят;
--   * без Telegram ('none') и с выключенными напоминаниями ('muted') — не
--     шлём и называем поимённо, чтобы экран сказал это честно;
--   * два нажатия подряд / два преподавателя разом идут по очереди (замок на
--     ученика): второе увидит строку первого и не разбудит повторно.
--
-- Колокольчик (notifications) не пишем: карточка — «напомнить в Telegram».
-- Текст собирает process-notification-queue (event_type
-- 'topic_homework_reminder', `_shared/variant-telegram.ts`
-- buildHomeworkReminderTelegramMessage); там же учитывается галочка
-- «Просроченное ДЗ» (notification_prefs.overdue).
--
-- Возвращает { sent, pairs, already, no_telegram: [{student_id, name}],
--              muted: [{student_id, name}], sent_at }.
create or replace function public.remind_overdue_homework(
  p_course_ids  uuid[] default null,
  p_student_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now      timestamptz := now();
  v_me       uuid := auth.uid();
  v_student  record;
  v_items    jsonb;
  v_hw_ids   uuid[];
  v_key      text;
  v_sent     int := 0;
  v_pairs    int := 0;
  v_already  int := 0;
  v_none     jsonb := '[]'::jsonb;
  v_muted    jsonb := '[]'::jsonb;
  v_n        int;
begin
  if v_me is null then
    raise exception 'Нет доступа' using errcode = '42501';
  end if;

  -- Чужой ученик в списке — отказ целиком.
  if p_student_ids is not null and exists (
    select 1 from unnest(p_student_ids) q(sid)
     where not exists (
       select 1 from public.teacher_home_scope(p_course_ids) sc
         join public.group_students gs on gs.group_id = sc.group_id
        where gs.student_id = q.sid)
  ) then
    raise exception 'Нет доступа к ученику' using errcode = '42501';
  end if;

  for v_student in
    select o.student_id, o.profile_id, min(o.student_name) as name, min(o.telegram) as telegram
      from public.teacher_home_overdue(p_course_ids) o
     where p_student_ids is null or o.student_id = any (p_student_ids)
     group by o.student_id, o.profile_id
     order by o.student_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('remind_overdue_homework:' || v_student.student_id::text, 0));

    -- Пары этого ученика без напоминания за 24 часа — перечитываем под
    -- замком, а не из строки цикла.
    select coalesce(jsonb_agg(jsonb_build_object(
             'title', o.card_title, 'course_title', o.course_title,
             'due_date', to_char(o.due_date, 'YYYY-MM-DD'),
             'link', '/my-course/' || o.group_id || '/topic/' || o.topic_id)
             order by o.due_date, o.card_title), '[]'::jsonb),
           array_agg(o.homework_id order by o.due_date, o.card_title)
      into v_items, v_hw_ids
      from public.teacher_home_overdue(p_course_ids) o
     where o.student_id = v_student.student_id
       and not exists (
         select 1 from public.topic_homework_reminders r
          where r.homework_id = o.homework_id and r.student_id = o.student_id
            and r.sent_at > v_now - interval '24 hours');

    select count(*) into v_n
      from public.teacher_home_overdue(p_course_ids) o
     where o.student_id = v_student.student_id;
    v_already := v_already + (v_n - coalesce(array_length(v_hw_ids, 1), 0));

    if coalesce(array_length(v_hw_ids, 1), 0) = 0 then
      continue;
    end if;
    if v_student.telegram = 'none' or v_student.profile_id is null then
      v_none := v_none || jsonb_build_array(jsonb_build_object('student_id', v_student.student_id, 'name', v_student.name));
      continue;
    end if;
    if v_student.telegram <> 'ok' then
      v_muted := v_muted || jsonb_build_array(jsonb_build_object('student_id', v_student.student_id, 'name', v_student.name));
      continue;
    end if;

    v_key := 'topic_homework_reminder:' || v_student.profile_id || ':' || floor(extract(epoch from v_now) * 1000)::bigint;

    insert into public.notification_queue
      (profile_id, channel, event_type, entity_type, entity_id,
       deduplication_key, payload, status, scheduled_for)
    values
      (v_student.profile_id, 'telegram', 'topic_homework_reminder', 'topic_homework', v_hw_ids[1],
       v_key,
       jsonb_build_object('items', v_items, 'link', v_items -> 0 ->> 'link'),
       'pending'::public.notification_queue_status, v_now)
    on conflict (deduplication_key) do nothing;

    insert into public.topic_homework_reminders (homework_id, student_id, sent_by, sent_at, queue_key)
    select h, v_student.student_id, v_me, v_now, v_key from unnest(v_hw_ids) h;

    v_sent  := v_sent + 1;
    v_pairs := v_pairs + array_length(v_hw_ids, 1);
  end loop;

  return jsonb_build_object(
    'sent', v_sent, 'pairs', v_pairs, 'already', v_already,
    'no_telegram', v_none, 'muted', v_muted, 'sent_at', v_now);
end;
$$;

comment on function public.remind_overdue_homework(uuid[], uuid[]) is
  '§233. «Напомнить всем» с главной: одно сообщение в Telegram (event topic_homework_reminder) каждому должнику по его просроченным ДЗ. Должники — заново из teacher_home_overdue (только свои курсы, course_is_staff); чужой ученик в p_student_ids — 42501. Пара ДЗ + ученик не чаще раза в 24 часа (topic_homework_reminders). Без Telegram / с выключенными напоминаниями — не шлёт, возвращает поимённо.';

revoke all on function public.remind_overdue_homework(uuid[], uuid[]) from public, anon;
grant execute on function public.remind_overdue_homework(uuid[], uuid[]) to authenticated;
