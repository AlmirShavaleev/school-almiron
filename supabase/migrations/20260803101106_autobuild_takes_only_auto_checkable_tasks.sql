-- Автосборка брала задачи, которые автопроверка не умеет проверить. Эталон у
-- них не одно число, а перечисление («0,006 -0,006» — плюс-минус одно и то же).
-- В submit_variant такая задача попадает в ветку ELSE: is_correct = NULL,
-- points_earned = NULL, но её баллы остаются в max_score, и на ручную проверку
-- она не уходит — grading_type у элемента 'auto'. Ученик молча теряет балл, и
-- никто этого не видит. В первом же живом прогоне вышло 9 из 10.
--
-- Правило автопроверяемости вынесено в функцию, а не вшито в тело сэмплера:
-- по нему обязаны фильтроваться и счётчики доступности, иначе форма покажет
-- «доступно 12», а соберётся 11.
--
-- Важно, что предикат НЕ сводится к «эталон — число». У задач с partial_type
-- (физика: выбор нескольких, установление соответствия) эталон тоже не число,
-- но submit_variant проверяет их отдельной веткой через score_auto_answer.
-- Наивный фильтр выбросил бы 2 029 совершенно рабочих задач физики.
--
-- Это ШАГ 1: задачи убраны из случайной автосборки. Когда сравнение научат
-- разбирать перечисления, предикат ослабляется здесь же — и счётчики в форме
-- потолстеют сами, отдельной правки интерфейса не нужно.
--
-- Ручная привязка к теме и банк тестов не затронуты.

create or replace function public.variant_answer_is_auto_checkable(
  p_answer_html  text,
  p_partial_type text
) returns boolean
language sql
immutable
set search_path to ''
as $$
  select case
    when p_answer_html is null or p_answer_html = '' then false
    -- Множественный выбор и соответствие считает score_auto_answer по цифрам.
    when p_partial_type is not null then true
    else public.normalize_variant_answer(public.strip_html_simple(p_answer_html))
           ~ '^-?[0-9]+(\.[0-9]+)?$'
  end;
$$;

comment on function public.variant_answer_is_auto_checkable(text, text) is
  'Сможет ли submit_variant проверить эталон этой задачи сам. Общий предикат для сэмплера и счётчиков доступности.';

-- ── Счётчики худеют вместе с пулом ───────────────────────────────────────────

create or replace function public.variant_topic_availability(
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
      and public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
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
    s.topic_id, t.title, cs.id, cs.title, cs.position, cs.exam_number,
    s.level, count(distinct s.task_id)::integer
  from scoped s
  join home h                     on h.topic_id = s.topic_id
  join public.catalog_sections cs on cs.id = h.section_id
  join public.catalog_topics   t  on t.id  = s.topic_id
  group by s.topic_id, t.title, cs.id, cs.title, cs.position, cs.exam_number, s.level;
$$;

comment on function public.variant_topic_availability(text, text, uuid[], text) is
  'Задачи, пригодные к автосборке, по темам и уровням, с номером задания для группировки.';

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
    and public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
    and ctt.source is not distinct from p_topic_source
    and ctt.topic_id = any(p_topic_ids)
  group by 1;
$$;

comment on function public.variant_selection_availability(text, text, uuid[], text) is
  'Сколько РАЗНЫХ пригодных задач доступно по уровням на всей выборке тем — против задвоения.';

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
        AND public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
        AND ctt.source IS NOT DISTINCT FROM p_topic_source
        AND ctt.topic_id = ANY(p_topic_ids)
        AND public.variant_task_level(ct.subject, ct.exam_type, ct.difficulty, ct.exam_part) = v_level
        AND ct.id <> ALL(v_selected)
    ) pool;

    IF v_available < v_needed THEN
      RAISE EXCEPTION 'NOT_ENOUGH_LEVEL:level=%:needed=%:available=%',
        v_level, v_needed, v_available;
    END IF;

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
          AND public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
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
  'Случайная выборка задач по темам и раскладке уровней. Без ИИ. Только те, что автопроверка умеет проверить.';

revoke all on function public.variant_answer_is_auto_checkable(text, text) from public, anon;
grant execute on function public.variant_answer_is_auto_checkable(text, text) to authenticated;
