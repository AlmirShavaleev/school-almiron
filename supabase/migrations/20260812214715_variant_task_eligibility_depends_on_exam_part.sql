-- §124 потребовал автопроверяемости от ВСЕХ задач. Для второй части это
-- неверно: она идёт на разбор по критериям, сверять её строкой ответа не с чем
-- и не нужно. Последствие вскрылось на живом прогоне: «Стандартный вариант»
-- математики ЕГЭ дал 19 задач, из них 18 первой части и одна второй. В разделах
-- №13–19 лежит смесь, и генератор выбирал меньшинство с коротким ответом
-- (№16 — 143 из 366, №19 — 91 из 697, №17 — 92 из 653). Вариант перестал быть
-- похож на экзамен.
--
-- Правило становится двойным и живёт в ОДНОЙ функции:
--   часть 1 — только автопроверяемые (variant_answer_is_auto_checkable);
--   часть 2 — только с критериями и max_points, автопроверяемость не нужна.
-- Задача второй части без критериев в выборку не идёт: разбирать нечем.
-- Таких на проде: физика ЕГЭ 13, математика ЕГЭ 27, физика ОГЭ 8,
-- математика ОГЭ 289.
--
-- ВАЖНОЕ СЛЕДСТВИЕ. grading_type у элементов варианта по умолчанию 'auto', и
-- ни один из 108 существующих элементов никогда не был 'manual'. Впустить
-- вторую часть обратно и оставить её 'auto' значит вернуть ровно ту потерю
-- балла, которую §124 закрывал: submit_variant поставит is_correct = NULL и
-- points NULL, а баллы задачи останутся в max_score. Поэтому save_variant_atomic
-- помечает задачи второй части как 'manual' — они уходят преподавателю на
-- проверку по критериям, для чего критерии и нужны.
--
-- Ученический create_self_built_variant не трогаем: там вторая часть кладётся с
-- points = 0 и разбирается шагом самопроверки, потери нет.

create or replace function public.variant_task_eligible(
  p_exam_part          smallint,
  p_answer_html        text,
  p_partial_type       text,
  p_grade_criteria_html text,
  p_max_points         smallint
) returns boolean
language sql
immutable
set search_path to ''
as $$
  select case
    when p_exam_part = 2 then
      p_grade_criteria_html is not null
      and btrim(p_grade_criteria_html) <> ''
      and coalesce(p_max_points, 0) > 0
    else
      public.variant_answer_is_auto_checkable(p_answer_html, p_partial_type)
  end;
$$;

comment on function public.variant_task_eligible(smallint, text, text, text, smallint) is
  'Годится ли задача в вариант. Часть 1 — автопроверяемая; часть 2 — с критериями и баллом. Один источник правды для генераторов и счётчиков.';

-- ── Генераторы ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_variant_tasks(p_sections variant_section_input[])
 RETURNS TABLE(out_task_id uuid, out_section_id uuid, out_topic_id uuid, out_position integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role      text;
  v_sec       public.variant_section_input;
  v_topic_ids uuid[];
  v_per_topic integer;
  v_remainder integer;
  v_topic_idx integer;
  v_topic_id  uuid;
  v_needed    integer;
  v_available integer;
  v_pos       integer := 0;
  v_selected  uuid[]  := ARRAY[]::uuid[];
  v_task_ids  uuid[];
  i           integer;
BEGIN
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('teacher', 'admin', 'owner', 'curator', 'student') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_sec IN SELECT * FROM unnest(p_sections) LOOP
    IF v_sec.topic_ids IS NULL OR array_length(v_sec.topic_ids, 1) IS NULL THEN
      SELECT ARRAY_AGG(DISTINCT ctt.topic_id)
        INTO v_topic_ids
        FROM public.catalog_task_topics ctt
        JOIN public.catalog_tasks ct ON ct.id = ctt.task_id
       WHERE ct.section_id = v_sec.section_id
         AND ct.is_published = true
         AND public.variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type,
                                          ct.grade_criteria_html, ct.max_points);
    ELSE
      v_topic_ids := v_sec.topic_ids;
    END IF;

    IF v_topic_ids IS NULL OR array_length(v_topic_ids, 1) = 0 THEN
      IF COALESCE(v_sec.cnt, 0) > 0 THEN
        RAISE EXCEPTION 'NOT_ENOUGH_TASKS:section=%:topic=%:needed=%:available=0',
          v_sec.section_id, NULL::uuid, v_sec.cnt;
      END IF;
      CONTINUE;
    END IF;

    v_per_topic := v_sec.cnt / array_length(v_topic_ids, 1);
    v_remainder := v_sec.cnt % array_length(v_topic_ids, 1);

    v_topic_idx := 1;
    FOREACH v_topic_id IN ARRAY v_topic_ids LOOP
      v_needed := v_per_topic + CASE WHEN v_topic_idx <= v_remainder THEN 1 ELSE 0 END;
      v_topic_idx := v_topic_idx + 1;

      IF v_needed = 0 THEN CONTINUE; END IF;

      SELECT ARRAY_AGG(ct.id ORDER BY random())
        INTO v_task_ids
        FROM public.catalog_tasks ct
        JOIN public.catalog_task_topics ctt ON ctt.task_id = ct.id
       WHERE ct.section_id = v_sec.section_id
         AND ctt.topic_id  = v_topic_id
         AND ct.is_published = true
         AND public.variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type,
                                          ct.grade_criteria_html, ct.max_points)
         AND ct.id <> ALL(v_selected);

      v_available := COALESCE(array_length(v_task_ids, 1), 0);

      IF v_available < v_needed THEN
        RAISE EXCEPTION 'NOT_ENOUGH_TASKS:section=%:topic=%:needed=%:available=%',
          v_sec.section_id, v_topic_id, v_needed, v_available;
      END IF;

      FOR i IN 1..v_needed LOOP
        v_pos := v_pos + 1;
        v_selected    := array_append(v_selected, v_task_ids[i]);
        out_task_id    := v_task_ids[i];
        out_section_id := v_sec.section_id;
        out_topic_id   := v_topic_id;
        out_position   := v_pos;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.replace_variant_task(p_variant_id uuid, p_old_task_id uuid, p_section_id uuid, p_topic_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role          text;
  v_variant_owner uuid;
  v_existing      uuid[];
  v_new_task_id   uuid;
BEGIN
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('teacher', 'admin', 'owner') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT created_by INTO v_variant_owner FROM public.test_variants WHERE id = p_variant_id;
  IF v_role = 'teacher' AND v_variant_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT ARRAY_AGG(task_id)
    INTO v_existing
    FROM public.test_variant_items
   WHERE variant_id = p_variant_id
     AND task_id <> p_old_task_id;

  SELECT ct.id INTO v_new_task_id
    FROM public.catalog_tasks ct
    JOIN public.catalog_task_topics ctt ON ctt.task_id = ct.id
   WHERE ct.section_id   = p_section_id
     AND ctt.topic_id    = p_topic_id
     AND ct.is_published = true
     AND public.variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type,
                                      ct.grade_criteria_html, ct.max_points)
     AND ct.id <> p_old_task_id
     AND (v_existing IS NULL OR ct.id <> ALL(v_existing))
   ORDER BY random()
   LIMIT 1;

  RETURN v_new_task_id;
END;
$function$;

-- ── Вторая часть в учительском варианте уходит на разбор, а не в тишину ──────

CREATE OR REPLACE FUNCTION public.save_variant_atomic(p_variant_id uuid, p_title text, p_description text, p_subject text, p_exam_type text, p_status text, p_settings jsonb, p_items variant_item_input[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role    text;
  v_id      uuid;
  v_count   integer;
  v_item    public.variant_item_input;
BEGIN
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('teacher', 'admin', 'owner') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_count := COALESCE(array_length(p_items, 1), 0);

  IF p_variant_id IS NULL THEN
    INSERT INTO public.test_variants
      (title, description, subject, exam_type, status, created_by, settings, tasks_count)
    VALUES
      (p_title, p_description, p_subject, p_exam_type, p_status, auth.uid(), p_settings, v_count)
    RETURNING id INTO v_id;
  ELSE
    IF v_role = 'teacher' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.test_variants
        WHERE id = p_variant_id AND created_by = auth.uid()
      ) THEN
        RAISE EXCEPTION 'Access denied';
      END IF;
    END IF;

    UPDATE public.test_variants SET
      title       = p_title,
      description = p_description,
      subject     = p_subject,
      exam_type   = p_exam_type,
      status      = p_status,
      settings    = p_settings,
      tasks_count = v_count,
      updated_at  = now()
    WHERE id = p_variant_id;
    v_id := p_variant_id;
  END IF;

  DELETE FROM public.test_variant_items WHERE variant_id = v_id;

  IF v_count > 0 THEN
    FOR v_item IN SELECT * FROM unnest(p_items) LOOP
      -- Вторая часть проверяется человеком по критериям. Если оставить 'auto',
      -- submit_variant не сможет её сверить, поставит NULL и молча заберёт балл.
      INSERT INTO public.test_variant_items
        (variant_id, task_id, "position", section_id, topic_id, points, grading_type)
      SELECT
        v_id, v_item.task_id, v_item.pos, v_item.section_id, v_item.topic_id,
        COALESCE(v_item.points, 1),
        CASE WHEN ct.exam_part = 2 THEN 'manual' ELSE 'auto' END
      FROM public.catalog_tasks ct
      WHERE ct.id = v_item.task_id;
    END LOOP;
  END IF;

  RETURN v_id;
END;
$function$;
