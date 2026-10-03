-- §261, часть 3/4. Применено оркестратором 03.10 (MCP apply_migration, версия 20261003114528); применённый текст — без строк-комментариев, comment on и хвостовых комментариев.
-- ══ 3. Работы ученика — одно место для карточки и отчёта ═══════════════════════════════════════════
-- По курсам ГРУПП ученика, только опубликованные ДЗ тем (h.is_published):
--   grp 'assessment' — тема kind check/control (проверочная/контрольная, как §249 course_assessment_grades);
--                     попадает, если у ученика есть попытка или день работы уже наступил (будущая
--                     проверочная — не «не писал»). День работы — начало окна (opens_at, по Москве),
--                     без окна — первая сдача.
--   grp 'homework'   — остальные темы (ДЗ урока, как §250 course_homework_grades); попадает, если тема
--                     открыта (topic_open_now — единственное правило открытости) или у ученика есть
--                     попытка. День — срок (due_at), без срока — первая сдача.
-- first_submitted_at — ПЕРВАЯ сдача (min submitted_at), правило «вовремя» §259 (src/lib/homeworkDeadline.ts);
-- status / score — ПОСЛЕДНЯЯ попытка и ПОСЛЕДНИЙ вердикт учителя (как §249/§250), score — только у принятой.
-- points / points_max — §260: таблица преподавателя у этой принятой попытки (topic_homework_review_tasks,
--   только строки с max_points; «не решено» — 0). Предложение ИИ (topic_homework_ai_jobs.points_*) НЕ берётся.
-- class_avg / class_graded / class_size — только у проверочных: средний балл принятых последних попыток
--   учеников групп курса (включая самого), сколько их и размер класса. Чужих имён и баллов наружу нет.
-- Внутренняя: execute ни у кого из клиентских ролей.
create or replace function public.student_work_rows(p_student_id uuid)
returns table (
  grp text, homework_id uuid, topic_id uuid, course_id uuid, subject text, exam_type text, kind text,
  title text, due_at date, opens_at timestamptz, work_date date, first_submitted_at timestamptz,
  status text, score numeric, grade_scale text, points numeric, points_max numeric,
  class_avg numeric, class_graded integer, class_size integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  with my_courses as (
    select distinct g.course_id
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
     where gs.student_id = p_student_id and g.course_id is not null
  ),
  hw as (
    select h.id as homework_id, t.id as topic_id, m.course_id,
           c.subject::text as subject, c.exam_type::text as exam_type,
           t.kind, coalesce(nullif(btrim(t.title), ''), h.title) as title,
           h.due_at, h.opens_at, h.grade_scale,
           public.topic_open_now(t.is_open, t.available_from) as topic_open,
           t.kind in ('check', 'control') as is_assessment
      from my_courses mc
      join public.modules m on m.course_id = mc.course_id
      join public.courses c on c.id = m.course_id
      join public.topics t on t.module_id = m.id
      join public.topic_homework h on h.topic_id = t.id
     where h.is_published
  ),
  mine as (
    select a.id, a.homework_id, a.status::text as status, a.attempt_number, a.submitted_at
      from public.topic_homework_attempts a
     where a.student_id = p_student_id
       and a.homework_id in (select homework_id from hw)
  ),
  first_sub as (
    select homework_id, min(submitted_at) as at from mine group by homework_id
  ),
  last_att as (
    select distinct on (homework_id) id, homework_id, status
      from mine
     order by homework_id, attempt_number desc
  ),
  last_rv as (
    select distinct on (rv.attempt_id) rv.attempt_id, rv.score
      from public.topic_homework_reviews rv
     where rv.attempt_id in (select id from last_att)
     order by rv.attempt_id, rv.created_at desc, rv.id desc
  ),
  pts as (
    select rt.attempt_id,
           sum(case when rt.verdict = 'unsolved' then 0 else rt.points end) as points,
           sum(rt.max_points) as points_max
      from public.topic_homework_review_tasks rt
     where rt.attempt_id in (select id from last_att where status = 'accepted')
       and rt.max_points is not null
     group by rt.attempt_id
  ),
  roster as (
    select distinct g.course_id, gs.student_id
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
     where g.course_id in (select course_id from my_courses)
  ),
  class_size as (
    select course_id, count(*)::int as n from roster group by course_id
  ),
  class_last as (
    select distinct on (a.homework_id, a.student_id) a.id, a.homework_id, a.status::text as status
      from public.topic_homework_attempts a
      join hw on hw.homework_id = a.homework_id and hw.is_assessment
      join roster r on r.course_id = hw.course_id and r.student_id = a.student_id
     order by a.homework_id, a.student_id, a.attempt_number desc
  ),
  class_scores as (
    select cl.homework_id, round(avg(x.score)::numeric, 2) as avg_score, count(*)::int as graded
      from class_last cl
      cross join lateral (
        select rv.score from public.topic_homework_reviews rv
         where rv.attempt_id = cl.id
         order by rv.created_at desc, rv.id desc
         limit 1
      ) x
     where cl.status = 'accepted' and x.score is not null
     group by cl.homework_id
  ),
  rows_ as (
    select hw.*,
           fs.at as first_submitted_at,
           la.id as last_id, la.status as last_status,
           case when la.status = 'accepted' then lr.score end as last_score,
           case when hw.is_assessment
                then coalesce((hw.opens_at at time zone 'Europe/Moscow')::date, (fs.at at time zone 'Europe/Moscow')::date)
                else coalesce(hw.due_at, (fs.at at time zone 'Europe/Moscow')::date)
           end as work_date
      from hw
      left join first_sub fs on fs.homework_id = hw.homework_id
      left join last_att la on la.homework_id = hw.homework_id
      left join last_rv lr on lr.attempt_id = la.id
  )
  select case when r.is_assessment then 'assessment' else 'homework' end,
         r.homework_id, r.topic_id, r.course_id, r.subject, r.exam_type, r.kind,
         r.title, r.due_at, r.opens_at, r.work_date, r.first_submitted_at,
         r.last_status, r.last_score::numeric, r.grade_scale,
         p.points, p.points_max,
         case when r.is_assessment then cs.avg_score end,
         case when r.is_assessment then coalesce(cs.graded, 0) else 0 end,
         coalesce(sz.n, 0)
    from rows_ r
    left join pts p on p.attempt_id = r.last_id and r.last_status = 'accepted'
    left join class_scores cs on cs.homework_id = r.homework_id
    left join class_size sz on sz.course_id = r.course_id
   where case when r.is_assessment
              then r.last_id is not null or r.work_date <= (now() at time zone 'Europe/Moscow')::date
              else r.last_id is not null or r.topic_open
         end;
$$;

comment on function public.student_work_rows(uuid) is
  '§261. Работы ученика по курсам его групп: проверочные/контрольные (assessment, как §249) и ДЗ уроков (homework, как §250) — первая сдача (правило «вовремя» §259), статус последней попытки и последний вердикт учителя, баллы по критериям из таблицы преподавателя (§260, не предложение ИИ), средняя по классу у проверочных. Одно место для карточки учителя и отчёта родителю. Внутренняя.';

revoke all on function public.student_work_rows(uuid) from public, anon, authenticated;

-- ══ 4. Карточка ученика у учителя — одним вызовом ═══════════════════════════════════════════════
-- p_subject — необязательный фильтр работ и прогноза по предмету курса ('math', 'physics', …); null —
-- всё (клиент так и зовёт: переключатель предмета у него мгновенный, без второго запроса).
-- Прогноз НЕ считается здесь: отдаются свидетельства (forecast — тот же ответ, что
-- student_exam_forecast_evidence() у ученика), модель — клиент, egeForecast.ts (одно место).
create or replace function public.student_overview_for_staff(p_student_id uuid, p_subject text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_today   date := (now() at time zone 'Europe/Moscow')::date;
  v_week    date := date_trunc('week', (now() at time zone 'Europe/Moscow'))::date;
  v_streak  record;
  v_points  jsonb;
  v_fc      jsonb;
begin
  if auth.uid() is null then
    raise exception 'student_overview_for_staff: нужен вход' using errcode = '42501';
  end if;
  if p_student_id is null then
    raise exception 'student_overview_for_staff: нужен ученик' using errcode = '22023';
  end if;
  if not (public.is_admin_or_owner() or public.auth_is_staff_of_student(p_student_id)) then
    raise exception 'ACCESS_DENIED: только персонал курса ученика' using errcode = '42501';
  end if;

  select s.profile_id into v_profile from public.students s where s.id = p_student_id;
  if v_profile is null then
    raise exception 'Ученик не найден' using errcode = 'P0002';
  end if;

  select * into v_streak from public.student_solve_streak(v_profile, v_today);
  v_points := public.student_school_points_of(v_profile);
  v_fc := public.student_forecast_evidence_of(v_profile, now());
  if p_subject is not null then
    v_fc := v_fc
      || jsonb_build_object(
           'subjects', coalesce((select jsonb_agg(x) from jsonb_array_elements(v_fc->'subjects') x where x->>'subject' = p_subject), '[]'::jsonb),
           'evidence', coalesce((select jsonb_agg(x) from jsonb_array_elements(v_fc->'evidence') x where x->>'subject' = p_subject), '[]'::jsonb),
           'numbers',  coalesce((select jsonb_agg(x) from jsonb_array_elements(v_fc->'numbers') x where x->>'subject' = p_subject), '[]'::jsonb),
           'titles',   coalesce((select jsonb_agg(x) from jsonb_array_elements(v_fc->'titles') x where x->>'subject' = p_subject), '[]'::jsonb));
  end if;

  return (
    with works as materialized (
      select w.* from public.student_work_rows(p_student_id) w
       where p_subject is null or w.subject = p_subject
    ),
    my_courses as (
      select c.id, c.title, c.subject::text as subject, c.exam_type::text as exam_type
        from public.group_students gs
        join public.groups g on g.id = gs.group_id
        join public.courses c on c.id = g.course_id
       where gs.student_id = p_student_id
    ),
    solve_days as (
      select x.day from public.student_solve_days(v_profile) x
       where x.day between v_today - 13 and v_today
    ),
    daily as (
      select d.day, d.subject,
             exists (
               select 1 from public.catalog_task_attempts a
                where a.profile_id = d.profile_id and a.task_id = d.task_id
                  and a.verdict = 'correct' and not a.revealed_before
                  and (a.created_at at time zone 'Europe/Moscow')::date = d.day) as done
        from public.student_daily_tasks d
       where d.profile_id = v_profile and d.day between v_today - 13 and v_today
         and (p_subject is null or d.subject = p_subject)
    ),
    sol as materialized (
      select s.* from public.catalog_counted_solutions(v_profile) s
    ),
    weekly as (
      select g.subject, g.week_start, g.numbers, g.target,
             (select count(*)::int from sol s
               where s.subject = g.subject and s.n = any (g.numbers)
                 and (s.at at time zone 'Europe/Moscow')::date between g.week_start and g.week_start + 6) as progress
        from public.student_weekly_goals g
       where g.profile_id = v_profile and g.week_start = v_week
         and (p_subject is null or g.subject = p_subject)
    )
    select jsonb_build_object(
      'student_id', p_student_id,
      'today', v_today,
      'now', now(),
      'subject', p_subject,
      'subjects', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'subject', x.subject, 'exam_type', x.exam_type,
                 'course_titles', x.titles) order by x.subject, x.exam_type)
          from (select subject, exam_type, string_agg(distinct title, ' · ') as titles
                  from my_courses group by subject, exam_type) x
      ), '[]'::jsonb),
      'forecast', v_fc,
      'activity', jsonb_build_object(
        'streak', coalesce(v_streak.streak, 0),
        'record', coalesce(v_streak.record, 0),
        'solved_today', coalesce(v_streak.solved_today, false),
        'days', coalesce((select jsonb_agg(d.day order by d.day) from solve_days d), '[]'::jsonb),
        'daily', jsonb_build_object(
          'days', 14,
          'assigned', (select count(*)::int from daily),
          'done', (select count(*)::int from daily where done)),
        'weekly', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'subject', w.subject, 'week_start', w.week_start, 'numbers', to_jsonb(w.numbers),
                   'target', w.target, 'progress', w.progress) order by w.subject)
            from weekly w), '[]'::jsonb),
        'catalog', jsonb_build_object(
          'total', (select count(*)::int from sol s where p_subject is null or s.subject = p_subject),
          'week', public.student_catalog_week_for_staff(p_student_id))
      ),
      'achievements', public.student_achievements_for_staff(p_student_id),
      'points', jsonb_build_object(
        'total', v_points->'total',
        'level', v_points->'level',
        'levels_count', jsonb_array_length(coalesce(v_points->'levels', '[]'::jsonb))),
      'assessments', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'homework_id', w.homework_id, 'topic_id', w.topic_id, 'course_id', w.course_id,
                 'subject', w.subject, 'exam_type', w.exam_type, 'kind', w.kind, 'title', w.title,
                 'date', w.work_date, 'opens_at', w.opens_at, 'first_submitted_at', w.first_submitted_at,
                 'status', w.status, 'score', w.score, 'grade_scale', w.grade_scale,
                 'points', w.points, 'points_max', w.points_max,
                 'class_avg', w.class_avg, 'class_graded', w.class_graded, 'class_size', w.class_size)
               order by w.work_date desc nulls last, w.title)
          from works w where w.grp = 'assessment'
      ), '[]'::jsonb),
      'homeworks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'homework_id', w.homework_id, 'topic_id', w.topic_id, 'course_id', w.course_id,
                 'subject', w.subject, 'exam_type', w.exam_type, 'title', w.title,
                 'due_at', w.due_at, 'date', w.work_date, 'first_submitted_at', w.first_submitted_at,
                 'status', w.status, 'score', w.score, 'grade_scale', w.grade_scale)
               order by w.work_date desc nulls last, w.title)
          from works w where w.grp = 'homework'
      ), '[]'::jsonb),
      -- «Что делать до следующей встречи» — последняя сохранённая запись отчёта (§217): та же таблица,
      -- второй копии нет; правят во вкладке «Отчёт».
      'next_steps', (
        select jsonb_build_object('period_from', n.period_from, 'period_to', n.period_to,
                                  'steps', to_jsonb(n.steps), 'updated_at', n.updated_at)
          from public.student_report_next_steps n
         where n.student_id = p_student_id and coalesce(array_length(n.steps, 1), 0) > 0
         order by n.period_to desc, n.updated_at desc
         limit 1)
    )
  );
end;
$$;

comment on function public.student_overview_for_staff(uuid, text) is
  '§261. Карточка ученика у учителя одним вызовом: предметы курсов, свидетельства прогноза (как у ученика, student_forecast_evidence_of), серия/рекорд/дни с решением за 14 дней, задача дня и цель недели, каталог с проверкой, награды, уровень баллов школы, проверочные с баллами по критериям и средней по классу, ДЗ со сроками и первой сдачей, последнее «что делать». p_subject — фильтр по предмету (null — всё). Только персонал курса ученика или админ; иначе 42501.';

revoke all on function public.student_overview_for_staff(uuid, text) from public, anon;
grant execute on function public.student_overview_for_staff(uuid, text) to authenticated;
