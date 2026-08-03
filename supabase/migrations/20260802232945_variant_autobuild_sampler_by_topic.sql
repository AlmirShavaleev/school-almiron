-- Автосборка теста из каталога по теме и раскладке по сложности (§52).
--
-- Шкала уровней задаётся данными, а не пожеланием: difficulty заполнена только
-- у физики ЕГЭ, у остальных предметов уровень выводится из exam_part. При этом
-- has_answer почти совпадает с exam_part = 1 — у части 2 эталона обычно нет,
-- поэтому у физики ОГЭ «сложных» с эталоном всего 5 штук на предмет и шкалы там
-- нет вовсе. Функции ниже возвращают шкалу честно, чтобы форма не показывала
-- учителю поля, которые заведомо не наберутся.

create or replace function public.variant_level_scale(
  p_subject   text,
  p_exam_type text
) returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_subject = 'Физика'     and p_exam_type = 'ЕГЭ' then 'three'  -- easy/medium/hard по difficulty
    when p_subject = 'Математика'                         then 'two'    -- basic/hard по exam_part
    else 'none'                                                         -- один уровень: all
  end;
$$;

comment on function public.variant_level_scale(text, text) is
  'Какая шкала сложности действует у экзамена: three | two | none. §52';

create or replace function public.variant_task_level(
  p_subject    text,
  p_exam_type  text,
  p_difficulty text,
  p_exam_part  smallint
) returns text
language sql
immutable
set search_path to ''
as $$
  select case public.variant_level_scale(p_subject, p_exam_type)
    when 'three' then
      case p_difficulty
        when 'лёгкая'  then 'easy'
        when 'средняя' then 'medium'
        when 'сложная' then 'hard'
        else case when p_exam_part = 2 then 'hard' else 'easy' end
      end
    when 'two' then
      case when p_exam_part = 2 then 'hard' else 'basic' end
    else 'all'
  end;
$$;

comment on function public.variant_task_level(text, text, text, smallint) is
  'Уровень задачи в шкале своего экзамена. difficulty приоритетнее, иначе exam_part. §52';

-- ── Счётчики для формы ───────────────────────────────────────────────────────
-- SECURITY INVOKER: каталог и так читается любым авторизованным через RLS,
-- новых прав не выдаём.

create or replace function public.variant_topic_availability(
  p_subject      text,
  p_exam_type    text,
  p_topic_ids    uuid[] default null,
  p_topic_source text   default null
) returns table (
  topic_id    uuid,
  topic_title text,
  level       text,
  available   integer
)
language sql
stable
set search_path to ''
as $$
  select
    ctt.topic_id,
    t.title,
    public.variant_task_level(ct.subject, ct.exam_type, ct.difficulty, ct.exam_part),
    count(distinct ct.id)::integer
  from public.catalog_task_topics ctt
  join public.catalog_tasks  ct on ct.id = ctt.task_id
  join public.catalog_topics t  on t.id  = ctt.topic_id
  where ct.subject      = p_subject
    and ct.exam_type    = p_exam_type
    and ct.is_published = true
    and ct.has_answer   = true
    and ctt.source is not distinct from p_topic_source
    and (p_topic_ids is null or ctt.topic_id = any(p_topic_ids))
  group by 1, 2, 3;
$$;

comment on function public.variant_topic_availability(text, text, uuid[], text) is
  'Сколько задач с эталоном доступно по каждой теме и уровню — для списка тем. §52';

-- Задача связана в среднем с 1.54 темами, поэтому сумма по темам больше, чем
-- реально доступно на выборке. Раскладку проверяем этой функцией: distinct.
create or replace function public.variant_selection_availability(
  p_subject      text,
  p_exam_type    text,
  p_topic_ids    uuid[],
  p_topic_source text default null
) returns table (
  level     text,
  available integer
)
language sql
stable
set search_path to ''
as $$
  select
    public.variant_task_level(ct.subject, ct.exam_type, ct.difficulty, ct.exam_part),
    count(distinct ct.id)::integer
  from public.catalog_task_topics ctt
  join public.catalog_tasks ct on ct.id = ctt.task_id
  where ct.subject      = p_subject
    and ct.exam_type    = p_exam_type
    and ct.is_published = true
    and ct.has_answer   = true
    and ctt.source is not distinct from p_topic_source
    and ctt.topic_id = any(p_topic_ids)
  group by 1;
$$;

comment on function public.variant_selection_availability(text, text, uuid[], text) is
  'Сколько РАЗНЫХ задач доступно по уровням на всей выборке тем — против задвоения. §52';

-- ── Сам сэмплер ──────────────────────────────────────────────────────────────

create or replace function public.generate_variant_tasks_by_topic(
  p_subject      text,
  p_exam_type    text,
  p_topic_ids    uuid[],
  p_levels       jsonb,
  p_topic_source text default null
) returns table (
  out_task_id    uuid,
  out_topic_id   uuid,
  out_section_id uuid,
  out_level      text,
  out_position   integer
)
language plpgsql
volatile
set search_path to ''
as $function$
DECLARE
  v_role      text;
  v_scale     text;
  v_allowed   text[];
  v_level     text;
  v_needed    integer;
  v_total     integer := 0;
  v_pos       integer := 0;
  v_selected  uuid[]  := ARRAY[]::uuid[];
  v_rows      record;
  v_available integer;
BEGIN
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('teacher', 'admin', 'owner', 'curator', 'student') THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF p_topic_ids IS NULL OR array_length(p_topic_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_TOPICS: select at least one topic';
  END IF;

  v_scale := public.variant_level_scale(p_subject, p_exam_type);
  v_allowed := CASE v_scale
    WHEN 'three' THEN ARRAY['easy', 'medium', 'hard']
    WHEN 'two'   THEN ARRAY['basic', 'hard']
    ELSE              ARRAY['all']
  END;

  -- Ключи раскладки должны принадлежать шкале этого экзамена, иначе форма и
  -- база разошлись — молча вернуть меньше задач хуже, чем упасть.
  FOR v_level IN SELECT jsonb_object_keys(p_levels) LOOP
    IF NOT (v_level = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'BAD_LEVEL:level=%:scale=%', v_level, v_scale;
    END IF;
  END LOOP;

  SELECT COALESCE(sum((value #>> '{}')::integer), 0) INTO v_total
  FROM jsonb_each(p_levels);

  IF v_total < 1 OR v_total > 50 THEN
    RAISE EXCEPTION 'INVALID_COUNT: expected 1..50 tasks, got %', v_total;
  END IF;

  FOREACH v_level IN ARRAY v_allowed LOOP
    v_needed := COALESCE((p_levels ->> v_level)::integer, 0);
    CONTINUE WHEN v_needed = 0;

    SELECT count(*) INTO v_available
    FROM (
      SELECT DISTINCT ct.id
      FROM public.catalog_tasks ct
      JOIN public.catalog_task_topics ctt ON ctt.task_id = ct.id
      WHERE ct.subject      = p_subject
        AND ct.exam_type    = p_exam_type
        AND ct.is_published = true
        AND ct.has_answer   = true
        AND ctt.source IS NOT DISTINCT FROM p_topic_source
        AND ctt.topic_id = ANY(p_topic_ids)
        AND public.variant_task_level(ct.subject, ct.exam_type, ct.difficulty, ct.exam_part) = v_level
        AND ct.id <> ALL(v_selected)
    ) pool;

    IF v_available < v_needed THEN
      RAISE EXCEPTION 'NOT_ENOUGH_LEVEL:level=%:needed=%:available=%',
        v_level, v_needed, v_available;
    END IF;

    -- Тема у задачи может быть не одна: берём основную, иначе любую из выбранных.
    FOR v_rows IN
      SELECT picked.task_id, picked.topic_id, picked.section_id
      FROM (
        SELECT DISTINCT ON (ct.id)
               ct.id AS task_id, ctt.topic_id, ct.section_id
        FROM public.catalog_tasks ct
        JOIN public.catalog_task_topics ctt ON ctt.task_id = ct.id
        WHERE ct.subject      = p_subject
          AND ct.exam_type    = p_exam_type
          AND ct.is_published = true
          AND ct.has_answer   = true
          AND ctt.source IS NOT DISTINCT FROM p_topic_source
          AND ctt.topic_id = ANY(p_topic_ids)
          AND public.variant_task_level(ct.subject, ct.exam_type, ct.difficulty, ct.exam_part) = v_level
          AND ct.id <> ALL(v_selected)
        ORDER BY ct.id, ctt.is_primary DESC NULLS LAST
      ) picked
      ORDER BY random()
      LIMIT v_needed
    LOOP
      v_pos          := v_pos + 1;
      v_selected     := array_append(v_selected, v_rows.task_id);
      out_task_id    := v_rows.task_id;
      out_topic_id   := v_rows.topic_id;
      out_section_id := v_rows.section_id;
      out_level      := v_level;
      out_position   := v_pos;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$function$;

comment on function public.generate_variant_tasks_by_topic(text, text, uuid[], jsonb, text) is
  'Детерминированная случайная выборка задач по темам и раскладке уровней. Без ИИ. Только has_answer. §52';

revoke all on function public.variant_level_scale(text, text) from public, anon;
revoke all on function public.variant_task_level(text, text, text, smallint) from public, anon;
revoke all on function public.variant_topic_availability(text, text, uuid[], text) from public, anon;
revoke all on function public.variant_selection_availability(text, text, uuid[], text) from public, anon;
revoke all on function public.generate_variant_tasks_by_topic(text, text, uuid[], jsonb, text) from public, anon;

grant execute on function public.variant_level_scale(text, text) to authenticated;
grant execute on function public.variant_task_level(text, text, text, smallint) to authenticated;
grant execute on function public.variant_topic_availability(text, text, uuid[], text) to authenticated;
grant execute on function public.variant_selection_availability(text, text, uuid[], text) to authenticated;
grant execute on function public.generate_variant_tasks_by_topic(text, text, uuid[], jsonb, text) to authenticated;
