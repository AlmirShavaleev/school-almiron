-- Обнаружено сразу после предыдущей миграции, на проверке №24 ОГЭ.
--
-- Когда в разделе не осталось ни одной пригодной задачи, цикл по темам получал
-- пустой список и делал CONTINUE — то есть раздел молча выпадал. Учитель просил
-- 3 задачи по №24 «Геометрические задачи на доказательство», получал пустой
-- вариант и ни одного слова о причине. До ужесточения фильтра случай был почти
-- невозможен (эталон есть почти везде), после — стал реальным: этот номер
-- схлопнулся в ноль целиком.
--
-- Теперь пустой раздел с запрошенным количеством даёт ту же структурированную
-- ошибку NOT_ENOUGH_TASKS с available = 0, которую интерфейс уже умеет
-- показывать. Раздел, у которого не просили задач (cnt = 0), по-прежнему
-- пропускается молча — это норма.

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
      -- Раздел без пригодных задач. Молча пропускать нельзя: заказавший задачи
      -- получил бы пустой вариант без объяснения.
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
