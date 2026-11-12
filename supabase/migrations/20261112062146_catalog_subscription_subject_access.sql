-- Catalogue access follows the caller's unexpired subject subscription.
create or replace function public.catalog_subscription_directions()
returns text[] language sql stable security definer set search_path = public, pg_temp
as $$
 select case
 when auth.uid() is null then '{}'::text[]
 when exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','owner','teacher','curator'))
 then array['Математика|ЕГЭ','Физика|ЕГЭ']::text[]
 else coalesce((select array_agg(distinct
   (case c.subject::text when 'math' then 'Математика' when 'physics' then 'Физика' end)||'|ЕГЭ')
 from public.students s join public.student_subscriptions ss on ss.student_id=s.id
 join public.courses c on c.id=ss.course_id
 where s.profile_id=auth.uid() and ss.status in ('trial','active','past_due')
 and ss.access_until>now() and c.exam_type::text='ege'
 and c.subject::text in ('math','physics')), '{}'::text[]) end;
$$;
revoke all on function public.catalog_subscription_directions() from public, anon;
grant execute on function public.catalog_subscription_directions() to authenticated, service_role;

create or replace function public.catalog_access_ok()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select cardinality(public.catalog_subscription_directions())>0 $$;

create policy catalog_tasks_subscription_direction on public.catalog_tasks as restrictive for select to authenticated using ((subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[]));
create policy catalog_sections_subscription_direction on public.catalog_sections as restrictive for select to authenticated using ((subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[]));
create policy catalog_topics_subscription_direction on public.catalog_topics as restrictive for select to authenticated using ((subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[]));

-- catalog_answer_reasons: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.catalog_answer_reasons(p_uid uuid, p_task_ids uuid[])
 RETURNS TABLE(task_id uuid, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with ids as (
    select distinct x.id
      from unnest(coalesce(p_task_ids, '{}'::uuid[])) as x(id)
     where p_uid is not null and x.id is not null
  ),
  who as (
    select exists (select 1 from public.profiles p
                    where p.id = p_uid and p.role in ('teacher', 'curator', 'admin', 'owner')) as staff,
           public.work_mode_active_for_profile(p_uid) as in_work
  ),
  mine as (
    select s.id from public.students s where s.profile_id = p_uid
  ),
  by_variant as (
    select distinct tvi.task_id
      from public.test_variant_student_assignments tvsa
      join public.test_variant_items tvi on tvi.variant_id = tvsa.variant_id
      left join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
     where tvsa.student_id in (select m.id from mine m)
       and tvsa.status in ('submitted', 'completed')
       and coalesce(tva.show_answers_after_submit, true)
       and coalesce(tva.show_solutions_after_submit, true)
       and tvi.task_id in (select i.id from ids i)
  ),
  by_lesson as (
    select distinct tvi.task_id
      from public.test_variant_assignments tva
      join public.test_variant_student_assignments tvsa on tvsa.assignment_id = tva.id
      join public.test_variant_items tvi on tvi.variant_id = tva.variant_id
      join public.test_variant_answers ans on ans.student_assignment_id = tvsa.id and ans.variant_item_id = tvi.id
     where tva.topic_id is not null
       and tvsa.student_id in (select m.id from mine m)
       and tvsa.status <> 'cancelled'
       and ans.solution_shown_at is not null
       and tvi.task_id in (select i.id from ids i)
  ),
  by_test as (
    select distinct ti.task_id
      from public.topic_test_attempts att
      join public.topic_test_items ti on ti.test_id = att.test_id
     where att.student_id in (select m.id from mine m)
       and att.status = 'completed'
       and ti.task_id in (select i.id from ids i)
  )
  select ct.id,
         case
           when who.staff then 'staff'
           when who.in_work then null
           when not ct.is_published then null
           when not public.catalog_task_checkable(ct.exam_part, ct.answer_html, ct.partial_type) then 'not_checkable'
           when exists (select 1 from public.catalog_task_attempts a
                         where a.profile_id = p_uid and a.task_id = ct.id and a.verdict = 'correct') then 'solved'
           when exists (select 1 from public.catalog_task_reveals rv
                         where rv.profile_id = p_uid and rv.task_id = ct.id) then 'revealed'
           when ct.id in (select v.task_id from by_variant v) then 'variant'
           when ct.id in (select l.task_id from by_lesson l) then 'lesson'
           when ct.id in (select t.task_id from by_test t) then 'test'
         end
    from (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
    join ids on ids.id = ct.id
   cross join who;
$function$;


-- catalog_check_answer: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.catalog_check_answer(p_task_id uuid, p_answer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_rules    jsonb := public.catalog_reward_rules();
  v_today    date := (now() at time zone 'Europe/Moscow')::date;
  v_week     date := date_trunc('week', (now() at time zone 'Europe/Moscow'))::date;
  v_task     record;
  v_answer   text;
  v_subject  text;
  v_n        integer;
  v_revealed boolean;
  v_correct  boolean;
  v_counted  boolean;
  v_zone     text;
  v_share    numeric;
  v_points   integer := 0;
  v_solved   integer := 0;
  v_mile     integer := 0;
  v_daily    integer := 0;
  v_gsubj    text;
  v_gnums    integer[];
  v_gstart   date;
  v_gtarget  integer;
  v_wprog    integer;
  v_wbonus   integer := 0;
  v_prev     record;
begin
  if v_uid is null then
    raise exception 'catalog_check_answer: нужен вход' using errcode = '42501';
  end if;
  if not public.catalog_access_ok() then
    raise exception 'Банк задач откроется с подпиской или пробным периодом' using errcode = '42501', hint = 'CATALOG_LOCKED';
  end if;

  select ct.id, ct.answer_html, ct.answer_spec /* §269 */, ct.partial_type, ct.exam_part, cs.subject, cs.exam_type, cs.exam_number
    into v_task
    from (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
    join (select * from public.catalog_sections where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) cs on cs.id = ct.section_id
   where ct.id = p_task_id and ct.is_published and cs.is_published;
  if not found then
    raise exception 'NOT_FOUND: задача не найдена' using errcode = 'P0002';
  end if;
  if not public.catalog_task_checkable(v_task.exam_part, v_task.answer_html, v_task.partial_type) then
    raise exception 'NOT_CHECKABLE: у этой задачи нет короткого ответа для проверки' using errcode = '22023';
  end if;

  v_answer := left(btrim(coalesce(p_answer, '')), 200);
  if v_answer = '' then
    raise exception 'EMPTY_ANSWER: введите ответ' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('catalog_check:' || v_uid::text || ':' || p_task_id::text));

  if (select count(*) from public.catalog_task_attempts a
       where a.profile_id = v_uid and a.created_at > now() - interval '1 minute')
     >= (v_rules->>'checks_per_minute')::int then
    raise exception 'RATE_LIMIT: не больше % проверок в минуту', v_rules->>'checks_per_minute' using errcode = '54000';
  end if;

  v_correct := case when v_task.answer_spec is not null
                   then coalesce(public.catalog_answer_spec_verdict(v_task.answer_spec, v_answer), false)
                   else public.catalog_task_verdict(v_task.answer_html, v_task.partial_type, v_answer) end;
  v_subject := public.catalog_subject_key(v_task.subject, v_task.exam_type);
  v_n := case when v_task.exam_number >= 1 then v_task.exam_number::int end;

  select a.revealed_before into v_prev
    from public.catalog_task_attempts a
   where a.profile_id = v_uid and a.task_id = p_task_id and a.verdict = 'correct'
   order by a.created_at limit 1;
  if found then
    return jsonb_build_object(
      'verdict', case when v_correct then 'correct' else 'wrong' end,
      'already_solved', true,
      'counted', false,
      'revealed_before', v_prev.revealed_before,
      'points', 0, 'milestone_bonus', 0, 'daily_bonus', 0, 'weekly_bonus', 0,
      'subject', v_subject, 'n', v_n,
      'answer_html', case when v_correct then v_task.answer_html end);
  end if;

  v_revealed := exists (select 1 from public.catalog_task_reveals rv where rv.profile_id = v_uid and rv.task_id = p_task_id);

  if v_subject is not null and v_n is not null then
    select z.share, z.zone into v_share, v_zone
      from public.student_kim_zone_shares(v_uid, array[v_subject], array[v_n], array[now()]) z;
  end if;

  insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, revealed_before)
  values (v_uid, p_task_id, v_answer, case when v_correct then 'correct' else 'wrong' end, v_revealed);

  v_counted := v_correct and not v_revealed;

  if v_correct then
    update public.catalog_task_progress
       set is_completed = true, completed_at = coalesce(completed_at, now()), updated_at = now()
     where user_id = v_uid and task_id = p_task_id;
    if not found then
      insert into public.catalog_task_progress (user_id, task_id, is_completed, completed_at, updated_at)
      values (v_uid, p_task_id, true, now(), now());
    end if;
  end if;

  if v_subject is not null and v_n is not null then
    select count(*)::int into v_solved
      from public.catalog_counted_solutions(v_uid) s
     where s.subject = v_subject and s.n = v_n;
    if v_counted then
      v_points := public.catalog_zone_points(v_zone);
      v_mile := public.catalog_zone_milestone(v_zone, v_solved);
    end if;
  end if;

  if v_counted then
    if exists (select 1 from public.student_daily_tasks d
                where d.profile_id = v_uid and d.day = v_today and d.task_id = p_task_id) then
      v_daily := (v_rules->>'daily_task')::int;
    end if;
    select g.subject, g.numbers, g.week_start, g.target into v_gsubj, v_gnums, v_gstart, v_gtarget
      from public.student_weekly_goals g
     where g.profile_id = v_uid and g.week_start = v_week and g.subject = v_subject and v_n = any (g.numbers);
    if v_gsubj is not null then
      select count(*)::int into v_wprog
        from public.catalog_counted_solutions(v_uid) s
       where s.subject = v_gsubj and s.n = any (v_gnums)
         and (s.at at time zone 'Europe/Moscow')::date between v_gstart and v_gstart + 6;
      if v_wprog = v_gtarget then
        v_wbonus := (v_rules->>'weekly_goal')::int;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'verdict', case when v_correct then 'correct' else 'wrong' end,
    'already_solved', false,
    'counted', v_counted,
    'revealed_before', v_revealed,
    'subject', v_subject,
    'n', v_n,
    'zone', v_zone,
    'share', v_share,
    'points', v_points,
    'solved', v_solved,
    'milestone_bonus', v_mile,
    'daily_bonus', v_daily,
    'weekly_bonus', v_wbonus,
    'weekly', case when v_gsubj is not null then
      jsonb_build_object('progress', v_wprog, 'target', v_gtarget) end,
    'answer_html', case when v_correct then v_task.answer_html end
  );
end;
$function$;


-- catalog_my_overview: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.catalog_my_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_min_solvers constant int := 10;
  v_uid        uuid := auth.uid();
  v_is_student boolean;
  v_result     jsonb;
begin
  if v_uid is null then
    raise exception 'catalog_my_overview: нужен вход' using errcode = '42501';
  end if;
  if not public.catalog_access_ok() then
    raise exception 'Банк задач откроется с подпиской или пробным периодом' using errcode = '42501', hint = 'CATALOG_LOCKED';
  end if;
  select coalesce(p.role::text = 'student', false) into v_is_student
    from public.profiles p where p.id = v_uid;
  v_is_student := coalesce(v_is_student, false);
  with
  sec as (
    select s.id, s.subject, s.exam_type, s.exam_number as n, s.position,
           (select count(*) from (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) t
             where t.section_id = s.id and t.is_published)::int as total
      from (select * from public.catalog_sections where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) s
     where s.is_published and s.exam_number >= 1
  ),
  nums as (
    select subject, exam_type, n,
           sum(total)::int as total,
           (array_agg(id order by (total > 0) desc, position, id))[1] as section_id
      from sec
     group by subject, exam_type, n
    having sum(total) > 0
  ),
  my_raw as (
    select p.task_id, coalesce(p.completed_at, p.updated_at) as at
      from public.catalog_task_progress p
     where p.user_id = v_uid and p.is_completed
    union all
    select i.task_id,
           coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at)
      from public.students st
      join public.test_variant_student_assignments sa on sa.student_id = st.id
      join public.test_variant_answers a on a.student_assignment_id = sa.id
      join public.test_variant_items i on i.id = a.variant_item_id
     where st.profile_id = v_uid and a.is_correct
  ),
  my_solved as (
    select coalesce(t.replaced_by_task_id, r.task_id) as task_id /* §269 */, s.subject, s.exam_type, s.n, min(r.at) as at
      from my_raw r
      join (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) t on t.id = r.task_id and (t.is_published or t.replaced_by_task_id is not null)
      join sec s on s.id = t.section_id
     group by coalesce(t.replaced_by_task_id, r.task_id), s.subject, s.exam_type, s.n
  ),
  my_exams as (
    select subject, exam_type,
           count(*)::int as solved,
           count(*) filter (where at >= now() - interval '7 days')::int as solved_7d
      from my_solved
     group by subject, exam_type
  ),
  my_nums as (
    select subject, exam_type, n, count(*)::int as solved
      from my_solved
     group by subject, exam_type, n
  ),
  mine as (
    select distinct
           case c.subject::text when 'math' then 'Математика' when 'physics' then 'Физика' end as subject,
           case c.exam_type::text when 'ege' then 'ЕГЭ' when 'oge' then 'ОГЭ' end as exam_type
      from public.students st
      join public.group_students gs on gs.student_id = st.id
      join public.groups g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where st.profile_id = v_uid
  ),
  school_raw as (
    select p.user_id as profile_id, p.task_id
      from public.catalog_task_progress p
     where v_is_student and p.is_completed
    union
    select st.profile_id, i.task_id
      from public.test_variant_answers a
      join public.test_variant_student_assignments sa on sa.id = a.student_assignment_id
      join public.students st on st.id = sa.student_id
      join public.test_variant_items i on i.id = a.variant_item_id
     where v_is_student and a.is_correct
  ),
  school as (
    select r.profile_id, s.subject, s.exam_type, coalesce(t.replaced_by_task_id, r.task_id) as task_id
      from school_raw r
      join public.profiles pr on pr.id = r.profile_id and pr.role = 'student'
      join (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) t on t.id = r.task_id and (t.is_published or t.replaced_by_task_id is not null)
      join sec s on s.id = t.section_id
      join my_exams e on e.subject = s.subject and e.exam_type = s.exam_type
  ),
  per_exam as (
    select profile_id, subject, exam_type, count(distinct task_id)::int as solved
      from school
     group by profile_id, subject, exam_type
  ),
  exam_cmp as (
    select pe.subject, pe.exam_type,
           count(*)::int as solvers,
           count(*) filter (where pe.solved < me.solved)::int as lower
      from per_exam pe
      join my_exams me on me.subject = pe.subject and me.exam_type = pe.exam_type
     group by pe.subject, pe.exam_type
  ),
  per_all as (
    select profile_id, count(distinct task_id)::int as solved
      from school
     group by profile_id
  ),
  my_total as (
    select count(*)::int as solved,
           count(*) filter (where at >= now() - interval '7 days')::int as solved_7d
      from my_solved
  ),
  all_cmp as (
    select count(*)::int as solvers,
           count(*) filter (where pa.solved < (select solved from my_total))::int as lower
      from per_all pa
  ),
  exam_rows as (
    select n.subject, n.exam_type,
           sum(n.total)::int as total,
           jsonb_agg(jsonb_build_object(
             'n',          n.n,
             'total',      n.total,
             'solved',     coalesce(mn.solved, 0),
             'section_id', n.section_id
           ) order by n.n) as numbers
      from nums n
      left join my_nums mn on mn.subject = n.subject and mn.exam_type = n.exam_type and mn.n = n.n
     group by n.subject, n.exam_type
  )
  select jsonb_build_object(
           'viewer',      case when v_is_student then 'student' else 'staff' end,
           'compare',     v_is_student,
           'min_solvers', c_min_solvers,
           'overall', (
              select jsonb_build_object(
                       'solved',     mt.solved,
                       'solved_7d',  mt.solved_7d,
                       'solvers',    case when v_is_student then ac.solvers end,
                       'better_pct', case when v_is_student and mt.solved > 0 and ac.solvers >= c_min_solvers
                                          then nullif(floor(100.0 * ac.lower / ac.solvers)::int, 0) end)
                from my_total mt cross join all_cmp ac),
           'exams', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'subject',    er.subject,
                       'exam_type',  er.exam_type,
                       'is_mine',    exists (
                                       select 1 from mine m
                                        where m.subject = er.subject and m.exam_type = er.exam_type),
                       'total',      er.total,
                       'solved',     coalesce(me.solved, 0),
                       'solved_7d',  coalesce(me.solved_7d, 0),
                       'solvers',    case when v_is_student then ec.solvers end,
                       'better_pct', case when v_is_student and ec.solvers >= c_min_solvers
                                          then nullif(floor(100.0 * ec.lower / ec.solvers)::int, 0) end,
                       'numbers',    er.numbers
                     ) order by er.subject, er.exam_type)
                from exam_rows er
                left join my_exams me on me.subject = er.subject and me.exam_type = er.exam_type
                left join exam_cmp ec on ec.subject = er.subject and ec.exam_type = er.exam_type
           ), '[]'::jsonb)
         )
    into v_result;
  return v_result;
end;
$function$;


-- catalog_practice_state: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.catalog_practice_state(p_section_id uuid, p_task_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_sec     record;
  v_subject text;
  v_zone    text;
  v_share   numeric;
  v_solved  integer := 0;
  v_ids     uuid[] := coalesce(p_task_ids, '{}');
begin
  if v_uid is null then
    raise exception 'catalog_practice_state: нужен вход' using errcode = '42501';
  end if;
  if not public.catalog_access_ok() then
    raise exception 'Банк задач откроется с подпиской или пробным периодом' using errcode = '42501', hint = 'CATALOG_LOCKED';
  end if;
  if cardinality(v_ids) > 300 then
    raise exception 'TOO_MANY: не больше 300 задач за раз' using errcode = '22023';
  end if;

  select cs.id, cs.subject, cs.exam_type, cs.exam_number, cs.title into v_sec
    from (select * from public.catalog_sections where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) cs where cs.id = p_section_id and cs.is_published;
  if found then
    v_subject := public.catalog_subject_key(v_sec.subject, v_sec.exam_type);
  end if;
  if v_subject is not null and v_sec.exam_number >= 1 then
    select z.share, z.zone into v_share, v_zone
      from public.student_kim_zone_shares(v_uid, array[v_subject], array[v_sec.exam_number::int], array[now()]) z;
    select count(*)::int into v_solved
      from public.catalog_counted_solutions(v_uid) s where s.subject = v_subject and s.n = v_sec.exam_number;
  end if;

  return jsonb_build_object(
    'rules', public.catalog_reward_rules(),
    'number', case when v_subject is not null and v_sec.exam_number >= 1 then jsonb_build_object(
      'subject', v_subject, 'n', v_sec.exam_number, 'title', v_sec.title,
      'zone', v_zone, 'share', v_share, 'solved', v_solved) end,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', ct.id,
               'checkable', public.catalog_task_checkable(ct.exam_part, ct.answer_html, ct.partial_type),
               'attempts', coalesce(x.attempts, 0),
               'last_verdict', x.last_verdict,
               'solved', coalesce(x.solved, false),
               'counted', coalesce(x.counted, false),
               'revealed', rv.task_id is not null) order by ct.id)
        from (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
        left join (
          select a.task_id, count(*)::int as attempts,
                 (array_agg(a.verdict order by a.created_at desc, a.id desc))[1] as last_verdict,
                 bool_or(a.verdict = 'correct') as solved,
                 bool_or(a.verdict = 'correct' and not a.revealed_before) as counted
            from public.catalog_task_attempts a
           where a.profile_id = v_uid and a.task_id = any (v_ids)
           group by a.task_id
        ) x on x.task_id = ct.id
        left join public.catalog_task_reveals rv on rv.profile_id = v_uid and rv.task_id = ct.id
       where ct.id = any (v_ids) and ct.is_published
    ), '[]'::jsonb)
  );
end;
$function$;


-- catalog_reveal_answer: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.catalog_reveal_answer(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_task   record;
  v_solved boolean;
begin
  if v_uid is null then
    raise exception 'catalog_reveal_answer: нужен вход' using errcode = '42501';
  end if;
  if not public.catalog_access_ok() then
    raise exception 'Банк задач откроется с подпиской или пробным периодом' using errcode = '42501', hint = 'CATALOG_LOCKED';
  end if;
  select ct.id, ct.answer_html, ct.solution_html into v_task
    from (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
    join (select * from public.catalog_sections where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) cs on cs.id = ct.section_id
   where ct.id = p_task_id and ct.is_published and cs.is_published;
  if not found then
    raise exception 'NOT_FOUND: задача не найдена' using errcode = 'P0002';
  end if;

  v_solved := exists (select 1 from public.catalog_task_attempts a
                       where a.profile_id = v_uid and a.task_id = p_task_id and a.verdict = 'correct');
  insert into public.catalog_task_reveals (profile_id, task_id) values (v_uid, p_task_id)
  on conflict (profile_id, task_id) do nothing;

  return jsonb_build_object(
    'answer_html', v_task.answer_html,
    'solved_before', v_solved
  );
end;
$function$;


-- catalog_reveal_answers: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.catalog_reveal_answers(p_task_ids uuid[])
 RETURNS TABLE(task_id uuid, allowed boolean, reason text, answer_html text, solution_html text, solution_plan_html text, grade_criteria_html text, has_plan boolean, has_criteria boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'catalog_reveal_answers: нужен вход' using errcode = '42501';
  end if;
  if not public.catalog_access_ok() then
    raise exception 'Банк задач откроется с подпиской или пробным периодом' using errcode = '42501', hint = 'CATALOG_LOCKED';
  end if;
  if cardinality(coalesce(p_task_ids, '{}'::uuid[])) > 300 then
    raise exception 'TOO_MANY: не больше 300 задач за раз' using errcode = '22023';
  end if;

  insert into public.catalog_task_reveals (profile_id, task_id)
  select v_uid, ct.id
    from (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
    join (select * from public.catalog_sections where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) cs on cs.id = ct.section_id
   where ct.id = any (coalesce(p_task_ids, '{}'::uuid[])) and ct.is_published and cs.is_published
  on conflict (profile_id, task_id) do nothing;

  return query select * from public.catalog_task_texts(p_task_ids);
end;
$function$;


-- catalog_task_texts: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.catalog_task_texts(p_task_ids uuid[])
 RETURNS TABLE(task_id uuid, allowed boolean, reason text, answer_html text, solution_html text, solution_plan_html text, grade_criteria_html text, has_plan boolean, has_criteria boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'catalog_task_texts: нужен вход' using errcode = '42501';
  end if;
  if not public.catalog_access_ok() then
    raise exception 'Банк задач откроется с подпиской или пробным периодом' using errcode = '42501', hint = 'CATALOG_LOCKED';
  end if;
  if cardinality(coalesce(p_task_ids, '{}'::uuid[])) > 300 then
    raise exception 'TOO_MANY: не больше 300 задач за раз' using errcode = '22023';
  end if;

  return query
    select ct.id,
           r.reason is not null,
           r.reason,
           case when r.reason is not null then ct.answer_html end,
           case when r.reason is not null then ct.solution_html end,
           case when r.reason is not null then ct.solution_plan_html end,
           case when r.reason is not null then ct.grade_criteria_html end,
           coalesce(ct.solution_plan_html, '') <> '',
           coalesce(ct.grade_criteria_html, '') <> ''
      from public.catalog_answer_reasons(v_uid, p_task_ids) r
      join (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct on ct.id = r.task_id
     where r.reason is not null or ct.is_published;
end;
$function$;


-- catalog_tasks_attach_preview: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.catalog_tasks_attach_preview(p_task_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'total',          count(*),
    'auto_checkable', count(*) filter (where public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)),
    'self_checked',   count(*) filter (where not public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)),
    'part_two',       count(*) filter (where ct.exam_part = 2)
  )
  from (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
  where ct.id = any(coalesce(p_task_ids, '{}'::uuid[]));
$function$;


-- create_self_built_variant: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.create_self_built_variant(p_title text, p_subject text, p_exam_type text, p_items variant_item_input[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role                text;
  v_student_id           uuid;
  v_variant_id           uuid;
  v_assignment_id        uuid;
  v_student_assignment_id uuid;
  v_count                integer;
  v_item                 public.variant_item_input;
  v_missing_count        integer;
BEGIN
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  if not public.catalog_access_ok() then
    raise exception 'Банк задач откроется с подпиской или пробным периодом' using errcode = '42501', hint = 'CATALOG_LOCKED';
  end if;
  IF v_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'ACCESS_DENIED: only students can self-build variants';
  END IF;

  SELECT id INTO v_student_id FROM public.students WHERE profile_id = auth.uid();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'ACCESS_DENIED: no student record for caller';
  END IF;

  v_count := COALESCE(array_length(p_items, 1), 0);
  IF v_count < 1 OR v_count > 50 THEN
    RAISE EXCEPTION 'INVALID_ITEMS: expected 1..50 items, got %', v_count;
  END IF;

  SELECT count(*) INTO v_missing_count
  FROM unnest(p_items) i
  LEFT JOIN (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct ON ct.id = i.task_id AND ct.is_published = true
  WHERE ct.id IS NULL;
  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'INVALID_TASK: % of the selected tasks do not exist or are not published', v_missing_count;
  END IF;

  INSERT INTO public.test_variants
    (title, description, subject, exam_type, status, created_by, settings, tasks_count, source_type)
  VALUES
    (p_title, NULL, p_subject, p_exam_type, 'ready', auth.uid(), '{}'::jsonb, v_count, 'student_self_built')
  RETURNING id INTO v_variant_id;

  FOR v_item IN SELECT * FROM unnest(p_items) LOOP
    INSERT INTO public.test_variant_items
      (variant_id, task_id, "position", section_id, topic_id, points)
    SELECT
      v_variant_id, v_item.task_id, v_item.pos, v_item.section_id, v_item.topic_id,
      CASE WHEN ct.exam_part = 1 THEN COALESCE(v_item.points, 1) ELSE 0 END
    FROM (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct WHERE ct.id = v_item.task_id;
  END LOOP;

  INSERT INTO public.test_variant_assignments
    (variant_id, assigned_by, student_id, group_id, max_attempts, allow_retry,
     show_answers_after_submit, show_solutions_after_submit, status)
  VALUES
    (v_variant_id, auth.uid(), v_student_id, NULL, 1, false, true, true, 'assigned')
  RETURNING id INTO v_assignment_id;

  INSERT INTO public.test_variant_student_assignments
    (assignment_id, variant_id, student_id, status)
  VALUES
    (v_assignment_id, v_variant_id, v_student_id, 'not_started')
  RETURNING id INTO v_student_assignment_id;

  RETURN v_student_assignment_id;
END;
$function$;


-- generate_variant_tasks: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.generate_variant_tasks(p_sections variant_section_input[])
 RETURNS TABLE(out_task_id uuid, out_section_id uuid, out_topic_id uuid, out_position integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role      text;
  v_sec       public.variant_section_input;
  v_topic_ids uuid[];
  v_per_topic integer;
  v_remainder integer;
  v_topic_idx integer;
  v_topic_id  uuid;
  v_needed    integer;
  v_available integer;
  v_pos       integer := 0;
  v_selected  uuid[]  := ARRAY[]::uuid[];
  v_task_ids  uuid[];
  i           integer;
BEGIN
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  if not public.catalog_access_ok() then
    raise exception 'Банк задач откроется с подпиской или пробным периодом' using errcode = '42501', hint = 'CATALOG_LOCKED';
  end if;
  IF v_role NOT IN ('teacher', 'admin', 'owner', 'curator', 'student') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_sec IN SELECT * FROM unnest(p_sections) LOOP
    IF v_sec.topic_ids IS NULL OR array_length(v_sec.topic_ids, 1) IS NULL THEN
      SELECT ARRAY_AGG(DISTINCT ctt.topic_id)
        INTO v_topic_ids
        FROM public.catalog_task_topics ctt
        JOIN (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct ON ct.id = ctt.task_id
       WHERE ct.section_id = v_sec.section_id
         AND ct.is_published = true
         AND public.variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type,
                                          ct.grade_criteria_html, ct.max_points);
    ELSE
      v_topic_ids := v_sec.topic_ids;
    END IF;

    IF v_topic_ids IS NULL OR array_length(v_topic_ids, 1) = 0 THEN
      IF COALESCE(v_sec.cnt, 0) > 0 THEN
        RAISE EXCEPTION 'NOT_ENOUGH_TASKS:section=%:topic=%:needed=%:available=0',
          v_sec.section_id, NULL::uuid, v_sec.cnt;
      END IF;
      CONTINUE;
    END IF;

    v_per_topic := v_sec.cnt / array_length(v_topic_ids, 1);
    v_remainder := v_sec.cnt % array_length(v_topic_ids, 1);

    v_topic_idx := 1;
    FOREACH v_topic_id IN ARRAY v_topic_ids LOOP
      v_needed := v_per_topic + CASE WHEN v_topic_idx <= v_remainder THEN 1 ELSE 0 END;
      v_topic_idx := v_topic_idx + 1;

      IF v_needed = 0 THEN CONTINUE; END IF;

      SELECT ARRAY_AGG(ct.id ORDER BY random())
        INTO v_task_ids
        FROM (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
        JOIN public.catalog_task_topics ctt ON ctt.task_id = ct.id
       WHERE ct.section_id = v_sec.section_id
         AND ctt.topic_id  = v_topic_id
         AND ct.is_published = true
         AND public.variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type,
                                          ct.grade_criteria_html, ct.max_points)
         AND ct.id <> ALL(v_selected);

      v_available := COALESCE(array_length(v_task_ids, 1), 0);

      IF v_available < v_needed THEN
        RAISE EXCEPTION 'NOT_ENOUGH_TASKS:section=%:topic=%:needed=%:available=%',
          v_sec.section_id, v_topic_id, v_needed, v_available;
      END IF;

      FOR i IN 1..v_needed LOOP
        v_pos := v_pos + 1;
        v_selected    := array_append(v_selected, v_task_ids[i]);
        out_task_id    := v_task_ids[i];
        out_section_id := v_sec.section_id;
        out_topic_id   := v_topic_id;
        out_position   := v_pos;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$function$;


-- generate_variant_tasks_by_topic: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.generate_variant_tasks_by_topic(p_subject text, p_exam_type text, p_topic_ids uuid[], p_levels jsonb, p_topic_source text DEFAULT NULL::text)
 RETURNS TABLE(out_task_id uuid, out_topic_id uuid, out_section_id uuid, out_level text, out_position integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role      text;
  v_scale     text;
  v_allowed   text[];
  v_level     text;
  v_needed    integer;
  v_total     integer := 0;
  v_pos       integer := 0;
  v_selected  uuid[]  := ARRAY[]::uuid[];
  v_rows      record;
  v_available integer;
BEGIN
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  if not public.catalog_access_ok() then
    raise exception 'Банк задач откроется с подпиской или пробным периодом' using errcode = '42501', hint = 'CATALOG_LOCKED';
  end if;
  IF v_role NOT IN ('teacher', 'admin', 'owner', 'curator', 'student') THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF p_topic_ids IS NULL OR array_length(p_topic_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_TOPICS: select at least one topic';
  END IF;

  v_scale := public.variant_level_scale(p_subject, p_exam_type);
  v_allowed := CASE v_scale
    WHEN 'three' THEN ARRAY['easy', 'medium', 'hard']
    WHEN 'two'   THEN ARRAY['basic', 'hard']
    ELSE              ARRAY['all']
  END;

  FOR v_level IN SELECT jsonb_object_keys(p_levels) LOOP
    IF NOT (v_level = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'BAD_LEVEL:level=%:scale=%', v_level, v_scale;
    END IF;
  END LOOP;

  SELECT COALESCE(sum((value #>> '{}')::integer), 0) INTO v_total
  FROM jsonb_each(p_levels);

  IF v_total < 1 OR v_total > 50 THEN
    RAISE EXCEPTION 'INVALID_COUNT: expected 1..50 tasks, got %', v_total;
  END IF;

  FOREACH v_level IN ARRAY v_allowed LOOP
    v_needed := COALESCE((p_levels ->> v_level)::integer, 0);
    CONTINUE WHEN v_needed = 0;

    SELECT count(*) INTO v_available
    FROM (
      SELECT DISTINCT ct.id
      FROM (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
      JOIN public.catalog_task_topics ctt ON ctt.task_id = ct.id
      WHERE ct.subject      = p_subject
        AND ct.exam_type    = p_exam_type
        AND ct.is_published = true
        AND ct.has_answer   = true
        AND public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
        AND ctt.source IS NOT DISTINCT FROM p_topic_source
        AND ctt.topic_id = ANY(p_topic_ids)
        AND public.variant_task_level(ct.subject, ct.exam_type, ct.difficulty, ct.exam_part) = v_level
        AND ct.id <> ALL(v_selected)
    ) pool;

    IF v_available < v_needed THEN
      RAISE EXCEPTION 'NOT_ENOUGH_LEVEL:level=%:needed=%:available=%',
        v_level, v_needed, v_available;
    END IF;

    FOR v_rows IN
      SELECT picked.task_id, picked.topic_id, picked.section_id
      FROM (
        SELECT DISTINCT ON (ct.id)
               ct.id AS task_id, ctt.topic_id, ct.section_id
        FROM (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
        JOIN public.catalog_task_topics ctt ON ctt.task_id = ct.id
        WHERE ct.subject      = p_subject
          AND ct.exam_type    = p_exam_type
          AND ct.is_published = true
          AND ct.has_answer   = true
          AND public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
          AND ctt.source IS NOT DISTINCT FROM p_topic_source
          AND ctt.topic_id = ANY(p_topic_ids)
          AND public.variant_task_level(ct.subject, ct.exam_type, ct.difficulty, ct.exam_part) = v_level
          AND ct.id <> ALL(v_selected)
        ORDER BY ct.id, ctt.is_primary DESC NULLS LAST
      ) picked
      ORDER BY random()
      LIMIT v_needed
    LOOP
      v_pos          := v_pos + 1;
      v_selected     := array_append(v_selected, v_rows.task_id);
      out_task_id    := v_rows.task_id;
      out_topic_id   := v_rows.topic_id;
      out_section_id := v_rows.section_id;
      out_level      := v_level;
      out_position   := v_pos;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$function$;


-- get_catalog_direction_counts: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.get_catalog_direction_counts()
 RETURNS TABLE(math_ege bigint, math_oge bigint, physics_ege bigint, physics_oge bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(*) FILTER (WHERE subject = 'Математика' AND exam_type = 'ЕГЭ') AS math_ege,
    COUNT(*) FILTER (WHERE subject = 'Математика' AND exam_type = 'ОГЭ') AS math_oge,
    COUNT(*) FILTER (WHERE subject = 'Физика'     AND exam_type = 'ЕГЭ') AS physics_ege,
    COUNT(*) FILTER (WHERE subject = 'Физика'     AND exam_type = 'ОГЭ') AS physics_oge
  FROM (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[]))
  WHERE is_published = true;
$function$;


-- get_catalog_section_counts: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.get_catalog_section_counts(p_subject text DEFAULT NULL::text, p_exam_type text DEFAULT NULL::text)
 RETURNS TABLE(section_id uuid, task_count bigint, part1_count bigint, part2_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.section_id,
         COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE t.exam_part = 1)::bigint,
         COUNT(*) FILTER (WHERE t.exam_part = 2)::bigint
  FROM (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) t
  JOIN (select * from public.catalog_sections where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) s ON s.id = t.section_id
  WHERE  t.is_published = true
    AND  (p_subject   IS NULL OR s.subject   = p_subject)
    AND  (p_exam_type IS NULL OR s.exam_type = p_exam_type)
  GROUP  BY t.section_id;
$function$;


-- get_catalog_topic_counts: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.get_catalog_topic_counts(p_section_id uuid)
 RETURNS TABLE(topic_id uuid, task_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tt.topic_id, COUNT(DISTINCT t.id)::bigint
  FROM   catalog_task_topics tt
  JOIN (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[]))        t  ON t.id = tt.task_id
  WHERE  t.section_id   = p_section_id
    AND  t.is_published = true
  GROUP  BY tt.topic_id;
$function$;


-- get_catalog_topic_ids: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.get_catalog_topic_ids(p_section_id uuid)
 RETURNS TABLE(topic_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT tt.topic_id
  FROM   catalog_task_topics tt
  JOIN (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[]))        t  ON t.id = tt.task_id
  WHERE  t.section_id   = p_section_id
    AND  t.is_published = true;
$function$;


-- pick_replacement_task: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.pick_replacement_task(p_section_id uuid, p_topic_id uuid DEFAULT NULL::uuid, p_exclude uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ct.id
  from (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
  left join catalog_task_topics ctt on ctt.task_id = ct.id
  where ct.section_id = p_section_id
    and (p_topic_id is null or ctt.topic_id = p_topic_id)
    and ct.is_published = true
    and ct.id <> all(coalesce(p_exclude, '{}'))
  order by random()
  limit 1;
$function$;


-- student_daily_task: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.student_daily_task(p_subject text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_row   record;
  v_pick  record;
  v_task  record;
  v_zone  text;
  v_share numeric;
begin
  if v_uid is null then
    raise exception 'student_daily_task: нужен вход' using errcode = '42501';
  end if;
  if not public.catalog_access_ok() then
    raise exception 'Банк задач откроется с подпиской или пробным периодом' using errcode = '42501', hint = 'CATALOG_LOCKED';
  end if;
  if p_subject is null or p_subject not in ('math', 'physics') then
    raise exception 'BAD_SUBJECT: предмет math или physics' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.students s
      join public.group_students gs on gs.student_id = s.id
      join public.groups g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where s.profile_id = v_uid and c.exam_type::text = 'ege' and c.subject::text = p_subject
  ) then
    return jsonb_build_object('day', v_today, 'subject', p_subject, 'task', null);
  end if;

  select d.* into v_row from public.student_daily_tasks d
   where d.profile_id = v_uid and d.day = v_today and d.subject = p_subject;

  if not found then
    select w.n into v_pick from public.student_weak_numbers(v_uid, p_subject) w
     where w.untried > 0 order by w.ord limit 1;
    if found then
      select ct.id into v_task
        from (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
        join (select * from public.catalog_sections where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) cs on cs.id = ct.section_id and cs.is_published
       where ct.is_published
         and cs.exam_number = v_pick.n
         and public.catalog_subject_key(cs.subject, cs.exam_type) = p_subject
         and coalesce(ct.exam_part, 1) = 1
         and coalesce(ct.auto_checkable, public.catalog_task_checkable(ct.exam_part, ct.answer_html, ct.partial_type))
         and not exists (select 1 from public.catalog_task_attempts a where a.profile_id = v_uid and a.task_id = ct.id)
         and not exists (select 1 from public.catalog_task_reveals rv where rv.profile_id = v_uid and rv.task_id = ct.id)
       order by random()
       limit 1;
      if found then
        insert into public.student_daily_tasks (profile_id, day, subject, task_id, n)
        values (v_uid, v_today, p_subject, v_task.id, v_pick.n)
        on conflict (profile_id, day, subject) do nothing;
      end if;
    end if;
    select d.* into v_row from public.student_daily_tasks d
     where d.profile_id = v_uid and d.day = v_today and d.subject = p_subject;
    if not found then
      return jsonb_build_object('day', v_today, 'subject', p_subject, 'task', null);
    end if;
  end if;

  select z.share, z.zone into v_share, v_zone
    from public.student_kim_zone_shares(v_uid, array[p_subject], array[v_row.n], array[now()]) z;

  return (
    select jsonb_build_object(
      'day', v_row.day,
      'subject', v_row.subject,
      'n', v_row.n,
      'zone', v_zone,
      'share', v_share,
      'bonus', (public.catalog_reward_rules()->>'daily_task')::int,
      'section_id', cs.id,
      'title', cs.title,
      'task', case when ct.is_published then jsonb_build_object(
        'id', ct.id,
        'statement_html', ct.statement_html,
        'subject', ct.subject,
        'exam_type', ct.exam_type,
        'assets', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', a.id, 'task_id', a.task_id, 'kind', a.kind,
                   'storage_path', a.storage_path, 'alt', a.alt, 'position', a.position)
                 order by a.position)
            from public.catalog_task_assets a where a.task_id = ct.id), '[]'::jsonb)) end,
      'attempts', (select count(*)::int from public.catalog_task_attempts a where a.profile_id = v_uid and a.task_id = ct.id),
      'revealed', exists (select 1 from public.catalog_task_reveals rv where rv.profile_id = v_uid and rv.task_id = ct.id),
      'solved', exists (select 1 from public.catalog_task_attempts a
                         where a.profile_id = v_uid and a.task_id = ct.id and a.verdict = 'correct'),
      'done', exists (select 1 from public.catalog_task_attempts a
                       where a.profile_id = v_uid and a.task_id = ct.id and a.verdict = 'correct'
                         and not a.revealed_before
                         and (a.created_at at time zone 'Europe/Moscow')::date = v_row.day)
    )
    from (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct
    join (select * from public.catalog_sections where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) cs on cs.id = ct.section_id
   where ct.id = v_row.task_id
  );
end;
$function$;


-- variant_section_available_counts: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.variant_section_available_counts(p_subject text, p_exam_type text)
 RETURNS TABLE(section_id uuid, total integer, available integer, available_p1 integer, available_p2 integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    cs.id,
    count(ct.id) filter (where ct.is_published)::integer,
    count(ct.id) filter (
      where ct.is_published
        and public.variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type,
                                         ct.grade_criteria_html, ct.max_points)
    )::integer,
    count(ct.id) filter (
      where ct.is_published and ct.exam_part is distinct from 2
        and public.variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type,
                                         ct.grade_criteria_html, ct.max_points)
    )::integer,
    count(ct.id) filter (
      where ct.is_published and ct.exam_part = 2
        and public.variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type,
                                         ct.grade_criteria_html, ct.max_points)
    )::integer
  from (select * from public.catalog_sections where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) cs
  left join (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct on ct.section_id = cs.id
  where cs.subject = p_subject
    and cs.exam_type = p_exam_type
  group by cs.id;
$function$;


-- variant_selection_availability: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.variant_selection_availability(p_subject text, p_exam_type text, p_topic_ids uuid[], p_topic_source text DEFAULT NULL::text)
 RETURNS TABLE(level text, available integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    public.variant_task_level(ct.subject, ct.exam_type, ct.difficulty, ct.exam_part),
    count(distinct ct.id)::integer
  from public.catalog_task_topics ctt
  join (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct on ct.id = ctt.task_id
  where ct.subject      = p_subject
    and ct.exam_type    = p_exam_type
    and ct.is_published = true
    and ct.has_answer   = true
    and public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
    and ctt.source is not distinct from p_topic_source
    and ctt.topic_id = any(p_topic_ids)
  group by 1;
$function$;


-- variant_topic_availability: apply the same scope inside SECURITY DEFINER reads.
CREATE OR REPLACE FUNCTION public.variant_topic_availability(p_subject text, p_exam_type text, p_topic_ids uuid[] DEFAULT NULL::uuid[], p_topic_source text DEFAULT NULL::text)
 RETURNS TABLE(topic_id uuid, topic_title text, section_id uuid, section_title text, section_position integer, exam_number integer, level text, available integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with scoped as (
    select distinct
      ctt.topic_id,
      ct.id as task_id,
      ct.section_id,
      public.variant_task_level(ct.subject, ct.exam_type, ct.difficulty, ct.exam_part) as level
    from public.catalog_task_topics ctt
    join (select * from public.catalog_tasks where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) ct on ct.id = ctt.task_id
    where ct.subject      = p_subject
      and ct.exam_type    = p_exam_type
      and ct.is_published = true
      and ct.has_answer   = true
      and public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
      and ctt.source is not distinct from p_topic_source
      and (p_topic_ids is null or ctt.topic_id = any(p_topic_ids))
  ),
  home as (
    select distinct on (s.topic_id)
      s.topic_id, s.section_id
    from scoped s
    join (select * from public.catalog_sections where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) cs on cs.id = s.section_id
    group by s.topic_id, s.section_id, cs.position
    order by s.topic_id, count(*) desc, cs.position
  )
  select
    s.topic_id, t.title, cs.id, cs.title, cs.position, cs.exam_number,
    s.level, count(distinct s.task_id)::integer
  from scoped s
  join home h                     on h.topic_id = s.topic_id
  join (select * from public.catalog_sections where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[])) cs on cs.id = h.section_id
  join (select * from public.catalog_topics where (subject||'|'||exam_type) = any ((select public.catalog_subscription_directions())::text[]))   t  on t.id  = s.topic_id
  group by s.topic_id, t.title, cs.id, cs.title, cs.position, cs.exam_number, s.level;
$function$;

