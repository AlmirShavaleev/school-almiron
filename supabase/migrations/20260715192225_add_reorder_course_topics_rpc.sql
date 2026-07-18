CREATE OR REPLACE FUNCTION public.reorder_course_topics(
  p_course_id uuid,
  p_layout jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_probe uuid;
  v_bad_module int;
  v_bad_topic int;
  v_layout_count int;
  v_layout_distinct int;
  v_course_count int;
  v_module_entries int;
  v_module_distinct int;
BEGIN
  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'array' OR jsonb_array_length(p_layout) = 0 THEN
    RAISE EXCEPTION 'EMPTY_OR_INVALID_LAYOUT';
  END IF;

  SELECT count(*), count(DISTINCT (e->>'module_id'))
    INTO v_module_entries, v_module_distinct
  FROM jsonb_array_elements(p_layout) AS e;
  IF v_module_entries <> v_module_distinct THEN
    RAISE EXCEPTION 'DUPLICATE_MODULE_IN_LAYOUT';
  END IF;

  SELECT t.id INTO v_probe
  FROM public.topics t
  JOIN public.modules m ON m.id = t.module_id
  WHERE m.course_id = p_course_id
  LIMIT 1;

  IF v_probe IS NULL THEN
    RAISE EXCEPTION 'COURSE_HAS_NO_TOPICS_OR_NOT_FOUND: %', p_course_id;
  END IF;

  IF NOT (public.is_admin_or_owner() OR public.auth_is_staff_of_topic(v_probe)) THEN
    RAISE EXCEPTION 'FORBIDDEN: not staff of course %', p_course_id;
  END IF;

  CREATE TEMP TABLE _reorder(module_id uuid, topic_id uuid, position int) ON COMMIT DROP;
  INSERT INTO _reorder(module_id, topic_id, position)
  SELECT (e->>'module_id')::uuid,
         (ti.topic_id)::uuid,
         (ti.ord - 1)
  FROM jsonb_array_elements(p_layout) AS e
  CROSS JOIN LATERAL jsonb_array_elements_text(e->'topic_ids')
    WITH ORDINALITY AS ti(topic_id, ord);

  SELECT count(*) INTO v_bad_module
  FROM (SELECT DISTINCT module_id FROM _reorder) x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.modules m
    WHERE m.id = x.module_id AND m.course_id = p_course_id
  );
  IF v_bad_module > 0 THEN
    RAISE EXCEPTION 'MODULE_NOT_IN_COURSE: % module(s) outside course %', v_bad_module, p_course_id;
  END IF;

  SELECT count(*) INTO v_bad_topic
  FROM _reorder r
  WHERE NOT EXISTS (
    SELECT 1 FROM public.topics t
    JOIN public.modules m ON m.id = t.module_id
    WHERE t.id = r.topic_id AND m.course_id = p_course_id
  );
  IF v_bad_topic > 0 THEN
    RAISE EXCEPTION 'TOPIC_NOT_IN_COURSE: % topic(s) outside course %', v_bad_topic, p_course_id;
  END IF;

  SELECT count(*), count(DISTINCT topic_id) INTO v_layout_count, v_layout_distinct FROM _reorder;
  IF v_layout_count <> v_layout_distinct THEN
    RAISE EXCEPTION 'DUPLICATE_TOPIC_IN_LAYOUT';
  END IF;

  SELECT count(*) INTO v_course_count
  FROM public.topics t
  JOIN public.modules m ON m.id = t.module_id
  WHERE m.course_id = p_course_id;

  IF v_layout_count <> v_course_count THEN
    RAISE EXCEPTION 'TOPIC_SET_MISMATCH: layout %, course %', v_layout_count, v_course_count;
  END IF;

  WITH parked AS (
    SELECT t.id, row_number() OVER () AS rn
    FROM public.topics t
    JOIN public.modules m ON m.id = t.module_id
    WHERE m.course_id = p_course_id
  )
  UPDATE public.topics t
  SET order_index = -1 * parked.rn
  FROM parked
  WHERE t.id = parked.id;

  UPDATE public.topics t
  SET module_id = r.module_id,
      order_index = r.position
  FROM _reorder r
  WHERE t.id = r.topic_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_course_topics(uuid, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.reorder_course_topics(uuid, jsonb) TO authenticated;
