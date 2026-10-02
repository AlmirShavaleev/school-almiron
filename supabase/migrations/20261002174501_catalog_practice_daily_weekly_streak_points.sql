-- §256 — часть 3 из 3. Применено оркестратором 02.10 MCP apply_migration (версия 20261002174501); прежде — PENDING_256.sql.
-- Применённый текст — тот же без строк-комментариев и `comment on`; объяснения решений — здесь и в PROJECT_STATE.md §256.

-- ══ 7. Задача дня и цель недели ════════════════════════════════════════════
create or replace function public.student_daily_task(p_subject text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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
  if p_subject is null or p_subject not in ('math', 'physics') then
    raise exception 'BAD_SUBJECT: предмет math или physics' using errcode = '22023';
  end if;
  -- Только предмет ЕГЭ-курса ученика.
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
    -- Самый слабый номер, где есть задача, которую ученик ещё не пробовал.
    select w.n into v_pick from public.student_weak_numbers(v_uid, p_subject) w
     where w.untried > 0 order by w.ord limit 1;
    if found then
      select ct.id into v_task
        from public.catalog_tasks ct
        join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published
       where ct.is_published
         and cs.exam_number = v_pick.n
         and public.catalog_subject_key(cs.subject, cs.exam_type) = p_subject
         and coalesce(ct.exam_part, 1) = 1
         and public.catalog_task_checkable(ct.exam_part, ct.answer_html, ct.partial_type)
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
      -- Засчитано +10: верно в тот же день без открытого ответа.
      'solved', exists (select 1 from public.catalog_task_attempts a
                         where a.profile_id = v_uid and a.task_id = ct.id and a.verdict = 'correct'),
      'done', exists (select 1 from public.catalog_task_attempts a
                       where a.profile_id = v_uid and a.task_id = ct.id and a.verdict = 'correct'
                         and not a.revealed_before
                         and (a.created_at at time zone 'Europe/Moscow')::date = v_row.day)
    )
    from public.catalog_tasks ct
    join public.catalog_sections cs on cs.id = ct.section_id
   where ct.id = v_row.task_id
  );
end;
$$;

comment on function public.student_daily_task(text) is
  '§256. Задача дня (Москва) по предмету ЕГЭ ученика: при первом вызове за день — самый слабый номер части 1 (student_weak_numbers) и задача, которую ученик ещё не пробовал; выбор записывается в student_daily_tasks, дальше в этот день — та же. done — решена верно в тот же день без открытого ответа (+10).';

revoke all on function public.student_daily_task(text) from public, anon;
grant execute on function public.student_daily_task(text) to authenticated;

create or replace function public.student_weekly_goal(p_subject text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_rules jsonb := public.catalog_reward_rules();
  v_week  date := date_trunc('week', (now() at time zone 'Europe/Moscow'))::date;
  v_row   record;
  v_nums  integer[];
  v_prog  integer;
begin
  if v_uid is null then
    raise exception 'student_weekly_goal: нужен вход' using errcode = '42501';
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
    return jsonb_build_object('week_start', v_week, 'subject', p_subject, 'numbers', null);
  end if;

  select g.* into v_row from public.student_weekly_goals g
   where g.profile_id = v_uid and g.week_start = v_week and g.subject = p_subject;
  if not found then
    select array_agg(w.n order by w.ord) into v_nums
      from (select w.n, w.ord from public.student_weak_numbers(v_uid, p_subject) w
             order by w.ord limit (v_rules->>'weekly_numbers')::int) w;
    if v_nums is null then
      return jsonb_build_object('week_start', v_week, 'subject', p_subject, 'numbers', null);
    end if;
    insert into public.student_weekly_goals (profile_id, week_start, subject, numbers, target)
    values (v_uid, v_week, p_subject, v_nums, (v_rules->>'weekly_target')::int)
    on conflict (profile_id, week_start, subject) do nothing;
    select g.* into v_row from public.student_weekly_goals g
     where g.profile_id = v_uid and g.week_start = v_week and g.subject = p_subject;
  end if;

  select count(*)::int into v_prog
    from public.catalog_counted_solutions(v_uid) s
   where s.subject = v_row.subject and s.n = any (v_row.numbers)
     and (s.at at time zone 'Europe/Moscow')::date between v_row.week_start and v_row.week_start + 6;

  return jsonb_build_object(
    'week_start', v_row.week_start,
    'week_end', v_row.week_start + 6,
    'subject', v_row.subject,
    'numbers', to_jsonb(v_row.numbers),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('n', x.n, 'section_id', x.id, 'title', x.title) order by x.n)
        from (
          select distinct on (cs.exam_number) cs.exam_number::int as n, cs.id, cs.title
            from public.catalog_sections cs
           where cs.is_published and cs.exam_number = any (v_row.numbers)
             and public.catalog_subject_key(cs.subject, cs.exam_type) = v_row.subject
           order by cs.exam_number, cs.position, cs.id
        ) x), '[]'::jsonb),
    'target', v_row.target,
    'progress', v_prog,
    'done', v_prog >= v_row.target,
    'bonus', (v_rules->>'weekly_goal')::int
  );
end;
$$;

comment on function public.student_weekly_goal(text) is
  '§256. Цель недели (пн–вс по Москве): при первом вызове за неделю фиксирует два слабейших номера части 1 (student_weak_numbers) и цель 10 задач; прогресс — засчитанные задачи каталога этих номеров за неделю; +40 при достижении (начисляет student_school_points).';

revoke all on function public.student_weekly_goal(text) from public, anon;
grant execute on function public.student_weekly_goal(text) to authenticated;

-- Учитель: «Каталог за 7 дней: решено N, верно M» в карточке ученика.
-- Персонал курса ученика (auth_is_staff_of_student → course_is_staff) или админ.
create or replace function public.student_catalog_week_for_staff(p_student_id uuid)
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
    raise exception 'student_catalog_week_for_staff: нужен вход' using errcode = '42501';
  end if;
  if not (public.is_admin_or_owner() or public.auth_is_staff_of_student(p_student_id)) then
    raise exception 'ACCESS_DENIED: только персонал курса ученика' using errcode = '42501';
  end if;
  select s.profile_id into v_profile from public.students s where s.id = p_student_id;
  return (
    select jsonb_build_object(
      'days', 7,
      'tried', count(distinct a.task_id)::int,
      'correct', count(distinct a.task_id) filter (where a.verdict = 'correct' and not a.revealed_before)::int)
      from public.catalog_task_attempts a
     where a.profile_id = v_profile and a.created_at >= now() - interval '7 days'
  );
end;
$$;

comment on function public.student_catalog_week_for_staff(uuid) is
  '§256. Каталог ученика за 7 дней для его преподавателя: tried — задач с проверенным ответом, correct — засчитано верных (без открытого ответа). Только персонал курса ученика или админ.';

revoke all on function public.student_catalog_week_for_staff(uuid) from public, anon;
grant execute on function public.student_catalog_week_for_staff(uuid) to authenticated;

-- ══ 8. §254: главная — серия по новому правилу ═════════════════════════════
-- Меняется только серия: streak/record — student_solve_streak (дни с решением),
-- добавлены solved_today и streak_days (дни окна, засчитанные в серию — точки
-- недели в плашке). visits и цвет календаря (student_solved_task_days) как были.
create or replace function public.student_home_activity(p_days integer default 84)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_today  date := (now() at time zone 'Europe/Moscow')::date;
  v_days   integer := least(greatest(coalesce(p_days, 84), 7), 371);
  v_from   date;
  v_streak record;
begin
  if v_uid is null then
    raise exception 'student_home_activity: нужен вход' using errcode = '42501';
  end if;

  v_from := v_today - (v_days - 1);
  select * into v_streak from public.student_solve_streak(v_uid, v_today);

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
        from public.student_solve_days(v_uid) x
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
          from public.topic_done_events() e
         where e.student_id in (select id from st)
      ),
      per_topic as (
        select m.course_id, t.id,
               public.topic_open_now(t.is_open, t.available_from) as open_now,
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
$$;

comment on function public.student_home_activity(integer) is
  '§254/§256. Главная ученика: серия и рекорд по дням с решением (student_solve_streak, §256), дни серии и заходов за p_days (7..371), решённые задачи по дням (student_solved_task_days), пройденные темы по курсам. Только свои данные — от auth.uid().';

revoke all on function public.student_home_activity(integer) from public, anon;
grant execute on function public.student_home_activity(integer) to authenticated;

-- ══ 9. §255: свидетельства прогноза — каталог по проверенным ответам ════════
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
    ev as (
      select e.* from public.student_exam_evidence_rows(v_uid, v_from) e
       where e.subject in (select subject from my_subjects) and e.at <= now()
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
    -- §256: зона и засчитанное по каждому номеру — для «Решите в каталоге».
    nums as (
      select ti.subject, ti.n, ti.section_id from titles ti where ti.subject in (select subject from my_subjects)
    ),
    arr as (
      select array_agg(subject order by subject, n) as s, array_agg(n order by subject, n) as ns,
             array_agg(now() order by subject, n) as ats
        from nums
    ),
    zones as (
      select arr.s[z.idx] as subject, arr.ns[z.idx] as n, z.share, z.zone
        from arr, lateral public.student_kim_zone_shares(v_uid, arr.s, arr.ns, arr.ats) z
       where arr.s is not null
    ),
    solved as (
      select s.subject, s.n, count(*)::int as k from public.catalog_counted_solutions(v_uid) s group by 1, 2
    )
    select jsonb_build_object(
      'today', (now() at time zone 'Europe/Moscow')::date,
      'now', now(),
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
            on g.profile_id = v_uid and g.subject::text = ms.subject
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
    )
  );
end;
$$;

comment on function public.student_exam_forecast_evidence() is
  '§255/§256. Свидетельства для «Примерного балла на ЕГЭ» за 180 дней (student_exam_evidence_rows: ДЗ, тесты, пробники, проверенные ответы каталога и вариантов) по ЕГЭ-предметам ученика + цели, названия и разделы номеров, зона и засчитанное по каждому номеру (§256), правила наград каталога. Только свои данные — от auth.uid(). Модель считает клиент (egeForecast.ts).';

revoke all on function public.student_exam_forecast_evidence() from public, anon;
grant execute on function public.student_exam_forecast_evidence() to authenticated;

-- ══ 10. §255: баллы школы — каталог по зоне, вехи, задача дня, цель недели ══
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

  -- ══ ПРАВИЛА — одна таблица (каталог — в catalog_reward_rules()). ══
  c_hw_ontime  constant int := 10;  -- ДЗ сдано до срока (первая сдача; срока нет — тоже вовремя)
  c_hw_late    constant int := 4;   -- ДЗ сдано после срока
  c_grade5     constant int := 10;  -- работа принята с оценкой 5 (пятибалльная шкала)
  c_grade4     constant int := 6;   -- принята с оценкой 4
  c_accepted   constant int := 6;   -- принята без пятибалльной шкалы (без баллов или стобалльная)
  c_variant    constant int := 2;   -- задача варианта / к уроку решена верно (вердикт базы)
  c_mock_point constant int := 1;   -- пробник: за каждый первичный балл
  c_streak_day constant int := 3;   -- день серии (с решением), если он второй подряд и дальше
  c_levels     constant int[]  := array[0, 100, 200, 300, 450, 600, 800, 1000, 1250, 1500];
  c_names      constant text[] := array['Старт', 'Разгон', 'Ритм', 'Упорство', 'Система',
                                        'Уверенность', 'Опыт', 'Глубина', 'Мастерство', 'Вершина'];
  c_badge_streak  constant int := 7;    -- «Неделя без пропусков»: серия дней с решением 7 (рекорд)
  c_badge_ontime  constant int := 10;
  c_badge_mock    constant int := 1;
  c_badge_catalog constant int := 100;  -- «100 задач каталога»: засчитанные задачи с проверкой
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
    -- Задачи вариантов и к уроку (вердикт базы): задача один раз, по раннему.
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
    -- Каталог с проверкой: засчитанные решения и зона номера НА МОМЕНТ каждого.
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
    -- Серия — дни с решением (§256), а не заходы.
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
    ),
    tot as (
      select coalesce(sum(points), 0)::int as total from ev
    ),
    lvl as (
      select max(i) as n from tot, generate_subscripts(c_levels, 1) i where c_levels[i] <= tot.total
    ),
    -- Лента: последние 6 начислений; каталог и варианты — одной строкой на день.
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
      'rules', jsonb_build_object(
        'hw_ontime', c_hw_ontime, 'hw_late', c_hw_late, 'grade5', c_grade5, 'grade4', c_grade4,
        'accepted', c_accepted, 'variant', c_variant, 'mock_point', c_mock_point, 'streak_day', c_streak_day),
      'catalog_rules', v_rules,
      'feed', coalesce((select jsonb_agg(to_jsonb(f) order by f.at desc) from feed f), '[]'::jsonb),
      'badges', jsonb_build_array(
        jsonb_build_object('key', 'streak7', 'need', c_badge_streak,
          'have', coalesce((select s.record from public.student_solve_streak(v_uid, v_today) s), 0)),
        jsonb_build_object('key', 'ontime10', 'need', c_badge_ontime,
          'have', (select count(*)::int from ev where kind = 'hw_ontime')),
        jsonb_build_object('key', 'mock1', 'need', c_badge_mock,
          'have', (select count(distinct s.mock_exam_id)::int from public.mock_exam_task_scores s
                    where s.student_id in (select id from st))),
        jsonb_build_object('key', 'catalog100', 'need', c_badge_catalog,
          'have', (select count(*)::int from sol)))
    )
    from tot, lvl
  );
end;
$$;

comment on function public.student_school_points() is
  '§255/§256. «Баллы школы» из истории (без записи): ДЗ вовремя/после срока, принято 5/4/без шкалы, каталог с проверкой по зоне номера на момент попытки (+5/+3/+1) и вехи 10/20/30, задача дня +10, цель недели +40 (catalog_reward_rules), задачи вариантов и к уроку +2, первичные баллы пробников, дни серии с решением ≥ 2 подряд. Самоотметки «Выполнено» не считаются. Только свои — от auth.uid().';

revoke all on function public.student_school_points() from public, anon;
grant execute on function public.student_school_points() to authenticated;
