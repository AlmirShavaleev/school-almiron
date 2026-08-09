-- Порог на предложения: без него «Динамика. Первая часть» уверенно приводила к
-- «Первому закону термодинамики» — совпадение чисто буквенное, общей леммы у
-- ИИ-дерева с «динамикой» нет вовсе. Уверенным считаем совпадение по лемме
-- (fts > 0) либо сильное буквенное (>= 0.3). Остальное — молчание: пустая
-- строка честнее уверенного промаха, который приглашают подтвердить не глядя.
create or replace function public.topic_catalog_suggestions(
  p_topic_id uuid,
  p_limit    integer default 5
) returns table (
  catalog_topic_id uuid, title text, score real, available integer
)
language sql stable security definer set search_path to ''
as $$
  with me as (
    select public.course_topic_match_text(t.title) txt, lower(m.title) module
    from public.topics t join public.modules m on m.id = t.module_id
    where t.id = p_topic_id and public.topic_material_can_manage(p_topic_id)
  ),
  cand as (
    select distinct ct2.id, ct2.title
    from public.catalog_task_topics ctt
    join public.catalog_topics ct2 on ct2.id = ctt.topic_id
    where ctt.source = 'ai_physics_v1'
  ),
  scored as (
    select c.id, c.title,
           ts_rank(to_tsvector('russian', c.title), plainto_tsquery('russian', me.txt)) fts,
           extensions.similarity(me.txt, lower(c.title))    trg,
           extensions.similarity(me.module, lower(c.title)) mod
    from cand c, me
  )
  select s.id, s.title,
         (s.fts * 2.0 + s.trg * 0.5 + s.mod * 0.15)::real,
         public.topic_catalog_part1_task_count(array[s.id], 'ai_physics_v1')
  from scored s
  where s.fts > 0 or s.trg >= 0.3
  order by 3 desc, s.title
  limit greatest(coalesce(p_limit, 5), 1);
$$;

comment on function public.topic_catalog_suggestions(uuid, integer) is
  'Кандидаты тем ИИ-дерева для темы курса. Русская морфология основа, триграммы второе слагаемое, слабые совпадения отсекаются. Предложение, не подтверждение.';

-- ── Обзор курса: он же предполётная сводка ───────────────────────────────────

create or replace function public.course_topic_test_overview(p_course_id uuid)
returns table (
  topic_id     uuid,
  module_title text,
  topic_title  text,
  order_key    integer,
  kind         text,
  linked_count integer,
  available    integer,
  has_test     boolean
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    t.id, m.title, t.title,
    (m.order_index * 1000 + t.order_index),
    public.course_topic_test_kind(t.title),
    (select count(*)::integer from public.topic_catalog_topics l where l.topic_id = t.id),
    public.topic_catalog_part1_task_count(
      coalesce((select array_agg(l.catalog_topic_id) from public.topic_catalog_topics l
                where l.topic_id = t.id and l.source = 'ai_physics_v1'), '{}'::uuid[]),
      'ai_physics_v1'),
    exists (select 1 from public.test_variant_assignments tva where tva.topic_id = t.id)
  from public.modules m
  join public.topics t on t.module_id = m.id
  where m.course_id = p_course_id
    and public.topic_material_can_manage(t.id)
  order by 4;
$$;

comment on function public.course_topic_test_overview(uuid) is
  'Темы курса с видом (part1/candidate/part2/theory/method), числом связей, доступных задач и признаком уже собранного теста.';

-- ── Массовая сборка ──────────────────────────────────────────────────────────
-- Переиспользует всё существующее: правило автопроверяемости (§62/§96),
-- сохранение варианта save_variant_atomic, привязку-выдачу attach_variant_to_topic
-- (§58). Второго механизма не заводит.
--
-- Задачи не повторяются между темами одного курса, пока хватает запаса. Когда
-- не хватает — повтор разрешается, но НЕ молча: тема попадает в отчёт с
-- пометкой. Иначе ученик получит один и тот же вариант дважды под разными
-- названиями и решит, что система сломана.

create or replace function public.build_topic_tests_for_course(
  p_course_id uuid,
  p_count     integer default 10,
  p_rebuild   boolean default false
) returns table (
  topic_id    uuid,
  topic_title text,
  status      text,
  built       integer,
  note        text
)
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_role      text;
  v_t         record;
  v_links     uuid[];
  v_fresh     uuid[];
  v_reused    uuid[];
  v_picked    uuid[];
  v_used      uuid[] := ARRAY[]::uuid[];
  v_groups    uuid[];
  v_variant   uuid;
  v_items     public.variant_item_input[];
  v_need      integer;
BEGIN
  v_role := public.current_user_role();
  IF v_role NOT IN ('teacher', 'admin', 'owner') THEN
    RAISE EXCEPTION 'ACCESS_DENIED: only staff can build course tests';
  END IF;

  IF coalesce(p_count, 0) < 1 OR p_count > 50 THEN
    RAISE EXCEPTION 'INVALID_COUNT: expected 1..50, got %', p_count;
  END IF;

  SELECT array_agg(g.id) INTO v_groups
  FROM public.groups g WHERE g.course_id = p_course_id;

  IF v_groups IS NULL THEN
    RAISE EXCEPTION 'NO_GROUPS: course has no groups to assign to';
  END IF;

  FOR v_t IN
    SELECT t.id, t.title, public.course_topic_test_kind(t.title) kind
    FROM public.modules m
    JOIN public.topics t ON t.module_id = m.id
    WHERE m.course_id = p_course_id
      AND public.topic_material_can_manage(t.id)
    ORDER BY m.order_index, t.order_index
  LOOP
    topic_id := v_t.id; topic_title := v_t.title; built := 0; note := NULL;

    IF v_t.kind IN ('part2', 'theory', 'method') THEN
      status := 'skipped_kind';
      note   := CASE v_t.kind
                  WHEN 'part2'  THEN 'вторая часть — автопроверяемых задач нет'
                  WHEN 'theory' THEN 'теория — тест не предполагается'
                  ELSE               'методическая тема' END;
      RETURN NEXT; CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.test_variant_assignments a WHERE a.topic_id = v_t.id)
       AND NOT p_rebuild THEN
      status := 'skipped_has_test'; note := 'тест уже привязан';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT array_agg(l.catalog_topic_id) INTO v_links
    FROM public.topic_catalog_topics l
    WHERE l.topic_id = v_t.id AND l.source = 'ai_physics_v1';

    IF v_links IS NULL THEN
      status := 'no_link'; note := 'тема каталога не сопоставлена';
      RETURN NEXT; CONTINUE;
    END IF;

    -- Сначала то, что ещё не уходило в другие темы этого курса.
    SELECT array_agg(id ORDER BY random()) INTO v_fresh
    FROM (
      SELECT DISTINCT ct.id
      FROM public.catalog_task_topics ctt
      JOIN public.catalog_tasks ct ON ct.id = ctt.task_id
      WHERE ctt.topic_id = ANY(v_links) AND ctt.source = 'ai_physics_v1'
        AND ct.is_published AND ct.exam_part = 1
        AND public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
        AND NOT (ct.id = ANY(v_used))
    ) q;

    v_picked := coalesce(v_fresh[1:p_count], ARRAY[]::uuid[]);
    v_need   := p_count - coalesce(array_length(v_picked, 1), 0);

    IF v_need > 0 THEN
      -- Запас кончился: доливаем уже использованным, но говорим об этом.
      SELECT array_agg(id ORDER BY random()) INTO v_reused
      FROM (
        SELECT DISTINCT ct.id
        FROM public.catalog_task_topics ctt
        JOIN public.catalog_tasks ct ON ct.id = ctt.task_id
        WHERE ctt.topic_id = ANY(v_links) AND ctt.source = 'ai_physics_v1'
          AND ct.is_published AND ct.exam_part = 1
          AND public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
          AND ct.id = ANY(v_used)
      ) q;

      IF v_reused IS NOT NULL THEN
        v_picked := v_picked || v_reused[1:v_need];
      END IF;
    END IF;

    built := coalesce(array_length(v_picked, 1), 0);

    IF built = 0 THEN
      status := 'no_tasks'; note := 'по связке нет задач первой части';
      RETURN NEXT; CONTINUE;
    END IF;

    IF built < p_count THEN
      note := format('нашлось %s из %s', built, p_count);
    ELSIF v_need > 0 THEN
      note := format('повтор задач с другими темами курса: %s', v_need);
    END IF;

    SELECT array_agg(ROW(x.id, x.ord::integer, ct.section_id, NULL::uuid, 1)::public.variant_item_input)
    INTO v_items
    FROM unnest(v_picked) WITH ORDINALITY AS x(id, ord)
    JOIN public.catalog_tasks ct ON ct.id = x.id;

    v_variant := public.save_variant_atomic(
      NULL, v_t.title, NULL, 'physics', 'ege', 'ready',
      jsonb_build_object('generation_mode', 'course_topic', 'sections', '[]'::jsonb,
                         'course_topic_id', v_t.id),
      v_items);

    PERFORM public.attach_variant_to_topic(v_variant, v_t.id, v_groups, NULL);

    v_used  := v_used || v_picked;
    status  := 'built';
    RETURN NEXT;
  END LOOP;
END;
$function$;

comment on function public.build_topic_tests_for_course(uuid, integer, boolean) is
  'Собрать тесты по темам курса из связанных тем каталога. Только первая часть, только автопроверяемое. Повторы задач между темами курса избегаются, вынужденный повтор попадает в отчёт.';

revoke all on function public.course_topic_test_overview(uuid)                     from public, anon;
revoke all on function public.build_topic_tests_for_course(uuid, integer, boolean) from public, anon;
grant execute on function public.course_topic_test_overview(uuid)                     to authenticated;
grant execute on function public.build_topic_tests_for_course(uuid, integer, boolean) to authenticated;
