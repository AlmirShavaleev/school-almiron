-- §151. study_plan_board: клетки и сводка — массивами вместо объектов.
--
-- Первая версия отдавала объект на клетку; на классе из 16 человек и 169 тем
-- это 2704 клетки и 900 КБ на одно открытие таблицы. Индексы вместо uuid и
-- битовые флаги вместо восьми булевых полей дают ту же информацию в ~10 раз
-- короче. Расшифровка — src/lib/studyPlanBoard.ts, единственное место.
--
-- cells:   [si, ti, week, hw_code, self_groups, self_marked, flags, submitted_at?]
--   si/ti — индексы в массивах students/topics;
--   hw_code: 0 ДЗ не опубликовано · 1 не начато · 2 черновик · 3 сдано ·
--            4 принято · 5 на доработке;
--   flags:   1 зачёт · 2 отмечено · 4 просрочено · 8 сдано после срока ·
--            16 снята у ученика · 32 срок сдвинут ученику · 64 ДЗ опубликовано.
-- summary: [si, week, total, done, overdue]

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
           x.self_groups, x.self_marked, x.marked, x.done
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
          then jsonb_build_array(si, ti, week_no, hw_code, self_groups, self_marked, flags)
          else jsonb_build_array(si, ti, week_no, hw_code, self_groups, self_marked, flags, submitted_at)
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
