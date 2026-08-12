-- Случайные генераторы фильтровали has_answer — «эталон существует». Но
-- существование эталона не значит, что автопроверка умеет его сверить: у задач
-- с развёрнутым ответом, доказательством или рисунком эталон есть, а сверять
-- его не с чем. Такая задача получает is_correct = NULL и points NULL, при этом
-- её баллы остаются в max_score. Человек молча теряет балл, и никто этого не
-- видит — ровно тот класс ошибок, что вычищается в §62, §63, §66, §71, §96.
--
-- Правило не дублируется: обе функции спрашивают variant_answer_is_auto_checkable,
-- ту же, по которой живёт пул автосборки и вердикт submit_variant.
--
-- Замер выпадения (опубликованные, с эталоном) сделан ДО правки. По первой
-- части потери ничтожны: математика ЕГЭ 18 из 5733, ОГЭ 16 из 4893, физика 0.
-- По второй части, где эталон часто текстовый, выпадение крупное и ожидаемое:
-- №16 «Экономические задачи» 282 → 140, №19 «Теория чисел» 288 → 143,
-- №17 «Планиметрия» 227 → 91, №14 «Стереометрия» 106 → 16.
--
-- ОТДЕЛЬНО: №24 математики ОГЭ «Геометрические задачи на доказательство»
-- схлопывается в НОЛЬ, 87 → 0. Это верно по сути — доказательство автопроверке
-- не поддаётся в принципе, — но означает, что случайная сборка по этому номеру
-- больше не соберётся вовсе и честно ответит NOT_ENOUGH_TASKS вместо теста,
-- где все задачи оценены в ноль.

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
         AND public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type);
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
         AND public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
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
     AND public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
     AND ct.id <> p_old_task_id
     AND (v_existing IS NULL OR ct.id <> ALL(v_existing))
   ORDER BY random()
   LIMIT 1;

  RETURN v_new_task_id;
END;
$function$;
