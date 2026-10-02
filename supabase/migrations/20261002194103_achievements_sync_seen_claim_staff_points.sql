-- §257 — часть 2 из 2. Применено оркестратором 02.10 MCP apply_migration (версия 20261002194103); прежде — PENDING_257.sql.
-- Применённый текст — тот же без строк-комментариев и `comment on`; объяснения решений — здесь и в PROJECT_STATE.md §257.

-- ══ 4. Досчёт и ответ ═══════════════════════════════════════════════════════
-- Вставляет недостающие полученные (earned_at — момент из истории, иначе
-- now()); повторный вызов ничего не дублирует (PK + on conflict do nothing).
-- Ответ — все 79 наград: have / need / tier / points / earned_at / is_new
-- (seen_at is null) / fresh (вставлена этим вызовом — тост «Новая награда»
-- показывается ровно один раз).
create or replace function public.student_achievements_sync()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'student_achievements_sync: нужен вход' using errcode = '42501';
  end if;

  with prog as materialized (
    select p.* from public.student_achievement_progress(v_uid) p
  ),
  ins as (
    insert into public.student_achievements (profile_id, key, earned_at)
    select v_uid, p.key, p.reached_at from prog p where p.reached_at is not null
    on conflict (profile_id, key) do nothing
    returning key, earned_at
  ),
  -- Снимок основного запроса вставку не видит: полученные = уже были ∪ вставлено.
  got as (
    select sa.key, sa.earned_at, sa.seen_at is null as is_new, false as fresh
      from public.student_achievements sa where sa.profile_id = v_uid
    union all
    select i.key, i.earned_at, true, true from ins i
  ),
  items as (
    select r.ord, jsonb_build_object(
             'key', r.key, 'category', r.category, 'threshold', r.threshold,
             'tier', r.tier, 'points', r.points,
             'have', coalesce(p.have, 0), 'need', coalesce(p.need, r.threshold),
             'earned_at', g.earned_at,
             'is_new', coalesce(g.is_new, false),
             'fresh', coalesce(g.fresh, false)) as j,
           g.key is not null as earned, coalesce(g.is_new, false) as is_new
      from public.achievement_rules() r
      left join prog p on p.key = r.key
      left join got g on g.key = r.key
  )
  select jsonb_build_object(
           'total', count(*),
           'earned', count(*) filter (where earned),
           'new', count(*) filter (where is_new),
           'tiers', (select jsonb_agg(jsonb_build_object('tier', t.tier, 'points', t.points) order by t.tier)
                       from (select tier, max(points) as points from public.achievement_rules()
                              where category <> 'special' group by tier) t),
           'items', jsonb_agg(j order by ord))
    into v_out
    from items;

  return v_out;
end;
$$;

comment on function public.student_achievements_sync() is
  '§257. Награды ученика (от auth.uid()): досчитывает have по категориям (student_achievement_progress), вставляет недостающие полученные в student_achievements (earned_at — момент события), отвечает всеми 79 наградами с have/need/tier/points/earned_at/is_new/fresh. Полученная не отнимается.';

revoke all on function public.student_achievements_sync() from public, anon;
grant execute on function public.student_achievements_sync() to authenticated;

-- «Увидел»: все новые награды ученика помечаются просмотренными (страница
-- «Достижения» открыта). Возвращает, сколько отмечено.
create or replace function public.mark_achievements_seen()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if v_uid is null then
    raise exception 'mark_achievements_seen: нужен вход' using errcode = '42501';
  end if;
  update public.student_achievements set seen_at = now()
   where profile_id = v_uid and seen_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.mark_achievements_seen() from public, anon;
grant execute on function public.mark_achievements_seen() to authenticated;

-- ══ 5. Прогноз от клиента — значок без баллов ═══════════════════════════════
-- Модель прогноза живёт только на клиенте (egeForecast.ts). Клиент сообщает
-- первый показанный балл (запоминается ОДИН раз — дальше игнорируется) и
-- текущий. База проверяет только правдоподобие: предмет ЕГЭ-курса ученика,
-- целые 0..100; «Цель достигнута» — только если цель ученика есть
-- (student_exam_goals). Награды этих ключей — +0 баллов школы
-- (achievement_rules), поэтому подделанные числа ничего не дают, кроме значка.
create or replace function public.claim_forecast_achievement(p_subject text, p_first_score integer, p_current_score integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_mark  record;
  v_goal  integer;
  v_fresh jsonb;
begin
  if v_uid is null then
    raise exception 'claim_forecast_achievement: нужен вход' using errcode = '42501';
  end if;
  if p_subject is null or p_subject not in ('math', 'physics') then
    raise exception 'BAD_SUBJECT: предмет math или physics' using errcode = '22023';
  end if;
  if p_first_score is null or p_current_score is null
     or p_first_score not between 0 and 100 or p_current_score not between 0 and 100 then
    raise exception 'BAD_SCORE: балл прогноза — целое от 0 до 100' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.students s
      join public.group_students gs on gs.student_id = s.id
      join public.groups g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where s.profile_id = v_uid and c.exam_type::text = 'ege' and c.subject::text = p_subject
  ) then
    raise exception 'NOT_YOUR_SUBJECT: у вас нет курса ЕГЭ по этому предмету' using errcode = '22023';
  end if;

  select g.goal into v_goal from public.student_exam_goals g
   where g.profile_id = v_uid and g.subject::text = p_subject;

  insert into public.student_forecast_marks as m (profile_id, subject, first_score, last_score)
  values (v_uid, p_subject, p_first_score, p_current_score)
  on conflict (profile_id, subject) do update
     set last_score = excluded.last_score, last_at = now()
  returning m.* into v_mark;

  if v_goal is not null and p_current_score >= v_goal and v_mark.goal_reached_at is null then
    update public.student_forecast_marks set goal_reached_at = now()
     where profile_id = v_uid and subject = p_subject;
  end if;

  with ins as (
    insert into public.student_achievements (profile_id, key, earned_at)
    select v_uid, r.key, now()
      from public.achievement_rules() r
     where (r.category = 'forecast' and v_mark.last_score - v_mark.first_score >= r.threshold)
        or (r.key = 'special:goal' and v_goal is not null and p_current_score >= v_goal)
    on conflict (profile_id, key) do nothing
    returning key
  )
  select coalesce(jsonb_agg(key), '[]'::jsonb) into v_fresh from ins;

  return jsonb_build_object(
    'subject', p_subject,
    'first', v_mark.first_score,
    'current', v_mark.last_score,
    'growth', v_mark.last_score - v_mark.first_score,
    'goal', v_goal,
    'fresh', v_fresh);
end;
$$;

comment on function public.claim_forecast_achievement(text, integer, integer) is
  '§257. Клиент сообщает прогноз по предмету ЕГЭ-курса: первый показанный балл (запоминается один раз) и текущий. База проверяет правдоподобие (0..100, свой предмет; цель — из student_exam_goals) и пишет награды «Рост прогноза» и «Цель достигнута» — без баллов школы.';

revoke all on function public.claim_forecast_achievement(text, integer, integer) from public, anon;
grant execute on function public.claim_forecast_achievement(text, integer, integer) to authenticated;

-- ══ 6. Учитель: «Достижения: N из 79 · последние: …» ═══════════════════════
-- Только сохранённые награды (без досчёта — запись идёт от самого ученика).
-- Персонал курса ученика (auth_is_staff_of_student → course_is_staff) или админ.
create or replace function public.student_achievements_for_staff(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
begin
  if auth.uid() is null then
    raise exception 'student_achievements_for_staff: нужен вход' using errcode = '42501';
  end if;
  if not (public.is_admin_or_owner() or public.auth_is_staff_of_student(p_student_id)) then
    raise exception 'ACCESS_DENIED: только персонал курса ученика' using errcode = '42501';
  end if;
  select s.profile_id into v_profile from public.students s where s.id = p_student_id;
  return jsonb_build_object(
    'total', (select count(*) from public.achievement_rules()),
    'earned', (select count(*) from public.student_achievements sa
                 join public.achievement_rules() r on r.key = sa.key
                where sa.profile_id = v_profile),
    'latest', coalesce((
      select jsonb_agg(jsonb_build_object('key', x.key, 'category', x.category, 'threshold', x.threshold,
                                          'tier', x.tier, 'points', x.points, 'earned_at', x.earned_at)
                       order by x.earned_at desc, x.ord desc)
        from (
          select sa.key, r.category, r.threshold, r.tier, r.points, r.ord, sa.earned_at
            from public.student_achievements sa
            join public.achievement_rules() r on r.key = sa.key
           where sa.profile_id = v_profile
           order by sa.earned_at desc, r.ord desc
           limit 3
        ) x), '[]'::jsonb)
  );
end;
$$;

comment on function public.student_achievements_for_staff(uuid) is
  '§257. Награды ученика для его преподавателя: сколько из 79 и три последние. Только персонал курса ученика или админ.';

revoke all on function public.student_achievements_for_staff(uuid) from public, anon;
grant execute on function public.student_achievements_for_staff(uuid) to authenticated;

-- ══ 7. §255/§256: баллы школы — + награды, 20 уровней, без старых значков ════
-- Отличия от 20261002174501: (1) баллы полученных наград (student_achievements
-- × achievement_rules, points > 0) — новый вид начисления 'achievement' в ленте
-- (title — ключ награды, n — порог); (2) 20 уровней; (3) 'badges' сняты —
-- пять значков §255 заменены наградами (один механизм, без дублей). Остальное —
-- дословно §256.
create or replace function public.student_school_points()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
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
    raise exception 'student_school_points: нужен вход' using errcode = '42501';
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
    -- §257: полученные награды (сохранённые — не отнимаются); +0 (прогноз) не идут.
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

comment on function public.student_school_points() is
  '§255/§256/§257. «Баллы школы» из истории: ДЗ вовремя/после срока, принято 5/4/без шкалы, каталог с проверкой по зоне номера и вехи, задача дня, цель недели, задачи вариантов и к уроку, первичные баллы пробников, дни серии с решением ≥ 2 подряд, баллы полученных наград (student_achievements × achievement_rules). 20 уровней. Только свои — от auth.uid().';

revoke all on function public.student_school_points() from public, anon;
grant execute on function public.student_school_points() to authenticated;
