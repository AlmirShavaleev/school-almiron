-- §261, часть 4/4. Применено оркестратором 03.10 (MCP apply_migration, версия 20261003114628); применённый текст — без строк-комментариев, comment on и хвостовых комментариев.
-- ══ 5. Отчёт родителю — прежний ответ + новые поля ══════════════════════════════════════════════
-- Всё до отметки «§261» — ДОСЛОВНО 20260925184917 (расчёт прежних полей не менялся). Новые поля:
--   subjects[].exam_goal   — цель ученика (student_exam_goals, §255), только для ЕГЭ; target (§216) — как был;
--   subjects[].assessments — проверочные/контрольные предмета, у которых день работы в периоде:
--                            дата, название, оценка, баллы «10 из 12» (если учитель ставил по критериям),
--                            средняя по классу — только если в классе от c_min_group человек (правило 2);
--   subjects[].homeworks   — ДЗ уроков предмета, у которых срок в периоде (без срока — первая сдача в
--                            периоде): срок, первая сдача, статус, оценка. «Вовремя» считает клиент функцией
--                            §259 (homeworkDeadline.ts) — правило одно;
--   forecast               — свидетельства прогноза на конец периода (или «сейчас», если период не кончился):
--                            тот же ответ, что у ученика на главной; показывать ли балл решает клиент тем же
--                            правилом покрытия (egeForecast.ts, §255);
--   diligence              — «Старание за период»: дни с решением в периоде (student_solve_days, §256), сколько
--                            дней в периоде, серия сейчас, задачи каталога верно с проверкой в периоде
--                            (catalog_counted_solutions), награды N из M и уровень баллов школы.
create or replace function public.student_progress_report(
  p_student_id uuid,
  p_from       date,
  p_to         date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c_min_group    constant int := 6;
  c_min_tasks    constant int := 3;
  c_topic_limit  constant int := 5;
  c_mock_limit   constant int := 8;

  v_profile_id uuid;
  v_result     jsonb;
  -- §261
  v_today      date := (now() at time zone 'Europe/Moscow')::date;
  v_as_of      timestamptz;
  v_points     jsonb;
  v_streak     record;
  v_fc         jsonb;
  v_ach        jsonb;
begin
  if p_student_id is null or p_from is null or p_to is null then
    raise exception 'student_progress_report: нужны ученик и границы периода'
      using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'student_progress_report: конец периода раньше начала'
      using errcode = '22023';
  end if;

  if not (public.is_admin_or_owner() or public.auth_is_staff_of_student(p_student_id)) then
    raise exception 'Нет доступа к отчёту этого ученика'
      using errcode = '42501';
  end if;

  select s.profile_id into v_profile_id from public.students s where s.id = p_student_id;
  if v_profile_id is null then
    raise exception 'Ученик не найден' using errcode = 'P0002';
  end if;

  -- §261: прогноз на конец периода (конец дня p_to по Москве), но не позже «сейчас».
  v_as_of  := least(now(), ((p_to + 1)::timestamp at time zone 'Europe/Moscow') - interval '1 second');
  v_fc     := public.student_forecast_evidence_of(v_profile_id, v_as_of);
  v_points := public.student_school_points_of(v_profile_id);
  v_ach    := public.student_achievements_for_staff(p_student_id);
  select * into v_streak from public.student_solve_streak(v_profile_id, v_today);

  with
  my_groups as (
    select g.id            as group_id,
           g.name          as group_name,
           c.id            as course_id,
           c.title         as course_title,
           c.subject::text as subject,
           c.exam_type::text as exam_type,
           (select count(*) from public.group_students gs2 where gs2.group_id = g.id)::int as group_size
      from public.group_students gs
      join public.groups  g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where gs.student_id = p_student_id
  ),
  subject_groups as (
    select subject, exam_type,
           max(group_size)                  as group_size,
           string_agg(distinct course_title, ' · ') as course_titles
      from my_groups
     group by subject, exam_type
  ),
  my_works as (
    select c.subject::text as subject,
           c.exam_type::text as exam_type,
           a.id             as attempt_id,
           a.status::text   as status,
           t.id             as topic_id,
           th.due_at,
           coalesce(a.submitted_at, a.created_at) as at,
           r.score,
           least(100, greatest(0, case
             when r.score is null then null
             when th.grade_scale = 'five'    then round(r.score / 5.0  * 100)::int
             when th.grade_scale = 'hundred' then round(r.score / 100.0 * 100)::int
             else null
           end)) as percent
      from public.topic_homework_attempts a
      join public.topic_homework th on th.id = a.homework_id
      join public.topics  t on t.id = th.topic_id
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
      left join lateral (
        select rv.score
          from public.topic_homework_reviews rv
         where rv.attempt_id = a.id
         order by rv.created_at desc
         limit 1
      ) r on true
     where a.student_id = p_student_id
       and a.status <> 'draft'
       and coalesce(a.submitted_at, a.created_at) >= p_from::timestamptz
       and coalesce(a.submitted_at, a.created_at) <  (p_to + 1)::timestamptz
  ),
  work_stats as (
    select subject, exam_type,
           count(*)::int                                           as submitted,
           count(*) filter (where status = 'accepted')::int         as accepted,
           count(*) filter (where status = 'returned_for_revision')::int as revision,
           count(*) filter (where status = 'submitted')::int        as pending,
           count(percent)::int                                      as graded_works,
           case when count(percent) > 0 then round(avg(percent))::int end as avg_percent,
           count(*) filter (where due_at is not null)::int           as with_due,
           count(*) filter (where due_at is not null and at::date <= due_at)::int as on_time,
           count(*) filter (where due_at is not null and at::date >  due_at)::int as late
      from my_works
     group by subject, exam_type
  ),
  week_stats as (
    select subject, exam_type,
           date_trunc('week', at)::date as week_start,
           round(avg(percent))::int     as avg_percent,
           count(percent)::int          as works
      from my_works
     where percent is not null
     group by subject, exam_type, date_trunc('week', at)::date
  ),
  weeks_by_subject as (
    select subject, exam_type,
           jsonb_agg(jsonb_build_object(
             'week_start', week_start,
             'avg_percent', avg_percent,
             'works', works
           ) order by week_start) as weeks
      from week_stats
     group by subject, exam_type
  ),
  peer_works as (
    select mg.subject, mg.exam_type,
           least(100, greatest(0, case
             when r.score is null then null
             when th.grade_scale = 'five'    then round(r.score / 5.0  * 100)::int
             when th.grade_scale = 'hundred' then round(r.score / 100.0 * 100)::int
             else null
           end)) as percent
      from my_groups mg
      join public.group_students gs on gs.group_id = mg.group_id
      join public.modules m on m.course_id = mg.course_id
      join public.topics  t on t.module_id = m.id
      join public.topic_homework th on th.topic_id = t.id
      join public.topic_homework_attempts a
        on a.homework_id = th.id and a.student_id = gs.student_id
      left join lateral (
        select rv.score
          from public.topic_homework_reviews rv
         where rv.attempt_id = a.id
         order by rv.created_at desc
         limit 1
      ) r on true
     where a.status <> 'draft'
       and coalesce(a.submitted_at, a.created_at) >= p_from::timestamptz
       and coalesce(a.submitted_at, a.created_at) <  (p_to + 1)::timestamptz
  ),
  peer_stats as (
    select subject, exam_type, round(avg(percent))::int as group_avg_percent
      from peer_works
     where percent is not null
     group by subject, exam_type
  ),
  my_mocks as (
    select me.id, me.date, me.title,
           me.subject::text   as subject,
           me.exam_type::text as exam_type,
           me.group_id,
           mr.score, mr.part1_score, mr.part2_score
      from public.mock_exam_results mr
      join public.mock_exams me on me.id = mr.mock_exam_id
     where mr.student_id = p_student_id
       and me.date <= p_to
     order by me.date desc
     limit c_mock_limit
  ),
  mock_group as (
    select m.id,
           (select count(*) from public.group_students gs where gs.group_id = m.group_id)::int as group_size,
           (select round(avg(mr2.score))::int
              from public.mock_exam_results mr2
              join public.group_students gs2 on gs2.student_id = mr2.student_id
             where mr2.mock_exam_id = m.id
               and gs2.group_id = m.group_id) as group_avg
      from my_mocks m
  ),
  mock_rows as (
    select m.*,
           mg.group_size,
           case when coalesce(mg.group_size, 0) >= c_min_group then mg.group_avg end as group_avg,
           m.score - lag(m.score) over (partition by m.subject, m.exam_type order by m.date) as delta
      from my_mocks m
      left join mock_group mg on mg.id = m.id
  ),
  task_rows as (
    select t.id as topic_id, t.title, t.ege_task_numbers,
           c.subject::text as subject,
           rt.verdict
      from public.topic_homework_review_tasks rt
      join public.topic_homework_attempts a on a.id = rt.attempt_id
      join public.topic_homework th on th.id = a.homework_id
      join public.topics  t on t.id = th.topic_id
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
     where a.student_id = p_student_id
       and coalesce(a.submitted_at, a.created_at) >= p_from::timestamptz
       and coalesce(a.submitted_at, a.created_at) <  (p_to + 1)::timestamptz
       and rt.verdict <> 'unchecked'
  ),
  topic_stats as (
    select topic_id, title, subject, ege_task_numbers,
           count(*)::int as tasks_counted,
           round(
             sum(case verdict when 'correct' then 1.0 when 'partial' then 0.5 else 0 end)
             / count(*) * 100
           )::int as correct_percent
      from task_rows
     group by topic_id, title, subject, ege_task_numbers
    having count(*) >= c_min_tasks
  ),
  topic_json as (
    select topic_id, correct_percent,
           jsonb_build_object(
             'topic_id',        topic_id,
             'title',           title,
             'subject',         subject,
             'ege_numbers',     to_jsonb(coalesce(ege_task_numbers, '{}'::smallint[])),
             'tasks_counted',   tasks_counted,
             'correct_percent', correct_percent
           ) as js
      from topic_stats
  ),
  topic_ranked as (
    select topic_id, js, correct_percent,
           row_number() over (order by correct_percent asc,  topic_id) as rank_low,
           count(*)    over ()                                          as total
      from topic_json
  ),
  weak as (
    select topic_id, js, correct_percent
      from topic_ranked
     where rank_low <= least(c_topic_limit, ceil(total / 2.0))
  ),
  strong as (
    select topic_id, js, correct_percent
      from topic_ranked
     where topic_id not in (select topic_id from weak)
     order by correct_percent desc, topic_id
     limit c_topic_limit
  ),
  number_rows as (
    select n::int as ege_number, tr.verdict
      from task_rows tr
      cross join lateral unnest(tr.ege_task_numbers) as n
  ),
  number_stats as (
    select ege_number,
           count(*)::int as tasks_counted,
           round(
             sum(case verdict when 'correct' then 1.0 when 'partial' then 0.5 else 0 end)
             / count(*) * 100
           )::int as correct_percent
      from number_rows
     group by ege_number
    having count(*) >= c_min_tasks
  ),
  video as (
    select coalesce(sum(seconds), 0)::int as seconds,
           coalesce(sum(seconds) filter (where day > p_to - 7), 0)::int as seconds_last_week
      from public.video_watch_daily
     where student_id = v_profile_id
       and day between p_from and p_to
  ),
  materials as (
    select count(*)::int as views
      from public.material_views
     where profile_id = v_profile_id
       and viewed_on between p_from and p_to
  ),
  catalog as (
    select count(*)::int as solved
      from public.catalog_task_progress
     where user_id = v_profile_id
       and is_completed
       and completed_at is not null
       and completed_at >= p_from::timestamptz
       and completed_at <  (p_to + 1)::timestamptz
  ),
  targets as (
    select subject::text as subject, exam_type::text as exam_type, target_score
      from public.student_subject_targets
     where student_id = p_student_id
  ),
  subject_keys as (
    select subject, exam_type from subject_groups
    union select subject, exam_type from targets
    union select subject, exam_type from work_stats
  ),
  -- ── §261: работы периода (student_work_rows — одно место с карточкой учителя) ──────────────────
  work_period as materialized (
    select w.* from public.student_work_rows(p_student_id) w
     where (w.grp = 'assessment' and w.work_date between p_from and p_to)
        or (w.grp = 'homework' and (
              w.due_at between p_from and p_to
           or (w.due_at is null and (w.first_submitted_at at time zone 'Europe/Moscow')::date between p_from and p_to)))
  ),
  exam_goals as (
    select g.subject::text as subject, g.goal
      from public.student_exam_goals g
     where g.profile_id = v_profile_id
  ),
  subjects as (
    select jsonb_agg(jsonb_build_object(
             'subject',        k.subject,
             'exam_type',      k.exam_type,
             'course_titles',  sg.course_titles,
             'target',         tg.target_score,
             'avg_percent',    ws.avg_percent,
             'graded_works',   coalesce(ws.graded_works, 0),
             'group_size',     coalesce(sg.group_size, 0),
             'group_avg_percent',
               case when coalesce(sg.group_size, 0) >= c_min_group then ps.group_avg_percent end,
             'works', jsonb_build_object(
               'submitted', coalesce(ws.submitted, 0),
               'accepted',  coalesce(ws.accepted, 0),
               'revision',  coalesce(ws.revision, 0),
               'pending',   coalesce(ws.pending, 0),
               'with_due',  coalesce(ws.with_due, 0),
               'on_time',   coalesce(ws.on_time, 0),
               'late',      coalesce(ws.late, 0)
             ),
             'weeks', coalesce(wk.weeks, '[]'::jsonb),
             'last_mock', (
               select jsonb_build_object(
                        'date', mr.date, 'title', mr.title, 'score', mr.score,
                        'part1', mr.part1_score, 'part2', mr.part2_score,
                        'group_avg', mr.group_avg, 'group_size', mr.group_size,
                        'delta', mr.delta)
                 from mock_rows mr
                where mr.subject = k.subject and mr.exam_type = k.exam_type
                order by mr.date desc
                limit 1
             ),
             -- §261
             'exam_goal', case when k.exam_type = 'ege' then (select eg.goal from exam_goals eg where eg.subject = k.subject) end,
             'assessments', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'date', w.work_date, 'title', w.title, 'kind', w.kind,
                        'status', w.status, 'score', w.score, 'grade_scale', w.grade_scale,
                        'points', w.points, 'points_max', w.points_max,
                        -- Правило 2 (приватность): средняя по классу — только от c_min_group человек.
                        'class_avg', case when w.class_size >= c_min_group then w.class_avg end,
                        'class_size', w.class_size)
                      order by w.work_date, w.title)
                 from work_period w
                where w.grp = 'assessment' and w.subject = k.subject and w.exam_type = k.exam_type
             ), '[]'::jsonb),
             'homeworks', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'title', w.title, 'due_at', w.due_at, 'first_submitted_at', w.first_submitted_at,
                        'status', w.status, 'score', w.score, 'grade_scale', w.grade_scale)
                      order by w.work_date, w.title)
                 from work_period w
                where w.grp = 'homework' and w.subject = k.subject and w.exam_type = k.exam_type
             ), '[]'::jsonb)
           ) order by k.subject, k.exam_type) as rows
      from subject_keys k
      left join subject_groups sg on sg.subject = k.subject and sg.exam_type = k.exam_type
      left join work_stats     ws on ws.subject = k.subject and ws.exam_type = k.exam_type
      left join weeks_by_subject wk on wk.subject = k.subject and wk.exam_type = k.exam_type
      left join peer_stats     ps on ps.subject = k.subject and ps.exam_type = k.exam_type
      left join targets        tg on tg.subject = k.subject and tg.exam_type = k.exam_type
  )

  select jsonb_build_object(
    'student', jsonb_build_object(
      'id',        p_student_id,
      'full_name', (select p.full_name from public.profiles p where p.id = v_profile_id),
      'grade',     (select s.grade from public.students s where s.id = p_student_id),
      'groups',    coalesce((select jsonb_agg(group_name order by group_name) from my_groups), '[]'::jsonb)
    ),
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'generated_at', now(),
    'min_group_for_avg', c_min_group,
    'min_tasks_for_topic', c_min_tasks,
    'subjects', coalesce((select rows from subjects), '[]'::jsonb),
    'mocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', date, 'title', title, 'subject', subject, 'exam_type', exam_type,
               'score', score, 'part1', part1_score, 'part2', part2_score,
               'group_avg', group_avg, 'group_size', group_size, 'delta', delta
             ) order by date)
        from mock_rows), '[]'::jsonb),
    'topics', jsonb_build_object(
      'weak',   coalesce((select jsonb_agg(js order by correct_percent asc,  topic_id) from weak),   '[]'::jsonb),
      'strong', coalesce((select jsonb_agg(js order by correct_percent desc, topic_id) from strong), '[]'::jsonb),
      'without_number', coalesce((
        select count(*) from topic_stats
         where coalesce(array_length(ege_task_numbers, 1), 0) = 0), 0)
    ),
    'ege_numbers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'number', ege_number,
               'tasks_counted', tasks_counted,
               'correct_percent', correct_percent
             ) order by ege_number)
        from number_stats), '[]'::jsonb),
    'activity', jsonb_build_object(
      'video_seconds',           (select seconds from video),
      'video_seconds_last_week', (select seconds_last_week from video),
      'materials',               (select views from materials),
      'catalog_tasks',           (select solved from catalog),
      'with_due', coalesce((select sum(with_due) from work_stats), 0),
      'on_time',  coalesce((select sum(on_time)  from work_stats), 0),
      'late',     coalesce((select sum(late)     from work_stats), 0)
    ),
    'next_steps', coalesce((
      select to_jsonb(steps) from public.student_report_next_steps
       where student_id = p_student_id and period_from = p_from and period_to = p_to
    ), '[]'::jsonb),
    'teacher_note', (
      select jsonb_build_object('body', n.body, 'created_at', n.created_at)
        from public.student_feedback_notes n
       where n.student_id = p_student_id and n.kind = 'saved'
       order by n.created_at desc
       limit 1
    ),
    -- §261
    'forecast', v_fc,
    'diligence', jsonb_build_object(
      'solve_days', (select count(*)::int from public.student_solve_days(v_profile_id) x
                      where x.day between p_from and least(p_to, v_today)),
      'period_days', greatest(0, least(p_to, v_today) - p_from + 1),
      'streak', coalesce(v_streak.streak, 0),
      'catalog_correct', (select count(*)::int from public.catalog_counted_solutions(v_profile_id) s
                           where s.at >= p_from::timestamptz and s.at < (p_to + 1)::timestamptz),
      'achievements_earned', coalesce((v_ach->>'earned')::int, 0),
      'achievements_total', coalesce((v_ach->>'total')::int, 0),
      'level', v_points->'level',
      'levels_count', jsonb_array_length(coalesce(v_points->'levels', '[]'::jsonb))
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.student_progress_report(uuid, date, date) is
  '§217/§261. Отчёт об успеваемости одним вызовом: ученик + границы периода → готовые числа для экрана и листа родителю. Средний балл всегда с числом проверенных работ; среднее по группе (и по классу у проверочных) только от шести человек; тема идёт в списки от трёх заданий. §261: цель ученика, проверочные периода с баллами по критериям, ДЗ периода (срок и первая сдача), свидетельства прогноза на конец периода (показывать ли — решает клиент правилом покрытия §255), «старание за период». Только персонал курса ученика — ученику отказ.';

revoke all on function public.student_progress_report(uuid, date, date) from public, anon;
grant execute on function public.student_progress_report(uuid, date, date) to authenticated;

-- ══ Пробы для прода (выполнять ОТДЕЛЬНЫМИ операторами, в откатываемом блоке; set_config — отдельно) ══
-- begin;
-- select set_config('role', 'authenticated', true);
-- -- 1) учитель курса 10А/11А → объект; время (цель < 300 мс):
-- select set_config('request.jwt.claims', '{"sub":"<uuid учителя курса>","role":"authenticated"}', true);
-- explain (analyze, timing off) select public.student_overview_for_staff('<uuid ученика 11А>');
-- select jsonb_array_length(x->'assessments') a, jsonb_array_length(x->'homeworks') h,
--        jsonb_array_length(x->'forecast'->'evidence') ev, x->'points'->'level' lvl, x->'activity'->'streak' streak
--   from (select public.student_overview_for_staff('<uuid ученика 11А>') x) t;
-- -- 2) посторонний преподаватель → ERROR 42501
-- select set_config('request.jwt.claims', '{"sub":"<uuid чужого учителя>","role":"authenticated"}', true);
-- select public.student_overview_for_staff('<uuid ученика 11А>');
-- rollback;  -- после ошибки — новый begin
-- -- 3) ученик про другого ученика → 42501; 4) anon → permission denied (42501)
-- -- 5) отчёт: прежние поля не изменились — сравнить с ответом ДО применения на том же ученике и периоде:
-- --    select x - 'generated_at' - 'forecast' - 'diligence' ... (subjects — без exam_goal/assessments/homeworks)
-- -- 6) ученик главной: student_exam_forecast_evidence() и student_school_points() отвечают как до применения
-- --    (сравнить total/level/feed и число evidence у ученика 11А).
