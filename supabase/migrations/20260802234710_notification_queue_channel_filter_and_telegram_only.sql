-- §52. `claim_notification_queue` не смотрел на `channel`.
--
-- `finalize_grading` кладёт `variant_graded` с `channel = 'in_app'`, а claim
-- канал не фильтровал — строка доезжала до telegram-воркера и уходила в
-- Telegram. Работало это по случайности, а не по замыслу: потребителя у
-- `in_app` нет ни одного. `notification_queue` читают только воркер (claim) и
-- админский журнал на просмотр; колокольчик живёт в отдельной таблице
-- `notifications`, куда finalize_grading не пишет вовсе.
--
-- Порядок правок односторонний: фильтр раньше производителя = тихая потеря
-- (строки `in_app` перестают захватываться и висят `pending` навсегда, ровно
-- тот же класс отказа, что в §47). Поэтому всё делается одной транзакцией:
-- сначала производитель, потом бэкфилл, потом фильтр, потом ограничение.
--
-- Правка в `finalize_grading` — ровно один литерал 'in_app' → 'telegram'.
-- Функция принадлежит контуру вариантов/тестов, остальное тело не тронуто;
-- согласовано с владельцем перед применением.

-- 1. Производитель. Единственный, кто кладёт не-telegram канал.

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
  -- Канал 'telegram', а не 'in_app' (§52): notification_queue — очередь наружу,
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

-- 2. Бэкфилл. На момент миграции таких строк ноль (в очереди 10 строк, все
--    telegram), но выполнить надо ДО ограничения: check валидирует и старые
--    строки, а любая уцелевшая 'in_app' иначе повесила бы всю миграцию.

update public.notification_queue
   set channel = 'telegram'
 where channel is distinct from 'telegram';

-- 3. Фильтр. Теперь воркер забирает только своё.

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
      -- §52: очередь обрабатывает telegram-воркер и только он. Без этого
      -- условия сюда попадала строка с любым каналом.
      AND  channel       = 'telegram'
    ORDER  BY scheduled_for
    LIMIT  batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$function$;

-- 4. Защита от повторения. Новый производитель с чужим каналом теперь упрётся
--    громко на вставке, а не зависнет тихо в очереди.
--
--    Когда появится настоящий второй канал (email, push), менять надо здесь и
--    в claim одновременно — само по себе ограничение снимать бессмысленно,
--    пока claim забирает только 'telegram'.

alter table public.notification_queue
  drop constraint if exists notification_queue_channel_telegram_only;

alter table public.notification_queue
  add constraint notification_queue_channel_telegram_only
  check (channel = 'telegram');

comment on column public.notification_queue.channel is
  'Всегда ''telegram'' (§52). Очередь обрабатывает только telegram-воркер, claim_notification_queue фильтрует по этому полю, а check не даёт завести строку, которую никто не заберёт. In-app уведомления живут в таблице notifications, не здесь.';
