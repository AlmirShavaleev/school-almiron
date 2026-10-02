-- §257 — «Достижения» вместо «Мой прогресс»: 79 наград-лестниц, уведомление о
-- новой награде, 20 уровней «Баллов школы».
--
-- НЕ ПРИМЕНЕНА. Применяет оркестратор (MCP apply_migration), после применения
-- файл называется по версии из schema_migrations. ТОЛЬКО ДОБАВЛЕНИЕ: новые
-- таблицы (create table if not exists), политики на НОВЫХ таблицах (через
-- проверку pg_policies — без drop), новые функции и create or replace
-- student_school_points (§255/§256). Ни одного drop. Существующие таблицы не
-- меняются.
--
-- Решения владельца 02.10 (полностью — PROJECT_STATE.md §257):
--   * награды — лестницы по категориям; уровень награды — по месту в лестнице
--     (бронза +10, серебро +25, золото +50, легенда +100), «Особые» — золото +50;
--   * полученная награда НЕ отнимается: таблица student_achievements, досчёт и
--     вставка — student_achievements_sync() (earned_at — момент события из
--     истории, иначе now());
--   * баллы наград входят в student_school_points(); 20 уровней; старые пять
--     значков §255 сняты (один механизм — награды);
--   * «Рост прогноза» и «Цель достигнута»: прогноз считает только клиент
--     (egeForecast.ts), поэтому клиент сообщает числа, база проверяет только
--     правдоподобие и даёт значок БЕЗ баллов школы (+0) — накрутка
--     инструментами браузера ничего не даёт.
--
-- Источники «have» — уже существующие функции §254–§256, своих копий правил нет:
--   catalog_counted_solutions (каталог с проверкой), student_solve_days (серия),
--   student_daily_tasks / student_weekly_goals (как начисляет student_school_points),
--   student_kim_zone_shares (зона номера), topic_done_events (тема пройдена),
--   ДЗ/ревью/пробники — как в student_school_points; тестовый балл пробника —
--   mock_exam_test_score (20260925201156: score_scale[первичный + 1]).

-- ══ 1. Правила — ОДНА таблица ═══════════════════════════════════════════════
-- Ключ, категория, порог, уровень, баллы. Владелец меняет пороги и стоимость
-- здесь; клиент берёт всё из ответа sync и своих чисел не держит.
-- Уровень — по МЕСТУ в лестнице (как tierOf в макете): r = i / (len − 1),
-- r < 0,34 бронза, < 0,67 серебро, < 0,95 золото, иначе легенда.
create or replace function public.achievement_rules()
returns table (key text, category text, threshold integer, tier integer, points integer, ord integer)
language sql
immutable
set search_path = public, pg_temp
as $$
  with tier_points(tier, points) as (
    values (1, 10), (2, 25), (3, 50), (4, 100)
  ),
  -- category, порядок, пороги, без баллов школы (прогноз считает клиент)
  ladders(category, ord, steps, no_points) as (
    values
      ('catalog',   1,  array[1, 5, 10, 20, 50, 100, 200, 500, 1000], false), -- каталог: верно с проверкой (§256)
      ('hw',        2,  array[1, 5, 10, 20, 30, 50, 75, 100],         false), -- сданные ДЗ (разные)
      ('ontime',    3,  array[1, 5, 10, 25, 50],                      false), -- ДЗ вовремя (первая сдача ≤ срока; без срока — вовремя)
      ('five',      4,  array[1, 5, 10, 25],                          false), -- пятёрки (последнее «принято», шкала five)
      ('mock',      5,  array[1, 3, 5, 10],                           false), -- пробники с баллами
      ('mockscore', 6,  array[27, 60, 70, 80, 90],                    false), -- лучший тестовый балл пробника ЕГЭ
      ('streak',    7,  array[3, 7, 14, 30, 60, 100],                 false), -- рекорд серии дней с решением
      ('daily',     8,  array[1, 7, 30, 100],                         false), -- задачи дня, решённые в свой день
      ('weekly',    9,  array[1, 4, 10, 20],                          false), -- выполненные цели недели
      ('confident', 10, array[1, 3, 6, 9, 12],                        false), -- номера части 1 в зоне «уверенно»
      ('closed',    11, array[1, 3, 5],                               false), -- номер был «зона роста» → стал «уверенно»
      ('forecast',  12, array[5, 10, 20, 30],                         true),  -- рост прогноза от первого показа (+0)
      ('tests',     13, array[1, 10, 25, 50],                         false), -- завершённые тесты тем
      ('topics',    14, array[1, 10, 25, 50, 100],                    false), -- пройденные темы (topic_done_events)
      ('redo',      15, array[1, 5, 10],                              false)  -- вернули на доработку → пересдал
  ),
  ladder_rows as (
    select l.category || ':' || s.t as key, l.category, s.t::int as threshold,
           case when x.r < 0.34 then 1 when x.r < 0.67 then 2 when x.r < 0.95 then 3 else 4 end as tier,
           l.no_points, l.ord * 100 + s.i::int as ord
      from ladders l
      cross join lateral unnest(l.steps) with ordinality as s(t, i)
      cross join lateral (select (s.i - 1)::numeric / greatest(cardinality(l.steps) - 1, 1) as r) x
  ),
  -- Особые — золото (+50). Порог — смысл награды: подряд верных, задач за день,
  -- ДЗ за 3+ дня до срока, засчитанных по каждому номеру части 1; «Цель
  -- достигнута» — от клиента, без баллов.
  special_rows(key, threshold, no_points, ord) as (
    values
      ('special:flawless',    10, false, 1601),  -- «Без ошибок»: 10 верных подряд в каталоге
      ('special:marathon',    30, false, 1602),  -- «Марафон»: 30 задач каталога за день (Москва)
      ('special:early',       1,  false, 1603),  -- «Ранняя пташка»: ДЗ сдано за 3+ дня до срока
      ('special:all_numbers', 1,  false, 1604),  -- «Все номера»: ≥ 1 засчитанная по каждому номеру части 1
      ('special:full_kim',    10, false, 1605),  -- «Полный КИМ»: ≥ 10 по каждому номеру части 1
      ('special:goal',        1,  true,  1606)   -- «Цель достигнута»: прогноз ≥ цели ученика (+0)
  )
  select lr.key, lr.category, lr.threshold, lr.tier,
         case when lr.no_points then 0 else tp.points end, lr.ord
    from ladder_rows lr join tier_points tp on tp.tier = lr.tier
  union all
  select sr.key, 'special', sr.threshold, 3,
         case when sr.no_points then 0 else (select points from tier_points where tier = 3) end, sr.ord
    from special_rows sr
  order by 6;
$$;

comment on function public.achievement_rules() is
  '§257. Награды одной таблицей: ключ «категория:порог» (особые — special:…), категория, порог, уровень по месту в лестнице (1 бронза +10, 2 серебро +25, 3 золото +50, 4 легенда +100), баллы школы (рост прогноза и «Цель достигнута» — 0: прогноз считает клиент), порядок. 79 строк.';

revoke all on function public.achievement_rules() from public, anon;
grant execute on function public.achievement_rules() to authenticated;

-- ══ 2. Таблицы ═════════════════════════════════════════════════════════════
-- Полученные награды. Строка не удаляется и не меняется (кроме seen_at):
-- награда не отнимается, даже если «have» потом упал (задачу сняли с
-- публикации, оценку переправили). seen_at — «увидел» (mark_achievements_seen);
-- null — новая: счётчик у пункта меню «Достижения».
create table if not exists public.student_achievements (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  key        text not null check (length(key) between 3 and 64),
  earned_at  timestamptz not null default now(),
  seen_at    timestamptz,
  created_at timestamptz not null default now(),
  primary key (profile_id, key)
);
create index if not exists student_achievements_unseen_idx
  on public.student_achievements (profile_id) where seen_at is null;

-- Прогноз, о котором сообщил клиент: первый показ (first_score — один раз) и
-- последний. Только для «Рост прогноза» и «Цель достигнута» (+0 баллов).
create table if not exists public.student_forecast_marks (
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  subject         text not null check (subject in ('math', 'physics')),
  first_score     smallint not null check (first_score between 0 and 100),
  first_at        timestamptz not null default now(),
  last_score      smallint not null check (last_score between 0 and 100),
  last_at         timestamptz not null default now(),
  goal_reached_at timestamptz,
  primary key (profile_id, subject)
);

alter table public.student_achievements   enable row level security;
alter table public.student_forecast_marks enable row level security;

-- Supabase выдаёт новым таблицам ВСЕ права anon/authenticated — забираем;
-- ученик только читает свои строки, пишут definer-функции ниже.
revoke all on table public.student_achievements   from public, anon, authenticated;
revoke all on table public.student_forecast_marks from public, anon, authenticated;
grant select on table public.student_achievements   to authenticated;
grant select on table public.student_forecast_marks to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'student_achievements' and policyname = 'student_achievements_select_own') then
    create policy student_achievements_select_own on public.student_achievements
      for select to authenticated using (profile_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'student_forecast_marks' and policyname = 'student_forecast_marks_select_own') then
    create policy student_forecast_marks_select_own on public.student_forecast_marks
      for select to authenticated using (profile_id = auth.uid());
  end if;
end $$;

-- ══ 3. «Have» по категориям — одно место ════════════════════════════════════
-- События (метрика, значение, момент, need): для счётных категорий значение —
-- номер события по порядку (k-е ДЗ, k-я задача), момент — когда оно случилось;
-- для «лучшего» (результат пробника, рекорд серии, подряд верных) — значение
-- на этом событии. Тогда для порога t: have = max(значение), получено в
-- min(момент) среди событий со значением ≥ t. Одно правило на все 79.
-- «Номера уверенно» и «Закрыта зона роста» — состояние СЕЙЧАС (момент — now()).
-- Номера части 1 — как egeScales.ts (2026): математика 1–12, физика 1–20.
create or replace function public.student_achievement_progress(p_profile_id uuid)
returns table (key text, have integer, need integer, reached_at timestamptz)
language sql
stable
set search_path = public, pg_temp
-- Планировщик не знает размеров функций-источников (оценка 1000 строк на
-- каждую) и включал JIT: на локальном Postgres 16 компиляция стоила 3,4 с при
-- 36 мс самого запроса. JIT здесь не нужен никогда — данных одного ученика мало.
set jit = off
as $$
  with rules as materialized (
    select r.*, case when r.category = 'special' then r.key else r.category end as metric
      from public.achievement_rules() r
  ),
  st as (
    select s.id from public.students s where s.profile_id = p_profile_id
  ),
  part1(subject, last_n) as (
    values ('math', 12), ('physics', 20)
  ),
  ege_subj as (
    select distinct c.subject::text as subject
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where gs.student_id in (select id from st)
       and c.exam_type::text = 'ege' and c.subject::text in ('math', 'physics')
  ),
  -- Каталог с проверкой (§256): задача один раз, первая верная без раскрытия.
  sol as materialized (
    select s.* from public.catalog_counted_solutions(p_profile_id) s
  ),
  -- ДЗ: первая сдача — как student_school_points (вовремя — по Москве против due_at).
  first_sub as materialized (
    select h.id as homework_id, h.due_at, min(a.submitted_at) as at
      from public.topic_homework_attempts a
      join public.topic_homework h on h.id = a.homework_id
     where a.student_id in (select id from st) and a.submitted_at is not null
     group by h.id, h.due_at
  ),
  last_accept as (
    select distinct on (a.homework_id) a.homework_id, r.created_at as at, r.score, h.grade_scale
      from public.topic_homework_reviews r
      join public.topic_homework_attempts a on a.id = r.attempt_id
      join public.topic_homework h on h.id = a.homework_id
     where a.student_id in (select id from st) and r.decision = 'accepted'
     order by a.homework_id, r.created_at desc
  ),
  -- Вернули на доработку → пересдал: первая сдача после первого возврата.
  redo as (
    select a.homework_id, min(a2.submitted_at) as at
      from public.topic_homework_reviews r
      join public.topic_homework_attempts a on a.id = r.attempt_id
      join public.topic_homework_attempts a2
        on a2.homework_id = a.homework_id and a2.student_id = a.student_id
       and a2.submitted_at > r.created_at
     where a.student_id in (select id from st) and r.decision = 'returned_for_revision'
     group by a.homework_id
  ),
  -- Пробники с баллами; тестовый — mock_exam_test_score по шкале шаблона.
  mocks as (
    select me.id, coalesce(me.starts_at, me.date) as at, me.exam_type::text as exam_type,
           me.template_id, tpl.score_scale, sum(s.points)::int as prim
      from public.mock_exam_task_scores s
      join public.mock_exams me on me.id = s.mock_exam_id
      left join public.mock_exam_templates tpl on tpl.id = me.template_id
     where s.student_id in (select id from st)
     group by me.id, coalesce(me.starts_at, me.date), me.exam_type, me.template_id, tpl.score_scale
  ),
  -- Серия — дни с решением (§256); значение — номер дня в своём ряду.
  sdays as (
    select x.day, x.day - (row_number() over (order by x.day))::int as grp
      from public.student_solve_days(p_profile_id) x
     where x.day <= (now() at time zone 'Europe/Moscow')::date
  ),
  runs as (
    select s.day, row_number() over (partition by s.grp order by s.day)::int as k from sdays s
  ),
  -- Задача дня и цель недели — ровно как начисляет student_school_points.
  daily as (
    select d.day, min(a.created_at) as at
      from public.student_daily_tasks d
      join public.catalog_task_attempts a
        on a.profile_id = d.profile_id and a.task_id = d.task_id
       and a.verdict = 'correct' and not a.revealed_before
       and (a.created_at at time zone 'Europe/Moscow')::date = d.day
     where d.profile_id = p_profile_id
     group by d.day
  ),
  weekly as (
    select g.week_start,
           (select x.at from (
              select s.at, row_number() over (order by s.at, s.task_id) as rn
                from sol s
               where s.subject = g.subject and s.n = any (g.numbers)
                 and (s.at at time zone 'Europe/Moscow')::date between g.week_start and g.week_start + 6
            ) x where x.rn = g.target) as at
      from public.student_weekly_goals g
     where g.profile_id = p_profile_id
  ),
  done as (
    select e.topic_id, min(e.done_at) as at
      from public.topic_done_events() e
     where e.student_id in (select id from st) and e.done_at is not null
     group by e.topic_id
  ),
  tests as (
    select att.id, att.completed_at as at
      from public.topic_test_attempts att
     where att.student_id in (select id from st) and att.status = 'completed' and att.completed_at is not null
  ),
  -- «Без ошибок»: ряды верных проверок каталога (раскрытые — вне счёта).
  att_seq as (
    select a.id, a.created_at, a.verdict,
           row_number() over (order by a.created_at, a.id)
             - row_number() over (partition by a.verdict order by a.created_at, a.id) as grp
      from public.catalog_task_attempts a
     where a.profile_id = p_profile_id and not a.revealed_before
  ),
  flawless as (
    select a.created_at as at, row_number() over (partition by a.grp order by a.created_at, a.id)::int as k
      from att_seq a where a.verdict = 'correct'
  ),
  -- Засчитанные по номерам части 1: момент k-й задачи номера.
  per_number as (
    select s.subject, s.n, s.at, row_number() over (partition by s.subject, s.n order by s.at, s.task_id)::int as k
      from sol s join part1 p on p.subject = s.subject and s.n between 1 and p.last_n
  ),
  -- «Все номера» / «Полный КИМ»: номер покрыт в момент своей t-й задачи
  -- (t — порог правила: 1 и 10); значение — сколько номеров предмета покрыто.
  cover as (
    select r.key, pn.subject, pn.at,
           row_number() over (partition by r.key, pn.subject order by pn.at)::int as k
      from rules r join per_number pn on pn.k = r.threshold
     where r.key in ('special:all_numbers', 'special:full_kim')
  ),
  -- Зона номера — одно определение (student_kim_zone_shares), два вызова:
  -- (1) сейчас по каждому номеру части 1 ЕГЭ-предметов ученика; (2) только для
  -- номеров, которые СЕЙЧАС «уверенно», — сразу после каждого их свидетельства
  -- («был в зоне роста с данными»: доля < 0,4 при весе > 0). Пробы второго
  -- вызова — лишь по уверенным номерам: на ученике с 1300 свидетельствами
  -- один общий вызов по всем номерам стоил 140 мс, этот — десятки.
  -- Темы шире 3 номеров зону не двигают — как в самой функции зоны.
  now_probes as (
    select s.subject, g.n::int as n
      from ege_subj s join part1 p on p.subject = s.subject
      cross join lateral generate_series(1, p.last_n) as g(n)
  ),
  narr as (
    select array_agg(subject order by subject, n) as s, array_agg(n order by subject, n) as ns,
           array_agg(now() order by subject, n) as ats
      from now_probes
  ),
  zz_now as materialized (
    select narr.s[z.idx] as subject, narr.ns[z.idx] as n, z.zone
      from narr, lateral public.student_kim_zone_shares(p_profile_id, narr.s, narr.ns, narr.ats) z
     where narr.s is not null
  ),
  conf as (
    select z.subject, z.n from zz_now z where z.zone = 'confident'
  ),
  evx as (
    select distinct e.subject, u.n::int as n, e.at
      from public.student_exam_evidence_rows(p_profile_id, '-infinity'::timestamptz) e
      cross join lateral unnest(e.ns) as u(n)
     where cardinality(e.ns) between 1 and 3
       and e.at <= now()
       and (e.subject, u.n::int) in (select subject, n from conf)
  ),
  harr as (
    select array_agg(subject order by subject, n, at) as s, array_agg(n order by subject, n, at) as ns,
           array_agg(at + interval '1 microsecond' order by subject, n, at) as ats
      from evx
  ),
  zz_hist as materialized (
    select harr.s[z.idx] as subject, harr.ns[z.idx] as n, z.zone, z.weight
      from harr, lateral public.student_kim_zone_shares(p_profile_id, harr.s, harr.ns, harr.ats) z
     where harr.s is not null
  ),
  closed as (
    select c.subject, c.n from conf c
     where exists (select 1 from zz_hist h
                    where h.subject = c.subject and h.n = c.n
                      and h.zone = 'growth' and h.weight > 0)
  ),
  marks as (
    select m.* from public.student_forecast_marks m where m.profile_id = p_profile_id
  ),
  ev(metric, val, at, need) as (
    select 'catalog', (row_number() over (order by s.at, s.task_id))::int, s.at, null::int from sol s
    union all
    select 'hw', (row_number() over (order by f.at, f.homework_id))::int, f.at, null from first_sub f
    union all
    select 'ontime', (row_number() over (order by f.at, f.homework_id))::int, f.at, null
      from first_sub f
     where f.due_at is null or (f.at at time zone 'Europe/Moscow')::date <= f.due_at
    union all
    select 'special:early', (row_number() over (order by f.at, f.homework_id))::int, f.at, null
      from first_sub f
     where f.due_at is not null and f.due_at - (f.at at time zone 'Europe/Moscow')::date >= 3
    union all
    select 'five', (row_number() over (order by l.at, l.homework_id))::int, l.at, null
      from last_accept l where l.grade_scale = 'five' and l.score = 5
    union all
    select 'mock', (row_number() over (order by m.at, m.id))::int, m.at, null from mocks m
    union all
    select 'mockscore', public.mock_exam_test_score(m.prim, m.score_scale), m.at, null
      from mocks m where m.exam_type = 'ege' and m.template_id is not null
    union all
    select 'streak', r.k, (r.day::timestamp + interval '20 hours') at time zone 'Europe/Moscow', null from runs r
    union all
    select 'daily', (row_number() over (order by d.at))::int, d.at, null from daily d
    union all
    select 'weekly', (row_number() over (order by w.at))::int, w.at, null from weekly w where w.at is not null
    union all
    select 'confident', count(*)::int, now(), null from conf group by subject
    union all
    select 'closed', count(*)::int, now(), null from closed group by subject
    union all
    select 'forecast', greatest(m.last_score - m.first_score, 0), m.last_at, null from marks m
    union all
    select 'special:goal', 1, m.goal_reached_at, null from marks m where m.goal_reached_at is not null
    union all
    select 'tests', (row_number() over (order by t.at, t.id))::int, t.at, null from tests t
    union all
    select 'topics', (row_number() over (order by d.at, d.topic_id))::int, d.at, null from done d
    union all
    select 'redo', (row_number() over (order by x.at, x.homework_id))::int, x.at, null from redo x
    union all
    select 'special:flawless', f.k, f.at, null from flawless f
    union all
    select 'special:marathon', (row_number() over (partition by (s.at at time zone 'Europe/Moscow')::date order by s.at, s.task_id))::int, s.at, null
      from sol s
    union all
    -- need — число номеров части 1 предмета; нулевые строки — чтобы без решений
    -- было «0 из 12», а не «0 из 1».
    select c.key, c.k, c.at, p.last_n from cover c join part1 p on p.subject = c.subject
    union all
    select k.key, 0, null::timestamptz, p.last_n
      from part1 p cross join (values ('special:all_numbers'), ('special:full_kim')) as k(key)
  ),
  cand as (
    select r.key, coalesce(e.need, r.threshold) as need, max(e.val)::int as have,
           min(least(e.at, now())) filter (where e.val >= coalesce(e.need, r.threshold) and e.at is not null) as reached_at
      from rules r join ev e on e.metric = r.metric
     group by r.key, coalesce(e.need, r.threshold)
  )
  select r.key,
         coalesce(b.have, 0),
         coalesce(b.need, r.threshold),
         (select min(c.reached_at) from cand c where c.key = r.key)
    from rules r
    left join lateral (
      select c.have, c.need from cand c where c.key = r.key
       order by c.have::numeric / nullif(c.need, 0) desc nulls last, c.need
       limit 1
    ) b on true
   order by r.ord;
$$;

comment on function public.student_achievement_progress(uuid) is
  '§257. Для каждой награды achievement_rules(): have, need и момент, когда порог был достигнут по истории (null — ещё нет). Источники — функции §254–§256 (каталог с проверкой, серия дней с решением, задачи дня и цели недели, зона номера, topic_done_events, ДЗ, ревью, пробники) и student_forecast_marks. Внутренняя.';

revoke all on function public.student_achievement_progress(uuid) from public, anon, authenticated;

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
