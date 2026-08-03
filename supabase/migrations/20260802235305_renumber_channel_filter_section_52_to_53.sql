-- Перенумерация ссылок: работа по фильтру канала записана как §53, а не §52.
--
-- §52 за три минуты до неё занял контур тестов (миграция
-- 20260802234351_variant_autobuild_comments_renumbered_to_section_52, девять
-- `comment on` в базе), хотя в реестре `ОРКЕСТРАЦИЯ.md` номер был
-- зарезервирован за уведомлениями. Двигаются уведомления — дешевле.
--
-- Поведение не меняется ни на строку: только ссылка §52 → §53 внутри тел
-- `finalize_grading`, `claim_notification_queue` и в комментарии колонки.
-- Применённую миграцию 20260802234710 править нельзя (MIGRATIONS.md), поэтому
-- исправление приходит отдельной версией.

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

  -- Check for ungraded pending answers
  SELECT COUNT(*) INTO v_pending
  FROM public.test_variant_answers
  WHERE student_assignment_id = p_student_assignment_id
    AND grading_status = 'pending_review';

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'INCOMPLETE: % manual answer(s) still pending review', v_pending;
  END IF;

  -- Compute final score
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

  -- Notify student
  -- Канал 'telegram', а не 'in_app' (§53): notification_queue — очередь наружу,
  -- и обрабатывает её только telegram-воркер. Строка с 'in_app' доезжала до
  -- него лишь потому, что claim не фильтровал канал.
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
      'title', 'Работа проверена',
      'body',  'Ваша работа проверена преподавателем. Итоговый балл: ' ||
               v_total_score::text || ' / ' || v_total_max::text ||
               ' (' || v_percentage::text || '%)'
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

CREATE OR REPLACE FUNCTION public.claim_notification_queue(batch_size integer DEFAULT 20)
 RETURNS SETOF notification_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Восстанавливаем зависшие recording > 10 мин → pending
  UPDATE notification_queue
  SET    status        = 'pending',
         processing_at = NULL
  WHERE  status        = 'processing'
    AND  processing_at < now() - interval '10 minutes';

  -- Атомарно захватываем новую пачку
  RETURN QUERY
  UPDATE notification_queue
  SET    status        = 'processing',
         processing_at = now()
  WHERE  id IN (
    SELECT id FROM notification_queue
    WHERE  status        = 'pending'
      AND  scheduled_for <= now()
      AND  attempts < 3
      -- §53: очередь обрабатывает telegram-воркер и только он. Без этого
      -- условия сюда попадала строка с любым каналом.
      AND  channel       = 'telegram'
    ORDER  BY scheduled_for
    LIMIT  batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$function$;

comment on column public.notification_queue.channel is
  'Всегда ''telegram'' (§53). Очередь обрабатывает только telegram-воркер, claim_notification_queue фильтрует по этому полю, а check не даёт завести строку, которую никто не заберёт. In-app уведомления живут в таблице notifications, не здесь.';
