CREATE OR REPLACE FUNCTION public._progress_state(p_course_id uuid, p_student_ids uuid[])
 RETURNS TABLE(student_id uuid, topic_id uuid, module_id uuid, rn integer, closed boolean, closed_at timestamp with time zone, open boolean, open_reason text, autocheck_total integer, autocheck_left integer, hw_state text, percent integer, override_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with t as (
    select tp.id as topic_id, tp.module_id, tp.available_from,
           (row_number() over (partition by tp.module_id order by tp.order_index, tp.id))::int as rn
      from public.topics tp
      join public.modules m on m.id = tp.module_id
     where m.course_id = p_course_id
  ),
  st as (
    select s.id as student_id, s.profile_id,
           -- §290: обычный пробный период по подписке на этот курс — «демо».
           -- Промокод «N дней бесплатно» тоже ставит status 'trial', но
           -- source 'manual' — он открывает курс целиком (решение владельца 13.10).
           exists (select 1 from public.student_subscriptions ss
                    where ss.student_id = s.id and ss.course_id = p_course_id
                      and ss.status = 'trial' and ss.source = 'trial'
                      and ss.access_until > now()) as is_demo
      from public.students s
     where s.id = any (p_student_ids)
  ),
  tasks as (
    select k.id as task_id, k.topic_id from public.topic_autocheck_tasks k
     where k.topic_id in (select t.topic_id from t)
  ),
  -- по задаче: завершена (верно или 3 попытки) и когда
  ans as (
    select a.profile_id, a.task_id,
           (bool_or(a.is_correct) or count(*) >= 3) as done,
           max(a.created_at) as at
      from public.topic_autocheck_answers a
     where a.profile_id in (select st.profile_id from st)
       and a.task_id in (select tasks.task_id from tasks)
     group by a.profile_id, a.task_id
  ),
  ac as (
    select st.student_id, tasks.topic_id,
           count(*)::int as total,
           (count(*) filter (where not coalesce(ans.done, false)))::int as left_n,
           max(ans.at) filter (where ans.done) as at
      from st
      cross join tasks
      left join ans on ans.profile_id = st.profile_id and ans.task_id = tasks.task_id
     group by st.student_id, tasks.topic_id
  ),
  hw as (
    select h.id as homework_id, h.topic_id, h.autocheck, h.grade_scale, h.is_published
      from public.topic_homework h
     where h.topic_id in (select t.topic_id from t)
  ),
  last_att as (
    select distinct on (a.homework_id, a.student_id)
           a.homework_id, a.student_id, a.id as attempt_id, a.status::text as status
      from public.topic_homework_attempts a
     where a.homework_id in (select hw.homework_id from hw)
       and a.student_id in (select st.student_id from st)
     order by a.homework_id, a.student_id, a.attempt_number desc, a.created_at desc
  ),
  acc_review as (
    -- последняя проверка принятой попытки: балл и время
    select distinct on (la.homework_id, la.student_id)
           la.homework_id, la.student_id, r.score, r.created_at as at
      from last_att la
      join public.topic_homework_reviews r on r.attempt_id = la.attempt_id
     where la.status = 'accepted'
     order by la.homework_id, la.student_id, r.created_at desc, r.id desc
  ),
  base as (
    select st.student_id, st.is_demo, t.topic_id, t.module_id, t.rn, t.available_from,
           coalesce(ac.total, 0) as ac_total,
           coalesce(ac.left_n, 0) as ac_left,
           ac.at as ac_at,
           -- ДЗ второй части: только опубликованное и не автопроверочное
           case when h2.homework_id is null then 'none'
                when la2.status is null then 'none'
                when la2.status = 'returned_for_revision' then 'returned'
                else la2.status end as hw_state,
           h2.homework_id is not null as has_hw2,
           rv2.at as hw2_at,
           -- % — балл ДЗ урока (любого: автопроверочного или второй части)
           case hx.grade_scale
             when 'hundred' then rvx.score
             when 'five' then rvx.score * 20
           end as percent,
           o.state as override_state
      from st
      cross join t
      left join ac on ac.student_id = st.student_id and ac.topic_id = t.topic_id
      left join hw h2 on h2.topic_id = t.topic_id and not coalesce(h2.autocheck, false) and h2.is_published
      left join last_att la2 on la2.homework_id = h2.homework_id and la2.student_id = st.student_id
      left join acc_review rv2 on rv2.homework_id = h2.homework_id and rv2.student_id = st.student_id
      left join hw hx on hx.topic_id = t.topic_id
      left join acc_review rvx on rvx.homework_id = hx.homework_id and rvx.student_id = st.student_id
      left join public.student_topic_overrides o on o.student_id = st.student_id and o.topic_id = t.topic_id
  ),
  cl as (
    select b.*,
           (b.ac_left = 0 and (not b.has_hw2 or b.hw_state = 'accepted')) as is_closed,
           -- «опора» — открыт сам по себе: отметка open, первые 2, наступила дата
           (coalesce(b.override_state = 'open', false) or b.rn <= 2
            or (b.available_from is not null and b.available_from <= current_date)) as anchor,
           b.override_state is distinct from 'closed' as allowed
      from base b
  ),
  -- Урок открывается «закрытием предыдущего», только если предыдущий был ОТКРЫТ
  -- и закрыт. Открытость рекурсивна, поэтому так: серия подряд идущих уроков,
  -- каждый закрыт и не закрыт вручную; в серии до предыдущего урока есть опора —
  -- значит, вся серия была открыта. Запертый пустой урок цепочку не продолжает.
  runs as (
    select c.*,
           not (c.is_closed and c.allowed) as brk,
           sum(case when c.is_closed and c.allowed then 0 else 1 end)
             over (partition by c.student_id, c.module_id order by c.rn rows unbounded preceding) as grp
      from cl c
  ),
  chained as (
    select r.*,
           bool_or(r.anchor and not r.brk)
             over (partition by r.student_id, r.module_id, r.grp order by r.rn rows unbounded preceding) as run_anchored
      from runs r
  ),
  seq as (
    select c.*,
           coalesce(lag(not c.brk and c.run_anchored)
                      over (partition by c.student_id, c.module_id order by c.rn), false) as prev_closed
      from chained c
  )
  select s.student_id, s.topic_id, s.module_id, s.rn,
         s.is_closed,
         case when s.is_closed then
           nullif(greatest(coalesce(s.ac_at, '-infinity'::timestamptz),
                           coalesce(s.hw2_at, '-infinity'::timestamptz)), '-infinity'::timestamptz)
         end,
         -- §290: в демо открыты строго первые 2 урока раздела — ни даты, ни
         -- прохождение, ни ручное «открыть» больше не открывают
         case when s.is_demo then s.allowed and s.rn <= 2
              else s.allowed and (s.anchor or s.prev_closed) end,
         case when not s.allowed then null
              when s.is_demo then case when s.rn <= 2 then 'first2' end
              when s.override_state = 'open' then 'manual'
              when s.rn <= 2 then 'first2'
              when s.available_from is not null and s.available_from <= current_date then 'date'
              when s.prev_closed then 'prev_closed'
         end,
         s.ac_total, s.ac_left, s.hw_state, s.percent, s.override_state
    from seq s;
$function$;

CREATE OR REPLACE FUNCTION public.progress_open_by_student(p_course_ids uuid[], p_student_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.student_exam_evidence_rows(p_profile_id uuid, p_from timestamp with time zone)
 RETURNS TABLE(subject text, ns integer[], source text, score numeric, at timestamp with time zone, item text, kim_total integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with st as (
    select s.id from public.students s where s.profile_id = p_profile_id
  ),
  hw_last as (
    select distinct on (a.homework_id, lower(btrim(rt.no)))
           a.homework_id, h.topic_id, lower(btrim(rt.no)) as no, rt.verdict, a.submitted_at
      from public.topic_homework_review_tasks rt
      join public.topic_homework_attempts a on a.id = rt.attempt_id
      join public.topic_homework h on h.id = a.homework_id
     where a.student_id in (select id from st)
       and a.submitted_at is not null
       and rt.verdict in ('correct', 'partial', 'wrong', 'unsolved')
       and exists (select 1 from public.topic_homework_reviews r where r.attempt_id = a.id)
     order by a.homework_id, lower(btrim(rt.no)), a.submitted_at desc, a.attempt_number desc
  ),
  hw_rows as (
    select c.subject::text as subject,
           t.ege_task_numbers::int[] as ns,
           'hw'::text as source,
           case x.verdict when 'correct' then 1.0 when 'partial' then 0.5 else 0.0 end::numeric as score,
           x.submitted_at as at,
           'hw:' || x.homework_id::text || ':' || x.no as item,
           null::int as kim_total
      from hw_last x
      join public.topics t on t.id = x.topic_id
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
     where x.submitted_at >= p_from
       and cardinality(t.ege_task_numbers) > 0
       and c.exam_type::text = 'ege'
       and c.subject::text in ('math', 'physics')
  ),
  test_rows as (
    select c.subject::text as subject,
           coalesce(
             (select array[cs.exam_number::int]
                from public.catalog_tasks ct
                join public.catalog_sections cs on cs.id = ct.section_id
               where ct.id = i.task_id and cs.exam_type = 'ЕГЭ' and cs.exam_number >= 1
                 and cs.subject = case c.subject::text when 'math' then 'Математика' when 'physics' then 'Физика' end),
             t.ege_task_numbers::int[]) as ns,
           'test'::text as source,
           case
             when i.max_points > 0 and ans.awarded_points is not null
               then least(1.0, ans.awarded_points::numeric / i.max_points)
             when coalesce(ans.is_correct, false) then 1.0
             else 0.0
           end::numeric as score,
           att.completed_at as at,
           'test:' || ans.id::text as item,
           null::int as kim_total
      from public.topic_test_answers ans
      join public.topic_test_attempts att on att.id = ans.attempt_id
      join public.topic_test_items i on i.id = ans.item_id
      join public.topic_test_assignments tta on tta.id = att.assignment_id
      join public.topics t on t.id = tta.topic_id
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
     where att.student_id in (select id from st)
       and att.status = 'completed'
       and att.completed_at >= p_from
       and c.exam_type::text = 'ege'
       and c.subject::text in ('math', 'physics')
  ),
  mock_rows as (
    select me.subject::text as subject,
           array[s.task_number::int] as ns,
           'mock'::text as source,
           least(1.0, s.points::numeric / tpl.max_points[s.task_number]) as score,
           coalesce(me.starts_at, me.date) as at,
           'mock:' || me.id::text as item,
           array_length(tpl.max_points, 1) as kim_total
      from public.mock_exam_task_scores s
      join public.mock_exams me on me.id = s.mock_exam_id
      join public.mock_exam_templates tpl on tpl.id = me.template_id
     where s.student_id in (select id from st)
       and me.exam_type::text = 'ege'
       and me.subject::text in ('math', 'physics')
       and coalesce(tpl.max_points[s.task_number], 0) > 0
       and coalesce(me.starts_at, me.date) >= p_from
  ),
  cat_try as (
    select a.task_id,
           min(a.created_at) as first_at,
           min(a.created_at) filter (where a.verdict = 'correct') as correct_at,
           (array_agg(a.verdict order by a.created_at, a.id))[1] as first_verdict
      from public.catalog_task_attempts a
     where a.profile_id = p_profile_id and not a.revealed_before
     group by a.task_id
  ),
  cat_rows as (
    select public.catalog_subject_key(cs.subject, cs.exam_type) as subject,
           array[cs.exam_number::int] as ns,
           'catalog'::text as source,
           case when x.first_verdict = 'correct' then 1.0
                when x.correct_at is not null then 0.5
                else 0.0 end::numeric as score,
           coalesce(x.correct_at, x.first_at) as at,
           'catalog:' || x.task_id::text as item,
           null::int as kim_total
      from cat_try x
      join public.catalog_tasks ct on ct.id = x.task_id and (ct.is_published or ct.replaced_by_task_id is not null) /* §269 */
      join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published
     where cs.exam_number >= 1
       and public.catalog_subject_key(cs.subject, cs.exam_type) is not null
       and coalesce(x.correct_at, x.first_at) >= p_from
  ),
  var_rows as (
    select public.catalog_subject_key(cs.subject, cs.exam_type) as subject,
           array[cs.exam_number::int] as ns,
           'catalog'::text as source,
           case when a.is_correct and coalesce(a.attempts_count, 0) > 1 then 0.5
                when a.is_correct then 1.0
                else 0.0 end::numeric as score,
           coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at) as at,
           'variant:' || a.id::text as item,
           null::int as kim_total
      from public.test_variant_student_assignments sa
      join public.test_variant_answers a on a.student_assignment_id = sa.id
      join public.test_variant_items vi on vi.id = a.variant_item_id
      join public.catalog_tasks ct on ct.id = vi.task_id and (ct.is_published or ct.replaced_by_task_id is not null)
      join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published
     where sa.student_id in (select id from st)
       and a.is_correct is not null
       and cs.exam_number >= 1
       and public.catalog_subject_key(cs.subject, cs.exam_type) is not null
       and coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at) >= p_from
  )
  select * from hw_rows
  union all select * from test_rows
  union all select * from mock_rows
  union all select * from cat_rows
  union all select * from var_rows;
$function$;

CREATE OR REPLACE FUNCTION public.student_solved_task_days(p_profile_id uuid, p_from date)
 RETURNS TABLE(day date, source text, n integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with st as (
    select s.id from public.students s where s.profile_id = p_profile_id
  ),
  hw as (
    select min(a.submitted_at) as at
      from public.topic_homework_review_tasks rt
      join public.topic_homework_attempts a on a.id = rt.attempt_id
     where a.student_id in (select id from st)
       and rt.verdict in ('correct', 'partial')
       and a.submitted_at is not null
       and exists (select 1 from public.topic_homework_reviews r where r.attempt_id = a.id)
     group by a.homework_id, lower(btrim(rt.no))
  ),
  cat_raw as (
    select p.task_id, coalesce(p.completed_at, p.updated_at) as at
      from public.catalog_task_progress p
     where p.user_id = p_profile_id and p.is_completed
    union all
    select i.task_id,
           coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at)
      from public.test_variant_student_assignments sa
      join public.test_variant_answers a on a.student_assignment_id = sa.id
      join public.test_variant_items i on i.id = a.variant_item_id
     where sa.student_id in (select id from st) and a.is_correct
  ),
  cat as (
    select min(at) as at from cat_raw group by task_id
  ),
  mock as (
    select coalesce(me.starts_at, me.date) as at
      from public.mock_exam_task_scores s
      join public.mock_exams me on me.id = s.mock_exam_id
     where s.student_id in (select id from st) and s.points > 0
  ),
  tests as (
    select att.completed_at as at
      from public.topic_test_answers ans
      join public.topic_test_attempts att on att.id = ans.attempt_id
     where att.student_id in (select id from st)
       and att.status = 'completed'
       and (coalesce(ans.is_correct, false) or coalesce(ans.awarded_points, 0) > 0)
  ),
  ev as (
    select 'hw'::text as source, at from hw
    union all select 'catalog', at from cat
    union all select 'mock', at from mock
    union all select 'test', at from tests
  )
  select (ev.at at time zone 'Europe/Moscow')::date as day, ev.source, count(*)::int as n
    from ev
   where ev.at is not null
     and (ev.at at time zone 'Europe/Moscow')::date >= p_from
   group by 1, 2;
$function$;

