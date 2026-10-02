-- §256 — Каталог поднимает прогноз: проверка ответа, задача дня, цель недели,
-- награды по зоне номера, серия по «дням с решением».
--
-- НЕ ПРИМЕНЕНА. Применяет оркестратор (MCP apply_migration), после применения
-- файл называется по версии из schema_migrations. ТОЛЬКО ДОБАВЛЕНИЕ: новые
-- таблицы (create table if not exists), политики на НОВЫХ таблицах (через
-- проверку pg_policies — без drop), новые функции и create or replace функций
-- §254/§255. Ни одного drop. Существующие таблицы не меняются.
--
-- Решения владельца 02.10 (полностью — PROJECT_STATE.md §256):
--   1. В прогноз и баллы идут только задачи каталога с ПРОВЕРЕННЫМ ответом
--      (верные и неверные). Открыл ответ до проверки — задача не засчитывается.
--      «Отметить выполненной» — для себя, вне прогноза и баллов.
--   2. Награда за задачу и вехи 10/20/30 — по ЗОНЕ НОМЕРА у ученика.
--   3. Задача дня (+10), 4. цель недели (+40), 5. серия — по дням, когда
--      ученик что-то РЕШИЛ, а не просто зашёл.
--
-- Проверка ответа — та же, что у вариантов (§63/§66, submit_variant):
-- normalize_variant_answer + variant_answer_verdict, у задач с partial_type —
-- score_auto_answer = 2. Второй копии правила нет: catalog_task_verdict
-- только выбирает ветку, как submit_variant.
--
-- Известный риск, который здесь НЕ чинится (решение владельца): ученик читает
-- catalog_tasks.answer_html (RLS select published) и может подсмотреть ответ
-- инструментами браузера. Защита — честное правило «открыл → не засчитано» и
-- вердикт на сервере, а не секретность эталона.

-- ══ 1. Правила наград — ОДНО место ═════════════════════════════════════════
-- Владелец меняет числа здесь. Клиент читает их из ответа (таблица «Как
-- начисляются баллы», метки зон) и своих копий не держит.
create or replace function public.catalog_reward_rules()
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    -- Зона номера: доля верного среди проверенных свидетельств номера за
    -- window_days (все источники, как в прогнозе). < low — «зона роста»,
    -- low..high — «в процессе», > high — «уверенно»; без данных — «зона роста».
    'window_days', 60,
    'low',  0.4,
    'high', 0.7,
    'zones', jsonb_build_array(
      jsonb_build_object('key', 'growth',    'per_task', 5, 'milestones', jsonb_build_array(
        jsonb_build_object('at', 10, 'bonus', 30), jsonb_build_object('at', 20, 'bonus', 50), jsonb_build_object('at', 30, 'bonus', 80))),
      jsonb_build_object('key', 'progress',  'per_task', 3, 'milestones', jsonb_build_array(
        jsonb_build_object('at', 10, 'bonus', 20), jsonb_build_object('at', 20, 'bonus', 30), jsonb_build_object('at', 30, 'bonus', 40))),
      jsonb_build_object('key', 'confident', 'per_task', 1, 'milestones', jsonb_build_array(
        jsonb_build_object('at', 10, 'bonus', 5),  jsonb_build_object('at', 20, 'bonus', 5),  jsonb_build_object('at', 30, 'bonus', 5)))),
    'daily_task',      10,  -- задача дня решена верно в тот же день без открытого ответа
    'weekly_goal',     40,  -- цель недели выполнена
    'weekly_target',   10,  -- сколько задач в цели недели
    'weekly_numbers',  2,   -- из скольких слабых номеров
    'checks_per_minute', 30 -- лимит проверок на ученика
  );
$$;

comment on function public.catalog_reward_rules() is
  '§256. Правила «Баллов школы» за каталог одной таблицей: пороги зон номера (0,4 / 0,7, окно 60 дней), награда за задачу и вехи 10/20/30 по зоне, задача дня +10, цель недели +40 (10 задач из 2 слабых номеров), лимит 30 проверок в минуту. Клиент читает их отсюда.';

revoke all on function public.catalog_reward_rules() from public, anon;
grant execute on function public.catalog_reward_rules() to authenticated;

-- Зона по доле (порог — из правил). null (нет данных) — «зона роста».
create or replace function public.catalog_zone_of(p_share numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
           when p_share is null or p_share < (r->>'low')::numeric then 'growth'
           when p_share <= (r->>'high')::numeric then 'progress'
           else 'confident'
         end
    from (select public.catalog_reward_rules() as r) x;
$$;

create or replace function public.catalog_zone_points(p_zone text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce((
    select (z->>'per_task')::int
      from jsonb_array_elements(public.catalog_reward_rules()->'zones') z
     where z->>'key' = p_zone), 0);
$$;

create or replace function public.catalog_zone_milestone(p_zone text, p_count integer)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce((
    select (m->>'bonus')::int
      from jsonb_array_elements(public.catalog_reward_rules()->'zones') z,
           jsonb_array_elements(z->'milestones') m
     where z->>'key' = p_zone and (m->>'at')::int = p_count), 0);
$$;

-- Ключ предмета номера: ЕГЭ — как в прогнозе ('math' | 'physics'), ОГЭ —
-- 'oge-math' | 'oge-physics' (там прогноза нет, но зона номера по каталогу есть).
create or replace function public.catalog_subject_key(p_subject text, p_exam_type text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
           when p_exam_type = 'ЕГЭ' and p_subject = 'Математика' then 'math'
           when p_exam_type = 'ЕГЭ' and p_subject = 'Физика'     then 'physics'
           when p_exam_type = 'ОГЭ' and p_subject = 'Математика' then 'oge-math'
           when p_exam_type = 'ОГЭ' and p_subject = 'Физика'     then 'oge-physics'
         end;
$$;

-- Проверяема ли задача на сервере: часть 1 (часть 2 — развёрнутый ответ,
-- разбор по критериям) и эталон, который берёт автопроверка (§96/§127).
create or replace function public.catalog_task_checkable(p_exam_part integer, p_answer_html text, p_partial_type text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_exam_part, 1) <> 2
     and public.variant_answer_is_auto_checkable(p_answer_html, p_partial_type);
$$;

-- Вердикт — ветки ровно как в submit_variant (20260803214142): partial_type →
-- score_auto_answer = 2, иначе variant_answer_verdict. Своих правил сравнения нет.
create or replace function public.catalog_task_verdict(p_answer_html text, p_partial_type text, p_answer_raw text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
           when p_partial_type is not null then
             coalesce(public.score_auto_answer(
               public.normalize_variant_answer(p_answer_raw),
               public.normalize_variant_answer(public.strip_html_simple(p_answer_html)),
               p_partial_type) = 2, false)
           else
             coalesce(public.variant_answer_verdict(
               public.normalize_variant_answer(public.strip_html_simple(p_answer_html)),
               public.normalize_variant_answer(p_answer_raw)), false)
         end;
$$;

revoke all on function public.catalog_zone_of(numeric) from public, anon, authenticated;
revoke all on function public.catalog_zone_points(text) from public, anon, authenticated;
revoke all on function public.catalog_zone_milestone(text, integer) from public, anon, authenticated;
revoke all on function public.catalog_subject_key(text, text) from public, anon, authenticated;
revoke all on function public.catalog_task_checkable(integer, text, text) from public, anon, authenticated;
revoke all on function public.catalog_task_verdict(text, text, text) from public, anon, authenticated;

-- ══ 2. Таблицы ═════════════════════════════════════════════════════════════
-- Попытки (по образцу задач урока §162/§176: каждая проверка — след; ответ
-- после открытого ответа не засчитывается). Пишет только catalog_check_answer.
create table if not exists public.catalog_task_attempts (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  task_id         uuid not null references public.catalog_tasks(id) on delete cascade,
  answer          text not null check (length(answer) between 1 and 200),
  verdict         text not null check (verdict in ('correct', 'wrong')),
  -- Ответ был открыт ДО этой попытки — попытка вне прогноза и баллов.
  revealed_before boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists catalog_task_attempts_profile_task_idx
  on public.catalog_task_attempts (profile_id, task_id, created_at);
create index if not exists catalog_task_attempts_profile_at_idx
  on public.catalog_task_attempts (profile_id, created_at);

-- Раскрытие ответа: одна строка на задачу (первое раскрытие).
create table if not exists public.catalog_task_reveals (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  task_id     uuid not null references public.catalog_tasks(id) on delete cascade,
  revealed_at timestamptz not null default now(),
  primary key (profile_id, task_id)
);

-- Задача дня: выбор фиксируется при первом вызове за день (Москва).
create table if not exists public.student_daily_tasks (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  subject    text not null check (subject in ('math', 'physics')),
  task_id    uuid not null references public.catalog_tasks(id) on delete cascade,
  n          integer not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, day, subject)
);

-- Цель недели: два слабых номера фиксируются на неделю (пн по Москве).
create table if not exists public.student_weekly_goals (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  subject    text not null check (subject in ('math', 'physics')),
  numbers    integer[] not null,
  target     integer not null default 10 check (target > 0),
  created_at timestamptz not null default now(),
  primary key (profile_id, week_start, subject)
);

alter table public.catalog_task_attempts enable row level security;
alter table public.catalog_task_reveals  enable row level security;
alter table public.student_daily_tasks   enable row level security;
alter table public.student_weekly_goals  enable row level security;

-- Supabase выдаёт новым таблицам ВСЕ права anon/authenticated — забираем;
-- ученик только читает свои строки, пишут definer-функции ниже.
revoke all on table public.catalog_task_attempts from public, anon, authenticated;
revoke all on table public.catalog_task_reveals  from public, anon, authenticated;
revoke all on table public.student_daily_tasks   from public, anon, authenticated;
revoke all on table public.student_weekly_goals  from public, anon, authenticated;
grant select on table public.catalog_task_attempts to authenticated;
grant select on table public.catalog_task_reveals  to authenticated;
grant select on table public.student_daily_tasks   to authenticated;
grant select on table public.student_weekly_goals  to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catalog_task_attempts' and policyname = 'catalog_task_attempts_select_own') then
    create policy catalog_task_attempts_select_own on public.catalog_task_attempts
      for select to authenticated using (profile_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catalog_task_reveals' and policyname = 'catalog_task_reveals_select_own') then
    create policy catalog_task_reveals_select_own on public.catalog_task_reveals
      for select to authenticated using (profile_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'student_daily_tasks' and policyname = 'student_daily_tasks_select_own') then
    create policy student_daily_tasks_select_own on public.student_daily_tasks
      for select to authenticated using (profile_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'student_weekly_goals' and policyname = 'student_weekly_goals_select_own') then
    create policy student_weekly_goals_select_own on public.student_weekly_goals
      for select to authenticated using (profile_id = auth.uid());
  end if;
end $$;

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
