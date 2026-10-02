-- §255 — часть 4: тема теста — через topic_test_assignments (у topic_tests нет topic_id; сверено с продом)
-- Применено оркестратором 02.10 MCP apply_migration. §255 собран из PENDING_255.sql, применён четырьмя миграциями
-- (MCP-инструмент зависал на «drop policy»): 20261002152136 → 20261002153317 → 20261002153407 → 20261002153604.
-- Полные объяснения решений — в шапке и комментариях ниже и в PROJECT_STATE.md §255.

create or replace function public.student_exam_forecast_evidence()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_from timestamptz := now() - interval '180 days';
begin
  if v_uid is null then
    raise exception 'student_exam_forecast_evidence: нужен вход' using errcode = '42501';
  end if;

  return (
    with st as (
      select s.id from public.students s where s.profile_id = v_uid
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
    -- ДЗ: последняя сдача с вердиктом по каждому заданию работы.
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
       where x.submitted_at >= v_from
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
         and att.completed_at >= v_from
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
         and coalesce(me.starts_at, me.date) >= v_from
    ),
    cat_raw as (
      select p.task_id, coalesce(p.completed_at, p.updated_at) as at
        from public.catalog_task_progress p
       where p.user_id = v_uid and p.is_completed
      union all
      select vi.task_id,
             coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at)
        from public.test_variant_student_assignments sa
        join public.test_variant_answers a on a.student_assignment_id = sa.id
        join public.test_variant_items vi on vi.id = a.variant_item_id
       where sa.student_id in (select id from st) and a.is_correct
    ),
    cat_rows as (
      select case cs.subject when 'Математика' then 'math' when 'Физика' then 'physics' end as subject,
             array[cs.exam_number::int] as ns,
             'catalog'::text as source,
             1.0::numeric as score,
             min(r.at) as at,
             'catalog:' || r.task_id::text as item,
             null::int as kim_total
        from cat_raw r
        join public.catalog_tasks ct on ct.id = r.task_id and ct.is_published
        join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published
       where cs.exam_type = 'ЕГЭ'
         and cs.subject in ('Математика', 'Физика')
         and cs.exam_number >= 1
       group by cs.subject, cs.exam_number, r.task_id
      having min(r.at) >= v_from
    ),
    ev as (
      select * from hw_rows
      union all select * from test_rows
      union all select * from mock_rows
      union all select * from cat_rows
    ),
    titles as (
      select distinct on (1, 2)
             case cs.subject when 'Математика' then 'math' when 'Физика' then 'physics' end as subject,
             cs.exam_number::int as n, cs.title
        from public.catalog_sections cs
       where cs.is_published and cs.exam_type = 'ЕГЭ'
         and cs.subject in ('Математика', 'Физика') and cs.exam_number >= 1
       order by 1, 2, cs.position, cs.id
    )
    select jsonb_build_object(
      'today', (now() at time zone 'Europe/Moscow')::date,
      'now', now(),
      'subjects', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'subject', ms.subject,
                 'goal', g.goal,
                 'goal_updated_at', g.updated_at,
                 -- цель учителя (§216) — только для подсказки «учитель поставил 70»
                 'teacher_goal', (
                   select tg.target_score from public.student_subject_targets tg
                    where tg.student_id in (select id from st)
                      and tg.subject::text = ms.subject and tg.exam_type::text = 'ege'
                    order by tg.updated_at desc limit 1)
               ) order by ms.subject)
          from my_subjects ms
          left join public.student_exam_goals g
            on g.profile_id = v_uid and g.subject::text = ms.subject
      ), '[]'::jsonb),
      'titles', coalesce((
        select jsonb_agg(jsonb_build_object('subject', ti.subject, 'n', ti.n, 'title', ti.title) order by ti.subject, ti.n)
          from titles ti where ti.subject in (select subject from my_subjects)
      ), '[]'::jsonb),
      'evidence', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'subject', e.subject, 'ns', to_jsonb(e.ns), 'source', e.source,
                 'score', round(e.score, 3), 'at', e.at, 'item', e.item, 'kim_total', e.kim_total)
               order by e.at)
          from ev e
         where e.subject in (select subject from my_subjects)
           and e.at <= now()
      ), '[]'::jsonb)
    )
  );
end;
$$;
