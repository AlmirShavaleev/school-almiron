-- §261 — «Ученик целиком»: карточка ученика у учителя + отчёт родителю с прогнозом, проверочными и стараем.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration одной транзакцией, после чего файл
-- переименовывается в <version>_<name>.sql точно по записи в supabase_migrations.schema_migrations
-- (MIGRATIONS.md). Повторяемая: только `create or replace function`, ни одного drop, таблицы и
-- политики не меняются.
--
-- Что здесь:
--   1. student_forecast_evidence_of(profile, as_of)  — НОВАЯ внутренняя: тело student_exam_forecast_evidence()
--      (§255/§256, 20261002174501) с параметром «чей» и «на какой момент». Сама
--      student_exam_forecast_evidence() — create or replace С ПРЕЖНИМ КОНТРАКТОМ: тот же ответ, теперь
--      одной строкой вызывает внутреннюю от auth.uid() на now(). Копии логики нет — учитель и отчёт
--      родителю получают ровно те же свидетельства, что ученик на главной.
--   2. student_school_points_of(profile)             — НОВАЯ внутренняя: тело student_school_points()
--      (§257, 20261002194103) с параметром «чей». student_school_points() — create or replace с прежним
--      контрактом (обёртка от auth.uid()). Правила баллов и уровни остаются ОДНОЙ таблицей констант.
--   3. student_work_rows(student)                    — НОВАЯ внутренняя: работы ученика по курсам его
--      групп — проверочные/контрольные (тема kind check/control, как §249) и ДЗ уроков (как §250), с
--      первой сдачей (правило §259), вердиктом учителя, баллами по критериям (§260, таблица
--      преподавателя topic_homework_review_tasks.points — НЕ предложение ИИ из topic_homework_ai_jobs)
--      и средней по классу для проверочных. Одно место для карточки и для отчёта.
--   4. student_overview_for_staff(student, subject)  — НОВАЯ definer: всё для карточки ученика одним
--      вызовом. Только персонал курса ученика (auth_is_staff_of_student → course_is_staff) или админ,
--      иначе 42501; anon — нет execute.
--   5. student_progress_report(student, from, to)    — create or replace С СОВМЕСТИМЫМ ОТВЕТОМ (§217,
--      20260925184917): все прежние поля и их расчёт дословно; добавлены только новые поля —
--      subjects[].exam_goal, subjects[].assessments, subjects[].homeworks, forecast, diligence.
--
-- Почему отчёт — расширением student_progress_report, а карточка — новой функцией: у отчёта есть
-- период, «что делать» на паре «ученик + период» и правило «среднее по группе только от шести»; у
-- карточки периода нет («сейчас»), зато есть серия, задача дня, цель недели, награды. Общее (свидетельства,
-- работы, баллы школы) вынесено во внутренние функции 1–3, поэтому двух копий расчёта нет.
--
-- Каждая колонка, которую читают новые функции, — в миграциях репозитория (см. supabase/tests/uchenik_261/
-- 05_slice_261.sql: таблица «колонка → миграция»).

-- ══ 1. Свидетельства прогноза — одно место для ученика, учителя и отчёта ═══════════════════════════
-- То же, что 20261002174501 (student_exam_forecast_evidence, §256), с двумя параметрами:
--   p_profile_id — чей (profiles.id ученика), p_as_of — на какой момент (ученик и учитель — now();
--   отчёт за прошлый период — конец периода). Окно — 180 дней ДО p_as_of; свидетельства позже p_as_of
--   не берутся; зона номера считается на p_as_of; «решено» каталога — не позже p_as_of.
-- Внутренняя: execute ни у кого из клиентских ролей; зовут definer-функции ниже (они уже проверили права).
create or replace function public.student_forecast_evidence_of(p_profile_id uuid, p_as_of timestamptz)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
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
  ev as (
    select e.* from public.student_exam_evidence_rows(p_profile_id, p_as_of - interval '180 days') e
     where e.subject in (select subject from my_subjects) and e.at <= p_as_of
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
  arr as (
    select array_agg(subject order by subject, n) as s, array_agg(n order by subject, n) as ns,
           array_agg(p_as_of order by subject, n) as ats
      from nums
  ),
  zones as (
    select arr.s[z.idx] as subject, arr.ns[z.idx] as n, z.share, z.zone
      from arr, lateral public.student_kim_zone_shares(p_profile_id, arr.s, arr.ns, arr.ats) z
     where arr.s is not null
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
$$;

comment on function public.student_forecast_evidence_of(uuid, timestamptz) is
  '§261. Свидетельства «Примерного балла на ЕГЭ» ученика p_profile_id на момент p_as_of (180 дней до него): то же, что §255/§256 student_exam_forecast_evidence() — цели, названия и разделы номеров, зона и засчитанное по номеру, правила каталога, свидетельства student_exam_evidence_rows. Одно место для главной ученика, карточки учителя и отчёта родителю. Внутренняя.';

revoke all on function public.student_forecast_evidence_of(uuid, timestamptz) from public, anon, authenticated;

-- Прежний контракт: тот же ответ, от auth.uid() на now().
create or replace function public.student_exam_forecast_evidence()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'student_exam_forecast_evidence: нужен вход' using errcode = '42501';
  end if;
  return public.student_forecast_evidence_of(v_uid, now());
end;
$$;

comment on function public.student_exam_forecast_evidence() is
  '§255/§256/§261. Свидетельства для «Примерного балла на ЕГЭ» за 180 дней по ЕГЭ-предметам ученика + цели, названия и разделы номеров, зона и засчитанное по каждому номеру, правила наград каталога. Только свои данные — от auth.uid(). Расчёт — student_forecast_evidence_of (§261, одно место с карточкой учителя и отчётом). Модель считает клиент (egeForecast.ts).';

revoke all on function public.student_exam_forecast_evidence() from public, anon;
grant execute on function public.student_exam_forecast_evidence() to authenticated;

-- ══ 2. Баллы школы — одно место для ученика и учителя ══════════════════════════════════════════════
-- Тело — ДОСЛОВНО §257 (20261002194103, student_school_points), v_uid — параметр. Правила (константы ниже)
-- живут только здесь; student_school_points() — обёртка от auth.uid().
create or replace function public.student_school_points_of(p_profile_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := p_profile_id;
  v_today date := (now() at time zone 'Europe/Moscow')::date;

  -- ══ ПРАВИЛА — одна таблица (каталог — в catalog_reward_rules(), награды — в achievement_rules()). ══
  c_hw_ontime  constant int := 10;  -- ДЗ сдано до срока (первая сдача; срока нет — тоже вовремя)
  c_hw_late    constant int := 4;   -- ДЗ сдано после срока
  c_grade5     constant int := 10;  -- работа принята с оценкой 5 (пятибалльная шкала)
  c_grade4     constant int := 6;   -- принята с оценкой 4
  c_accepted   constant int := 6;   -- принята без пятибалльной шкалы (без баллов или стобалльная)
  c_variant    constant int := 2;   -- задача варианта / к уроку решена верно (вердикт базы)
  c_mock_point constant int := 1;   -- пробник: за каждый первичный балл
  c_streak_day constant int := 3;   -- день серии (с решением), если он второй подряд и дальше
  -- §257: 20 уровней (баллы пошли быстрее — награды). Первые 9 названий прежние, «Вершина» — последний.
  c_levels     constant int[]  := array[0, 100, 200, 300, 450, 600, 800, 1000, 1250, 1500,
                                        1800, 2150, 2550, 3000, 3500, 4100, 4800, 5600, 6500, 7500];
  c_names      constant text[] := array['Старт', 'Разгон', 'Ритм', 'Упорство', 'Система',
                                        'Уверенность', 'Опыт', 'Глубина', 'Мастерство', 'Точность',
                                        'Выдержка', 'Сила', 'Размах', 'Стратегия', 'Мудрость',
                                        'Эксперт', 'Виртуоз', 'Триумф', 'Высота', 'Вершина'];
  v_rules jsonb := public.catalog_reward_rules();
begin
  if v_uid is null then
    raise exception 'student_school_points_of: нужен ученик' using errcode = '22023';
  end if;

  return (
    with st as (
      select s.id from public.students s where s.profile_id = v_uid
    ),
    first_sub as (
      select h.id as homework_id, t.title as topic_title, h.due_at, min(a.submitted_at) as at
        from public.topic_homework_attempts a
        join public.topic_homework h on h.id = a.homework_id
        join public.topics t on t.id = h.topic_id
       where a.student_id in (select id from st) and a.submitted_at is not null
       group by h.id, t.title, h.due_at
    ),
    last_accept as (
      select distinct on (a.homework_id)
             a.homework_id, r.created_at as at, r.score, h.grade_scale, t.title
        from public.topic_homework_reviews r
        join public.topic_homework_attempts a on a.id = r.attempt_id
        join public.topic_homework h on h.id = a.homework_id
        join public.topics t on t.id = h.topic_id
       where a.student_id in (select id from st) and r.decision = 'accepted'
       order by a.homework_id, r.created_at desc
    ),
    variant as (
      select vi.task_id,
             min(coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at)) as at
        from public.test_variant_student_assignments sa
        join public.test_variant_answers a on a.student_assignment_id = sa.id
        join public.test_variant_items vi on vi.id = a.variant_item_id
        join public.catalog_tasks ct on ct.id = vi.task_id and ct.is_published
        join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published and cs.exam_number >= 1
       where sa.student_id in (select id from st) and a.is_correct
       group by vi.task_id
    ),
    sol as materialized (
      select s.*, row_number() over (partition by s.subject, s.n order by s.at, s.task_id)::int as k
        from public.catalog_counted_solutions(v_uid) s
    ),
    sol_arr as (
      select array_agg(subject order by at, task_id) as s, array_agg(n order by at, task_id) as ns,
             array_agg(at order by at, task_id) as ats, array_agg(task_id order by at, task_id) as tids
        from sol
    ),
    sol_zone as (
      select sa.tids[z.idx] as task_id, z.zone
        from sol_arr sa, lateral public.student_kim_zone_shares(v_uid, sa.s, sa.ns, sa.ats) z
       where sa.s is not null
    ),
    cat as (
      select s.task_id, s.at, s.subject, s.n, s.k, zz.zone,
             public.catalog_zone_points(zz.zone) as points,
             public.catalog_zone_milestone(zz.zone, s.k) as mile
        from sol s join sol_zone zz on zz.task_id = s.task_id
    ),
    daily as (
      select d.day, d.n, min(a.created_at) as at
        from public.student_daily_tasks d
        join public.catalog_task_attempts a
          on a.profile_id = d.profile_id and a.task_id = d.task_id
         and a.verdict = 'correct' and not a.revealed_before
         and (a.created_at at time zone 'Europe/Moscow')::date = d.day
       where d.profile_id = v_uid
       group by d.day, d.n
    ),
    weekly as (
      select g.week_start, g.numbers, g.target,
             (select x.at from (
                select s.at, row_number() over (order by s.at, s.task_id) as rn
                  from sol s
                 where s.subject = g.subject and s.n = any (g.numbers)
                   and (s.at at time zone 'Europe/Moscow')::date between g.week_start and g.week_start + 6
              ) x where x.rn = g.target) as at
        from public.student_weekly_goals g
       where g.profile_id = v_uid
    ),
    mock as (
      select me.id, me.title, coalesce(me.starts_at, me.date) as at, sum(s.points)::int as pts
        from public.mock_exam_task_scores s
        join public.mock_exams me on me.id = s.mock_exam_id
       where s.student_id in (select id from st)
       group by me.id, me.title, coalesce(me.starts_at, me.date)
    ),
    sdays as (
      select x.day, x.day - (row_number() over (order by x.day))::int as grp
        from public.student_solve_days(v_uid) x
       where x.day <= v_today
    ),
    runs as (
      select (s.day::timestamp + interval '20 hours') at time zone 'Europe/Moscow' as at, s.day,
             row_number() over (partition by s.grp order by s.day)::int as day_in_run
        from sdays s
    ),
    ach as (
      select sa.key, sa.earned_at as at, r.points, r.threshold
        from public.student_achievements sa
        join public.achievement_rules() r on r.key = sa.key
       where sa.profile_id = v_uid and r.points > 0
    ),
    ev as (
      select case when f.due_at is null or (f.at at time zone 'Europe/Moscow')::date <= f.due_at
                  then 'hw_ontime' else 'hw_late' end as kind,
             f.at,
             case when f.due_at is null or (f.at at time zone 'Europe/Moscow')::date <= f.due_at
                  then c_hw_ontime else c_hw_late end as points,
             f.topic_title as title, null::int as n
        from first_sub f
      union all
      select 'hw_grade', la.at,
             case when la.grade_scale = 'five' and la.score = 5 then c_grade5
                  when la.grade_scale = 'five' and la.score = 4 then c_grade4
                  when la.grade_scale = 'five' and la.score is not null then 0
                  else c_accepted end,
             la.title, case when la.grade_scale = 'five' then la.score end
        from last_accept la
      union all
      select 'catalog', c.at, c.points, null, 1 from cat c
      union all
      select 'catalog_milestone', c.at, c.mile, null, c.k from cat c where c.mile > 0
      union all
      select 'daily', d.at, (v_rules->>'daily_task')::int, null, d.n from daily d
      union all
      select 'weekly', w.at, (v_rules->>'weekly_goal')::int, null, w.target from weekly w where w.at is not null
      union all
      select 'variant', v.at, c_variant, null, 1 from variant v
      union all
      select 'mock', m.at, c_mock_point * m.pts, m.title, m.pts from mock m where m.pts > 0
      union all
      select 'streak', r.at, c_streak_day, null, r.day_in_run from runs r where r.day_in_run >= 2
      union all
      select 'achievement', a.at, a.points, a.key, a.threshold from ach a
    ),
    tot as (
      select coalesce(sum(points), 0)::int as total from ev
    ),
    lvl as (
      select max(i) as n from tot, generate_subscripts(c_levels, 1) i where c_levels[i] <= tot.total
    ),
    feed as (
      select x.kind, x.at, x.points, x.title, x.n
        from (
          select kind, at, points, title, n from ev where kind not in ('catalog', 'variant') and points > 0
          union all
          select kind, max(at), sum(points)::int, null, count(*)::int
            from ev where kind in ('catalog', 'variant') and points > 0
           group by kind, (at at time zone 'Europe/Moscow')::date
        ) x
       order by x.at desc
       limit 6
    )
    select jsonb_build_object(
      'total', tot.total,
      'level', jsonb_build_object(
        'n', lvl.n,
        'name', c_names[lvl.n],
        'from', c_levels[lvl.n],
        'next', case when lvl.n < array_length(c_levels, 1) then c_levels[lvl.n + 1] end,
        'next_name', case when lvl.n < array_length(c_names, 1) then c_names[lvl.n + 1] end),
      'levels', to_jsonb(c_levels),
      'level_names', to_jsonb(c_names),
      'rules', jsonb_build_object(
        'hw_ontime', c_hw_ontime, 'hw_late', c_hw_late, 'grade5', c_grade5, 'grade4', c_grade4,
        'accepted', c_accepted, 'variant', c_variant, 'mock_point', c_mock_point, 'streak_day', c_streak_day),
      'catalog_rules', v_rules,
      'achievement_points', (select coalesce(sum(points), 0)::int from ach),
      'feed', coalesce((select jsonb_agg(to_jsonb(f) order by f.at desc) from feed f), '[]'::jsonb)
    )
    from tot, lvl
  );
end;
$$;

comment on function public.student_school_points_of(uuid) is
  '§261. «Баллы школы» ученика p_profile_id — тело §257 student_school_points() с параметром «чей»: правила (константы), 20 уровней, лента, баллы наград. Одно место для ученика (student_school_points) и карточки учителя / отчёта родителю. Внутренняя.';

revoke all on function public.student_school_points_of(uuid) from public, anon, authenticated;

-- Прежний контракт: тот же ответ, от auth.uid().
create or replace function public.student_school_points()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'student_school_points: нужен вход' using errcode = '42501';
  end if;
  return public.student_school_points_of(v_uid);
end;
$$;

comment on function public.student_school_points() is
  '§255/§256/§257/§261. «Баллы школы» из истории: ДЗ вовремя/после срока, принято 5/4/без шкалы, каталог с проверкой по зоне номера и вехи, задача дня, цель недели, задачи вариантов и к уроку, первичные баллы пробников, дни серии с решением ≥ 2 подряд, баллы полученных наград. 20 уровней. Только свои — от auth.uid(); расчёт — student_school_points_of (§261).';

revoke all on function public.student_school_points() from public, anon;
grant execute on function public.student_school_points() to authenticated;

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
