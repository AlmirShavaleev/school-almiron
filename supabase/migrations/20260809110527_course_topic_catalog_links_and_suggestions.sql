-- Связь «тема курса ↔ тема каталога». В схеме её не было вовсе, а без неё
-- нельзя собрать тест «по смыслу темы».
--
-- Сопоставляем по ИИ-дереву физики (ai_physics_v1): у обычных тем каталога
-- крупнейшие узлы — не темы, а источники («Банк ФИПИ и Демидов» 1092 задачи,
-- «СтатГрад» 892, «ЕГЭ прошлых лет» 387). Автомат, ранжирующий по числу задач,
-- привёл бы тему курса к «СтатГраду» и собрал «тест по теме» из чего попало.
-- В ИИ-дереве 87 чистых предметных тем с задачами первой части, 70 из них с
-- десятком и больше.
--
-- Поле source в связке остаётся: привязать обычную тему каталога вручную можно,
-- но автомат по умолчанию работает только по ИИ-дереву. Смешивать таксономии в
-- одной выборке нельзя — грабли §45, §51, §56.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.topic_catalog_topics (
  id               uuid primary key default gen_random_uuid(),
  topic_id         uuid not null references public.topics(id) on delete cascade,
  catalog_topic_id uuid not null references public.catalog_topics(id) on delete cascade,
  -- NULL — обычные темы каталога, 'ai_physics_v1' — ИИ-дерево.
  source           text,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  constraint topic_catalog_topics_unique
    unique nulls not distinct (topic_id, catalog_topic_id, source)
);

comment on table public.topic_catalog_topics is
  'Тема курса ↔ тема каталога. Много-ко-многим: тема урока шире темы каталога.';

create index if not exists topic_catalog_topics_topic_idx
  on public.topic_catalog_topics (topic_id);

alter table public.topic_catalog_topics enable row level security;

drop policy if exists tct_staff_all on public.topic_catalog_topics;
create policy tct_staff_all on public.topic_catalog_topics
  for all using (public.topic_material_can_manage(topic_id))
  with check (public.topic_material_can_manage(topic_id));

drop policy if exists tct_student_select on public.topic_catalog_topics;
create policy tct_student_select on public.topic_catalog_topics
  for select using (public.course_student_can_see_topic(topic_id));

-- ── Классификация тем курса ──────────────────────────────────────────────────
-- Часть указана в самом названии темы: «…Первая часть», «…Вторая часть»,
-- «…Теория», «Как решать задачи на…». Из 169 тем курса «Физика ЕГЭ Шаблон»
-- 31 помечена второй частью — по ним автопроверяемых задач 0 из 611, тест не
-- соберётся никогда. Показать это надо ДО сборки, а не 31 строкой «не нашлось».

create or replace function public.course_topic_test_kind(p_title text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    -- Порядок важен: «Теория + Первая часть» — кандидат, а не теория.
    when p_title ~* 'втор(ая|ой)\s+часть'          then 'part2'
    when p_title ~* 'перв(ая|ой)\s+часть'          then 'part1'
    when p_title ~* '^\s*(как решать|вс[ёе] про)'  then 'method'
    when p_title ~* 'теори'                        then 'theory'
    else                                                'candidate'
  end;
$$;

comment on function public.course_topic_test_kind(text) is
  'Годится ли тема курса под тест, по её названию: part1 | candidate | part2 | theory | method.';

-- Текст темы для сопоставления: убираем пометки части и методические обороты,
-- остаётся предметная суть.
create or replace function public.course_topic_match_text(p_title text)
returns text
language sql
immutable
set search_path to ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      lower(coalesce(p_title, '')),
      '(втор(ая|ой)\s+часть|перв(ая|ой)\s+часть|теори[а-я]*|как решать задачи на|как решать|вс[ёе] про|полный анализ|[.\-–—+?!]|\s+\d+\s*$)',
      ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

comment on function public.course_topic_match_text(text) is
  'Предметная часть названия темы курса, без пометок «Теория» / «Первая часть» и методических оборотов.';

-- ── Сколько задач даст связка ────────────────────────────────────────────────
-- Только первая часть и только автопроверяемые: правило одно на всё
-- (§62, §66, §96), копий не заводим.

create or replace function public.topic_catalog_part1_task_count(
  p_catalog_topic_ids uuid[],
  p_source            text default 'ai_physics_v1'
) returns integer
language sql
stable
set search_path to ''
as $$
  select coalesce(count(distinct ct.id), 0)::integer
  from public.catalog_task_topics ctt
  join public.catalog_tasks ct on ct.id = ctt.task_id
  where ctt.topic_id = any(p_catalog_topic_ids)
    and ctt.source is not distinct from p_source
    and ct.is_published
    and ct.exam_part = 1
    and public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type);
$$;

comment on function public.topic_catalog_part1_task_count(uuid[], text) is
  'Сколько задач первой части, пригодных к автопроверке, даст набор тем каталога.';

-- ── Предложение по названиям ─────────────────────────────────────────────────
-- Первая редакция: триграммы. Заменена в следующей миграции на морфологию —
-- «динамика» лежит подстрокой в «термодинамике», порогом это не лечится.

create or replace function public.topic_catalog_suggestions(
  p_topic_id uuid,
  p_limit    integer default 5
) returns table (
  catalog_topic_id uuid,
  title            text,
  score            real,
  available        integer
)
language sql
stable
security definer
set search_path to ''
as $$
  with me as (
    select public.course_topic_match_text(t.title) txt, lower(m.title) module
    from public.topics t
    join public.modules m on m.id = t.module_id
    where t.id = p_topic_id
      and public.topic_material_can_manage(p_topic_id)
  ),
  cand as (
    select distinct ct2.id, ct2.title
    from public.catalog_task_topics ctt
    join public.catalog_topics ct2 on ct2.id = ctt.topic_id
    where ctt.source = 'ai_physics_v1'
  )
  select
    c.id, c.title,
    (extensions.similarity(me.txt, lower(c.title))
     + 0.2 * extensions.similarity(me.module, lower(c.title)))::real,
    public.topic_catalog_part1_task_count(array[c.id], 'ai_physics_v1')
  from cand c, me
  where extensions.similarity(me.txt, lower(c.title)) > 0.12
  order by 3 desc, c.title
  limit greatest(coalesce(p_limit, 5), 1);
$$;

comment on function public.topic_catalog_suggestions(uuid, integer) is
  'Кандидаты тем ИИ-дерева для темы курса, с числом задач у каждого. Предложение, не подтверждение.';

revoke all on function public.course_topic_test_kind(text)                 from public, anon;
revoke all on function public.course_topic_match_text(text)                from public, anon;
revoke all on function public.topic_catalog_part1_task_count(uuid[], text) from public, anon;
revoke all on function public.topic_catalog_suggestions(uuid, integer)     from public, anon;

grant execute on function public.course_topic_test_kind(text)                 to authenticated;
grant execute on function public.course_topic_match_text(text)                to authenticated;
grant execute on function public.topic_catalog_part1_task_count(uuid[], text) to authenticated;
grant execute on function public.topic_catalog_suggestions(uuid, integer)     to authenticated;
