-- Карточка variant_graded уходила в Telegram строкой, собранной здесь:
--   «Работа проверена» / «Ваша работа проверена преподавателем.
--    Итоговый балл: 18.00 / 22.00 (81.82%)»
-- Повтор «работа проверена… проверена преподавателем», машинная точность там,
-- где нужны целые, и ни ссылки, ни кнопки.
--
-- По правилу §65 формулировки собирает воркер, производитель отдаёт данные.
-- Поэтому в payload теперь лежат score / max_score / percentage / variant_title
-- / link — воркеру есть из чего собрать карточку и кнопку.
--
-- title и body ОСТАВЛЕНЫ намеренно, с утверждённым текстом. Ветка воркера для
-- variant_graded пока просто печатает их (в отличие от variant_assigned, где
-- воркер уже собирает сам), а сам воркер — зона чата уведомлений. Убрать их
-- сейчас значит выключить карточку в проде. Когда там появится сборщик, эти
-- два поля удаляются отсюда одной правкой.
--
-- Числа: 18.00 → «18», 17.50 → «17.5», 81.82% → «82%». Хвостовые нули режем,
-- процент округляем до целого — так в утверждённом тексте. Точка блокирует
-- лишнюю обрезку: numeric(10,2) всегда печатается с ней, поэтому «10.00» даёт
-- «10», а не «1».

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
  v_score_txt   text;
  v_max_txt     text;
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

  -- Числа для человека: без хвостовых нулей, процент целым.
  v_score_txt := rtrim(rtrim(v_total_score::text, '0'), '.');
  v_max_txt   := rtrim(rtrim(v_total_max::text,   '0'), '.');

  SELECT tv.title INTO v_variant_title
  FROM public.test_variant_student_assignments tvsa
  JOIN public.test_variants tv ON tv.id = tvsa.variant_id
  WHERE tvsa.id = p_student_assignment_id;

  -- Канал 'telegram', а не 'in_app' (§53): notification_queue — очередь наружу,
  -- и обрабатывает её только telegram-воркер.
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
      -- Данные для воркера.
      'variant_title', v_variant_title,
      'score',         v_total_score,
      'max_score',     v_total_max,
      'percentage',    v_percentage,
      'link',          '/student/variants/' || p_student_assignment_id::text,
      'button_text',   'Посмотреть разбор',
      -- Временно: ветка воркера пока печатает готовый текст. Удалить, когда
      -- там появится сборщик variant_graded.
      'title', 'Вариант проверен — ' || v_score_txt || ' из ' || v_max_txt,
      'body',  CASE WHEN v_percentage IS NULL THEN ''
                    ELSE 'Это ' || ROUND(v_percentage)::text || '% от максимума.'
               END
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
