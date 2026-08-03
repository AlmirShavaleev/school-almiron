-- Форма автосборки сыпала темы плоским списком, и по физике ЕГЭ это давало 26
-- одинаковых строк «ЕГЭ прошлых лет»: после §50 имена тем уникальны только
-- внутри своего номера задания. По физике ОГЭ ещё хуже — 241 тема на 64
-- названия. Имена в каталоге правильные, не хватало контекста показа, поэтому
-- функция начинает отдавать номер задания, а каталог не трогаем вовсе.
--
-- Заголовки разделов в каталоге уже содержат номер («№1 Кинематика»), так что
-- склеивать подпись на клиенте не нужно.
--
-- Тема почти всегда принадлежит одному номеру: из 435 тем в двух номерах
-- лежат три. Для них берём номер, где у темы больше задач, а счётчики уровней
-- остаются суммой по всей теме — так они совпадают с
-- variant_selection_availability, по которой гаснет кнопка.

drop function if exists public.variant_topic_availability(text, text, uuid[], text);

create function public.variant_topic_availability(
  p_subject      text,
  p_exam_type    text,
  p_topic_ids    uuid[] default null,
  p_topic_source text   default null
) returns table (
  topic_id         uuid,
  topic_title      text,
  section_id       uuid,
  section_title    text,
  section_position integer,
  exam_number      integer,
  level            text,
  available        integer
)
language sql
stable
set search_path to ''
as $$
  with scoped as (
    select distinct
      ctt.topic_id,
      ct.id as task_id,
      ct.section_id,
      public.variant_task_level(ct.subject, ct.exam_type, ct.difficulty, ct.exam_part) as level
    from public.catalog_task_topics ctt
    join public.catalog_tasks ct on ct.id = ctt.task_id
    where ct.subject      = p_subject
      and ct.exam_type    = p_exam_type
      and ct.is_published = true
      and ct.has_answer   = true
      and ctt.source is not distinct from p_topic_source
      and (p_topic_ids is null or ctt.topic_id = any(p_topic_ids))
  ),
  home as (
    select distinct on (s.topic_id)
      s.topic_id, s.section_id
    from scoped s
    join public.catalog_sections cs on cs.id = s.section_id
    group by s.topic_id, s.section_id, cs.position
    order by s.topic_id, count(*) desc, cs.position
  )
  select
    s.topic_id,
    t.title,
    cs.id,
    cs.title,
    cs.position,
    cs.exam_number,
    s.level,
    count(distinct s.task_id)::integer
  from scoped s
  join home h              on h.topic_id = s.topic_id
  join public.catalog_sections cs on cs.id = h.section_id
  join public.catalog_topics   t  on t.id  = s.topic_id
  group by s.topic_id, t.title, cs.id, cs.title, cs.position, cs.exam_number, s.level;
$$;

comment on function public.variant_topic_availability(text, text, uuid[], text) is
  'Задачи с эталоном по темам и уровням, с номером задания для группировки. §56';

revoke all on function public.variant_topic_availability(text, text, uuid[], text) from public, anon;
grant execute on function public.variant_topic_availability(text, text, uuid[], text) to authenticated;
