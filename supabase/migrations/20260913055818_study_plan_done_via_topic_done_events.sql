-- §151. Зачёт темы без опубликованного ДЗ — через topic_done_events() (§152),
-- а не своей копией правила «тема пройдена».
--
-- Первая версия study_plan_topic_states повторяла правило topicDone
-- (какие группы у темы есть, все ли отмечены). В main с 11.09 это правило
-- живёт в базе одной функцией topic_done_events(), и своей копии быть не
-- должно: она уже получила четвёртую группу (задачи к уроку, §162), копия
-- о ней не знала бы.
--
-- Что осталось своим: зачёт темы С опубликованным ДЗ — по сдаче
-- (submitted/accepted, решение владельца №2) и самоотметки theory/lesson,
-- показываемые РЯДОМ с зачётом, чтобы было видно расхождение «отметил
-- пройденной, но ДЗ не сдал». Самоотметки — сырые строки topic_section_marks,
-- без расчёта «какие группы у темы есть»: это тоже было бы копией.
--
-- Формат клетки study_plan_board: позиции 4 и 5 теперь theory_marked и
-- lesson_marked (0/1) вместо self_groups/self_marked.

drop function if exists public.study_plan_topic_states(uuid);

create function public.study_plan_topic_states(p_course_id uuid)
returns table (
  student_id     uuid,
  topic_id       uuid,
  hw_published   boolean,
  hw_status      text,
  submitted_at   timestamptz,
  theory_marked  boolean,
  lesson_marked  boolean,
  marked         boolean,
  done           boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with roster as (
    select gs.student_id
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
     where g.course_id = p_course_id
  ),
  course_topics as (
    select t.id as topic_id, h.id as homework_id, coalesce(h.is_published, false) as hw_published
      from public.topics t
      join public.modules m on m.id = t.module_id
      left join public.topic_homework h on h.topic_id = t.id
     where m.course_id = p_course_id
  ),
  attempt as (
    -- Принятая попытка терминальна; иначе самая свежая сданная, иначе черновик.
    select distinct on (a.homework_id, a.student_id)
           a.homework_id, a.student_id, a.status::text as status, a.submitted_at
      from public.topic_homework_attempts a
      join course_topics ct on ct.homework_id = a.homework_id
      join roster r on r.student_id = a.student_id
     order by a.homework_id, a.student_id,
              (a.status = 'accepted') desc, a.submitted_at desc nulls last, a.attempt_number desc
  ),
  marks as (
    select m.student_id, m.topic_id,
           bool_or(m.group_key = 'theory') as theory_marked,
           bool_or(m.group_key = 'lesson') as lesson_marked
      from public.topic_section_marks m
      join roster r on r.student_id = m.student_id
      join course_topics ct on ct.topic_id = m.topic_id
     group by m.student_id, m.topic_id
  ),
  done_events as (
    select e.student_id, e.topic_id
      from public.topic_done_events() e
      join roster r on r.student_id = e.student_id
      join course_topics ct on ct.topic_id = e.topic_id
  )
  select r.student_id,
         ct.topic_id,
         ct.hw_published,
         case
           when not ct.hw_published then 'none'
           when a.status is null then 'not_started'
           when a.status = 'returned_for_revision' then 'returned'
           else a.status
         end as hw_status,
         case when a.status in ('submitted', 'accepted') then a.submitted_at end as submitted_at,
         coalesce(mk.theory_marked, false) as theory_marked,
         coalesce(mk.lesson_marked, false) as lesson_marked,
         (coalesce(mk.theory_marked, false) and coalesce(mk.lesson_marked, false)) as marked,
         case
           when ct.hw_published then coalesce(a.status in ('submitted', 'accepted'), false)
           else (de.topic_id is not null)
         end as done
    from roster r
    cross join course_topics ct
    left join attempt a on a.homework_id = ct.homework_id and a.student_id = r.student_id
    left join marks mk on mk.student_id = r.student_id and mk.topic_id = ct.topic_id
    left join done_events de on de.student_id = r.student_id and de.topic_id = ct.topic_id;
$$;

revoke all on function public.study_plan_topic_states(uuid) from public, anon, authenticated;

create or replace function public.study_plan_board(p_course_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_plan public.course_study_plans;
  v_result jsonb;
begin
  if not public.course_is_staff(p_course_id) then
    return null;
  end if;

  select * into v_plan from public.course_study_plans where course_id = p_course_id;

  with roster_students as (
    select s.id as student_id, s.profile_id, coalesce(p.full_name, p.email, '—') as full_name,
           row_number() over (order by coalesce(p.full_name, p.email, '—'), s.id) - 1 as si
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
      join public.students s on s.id = gs.student_id
      join public.profiles p on p.id = s.profile_id
     where g.course_id = p_course_id
  ),
  plan_topics as (
    select t.id as topic_id, t.title, m.title as module_title,
           row_number() over (order by m.order_index, m.id, t.order_index, t.id) - 1 as ti,
           i.week_no,
           t.is_open, t.available_from,
           public.topic_open_now(t.is_open, t.available_from) as open_now
      from public.topics t
      join public.modules m on m.id = t.module_id
      left join public.course_study_plan_items i on i.course_id = p_course_id and i.topic_id = t.id
     where m.course_id = p_course_id
  ),
  cells as (
    select st.si, tp.ti,
           coalesce(o.week_no, tp.week_no) as week_no,
           coalesce(o.removed, false) as removed,
           (o.week_no is not null) as shifted,
           case when v_plan.course_id is not null and coalesce(o.week_no, tp.week_no) is not null
                then public.study_plan_week_deadline(v_plan.start_date, coalesce(o.week_no, tp.week_no)) end as deadline,
           x.hw_published, x.hw_status, x.submitted_at,
           x.theory_marked, x.lesson_marked, x.marked, x.done
      from roster_students st
      join plan_topics tp on true
      join public.study_plan_topic_states(p_course_id) x on x.student_id = st.student_id and x.topic_id = tp.topic_id
      left join public.course_study_plan_overrides o
        on o.course_id = p_course_id and o.student_id = st.student_id and o.topic_id = tp.topic_id
     where tp.week_no is not null or o.week_no is not null
  ),
  cells_flagged as (
    select c.*,
           (not c.removed and not c.done and c.deadline is not null and c.deadline < now()) as overdue,
           (c.done and c.hw_published and c.submitted_at is not null and c.deadline is not null
            and c.submitted_at > c.deadline) as late
      from cells c
  ),
  summary as (
    select si, week_no,
           count(*) filter (where not removed) as total,
           count(*) filter (where not removed and done) as done,
           count(*) filter (where overdue) as overdue
      from cells_flagged
     group by si, week_no
  )
  select jsonb_build_object(
    'plan', case when v_plan.course_id is null then null else jsonb_build_object(
      'start_date', v_plan.start_date,
      'auto_open', v_plan.auto_open,
      'current_week', public.study_plan_current_week(v_plan.start_date),
      'weeks_total', coalesce((select max(week_no) from public.course_study_plan_items where course_id = p_course_id), 0)
    ) end,
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'student_id', student_id, 'profile_id', profile_id, 'full_name', full_name)
        order by si) from roster_students), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object(
        'topic_id', topic_id, 'title', title, 'module_title', module_title,
        'week_no', week_no, 'is_open', is_open, 'available_from', available_from, 'open_now', open_now)
        order by ti) from plan_topics), '[]'::jsonb),
    'cells', coalesce((select jsonb_agg(
        case when submitted_at is null
          then jsonb_build_array(si, ti, week_no, hw_code, theory_marked::int, lesson_marked::int, flags)
          else jsonb_build_array(si, ti, week_no, hw_code, theory_marked::int, lesson_marked::int, flags, submitted_at)
        end order by si, ti)
        from (
          select c.*,
                 case c.hw_status
                   when 'none' then 0 when 'not_started' then 1 when 'draft' then 2
                   when 'submitted' then 3 when 'accepted' then 4 when 'returned' then 5
                   else 1 end as hw_code,
                 (c.done::int * 1) + (c.marked::int * 2) + (c.overdue::int * 4) + (c.late::int * 8)
                 + (c.removed::int * 16) + (c.shifted::int * 32) + (c.hw_published::int * 64) as flags
            from cells_flagged c
        ) z), '[]'::jsonb),
    'summary', coalesce((select jsonb_agg(jsonb_build_array(si, week_no, total, done, overdue) order by si, week_no)
        from summary), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.student_week_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student uuid := public.auth_student_id();
  v_result jsonb;
begin
  if v_student is null then
    return '[]'::jsonb;
  end if;

  with my_courses as (
    select distinct g.course_id, g.id as group_id
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
     where gs.student_id = v_student and g.course_id is not null
  ),
  plans as (
    select mc.course_id, mc.group_id, c.title as course_title, c.subject,
           p.start_date,
           public.study_plan_current_week(p.start_date) as week_no,
           (select max(week_no) from public.course_study_plan_items i where i.course_id = mc.course_id) as weeks_total
      from my_courses mc
      join public.courses c on c.id = mc.course_id
      join public.course_study_plans p on p.course_id = mc.course_id
  ),
  week_topics as (
    select pl.course_id, t.id as topic_id, t.title,
           row_number() over (partition by pl.course_id order by m.order_index, m.id, t.order_index, t.id) as position,
           public.topic_open_now(t.is_open, t.available_from) as open_now,
           x.hw_published, x.hw_status, x.done, x.marked
      from plans pl
      join public.course_study_plan_items i on i.course_id = pl.course_id
      join public.topics t on t.id = i.topic_id
      join public.modules m on m.id = t.module_id
      left join public.course_study_plan_overrides o
        on o.course_id = pl.course_id and o.student_id = v_student and o.topic_id = t.id
      join public.study_plan_topic_states(pl.course_id) x
        on x.student_id = v_student and x.topic_id = t.id
     where coalesce(o.removed, false) = false
       and coalesce(o.week_no, i.week_no) = pl.week_no
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'course_id', pl.course_id,
    'group_id', pl.group_id,
    'course_title', pl.course_title,
    'subject', pl.subject,
    'week_no', pl.week_no,
    'weeks_total', coalesce(pl.weeks_total, 0),
    'week_start', public.study_plan_week_start(pl.start_date, pl.week_no),
    'week_end', public.study_plan_week_start(pl.start_date, pl.week_no) + 6,
    'deadline', public.study_plan_week_deadline(pl.start_date, pl.week_no),
    'topics', coalesce((select jsonb_agg(jsonb_build_object(
        'topic_id', wt.topic_id, 'title', wt.title, 'open_now', wt.open_now,
        'hw_published', wt.hw_published, 'hw_status', wt.hw_status,
        'done', wt.done, 'marked', wt.marked)
        order by wt.position) from week_topics wt where wt.course_id = pl.course_id), '[]'::jsonb)
  ) order by pl.course_title), '[]'::jsonb)
  into v_result
  from plans pl;

  return v_result;
end;
$$;
