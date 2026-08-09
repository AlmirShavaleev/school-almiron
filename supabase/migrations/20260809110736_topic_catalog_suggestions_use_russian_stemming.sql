-- Триграммного сходства мало: «Динамика. Первая часть» уверенно приводило к
-- «Первому закону термодинамики», потому что «динамика» буквально лежит внутри
-- «термодинамики». Ни similarity, ни strict_word_similarity этого не различают
-- — это свойство подстроки, а не порог.
--
-- Различает морфология. Русский стеммер даёт «динамика» → 'динамик',
-- «термодинамики» → 'термодинамик': разные леммы, ранг 0. При этом верное
-- совпадение остаётся сильным: «закон сохранения и изменения импульса» против
-- «Импульс, закон сохранения импульса» — 0.41.
--
-- Поэтому основа оценки — полнотекстовый ранг, а триграммы остаются вторым
-- слагаемым: они ловят то, у чего общей леммы нет (сокращения, опечатки,
-- «Баллистика»). Модуль по-прежнему только подталкивает.

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
  ),
  scored as (
    select
      c.id, c.title,
      ts_rank(to_tsvector('russian', c.title),
              plainto_tsquery('russian', me.txt))                 as fts,
      extensions.similarity(me.txt, lower(c.title))               as trg,
      extensions.similarity(me.module, lower(c.title))            as mod
    from cand c, me
  )
  select
    s.id, s.title,
    (s.fts * 2.0 + s.trg * 0.5 + s.mod * 0.15)::real,
    public.topic_catalog_part1_task_count(array[s.id], 'ai_physics_v1')
  from scored s
  where s.fts > 0 or s.trg > 0.12
  order by 3 desc, s.title
  limit greatest(coalesce(p_limit, 5), 1);
$$;

comment on function public.topic_catalog_suggestions(uuid, integer) is
  'Кандидаты тем ИИ-дерева для темы курса, с числом задач у каждого. Основа — русская морфология, триграммы вторым слагаемым. Предложение, не подтверждение.';
