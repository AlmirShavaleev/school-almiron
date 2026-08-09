-- Исправление к 20260808220907: `my_staff_course_ids()` возвращает
-- `setof uuid`, и колонки `id` у неё нет — обращаться надо по псевдониму.
-- Ошибка не всплыла при создании функций: тело plpgsql проверяется только при
-- вызове. Пробы прав нашли её на первом же запуске.

-- ── Кто пропал ──────────────────────────────────────────────────────────────
-- Последняя активность — МАКСИМУМ из трёх: заход, сдача ДЗ, попытка теста
-- (решение владельца). По одним заходам считать нельзя: app_visits заведена
-- 04.08, и все, кто не заходил с тех пор, выглядели бы пропавшими — это
-- возраст таблицы, а не правда. Сдачи уходят вглубь на месяцы.
create or replace function public.school_dormant_students(p_days integer default 7)
returns table (
  student_id    uuid,
  profile_id    uuid,
  full_name     text,
  course_titles text,
  last_active   date,
  days_silent   integer,
  never_active  boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
begin
  if not exists (select 1 from public.my_staff_course_ids()) then
    raise exception 'NOT_STAFF_OF_ANY_COURSE' using errcode = 'P0001';
  end if;

  return query
  with mine as (select cid from public.my_staff_course_ids() as cid),
  roster as (
    select distinct s.id as sid, s.profile_id as pid
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
      join mine m on m.cid = g.course_id
      join public.students s on s.id = gs.student_id
     where s.is_active
  ),
  acts as (
    select r.sid, r.pid,
           greatest(
             (select max(v.visited_on) from public.app_visits v where v.profile_id = r.pid),
             (select max(a.submitted_at)::date from public.topic_homework_attempts a where a.student_id = r.sid),
             (select max(coalesce(t.completed_at, t.started_at))::date from public.topic_test_attempts t where t.student_id = r.sid)
           ) as last_act
      from roster r
  )
  select a.sid, a.pid, coalesce(p.full_name, 'Ученик'),
         coalesce((select string_agg(distinct c.title, ', ')
                     from public.group_students gs
                     join public.groups g on g.id = gs.group_id
                     join public.courses c on c.id = g.course_id
                     join mine m2 on m2.cid = c.id
                    where gs.student_id = a.sid), '—'),
         a.last_act,
         case when a.last_act is null then null else (v_today - a.last_act) end,
         (a.last_act is null)
    from acts a
    join public.profiles p on p.id = a.pid
   where a.last_act is null or a.last_act <= v_today - p_days
   order by (a.last_act is null) desc, a.last_act asc nulls first;
end;
$fn$;

-- ── Заходы по дням ──────────────────────────────────────────────────────────
-- Ряд без дыр: дни без заходов должны рисоваться нулём, иначе график врёт
-- формой — провал выглядит как отсутствие точки.
create or replace function public.school_activity_daily(p_days integer default 30)
returns table (day date, people integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
begin
  if not exists (select 1 from public.my_staff_course_ids()) then
    raise exception 'NOT_STAFF_OF_ANY_COURSE' using errcode = 'P0001';
  end if;

  return query
  with mine as (select cid from public.my_staff_course_ids() as cid),
  scope as (
    select distinct s.profile_id as pid
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
      join mine m on m.cid = g.course_id
      join public.students s on s.id = gs.student_id
     where s.profile_id is not null
  ),
  days as (
    select generate_series(v_today - (p_days - 1), v_today, interval '1 day')::date as d
  )
  select d.d,
         (select count(distinct v.profile_id)::int
            from public.app_visits v
            join scope sc on sc.pid = v.profile_id
           where v.visited_on = d.d)
    from days d
   order by d.d;
end;
$fn$;

-- ── Что не открывают ────────────────────────────────────────────────────────
-- Пока `material_views` пуста, «не открыто» — все материалы разом. Это не
-- ответ, а артефакт: учёт только заводится. Флаг has_data отдаётся отдельно,
-- чтобы экран сказал «данных пока нет», а не показал 2720 «неоткрытых».
create or replace function public.school_unopened_materials(p_limit integer default 20)
returns table (
  topic_id     uuid,
  topic_title  text,
  course_title text,
  total_items  integer,
  unopened     integer,
  has_data     boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_has_data boolean := exists (select 1 from public.material_views);
begin
  if not exists (select 1 from public.my_staff_course_ids()) then
    raise exception 'NOT_STAFF_OF_ANY_COURSE' using errcode = 'P0001';
  end if;

  return query
  with mine as (select cid from public.my_staff_course_ids() as cid),
  items as (
    select i.id, t.id as tid, t.title as ttitle, c.title as ctitle
      from public.topic_material_items i
      join public.topics t  on t.id = i.topic_id
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
      join mine mm on mm.cid = c.id
  )
  select it.tid, it.ttitle, it.ctitle,
         count(*)::int,
         count(*) filter (
           where not exists (select 1 from public.material_views v where v.item_id = it.id)
         )::int,
         v_has_data
    from items it
   group by it.tid, it.ttitle, it.ctitle
  having count(*) filter (
           where not exists (select 1 from public.material_views v where v.item_id = it.id)
         ) > 0
   order by 5 desc
   limit p_limit;
end;
$fn$;

-- ── Воронка ДЗ по курсу ─────────────────────────────────────────────────────
-- Считаем РАБОТАМИ, парой «ДЗ + ученик», а не попытками: цикл «сдал → вернули
-- → пересдал» иначе даёт две сдачи у одного человека и завышает середину
-- воронки (тот же довод, что у collapseToWorks, §88).
create or replace function public.school_homework_funnel()
returns table (
  course_id    uuid,
  course_title text,
  expected     integer,
  submitted    integer,
  accepted     integer
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not exists (select 1 from public.my_staff_course_ids()) then
    raise exception 'NOT_STAFF_OF_ANY_COURSE' using errcode = 'P0001';
  end if;

  return query
  with mine as (select cid from public.my_staff_course_ids() as cid),
  course_hw as (
    select c.id as cid, h.id as hid
      from public.courses c
      join mine m on m.cid = c.id
      join public.modules mo on mo.course_id = c.id
      join public.topics t on t.module_id = mo.id
      join public.topic_homework h on h.topic_id = t.id
     where h.is_published
  ),
  course_students as (
    select c.id as cid, gs.student_id as sid
      from public.courses c
      join mine m on m.cid = c.id
      join public.groups g on g.course_id = c.id
      join public.group_students gs on gs.group_id = g.id
  )
  select c.id, c.title,
         ((select count(*) from course_hw ch where ch.cid = c.id)
           * (select count(distinct cs.sid) from course_students cs where cs.cid = c.id))::int,
         (select count(distinct (a.homework_id, a.student_id))
            from public.topic_homework_attempts a
            join course_hw ch on ch.hid = a.homework_id and ch.cid = c.id
           where a.submitted_at is not null)::int,
         (select count(distinct (a.homework_id, a.student_id))
            from public.topic_homework_attempts a
            join course_hw ch on ch.hid = a.homework_id and ch.cid = c.id
           where a.status = 'accepted')::int
    from public.courses c
    join mine m on m.cid = c.id
   order by c.title;
end;
$fn$;

revoke all on function public.school_dormant_students(integer) from public, anon;
grant execute on function public.school_dormant_students(integer) to authenticated;
revoke all on function public.school_activity_daily(integer) from public, anon;
grant execute on function public.school_activity_daily(integer) to authenticated;
revoke all on function public.school_unopened_materials(integer) from public, anon;
grant execute on function public.school_unopened_materials(integer) to authenticated;
revoke all on function public.school_homework_funnel() from public, anon;
grant execute on function public.school_homework_funnel() to authenticated;
