-- Случайная выборка не должна класть в тест задачу без эталонного ответа:
-- автопроверка по ней не сработает и ученик получит ноль ни за что. Фильтра
-- has_answer не было ни в одном генераторе, то есть требование нарушалось и в
-- ручной сборке через конструктор, а не только в новой автосборке (§52).
--
-- create_self_built_variant СОЗНАТЕЛЬНО не трогаем: там ученик кладёт в вариант
-- конкретные задачи из корзины, и молча выбрасывать выбранное нельзя —
-- предупреждение показывает интерфейс.

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
         AND ct.has_answer = true;
    ELSE
      v_topic_ids := v_sec.topic_ids;
    END IF;

    IF v_topic_ids IS NULL OR array_length(v_topic_ids, 1) = 0 THEN
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
         AND ct.has_answer = true
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
     AND ct.has_answer   = true
     AND ct.id <> p_old_task_id
     AND (v_existing IS NULL OR ct.id <> ALL(v_existing))
   ORDER BY random()
   LIMIT 1;

  RETURN v_new_task_id;
END;
$function$;
