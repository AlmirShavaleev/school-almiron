-- Уведомление о проверке тестирования убрано целиком.
--
-- Решение владельца 04.08: карточка `variant_graded` не нужна. Убираем
-- производителя здесь и ветку в воркере; `variant_assigned` (выдача варианта)
-- остаётся — её не трогаем.
--
-- Правка сделана в зоне чата тестов и согласована оркестратором. Тронут только
-- блок оповещения: подсчёт балла, проверки прав и запись результата не
-- изменились ни на строку. Вместе с блоком ушла переменная v_variant_title —
-- она заполнялась только ради payload.
--
-- Строк `variant_graded` в очереди не было ни одной, чистить нечего.

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
    SELECT COALESCE(SUM(COALESCE(tva.points_earned, 0)), 0),
           COALESCE(SUM(tva.points_max), 0)
    INTO v_total_score, v_total_max
    FROM public.test_variant_answers tva
    WHERE tva.student_assignment_id = p_student_assignment_id;

    v_total_max := COALESCE(NULLIF(v_total_max, 0), v_tvsa.max_score, 0);

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

  SELECT COALESCE(SUM(COALESCE(tva.points_earned, 0)), 0),
         COALESCE(SUM(tva.points_max), 0)
  INTO v_total_score, v_total_max
  FROM public.test_variant_answers tva
  WHERE tva.student_assignment_id = p_student_assignment_id;

  v_total_max := COALESCE(NULLIF(v_total_max, 0), v_tvsa.max_score, 0);
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

  -- Уведомления здесь больше нет: карточка `variant_graded` убрана решением
  -- владельца 04.08. Заводить её обратно — только через владельца.

  RETURN jsonb_build_object(
    'status',      'graded',
    'score',       v_total_score,
    'max_score',   v_total_max,
    'percentage',  v_percentage,
    'reviewed_at', now()
  );
END;
$function$;
