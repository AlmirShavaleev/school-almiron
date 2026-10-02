-- §256 — часть 2 из 3. Применено оркестратором 02.10 MCP apply_migration (версия 20261002174335); прежде — PENDING_256.sql.
-- Применённый текст — тот же без строк-комментариев и `comment on`; объяснения решений — здесь и в PROJECT_STATE.md §256.

-- ══ 3. Свидетельства — одно место для прогноза и зоны номера ═══════════════
-- То же, что §255 (20261002153604) считал внутри student_exam_forecast_evidence,
-- вынесено сюда, чтобы зона номера считалась ровно по тем же строкам.
-- Меняется только каталог (решение владельца 02.10):
--   * catalog — ПРОВЕРЕННЫЕ попытки catalog_task_attempts без открытого ответа:
--     задача — одна строка; верно с первой попытки 1, верно после неверной 0,5
--     (как «частично» в ДЗ: подбор ответа — не то же, что решить), только
--     неверные 0. Дата — верная попытка, иначе первая. Самоотметки
--     («Выполнено», catalog_task_progress) сюда больше не идут.
--   * variant — ответы вариантов и задач к уроку (test_variant_answers с
--     вердиктом базы is_correct): верно 1 (после нескольких попыток урока 0,5),
--     неверно 0; самооценка (is_correct null) пропускается. Источник 'catalog'.
-- ЕГЭ — subject 'math'/'physics'; каталог ОГЭ — 'oge-…' (только для зоны).
create or replace function public.student_exam_evidence_rows(p_profile_id uuid, p_from timestamptz)
returns table (subject text, ns integer[], source text, score numeric, at timestamptz, item text, kim_total integer)
language sql
stable
set search_path = public, pg_temp
as $$
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
      join public.catalog_tasks ct on ct.id = x.task_id and ct.is_published
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
      join public.catalog_tasks ct on ct.id = vi.task_id and ct.is_published
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
$$;

comment on function public.student_exam_evidence_rows(uuid, timestamptz) is
  '§256. Свидетельства ученика по номерам КИМ с p_from: hw (таблица проверки работ с вердиктом), test (тесты тем), mock (пробники), catalog (проверенные попытки каталога без открытого ответа: верно 1 / верно после неверной 0,5 / неверно 0; ответы вариантов и задач к уроку). Одно место для прогноза (student_exam_forecast_evidence) и зоны номера (student_kim_zone_shares). Внутренняя.';

revoke all on function public.student_exam_evidence_rows(uuid, timestamptz) from public, anon, authenticated;

-- ══ 4. Зона номера — одно определение ══════════════════════════════════════
-- Доля верного среди свидетельств номера за window_days ДО момента at
-- (строго раньше): темы с k ≤ 3 номерами — с долей 1/k (как в прогнозе),
-- шире — пропускаются. Пробы передаются массивами (subject, n, at) — так
-- баллы школы считают зону на момент КАЖДОЙ попытки одним проходом по
-- свидетельствам. Пробник с чужой нумерацией года здесь не отсеивается
-- (прогноз отсеивает его на клиенте) — мелкое расхождение, см. §256.
create or replace function public.student_kim_zone_shares(
  p_profile_id uuid, p_subjects text[], p_ns integer[], p_ats timestamptz[]
)
returns table (idx integer, share numeric, zone text, weight numeric)
language sql
stable
set search_path = public, pg_temp
as $$
  with r as (
    select (public.catalog_reward_rules()->>'window_days')::int * interval '1 day' as win
  ),
  probes as (
    select p.subject, p.n, p.at, p.idx::int as idx
      from unnest(p_subjects, p_ns, p_ats) with ordinality as p(subject, n, at, idx)
  ),
  ev as materialized (
    select e.subject, e.ns, e.score, e.at, 1.0 / cardinality(e.ns) as w
      from r, public.student_exam_evidence_rows(p_profile_id, (select min(at) from probes) - r.win) e
     where cardinality(e.ns) between 1 and 3
  ),
  agg as (
    select p.idx,
           round(sum(e.score * e.w) / nullif(sum(e.w), 0), 4) as share,
           coalesce(sum(e.w), 0) as weight
      from probes p
      cross join r
      left join ev e
        on e.subject = p.subject and p.n = any (e.ns)
       and e.at < p.at and e.at >= p.at - r.win
     group by p.idx
  )
  select a.idx, a.share, public.catalog_zone_of(a.share), round(a.weight, 3) from agg a order by a.idx;
$$;

comment on function public.student_kim_zone_shares(uuid, text[], integer[], timestamptz[]) is
  '§256. Зона номера КИМ (growth | progress | confident) по свидетельствам student_exam_evidence_rows за окно правил до момента at — для набора проб (subject, n, at). Одно определение зоны для проверки ответа, баллов школы, задачи дня и цели недели. Внутренняя.';

revoke all on function public.student_kim_zone_shares(uuid, text[], integer[], timestamptz[]) from public, anon, authenticated;

-- Засчитанные решения каталога: по задаче — ПЕРВАЯ верная попытка без
-- открытого ответа (после верной попыток больше не пишется). Только
-- опубликованные задачи в разделах с номером.
create or replace function public.catalog_counted_solutions(p_profile_id uuid)
returns table (task_id uuid, attempt_id uuid, at timestamptz, subject text, n integer, section_id uuid)
language sql
stable
set search_path = public, pg_temp
as $$
  select distinct on (a.task_id)
         a.task_id, a.id, a.created_at,
         public.catalog_subject_key(cs.subject, cs.exam_type), cs.exam_number::int, cs.id
    from public.catalog_task_attempts a
    join public.catalog_tasks ct on ct.id = a.task_id and ct.is_published
    join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published
   where a.profile_id = p_profile_id
     and a.verdict = 'correct'
     and not a.revealed_before
     and cs.exam_number >= 1
     and public.catalog_subject_key(cs.subject, cs.exam_type) is not null
   order by a.task_id, a.created_at, a.id;
$$;

revoke all on function public.catalog_counted_solutions(uuid) from public, anon, authenticated;

-- Слабые номера части 1 предмета ЕГЭ — один порядок для задачи дня и цели
-- недели: доля (нет данных = 0), меньше свидетельств, меньше номер. Только
-- номера, где есть опубликованные проверяемые задачи части 1; untried —
-- сколько из них ученик ещё не пробовал и не открывал.
create or replace function public.student_weak_numbers(p_profile_id uuid, p_subject text)
returns table (n integer, share numeric, zone text, weight numeric, untried integer, ord integer)
language sql
stable
set search_path = public, pg_temp
as $$
  with nums as (
    select cs.exam_number::int as n,
           count(*) filter (
             where not exists (select 1 from public.catalog_task_attempts a where a.profile_id = p_profile_id and a.task_id = ct.id)
               and not exists (select 1 from public.catalog_task_reveals rv where rv.profile_id = p_profile_id and rv.task_id = ct.id)
           )::int as untried
      from public.catalog_sections cs
      join public.catalog_tasks ct on ct.section_id = cs.id and ct.is_published
     where cs.is_published and cs.exam_number >= 1
       and public.catalog_subject_key(cs.subject, cs.exam_type) = p_subject
       and coalesce(ct.exam_part, 1) = 1
       and public.catalog_task_checkable(ct.exam_part, ct.answer_html, ct.partial_type)
     group by cs.exam_number
  ),
  arr as (
    select array_agg(p_subject order by n) as s, array_agg(n order by n) as ns,
           array_agg(now() order by n) as ats, array_agg(untried order by n) as un
      from nums
  ),
  z as (
    select arr.ns[z.idx] as n, z.share, z.zone, z.weight, arr.un[z.idx] as untried
      from arr, lateral public.student_kim_zone_shares(p_profile_id, arr.s, arr.ns, arr.ats) z
     where arr.ns is not null
  )
  select z.n, z.share, z.zone, z.weight, z.untried,
         (row_number() over (order by coalesce(z.share, 0), z.weight, z.n))::int
    from z;
$$;

revoke all on function public.student_weak_numbers(uuid, text) from public, anon, authenticated;

-- ══ 5. Серия по «дням с решением» — одно определение ═══════════════════════
-- День засчитывается, если ученик что-то РЕШИЛ (решение владельца 02.10, п. 5):
--   * верно решил задачу каталога с проверкой (без открытого ответа) или задачу
--     варианта / к уроку (вердикт базы is_correct);
--   * сдал ДЗ (topic_homework_attempts.submitted_at);
--   * завершил тест темы (topic_test_attempts.completed_at, status completed);
--   * писал пробник (есть баллы пробника; день — starts_at, у старых date).
-- Просто заход (app_visits) день не засчитывает. Дни — по Москве.
create or replace function public.student_solve_days(p_profile_id uuid)
returns table (day date)
language sql
stable
set search_path = public, pg_temp
as $$
  with st as (
    select s.id from public.students s where s.profile_id = p_profile_id
  ),
  ev as (
    select a.created_at as at
      from public.catalog_task_attempts a
     where a.profile_id = p_profile_id and a.verdict = 'correct' and not a.revealed_before
    union all
    select coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at)
      from public.test_variant_student_assignments sa
      join public.test_variant_answers a on a.student_assignment_id = sa.id
     where sa.student_id in (select id from st) and a.is_correct
    union all
    select a.submitted_at
      from public.topic_homework_attempts a
     where a.student_id in (select id from st) and a.submitted_at is not null
    union all
    select att.completed_at
      from public.topic_test_attempts att
     where att.student_id in (select id from st) and att.status = 'completed' and att.completed_at is not null
    union all
    select coalesce(me.starts_at, me.date)
      from public.mock_exam_task_scores s
      join public.mock_exams me on me.id = s.mock_exam_id
     where s.student_id in (select id from st)
  )
  select distinct (ev.at at time zone 'Europe/Moscow')::date from ev where ev.at is not null;
$$;

comment on function public.student_solve_days(uuid) is
  '§256. Дни (Москва), когда ученик что-то решил: верная задача каталога с проверкой без открытого ответа или верный ответ варианта/задачи к уроку, сданное ДЗ, завершённый тест темы, пробник. Одно определение «дня серии». Внутренняя.';

revoke all on function public.student_solve_days(uuid) from public, anon, authenticated;

-- Серия — ряд дней с решением, кончающийся СЕГОДНЯ или ВЧЕРА (сегодня ещё
-- ничего — серия не обнуляется до конца дня); рекорд — за всю историю.
create or replace function public.student_solve_streak(p_profile_id uuid, p_today date)
returns table (streak integer, record integer, solved_today boolean)
language sql
stable
set search_path = public, pg_temp
as $$
  with d as (
    select x.day from public.student_solve_days(p_profile_id) x where x.day <= p_today
  ),
  g as (
    select d.day, d.day - (row_number() over (order by d.day))::int as grp from d
  ),
  runs as (
    select max(g.day) as last_day, count(*)::int as len from g group by g.grp
  )
  select
    coalesce((select r.len from runs r where r.last_day >= p_today - 1 order by r.last_day desc limit 1), 0),
    coalesce((select max(r.len) from runs r), 0),
    exists (select 1 from d where d.day = p_today);
$$;

comment on function public.student_solve_streak(uuid, date) is
  '§256. Серия дней с решением (student_solve_days), кончающаяся p_today или днём раньше; рекорд за всю историю; решал ли что-то p_today. Внутренняя.';

revoke all on function public.student_solve_streak(uuid, date) from public, anon, authenticated;

-- ══ 6. Проверка ответа и раскрытие ═════════════════════════════════════════
create or replace function public.catalog_check_answer(p_task_id uuid, p_answer text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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

  select ct.id, ct.answer_html, ct.partial_type, ct.exam_part, cs.subject, cs.exam_type, cs.exam_number
    into v_task
    from public.catalog_tasks ct
    join public.catalog_sections cs on cs.id = ct.section_id
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

  -- Одна задача — по очереди (двойной клик не засчитает её дважды).
  perform pg_advisory_xact_lock(hashtext('catalog_check:' || v_uid::text || ':' || p_task_id::text));

  if (select count(*) from public.catalog_task_attempts a
       where a.profile_id = v_uid and a.created_at > now() - interval '1 minute')
     >= (v_rules->>'checks_per_minute')::int then
    raise exception 'RATE_LIMIT: не больше % проверок в минуту', v_rules->>'checks_per_minute' using errcode = '54000';
  end if;

  v_correct := public.catalog_task_verdict(v_task.answer_html, v_task.partial_type, v_answer);
  v_subject := public.catalog_subject_key(v_task.subject, v_task.exam_type);
  v_n := case when v_task.exam_number >= 1 then v_task.exam_number::int end;

  -- Уже решена (верная попытка есть) — повтор ничего не пишет и не начисляет.
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

  -- Зона — НА МОМЕНТ попытки, по истории до неё.
  if v_subject is not null and v_n is not null then
    select z.share, z.zone into v_share, v_zone
      from public.student_kim_zone_shares(v_uid, array[v_subject], array[v_n], array[now()]) z;
  end if;

  insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, revealed_before)
  values (v_uid, p_task_id, v_answer, case when v_correct then 'correct' else 'wrong' end, v_revealed);

  v_counted := v_correct and not v_revealed;

  if v_correct then
    -- Решённая задача — «Выполнено» и в каталоге (счётчики страниц и §246);
    -- в прогноз и баллы отметка по-прежнему не идёт.
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
$$;

comment on function public.catalog_check_answer(uuid, text) is
  '§256. Проверка ответа на задачу каталога от auth.uid(): задача опубликована и проверяема (часть 1, catalog_task_checkable), вердикт — правило вариантов (catalog_task_verdict), запись попытки (catalog_task_attempts). Засчитывается первая верная попытка без открытого ответа: баллы по зоне номера НА МОМЕНТ попытки, вехи 10/20/30, задача дня, цель недели. Правильный ответ — только при верном. Не больше 30 проверок в минуту (RATE_LIMIT, 54000).';

revoke all on function public.catalog_check_answer(uuid, text) from public, anon;
grant execute on function public.catalog_check_answer(uuid, text) to authenticated;

create or replace function public.catalog_reveal_answer(p_task_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_task   record;
  v_solved boolean;
begin
  if v_uid is null then
    raise exception 'catalog_reveal_answer: нужен вход' using errcode = '42501';
  end if;
  select ct.id, ct.answer_html, ct.solution_html into v_task
    from public.catalog_tasks ct
    join public.catalog_sections cs on cs.id = ct.section_id
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
    -- Решена до раскрытия — уже засчитана, раскрытие ничего не отнимает.
    'solved_before', v_solved
  );
end;
$$;

comment on function public.catalog_reveal_answer(uuid) is
  '§256. Отметить, что ученик открыл ответ (или решение) задачи каталога: дальнейшие попытки — revealed_before, в прогноз и баллы не идут. Возвращает ответ. Решённую задачу раскрытие не трогает.';

revoke all on function public.catalog_reveal_answer(uuid) from public, anon;
grant execute on function public.catalog_reveal_answer(uuid) to authenticated;

-- Состояние для страницы каталога одним вызовом: номер раздела (зона, сколько
-- засчитано, вехи), задачи страницы (проверяема ли, попытки, решена, открыт ли
-- ответ), правила для таблицы наград.
create or replace function public.catalog_practice_state(p_section_id uuid, p_task_ids uuid[] default '{}')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
  if cardinality(v_ids) > 300 then
    raise exception 'TOO_MANY: не больше 300 задач за раз' using errcode = '22023';
  end if;

  select cs.id, cs.subject, cs.exam_type, cs.exam_number, cs.title into v_sec
    from public.catalog_sections cs where cs.id = p_section_id and cs.is_published;
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
        from public.catalog_tasks ct
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
$$;

comment on function public.catalog_practice_state(uuid, uuid[]) is
  '§256. Каталог глазами ученика одним вызовом: номер раздела (зона на сейчас, засчитано задач), задачи страницы (проверяема ли, попытки, последний вердикт, решена, засчитана, открыт ли ответ) и правила наград. Только свои данные.';

revoke all on function public.catalog_practice_state(uuid, uuid[]) from public, anon;
grant execute on function public.catalog_practice_state(uuid, uuid[]) to authenticated;
