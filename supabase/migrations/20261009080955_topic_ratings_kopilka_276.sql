-- §276. Оценки уроков «в общую копилку»: в сводке каркаса (шаблона) — оценки всех групп вместе.
-- ПРИМЕНЕНО 09.10 через MCP (версия 20261009080955).
-- Решение владельца 08.10: «оценка урока в курсе идёт в каркас и оценивается по теме, а не по группам».
--
-- Ученик по-прежнему оценивает тему СВОЕГО курса (строка topic_ratings ссылается на тему класса — права и доступ
-- не меняются). Меняется только чтение: `topic_ratings_summary(p_course_id)` для каркаса (`courses.is_template`)
-- собирает оценки самой темы каркаса и всех её копий (`topics.source_topic_id = тема каркаса`) и отдаёт их
-- под id темы каркаса. Для обычного курса — как раньше, только его группы.
--
-- Только добавляющая: create or replace с той же сигнатурой и тем же типом результата; таблица и права не меняются.
-- Цепочек копий глубже одного шага на проде нет (копия копии — 0 строк на 09.10), поэтому берём прямых потомков.

create or replace function public.topic_ratings_summary(p_course_id uuid)
returns table (topic_id uuid, ratings int, avg_rating numeric, dist int[], last_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_template boolean;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет доступа к оценкам уроков этого курса' using errcode = '42501';
  end if;

  select c.is_template into v_template from public.courses c where c.id = p_course_id;

  return query
  with course_topics as (
    select t.id
      from public.topics  t
      join public.modules m on m.id = t.module_id
     where m.course_id = p_course_id
  ),
  src as (
    -- Тема курса сама по себе; у каркаса — ещё и все её копии в классах (оценка уходит в «копилку» темы каркаса).
    select r.rating, r.updated_at,
           case when rt.id in (select id from course_topics) then rt.id else rt.source_topic_id end as tid
      from public.topic_ratings r
      join public.topics rt on rt.id = r.topic_id
     where rt.id in (select id from course_topics)
        or (coalesce(v_template, false) and rt.source_topic_id in (select id from course_topics))
  )
  select s.tid,
         count(*)::int,
         round(avg(s.rating)::numeric, 2),
         -- Распределение: dist[n] — сколько учеников поставили n звёзд (1..10).
         array[
           count(*) filter (where s.rating = 1),  count(*) filter (where s.rating = 2),
           count(*) filter (where s.rating = 3),  count(*) filter (where s.rating = 4),
           count(*) filter (where s.rating = 5),  count(*) filter (where s.rating = 6),
           count(*) filter (where s.rating = 7),  count(*) filter (where s.rating = 8),
           count(*) filter (where s.rating = 9),  count(*) filter (where s.rating = 10)
         ]::int[],
         max(s.updated_at)
    from src s
   group by s.tid;
end;
$$;

comment on function public.topic_ratings_summary(uuid) is
  '§271/§276. Сводка оценок уроков курса для персонала (course_is_staff, иначе 42501): по каждой оценённой теме — число оценок, среднее (2 знака), распределение dist[1..10] и дата последней оценки. Без имён учеников. У каркаса (is_template) — оценки темы каркаса и всех её копий в классах вместе («общая копилка»).';
