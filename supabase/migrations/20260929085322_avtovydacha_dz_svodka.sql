-- §243. «Тема открыта = ДЗ выдано» и одна сводка ученику вместо поштучных
-- сообщений о новом ДЗ.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration ОДНОЙ
-- транзакцией, после чего файл переименовывается в <version>_<name>.sql
-- точно по записи в supabase_migrations.schema_migrations (MIGRATIONS.md).
-- Повторное применение безопасно: if not exists / create or replace /
-- drop trigger if exists; разовая выдача старых ДЗ второй раз находит ноль
-- (supabase/tests/avtovydacha_243/run.sh гоняет файл дважды).
--
-- Только добавление: два столбца, одна таблица, функции, триггеры, задание
-- pg_cron. Существующие функции и политики не меняются.
--
-- ── Решения владельца (29.09) ──────────────────────────────────────────────
--  * Правило одно: тема открыта для учеников (topic_open_now) ⇒ её ДЗ выдано.
--    Кнопки «Опубликовать» больше нет; скрыть ДЗ в открытой теме нельзя.
--  * ДЗ без файлов не выдаётся (как не пускала кнопка). Исключение — работа
--    по времени (kind check/control): её условие часто лежит рубрикой, и
--    кнопка §240 публиковала её без файла.
--  * Уже открытые темы с неопубликованным ДЗ выдаются МОЛЧА (published_via =
--    'backfill', в сводку не попадают).
--  * Сообщения — одна сводка на ученика по всем курсам: через 30 мин после
--    последнего выданного ему ДЗ (каждое новое сдвигает), не позже 2 ч после
--    первого; с 22:00 до 08:00 МСК не шлём. Плюс одна запись в колокольчике.
--  * Не пишем: сдавшим это ДЗ, пришедшим в курс после выдачи, второй раз про
--    то же ДЗ (навсегда), по работам по времени, выключившим галочку «ДЗ»
--    (галочку смотрит воркер).
--
-- ── Механизм и почему он такой ────────────────────────────────────────────
-- `is_published` остаётся хранимым флагом, но ставит его сервер, а не
-- учитель. Флаг читают политика topic_homework_student_select, «Долги»,
-- статистика §242, главная §233, раздел §241 и клиент — вычисляемое правило
-- вместо флага потребовало бы переписать их все сразу, а флаг, который
-- ставит сервер ровно по правилу, оставляет их нетронутыми. Кроме того,
-- «выдано» должно быть СОБЫТИЕМ с моментом (published_at): от него зависят
-- «одно сообщение навсегда» и «кого добавили позже».
--
-- Выдача (одна функция _topic_homework_autopublish, все пути через неё):
--   'topic'    — у темы сменились is_open / available_from / kind (тумблер,
--                «Открыть до сюда», дата в прошлом, урок стал КР);
--   'schedule' — pg_cron раз в 5 минут: наступила дата available_from
--                (current_date базы), заодно подбирает всё пропущенное;
--   'content'  — у ДЗ появился первый файл, либо ДЗ создано в уже открытой
--                теме (для работ по времени — сразу);
--   'backfill' — разовая выдача в этой миграции, без сводки.
-- Закрытие темы флаг не снимает: видимость и так режет
-- course_student_can_see_topic, а «закрыл-открыл» не должно слать второе
-- сообщение. Каркас (courses.is_template) не выдаётся: учеников там нет, а
-- каждая запись в ДЗ каркаса запускает синхронизацию классов.
--
-- Клиент флаг не пишет: триггер-сторож (для ролей authenticated/anon)
-- держит is_published / published_at / published_via серверными; попытка
-- снять выдачу — ошибка с объяснением, попытка выдать руками — тихо
-- игнорируется (старый интерфейс до деплоя фронта не ломается).
--
-- Сводка: таблица topic_homework_digest (профиль ученика × ДЗ, первичный
-- ключ — «один раз навсегда»). Наполняется при выдаче (кроме бэкфилла и работ
-- по времени) теми, кто в этот момент в группе курса и не сдал. Задание
-- pg_cron раз в 5 минут отправляет тем профилям, у кого пора, и перед
-- отправкой выбрасывает сдавших, ушедших из курса, снова закрытые темы и
-- тех, кому учитель успел отправить ручное «Напомнить».

-- ── 1. Столбцы ДЗ ──────────────────────────────────────────────────────────
alter table public.topic_homework
  add column if not exists published_at  timestamptz,
  add column if not exists published_via text;

alter table public.topic_homework drop constraint if exists topic_homework_published_via_check;
alter table public.topic_homework add constraint topic_homework_published_via_check
  check (published_via is null or published_via = any (array['topic', 'schedule', 'content', 'backfill']::text[]));

comment on column public.topic_homework.is_published is
  '§243: ДЗ выдано ученикам. Ставит сервер (тема открыта и есть файл задания либо это работа по времени), клиент не пишет — сторож topic_homework_publish_guard. Закрытие темы флаг не снимает.';
comment on column public.topic_homework.published_at is
  '§243: момент выдачи. NULL у выданного — выдано до §243 кнопкой «Опубликовать».';
comment on column public.topic_homework.published_via is
  '§243: как выдано — topic (сменились открытость/дата/тип темы), schedule (крон: наступила дата), content (первый файл / ДЗ создано в открытой теме), backfill (разовая выдача при миграции, без сводки).';

-- ── 2. Сводка: кто и о каком ДЗ ещё не получил сообщения ──────────────────
create table if not exists public.topic_homework_digest (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  homework_id uuid not null references public.topic_homework(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  queued_at   timestamptz not null default now(),
  sent_at     timestamptz,
  dropped_at  timestamptz,
  drop_reason text,
  queue_key   text,
  primary key (profile_id, homework_id)
);

create index if not exists topic_homework_digest_pending_idx
  on public.topic_homework_digest (profile_id, queued_at)
  where sent_at is null and dropped_at is null;
create index if not exists topic_homework_digest_homework_idx
  on public.topic_homework_digest (homework_id)
  where sent_at is null and dropped_at is null;

comment on table public.topic_homework_digest is
  '§243: сводка «новые ДЗ» — строка на пару (профиль ученика, ДЗ). Первичный ключ = одно сообщение о ДЗ навсегда. sent_at — ушло в сводке (queue_key — ключ строки очереди и колокольчика), dropped_at/drop_reason — выброшено перед отправкой (submitted, left, closed, unpublished, timed, manual). Пишут только definer-функции §243; клиенту закрыта целиком.';

alter table public.topic_homework_digest enable row level security;
revoke all on table public.topic_homework_digest from anon, authenticated;

-- ── 3. Когда уйдёт сводка ──────────────────────────────────────────────────
-- 30 минут после последнего выданного, но не позже 2 часов после первого;
-- попало на 22:00–08:00 МСК — в 08:00 ближайшего утра.
create or replace function public.topic_homework_digest_due_at(p_first timestamptz, p_last timestamptz)
returns timestamptz
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  with d as (
    select least(p_last + interval '30 minutes', p_first + interval '2 hours') as t
  ), l as (
    select t, (t at time zone 'Europe/Moscow') as loc from d
  )
  select case
    when l.loc::time >= time '22:00' then ((l.loc::date + 1) + time '08:00') at time zone 'Europe/Moscow'
    when l.loc::time <  time '08:00' then (l.loc::date + time '08:00') at time zone 'Europe/Moscow'
    else l.t
  end
  from l;
$$;

-- «3 октября» (год — только если не текущий по Москве): для колокольчика.
-- Telegram-карточку собирает воркер своим formatDay.
create or replace function public._topic_homework_ru_day(p_day date, p_now timestamptz)
returns text
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select extract(day from p_day)::int || ' ' ||
         (array['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
                'августа', 'сентября', 'октября', 'ноября', 'декабря'])[extract(month from p_day)::int] ||
         case when extract(year from p_day) <> extract(year from (p_now at time zone 'Europe/Moscow'))
              then ' ' || extract(year from p_day)::int else '' end;
$$;

-- ── 4. Кому писать о выданном ──────────────────────────────────────────────
-- Ученики групп курса НА МОМЕНТ ВЫДАЧИ (кто придёт позже, по этому ДЗ ничего
-- не получит — только приветствие курса), активные, с профилем, ещё не
-- сдавшие. Работы по времени — никогда. Повтор пары молча отбрасывается.
create or replace function public._topic_homework_digest_enqueue(p_homework_ids uuid[], p_at timestamptz)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  insert into topic_homework_digest (profile_id, homework_id, student_id, queued_at)
  select distinct on (s.profile_id, h.id) s.profile_id, h.id, s.id, p_at
    from topic_homework h
    join topics t          on t.id = h.topic_id
    join modules m         on m.id = t.module_id
    join groups g          on g.course_id = m.course_id
    join group_students gs on gs.group_id = g.id
    join students s        on s.id = gs.student_id
   where h.id = any (p_homework_ids)
     and h.is_published
     and t.kind not in ('check', 'control')
     and s.profile_id is not null
     and s.is_active is not false
     and not exists (
       select 1 from topic_homework_attempts a
        where a.homework_id = h.id and a.student_id = s.id and a.status <> 'draft')
   order by s.profile_id, h.id, s.id
  on conflict (profile_id, homework_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── 5. Выдача — единственное место, где ставится is_published ─────────────
-- p_homework_ids = null — все кандидаты (крон и бэкфилл). Возвращает число
-- выданных. Сбой постановки в сводку выдачу не отменяет: причина уходит в
-- notification_dispatch_errors, как у остальных рассылок.
create or replace function public._topic_homework_autopublish(p_homework_ids uuid[], p_via text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now   timestamptz := now();
  v_n     integer;
  v_ids   uuid[];
begin
  with pub as (
    update topic_homework h
       set is_published = true, published_at = v_now, published_via = p_via
      from topics t
      join modules m on m.id = t.module_id
      join courses c on c.id = m.course_id
     where h.topic_id = t.id
       and (p_homework_ids is null or h.id = any (p_homework_ids))
       and not h.is_published
       and not coalesce(c.is_template, false)
       and public.topic_open_now(t.is_open, t.available_from)
       and (t.kind in ('check', 'control')
            or exists (select 1 from topic_homework_files f where f.homework_id = h.id))
    returning h.id, t.kind
  )
  select count(*)::int,
         coalesce(array_agg(id) filter (where kind not in ('check', 'control')), '{}'::uuid[])
    into v_n, v_ids
    from pub;

  if p_via <> 'backfill' and cardinality(v_ids) > 0 then
    begin
      perform public._topic_homework_digest_enqueue(v_ids, v_now);
    exception when others then
      insert into notification_dispatch_errors (source, entity_id, sqlstate, message)
      values ('topic_homework_digest_enqueue', v_ids[1], sqlstate, sqlerrm);
    end;
  end if;

  return v_n;
end $$;

-- ── 6. Сторож: флаг выдачи пишет только сервер ─────────────────────────────
-- НЕ definer: смотрит, кто пишет. Клиент (authenticated/anon) флаг не
-- меняет; definer-функции проекта (копирование, синхронизация, выдача)
-- работают от владельца и проходят как раньше.
create or replace function public.topic_homework_publish_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.is_published  := false;
    new.published_at  := null;
    new.published_via := null;
    return new;
  end if;
  if old.is_published and not new.is_published then
    raise exception 'Скрыть выданное ДЗ нельзя: ДЗ выдано, пока тема открыта. Закройте тему или удалите ДЗ.'
      using errcode = 'check_violation';
  end if;
  new.is_published  := old.is_published;
  new.published_at  := old.published_at;
  new.published_via := old.published_via;
  return new;
end $$;

drop trigger if exists topic_homework_publish_guard on public.topic_homework;
create trigger topic_homework_publish_guard
  before insert or update on public.topic_homework
  for each row execute function public.topic_homework_publish_guard();

-- ── 7. Разовая выдача уже открытых тем — МОЛЧА ─────────────────────────────
-- До триггеров выдачи и задания крона: сводка эти ДЗ не подберёт
-- (published_via = 'backfill', в topic_homework_digest строк не будет).
do $$
declare
  v_n integer;
begin
  v_n := public._topic_homework_autopublish(null, 'backfill');
  raise notice '§243 backfill: выдано ДЗ без сообщений — %', v_n;
end $$;

-- ── 8. Триггеры выдачи ─────────────────────────────────────────────────────
-- Definer: зовут закрытую от клиента _topic_homework_autopublish. Сбой выдачи
-- не должен ломать тумблер темы или загрузку файла — крон подберёт через
-- 5 минут, причина — в notification_dispatch_errors.
create or replace function public.trg_topic_homework_autopublish_topic()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public._topic_homework_autopublish(
      array(select h.id from topic_homework h where h.topic_id = new.id), 'topic');
  exception when others then
    insert into notification_dispatch_errors (source, entity_id, sqlstate, message)
    values ('topic_homework_autopublish_topic', new.id, sqlstate, sqlerrm);
  end;
  return null;
end $$;

drop trigger if exists topic_homework_autopublish_topic on public.topics;
create trigger topic_homework_autopublish_topic
  after update of is_open, available_from, kind on public.topics
  for each row
  when (new.is_open is distinct from old.is_open
        or new.available_from is distinct from old.available_from
        or new.kind is distinct from old.kind)
  execute function public.trg_topic_homework_autopublish_topic();

create or replace function public.trg_topic_homework_autopublish_content()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hw uuid;
begin
  -- Ветками, а не CASE: у строки topic_homework нет поля homework_id, и
  -- выражение с ним не собралось бы.
  if tg_table_name = 'topic_homework_files' then
    v_hw := new.homework_id;
  else
    v_hw := new.id;
  end if;
  begin
    perform public._topic_homework_autopublish(array[v_hw], 'content');
  exception when others then
    insert into notification_dispatch_errors (source, entity_id, sqlstate, message)
    values ('topic_homework_autopublish_content', v_hw, sqlstate, sqlerrm);
  end;
  return null;
end $$;

drop trigger if exists topic_homework_autopublish_file on public.topic_homework_files;
create trigger topic_homework_autopublish_file
  after insert on public.topic_homework_files
  for each row execute function public.trg_topic_homework_autopublish_content();

drop trigger if exists topic_homework_autopublish_created on public.topic_homework;
create trigger topic_homework_autopublish_created
  after insert on public.topic_homework
  for each row execute function public.trg_topic_homework_autopublish_content();

-- ── 9. Отправка сводки ─────────────────────────────────────────────────────
-- Одна строка notification_queue (event new_homework_digest, только при живой
-- связке Telegram — как у topic_homework_notify_students) и одна строка
-- notifications (всем) на профиль. Payload:
--   { count, items: [{course_title, title, due_date 'YYYY-MM-DD'|null, link}],
--     courses: [{course_title, link, count}], link }
-- link: одно ДЗ — тема; один курс — курс; иначе «Мои задания».
-- p_now — «сейчас» (параметр для проб; крон зовёт без него).
create or replace function public.topic_homework_digest_flush(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_msk     timestamp := p_now at time zone 'Europe/Moscow';
  v_p       record;
  v_items   jsonb;
  v_courses jsonb;
  v_n       integer;
  v_nc      integer;
  v_k       integer;
  v_link    text;
  v_key     text;
  v_title   text;
  v_message text;
  v_first   jsonb;
  v_sent    integer := 0;
  v_tg      integer := 0;
  v_dropped integer := 0;
  v_count   integer := 0;
begin
  if v_msk::time >= time '22:00' or v_msk::time < time '08:00' then
    return jsonb_build_object('sent', 0, 'items', 0, 'dropped', 0, 'telegram', 0, 'night', true);
  end if;

  for v_p in
    select d.profile_id
      from topic_homework_digest d
     where d.sent_at is null and d.dropped_at is null
     group by d.profile_id
    having public.topic_homework_digest_due_at(min(d.queued_at), max(d.queued_at)) <= p_now
     order by d.profile_id
  loop
    -- Два параллельных прогона не отправят одному ученику две сводки: второй
    -- ждёт замка и ниже уже не находит неотправленных строк.
    perform pg_advisory_xact_lock(hashtextextended('topic_homework_digest:' || v_p.profile_id::text, 0));

    -- Перед отправкой — выбросить то, о чём писать уже не надо.
    with chk as (
      select d.profile_id, d.homework_id,
             case
               when h.id is null or not h.is_published then 'unpublished'
               when t.kind in ('check', 'control') then 'timed'
               when not public.topic_open_now(t.is_open, t.available_from) then 'closed'
               when s.is_active is false or not exists (
                 select 1 from group_students gs join groups g on g.id = gs.group_id
                  where gs.student_id = d.student_id and g.course_id = m.course_id) then 'left'
               when exists (
                 select 1 from topic_homework_attempts a
                  where a.homework_id = d.homework_id and a.student_id = d.student_id
                    and a.status <> 'draft') then 'submitted'
               when exists (
                 select 1 from notification_queue q
                  where q.profile_id = d.profile_id and q.event_type = 'new_homework'
                    and q.entity_id = d.homework_id and q.created_at >= d.queued_at) then 'manual'
             end as reason
        from topic_homework_digest d
        left join topic_homework h on h.id = d.homework_id
        left join topics t         on t.id = h.topic_id
        left join modules m        on m.id = t.module_id
        left join students s       on s.id = d.student_id
       where d.profile_id = v_p.profile_id and d.sent_at is null and d.dropped_at is null
    )
    update topic_homework_digest d
       set dropped_at = p_now, drop_reason = chk.reason
      from chk
     where d.profile_id = chk.profile_id and d.homework_id = chk.homework_id
       and chk.reason is not null;
    get diagnostics v_k = row_count;
    v_dropped := v_dropped + v_k;

    with it as (
      select c.id as course_id, c.title as course_title,
             public.topic_homework_card_title(t.title, h.title) as title,
             h.due_at, t.id as topic_id, m.order_index as m_ord, t.order_index as t_ord,
             (select gs.group_id
                from group_students gs join groups gg on gg.id = gs.group_id
               where gs.student_id = d.student_id and gg.course_id = c.id
               order by gs.joined_at nulls last, gs.group_id
               limit 1) as group_id
        from topic_homework_digest d
        join topic_homework h on h.id = d.homework_id
        join topics t         on t.id = h.topic_id
        join modules m        on m.id = t.module_id
        join courses c        on c.id = m.course_id
       where d.profile_id = v_p.profile_id and d.sent_at is null and d.dropped_at is null
    ), cs as (
      select course_id, course_title, (array_agg(group_id order by group_id))[1] as group_id, count(*)::int as n
        from it group by course_id, course_title
    )
    select (select coalesce(jsonb_agg(jsonb_build_object(
                     'course_title', course_title,
                     'title',        title,
                     'due_date',     to_char(due_at, 'YYYY-MM-DD'),
                     'link',         '/my-course/' || group_id || '/topic/' || topic_id)
                   order by course_title, course_id, m_ord, t_ord, title), '[]'::jsonb) from it),
           (select count(*)::int from it),
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'course_title', course_title,
                     'link',         '/my-course/' || group_id,
                     'count',        n)
                   order by course_title, course_id), '[]'::jsonb) from cs),
           (select count(*)::int from cs)
      into v_items, v_n, v_courses, v_nc;

    if v_n = 0 then
      continue;
    end if;

    v_first := v_items -> 0;
    v_link := case
      when v_n = 1  then v_first ->> 'link'
      when v_nc = 1 then v_courses -> 0 ->> 'link'
      else '/my-homework'
    end;

    -- Колокольчик: те же три формы, что у карточки в Telegram.
    if v_n = 1 then
      v_title := 'Новое домашнее задание';
      v_message := concat_ws(' · ', nullif(btrim(v_first ->> 'course_title'), ''), nullif(btrim(v_first ->> 'title'), ''))
        || '. ' || case when v_first ->> 'due_date' is not null
                        then 'Сдать до ' || public._topic_homework_ru_day((v_first ->> 'due_date')::date, p_now)
                        else 'Без дедлайна' end;
    elsif v_n < 10 then
      v_title := 'Новые домашние задания: ' || v_n;
      select string_agg(x.course_title || ': ' || x.titles, '; ' order by x.ord)
        into v_message
        from (select e ->> 'course_title' as course_title,
                     string_agg(e ->> 'title', ', ' order by i) as titles,
                     min(i) as ord
                from jsonb_array_elements(v_items) with ordinality as a(e, i)
               group by e ->> 'course_title') x;
    else
      v_title := 'Открыто ' || v_n || ' ' || case
        when v_n % 10 = 1 and v_n % 100 <> 11 then 'новое домашнее задание'
        when v_n % 10 between 2 and 4 and v_n % 100 not between 12 and 14 then 'новых домашних задания'
        else 'новых домашних заданий' end;
      select string_agg(e ->> 'course_title', ', ' order by i) || '. Список — в курсе'
        into v_message
        from jsonb_array_elements(v_courses) with ordinality as a(e, i);
    end if;

    v_key := 'new_homework_digest:' || v_p.profile_id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');

    insert into notification_queue
      (profile_id, channel, event_type, entity_type, entity_id,
       deduplication_key, payload, status, scheduled_for)
    select v_p.profile_id, 'telegram', 'new_homework_digest', 'topic_homework_digest', null,
           v_key,
           jsonb_build_object('count', v_n, 'items', v_items, 'courses', v_courses, 'link', v_link),
           'pending'::notification_queue_status, p_now
      from telegram_connections tc
     where tc.profile_id = v_p.profile_id
       and tc.is_enabled
       and tc.disconnected_at is null
       and tc.telegram_chat_id is not null
    on conflict (deduplication_key) do nothing;
    get diagnostics v_k = row_count;
    v_tg := v_tg + v_k;

    insert into notifications (user_id, title, message, type, link, dedup_key)
    values (v_p.profile_id, v_title, coalesce(v_message, ''), 'info', v_link, v_key)
    on conflict (dedup_key) do nothing;

    update topic_homework_digest d
       set sent_at = p_now, queue_key = v_key
     where d.profile_id = v_p.profile_id and d.sent_at is null and d.dropped_at is null;

    v_sent  := v_sent + 1;
    v_count := v_count + v_n;
  end loop;

  return jsonb_build_object('sent', v_sent, 'items', v_count, 'dropped', v_dropped, 'telegram', v_tg, 'night', false);
end $$;

-- ── 10. Крон: выдать открывшееся по дате и отправить созревшие сводки ──────
create or replace function public.topic_homework_autopublish_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_published integer := 0;
  v_flush     jsonb;
begin
  begin
    v_published := public._topic_homework_autopublish(null, 'schedule');
  exception when others then
    insert into notification_dispatch_errors (source, entity_id, sqlstate, message)
    values ('topic_homework_autopublish_tick', null, sqlstate, sqlerrm);
  end;
  begin
    v_flush := public.topic_homework_digest_flush(now());
  exception when others then
    insert into notification_dispatch_errors (source, entity_id, sqlstate, message)
    values ('topic_homework_digest_flush', null, sqlstate, sqlerrm);
  end;
  return jsonb_build_object('published', v_published, 'flush', v_flush);
end $$;

-- ── 11. Окну темы у учителя: когда уйдёт сводка по этому ДЗ ────────────────
-- Только персонал курса (course_is_staff). Возвращает число учеников, кому
-- сообщение о ДЗ ещё не ушло, и самое позднее время их сводок.
create or replace function public.topic_homework_digest_eta(p_homework_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_course uuid;
  v_out    jsonb;
begin
  select public.course_of_topic(h.topic_id) into v_course
    from topic_homework h where h.id = p_homework_id;
  if v_course is null or not public.course_is_staff(v_course) then
    raise exception 'Нет прав на это ДЗ' using errcode = '42501';
  end if;

  select jsonb_build_object('pending', count(*)::int,
                            'due_at',  max(public.topic_homework_digest_due_at(p.first_at, p.last_at)))
    into v_out
    from (select d.profile_id, min(d.queued_at) as first_at, max(d.queued_at) as last_at
            from topic_homework_digest d
           where d.sent_at is null and d.dropped_at is null
             and d.profile_id in (select x.profile_id from topic_homework_digest x
                                   where x.homework_id = p_homework_id
                                     and x.sent_at is null and x.dropped_at is null)
           group by d.profile_id) p;
  return v_out;
end $$;

-- ── 12. Права ──────────────────────────────────────────────────────────────
revoke all on function public.topic_homework_digest_due_at(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._topic_homework_ru_day(date, timestamptz)              from public, anon, authenticated;
revoke all on function public._topic_homework_digest_enqueue(uuid[], timestamptz)     from public, anon, authenticated;
revoke all on function public._topic_homework_autopublish(uuid[], text)               from public, anon, authenticated;
revoke all on function public.topic_homework_publish_guard()                          from public, anon, authenticated;
revoke all on function public.trg_topic_homework_autopublish_topic()                  from public, anon, authenticated;
revoke all on function public.trg_topic_homework_autopublish_content()                from public, anon, authenticated;
revoke all on function public.topic_homework_digest_flush(timestamptz)                from public, anon, authenticated;
revoke all on function public.topic_homework_autopublish_tick()                       from public, anon, authenticated;
revoke all on function public.topic_homework_digest_eta(uuid)                         from public, anon;
grant execute on function public.topic_homework_digest_eta(uuid) to authenticated;

-- ── 13. Задание pg_cron ─────────────────────────────────────────────────────
-- По имени: повторный прогон файла не плодит задания.
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('topic-homework-autopublish', '*/5 * * * *',
                          'select public.topic_homework_autopublish_tick()');
  end if;
end $$;
