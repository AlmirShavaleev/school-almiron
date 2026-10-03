-- §261, часть 2/4. Применено оркестратором 03.10 (MCP apply_migration, версия 20261003114440); применённый текст — без строк-комментариев, comment on и хвостовых комментариев.
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
