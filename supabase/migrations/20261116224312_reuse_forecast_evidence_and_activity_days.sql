set local lock_timeout='3s';
set local statement_timeout='25s';

CREATE OR REPLACE FUNCTION public.student_forecast_evidence_of(p_profile_id uuid, p_as_of timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with st as (
    select s.id from public.students s where s.profile_id = p_profile_id
  ),
  my_subjects as (
    select distinct c.subject::text as subject
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where gs.student_id in (select id from st)
       and c.exam_type::text = 'ege'
       and c.subject::text in ('math', 'physics')
  ),
  rules as materialized (
    select (public.catalog_reward_rules()->>'window_days')::int * interval '1 day' as win
  ),
  raw_evidence as materialized (
    select e.* from public.student_exam_evidence_rows(
      p_profile_id, least(p_as_of - interval '180 days', p_as_of - (select win from rules))
    ) e
  ),
  ev as (
    select e.* from raw_evidence e
     where e.subject in (select subject from my_subjects)
       and e.at >= p_as_of - interval '180 days' and e.at <= p_as_of
  ),
  titles as (
    select distinct on (1, 2)
           case cs.subject when 'Математика' then 'math' when 'Физика' then 'physics' end as subject,
           cs.exam_number::int as n, cs.title, cs.id as section_id
      from public.catalog_sections cs
     where cs.is_published and cs.exam_type = 'ЕГЭ'
       and cs.subject in ('Математика', 'Физика') and cs.exam_number >= 1
     order by 1, 2, cs.position, cs.id
  ),
  nums as (
    select ti.subject, ti.n, ti.section_id from titles ti where ti.subject in (select subject from my_subjects)
  ),
  zone_aggregates as (
    -- Same window, weighting, rounding and strict upper boundary as student_kim_zone_shares.
    select n.subject, n.n,
           round(sum(e.score * (1.0 / cardinality(e.ns))) /
                 nullif(sum(1.0 / cardinality(e.ns)), 0), 4) as share
      from nums n cross join rules r
      left join raw_evidence e
        on e.subject = n.subject and n.n = any(e.ns)
       and cardinality(e.ns) between 1 and 3
       and e.at < p_as_of and e.at >= p_as_of - r.win
     group by n.subject, n.n
  ),
  zones as (
    select z.subject, z.n, z.share, public.catalog_zone_of(z.share) as zone
      from zone_aggregates z
  ),
  solved as (
    select s.subject, s.n, count(*)::int as k
      from public.catalog_counted_solutions(p_profile_id) s
     where s.at <= p_as_of
     group by 1, 2
  )
  select jsonb_build_object(
    'today', (p_as_of at time zone 'Europe/Moscow')::date,
    'now', p_as_of,
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'subject', ms.subject,
               'goal', g.goal,
               'goal_updated_at', g.updated_at,
               'teacher_goal', (
                 select tg.target_score from public.student_subject_targets tg
                  where tg.student_id in (select id from st)
                    and tg.subject::text = ms.subject and tg.exam_type::text = 'ege'
                  order by tg.updated_at desc limit 1)
             ) order by ms.subject)
        from my_subjects ms
        left join public.student_exam_goals g
          on g.profile_id = p_profile_id and g.subject::text = ms.subject
    ), '[]'::jsonb),
    'titles', coalesce((
      select jsonb_agg(jsonb_build_object('subject', ti.subject, 'n', ti.n, 'title', ti.title, 'section_id', ti.section_id) order by ti.subject, ti.n)
        from titles ti where ti.subject in (select subject from my_subjects)
    ), '[]'::jsonb),
    'numbers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'subject', z.subject, 'n', z.n, 'zone', z.zone, 'share', z.share,
               'solved', coalesce(so.k, 0)) order by z.subject, z.n)
        from zones z left join solved so on so.subject = z.subject and so.n = z.n
    ), '[]'::jsonb),
    'catalog_rules', public.catalog_reward_rules(),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
               'subject', e.subject, 'ns', to_jsonb(e.ns), 'source', e.source,
               'score', round(e.score, 3), 'at', e.at, 'item', e.item, 'kim_total', e.kim_total)
             order by e.at)
        from ev e
    ), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.student_home_activity(p_days integer DEFAULT 84)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_today  date := (now() at time zone 'Europe/Moscow')::date;
  v_days   integer := least(greatest(coalesce(p_days, 84), 7), 371);
  v_from   date;
  v_streak record;
  v_solve_days date[];
begin
  if v_uid is null then
    raise exception 'student_home_activity: нужен вход' using errcode = '42501';
  end if;

  v_from := v_today - (v_days - 1);
  select coalesce(array_agg(d.day order by d.day), '{}'::date[]) into v_solve_days
    from public.student_solve_days(v_uid) d where d.day <= v_today;

  with d as (select unnest(v_solve_days) as day),
  g as (select d.day, d.day - (row_number() over(order by d.day))::int as grp from d),
  runs as (select max(g.day) as last_day, count(*)::int as len from g group by g.grp)
  select coalesce((select r.len from runs r where r.last_day >= v_today - 1 order by r.last_day desc limit 1),0) as streak,
         coalesce((select max(r.len) from runs r),0) as record,
         exists(select 1 from d where d.day=v_today) as solved_today
    into v_streak;

  return jsonb_build_object(
    'today',         v_today,
    'from',          v_from,
    'streak',        v_streak.streak,
    'record',        v_streak.record,
    'streak_rule',   'solve',
    'solved_today',  v_streak.solved_today,
    'visited_today', exists (select 1 from public.app_visits v where v.profile_id = v_uid and v.visited_on = v_today),
    'streak_days', coalesce((
      select jsonb_agg(x.day order by x.day)
        from unnest(v_solve_days) as x(day)
       where x.day between v_from and v_today
    ), '[]'::jsonb),
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
          from public.topic_done_events(array(select id from st)) e
         where e.student_id in (select id from st)
      ),
      per_topic as (
        select m.course_id, t.id,
               public.topic_open_with((select public.progress_open_by_student(null, array(select id from st))), (select id from st limit 1)::text || ':' || t.id::text, t.is_open, t.available_from) as open_now,
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
$function$;
