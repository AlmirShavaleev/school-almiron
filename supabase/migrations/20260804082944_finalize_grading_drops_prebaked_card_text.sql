-- Снятие временных полей, оставленных в §67.
--
-- Тогда ветка воркера для variant_graded просто печатала готовые title и body,
-- поэтому производитель клал их рядом с данными: убрать сразу значило выключить
-- карточку в проде. В §69 сборщик появился — воркер собирает текст из score,
-- max_score и percentage сам. Готовый текст стал запасным путём, который больше
-- не срабатывает.
--
-- Перед снятием проверено, что в notification_queue нет ни одной строки
-- variant_graded — ни pending, ни любой другой. Уже поставленные в очередь
-- строки правку производителя и так пережили бы: payload у них снимок, он не
-- меняется задним числом. Но снимать под живой строкой всё равно нельзя, если
-- она вдруг старого формата: её единственная защита — фолбэк воркера.
--
-- После этой миграции формулировка карточки живёт ровно в одном месте — в
-- воркере, — как и требует правило §65.

CREATE OR REPLACE FUNCTION public.finalize_grading(p_student_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tvsa        record;
  v_role        text;
  v_pending     integer;
  v_total_score numeric(10,2);
  v_total_max   numeric(10,2);
  v_percentage  numeric(5,2);
  v_variant_title text;
BEGIN
  v_role := public.current_user_role();

  IF v_role NOT IN ('teacher', 'admin', 'owner') THEN
    RAISE EXCEPTION 'ACCESS_DENIED: only teachers and admins can finalize grading';
  END IF;

  SELECT tvsa.id, tvsa.status, tvsa.assignment_id,
         tvsa.grading_status, tvsa.auto_score, tvsa.max_score,
         tvsa.answered_count, tvsa.correct_count
  INTO v_tvsa
  FROM public.test_variant_student_assignments tvsa
  WHERE tvsa.id = p_student_assignment_id
  FOR UPDATE OF tvsa;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: student assignment not found';
  END IF;

  IF v_role = 'teacher' AND NOT public.auth_is_assigner(v_tvsa.assignment_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: you are not the assigner of this variant';
  END IF;

  IF v_tvsa.status NOT IN ('submitted', 'completed') THEN
    RAISE EXCEPTION 'NOT_SUBMITTED: can only finalize submitted work';
  END IF;

  -- Idempotent: already graded
  IF v_tvsa.grading_status = 'graded' THEN
    SELECT SUM(COALESCE(tva.points_earned, 0)), SUM(tva.points_max)
    INTO v_total_score, v_total_max
    FROM public.test_variant_answers tva
    WHERE tva.student_assignment_id = p_student_assignment_id;

    IF v_total_max > 0 THEN
      v_percentage := ROUND(v_total_score / v_total_max * 100, 2);
    END IF;

    RETURN jsonb_build_object(
      'status',    'graded',
      'score',     v_total_score,
      'max_score', v_total_max,
      'percentage', v_percentage,
      'idempotent', true
    );
  END IF;

  SELECT COUNT(*) INTO v_pending
  FROM public.test_variant_answers
  WHERE student_assignment_id = p_student_assignment_id
    AND grading_status = 'pending_review';

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'INCOMPLETE: % manual answer(s) still pending review', v_pending;
  END IF;

  SELECT SUM(COALESCE(tva.points_earned, 0)), SUM(tva.points_max)
  INTO v_total_score, v_total_max
  FROM public.test_variant_answers tva
  WHERE tva.student_assignment_id = p_student_assignment_id;

  v_total_max := COALESCE(v_tvsa.max_score, v_total_max);
  IF v_total_max > 0 THEN
    v_percentage := ROUND(v_total_score / v_total_max * 100, 2);
  END IF;

  UPDATE public.test_variant_student_assignments
  SET score          = v_total_score,
      max_score      = v_total_max,
      percentage     = v_percentage,
      grading_status = 'graded',
      reviewed_at    = now(),
      reviewed_by    = auth.uid(),
      updated_at     = now()
  WHERE id = p_student_assignment_id;

  SELECT tv.title INTO v_variant_title
  FROM public.test_variant_student_assignments tvsa
  JOIN public.test_variants tv ON tv.id = tvsa.variant_id
  WHERE tvsa.id = p_student_assignment_id;

  -- Канал 'telegram', а не 'in_app' (§53): notification_queue — очередь наружу,
  -- и обрабатывает её только telegram-воркер.
  --
  -- Только данные. Формулировку собирает воркер (§65, §69).
  INSERT INTO public.notification_queue (
    profile_id, event_type, entity_type, entity_id,
    channel, payload, deduplication_key
  )
  SELECT
    s.profile_id,
    'variant_graded',
    'student_assignment',
    p_student_assignment_id,
    'telegram',
    jsonb_build_object(
      'variant_title', v_variant_title,
      'score',         v_total_score,
      'max_score',     v_total_max,
      'percentage',    v_percentage,
      'link',          '/student/variants/' || p_student_assignment_id::text,
      'button_text',   'Посмотреть разбор'
    ),
    'variant_graded:' || p_student_assignment_id::text
  FROM public.test_variant_student_assignments tvsa
  JOIN public.students s ON s.id = tvsa.student_id
  WHERE tvsa.id = p_student_assignment_id
  ON CONFLICT (deduplication_key) DO NOTHING;

  RETURN jsonb_build_object(
    'status',      'graded',
    'score',       v_total_score,
    'max_score',   v_total_max,
    'percentage',  v_percentage,
    'reviewed_at', now()
  );
END;
$function$;
