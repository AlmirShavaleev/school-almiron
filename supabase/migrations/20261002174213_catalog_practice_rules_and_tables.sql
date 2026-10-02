-- §256 — часть 1 из 3. Применено оркестратором 02.10 MCP apply_migration (версия 20261002174213); прежде — PENDING_256.sql.
-- Применённый текст — тот же без строк-комментариев и `comment on`; объяснения решений — здесь и в PROJECT_STATE.md §256.

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
