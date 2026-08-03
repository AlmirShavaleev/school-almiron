-- Привязка теста к теме курса (§58) создавала настоящую выдачу, но молча:
-- ученик узнавал о тесте, только зайдя в кабинет. Через раздел «Тесты»
-- (assign_test_variant) карточка в Telegram уходит, а через программу курса —
-- нет. Одно и то же действие вело себя по-разному в зависимости от экрана.
--
-- Событие variant_assigned и хелпер queue_variant_telegram_notification уже
-- существуют — используем их, ничего нового не заводим. Payload той же формы,
-- что у assign_test_variant, включая сырой due_at: форматирует воркер (§65).

create or replace function public.attach_variant_to_topic(
  p_variant_id uuid,
  p_topic_id   uuid,
  p_group_ids  uuid[],
  p_due_at     timestamptz default null
) returns integer
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_group_id      uuid;
  v_group_name    text;
  v_assignment_id uuid;
  v_created       integer := 0;
  v_variant       record;
  v_row           record;
BEGIN
  IF NOT public.topic_material_can_manage(p_topic_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: not staff of this course topic';
  END IF;

  SELECT tv.id, tv.title, tv.subject, tv.exam_type, tv.tasks_count
  INTO v_variant
  FROM public.test_variants tv
  WHERE tv.id = p_variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_VARIANT: test not found';
  END IF;

  IF p_group_ids IS NULL OR array_length(p_group_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_GROUPS: select at least one group';
  END IF;

  -- Группа обязана принадлежать курсу этой темы: иначе через параметр можно
  -- было бы выдать тест куда угодно в обход прав на чужой курс.
  IF EXISTS (
    SELECT 1 FROM unnest(p_group_ids) gid
    WHERE gid NOT IN (
      SELECT g.id
      FROM public.topics t
      JOIN public.modules m ON m.id = t.module_id
      JOIN public.groups  g ON g.course_id = m.course_id
      WHERE t.id = p_topic_id
    )
  ) THEN
    RAISE EXCEPTION 'FOREIGN_GROUP: group does not belong to this course';
  END IF;

  FOREACH v_group_id IN ARRAY p_group_ids LOOP
    -- Повторная привязка той же группы не плодит вторую выдачу.
    IF EXISTS (
      SELECT 1 FROM public.test_variant_assignments
      WHERE variant_id = p_variant_id
        AND topic_id   = p_topic_id
        AND group_id   = v_group_id
    ) THEN
      CONTINUE;
    END IF;

    SELECT g.name INTO v_group_name FROM public.groups g WHERE g.id = v_group_id;

    INSERT INTO public.test_variant_assignments
      (variant_id, assigned_by, student_id, group_id, topic_id, due_at,
       max_attempts, allow_retry, show_answers_after_submit, show_solutions_after_submit, status)
    VALUES
      (p_variant_id, auth.uid(), NULL, v_group_id, p_topic_id, p_due_at,
       1, false, true, true, 'assigned')
    RETURNING id INTO v_assignment_id;

    -- Строки ученикам и карточка каждому. RETURNING внутри FOR нужен, чтобы
    -- знать id выдачи и профиль: без них уведомление не адресовать.
    FOR v_row IN
      WITH ins AS (
        INSERT INTO public.test_variant_student_assignments
          (assignment_id, variant_id, student_id, status, due_at, max_attempts)
        SELECT v_assignment_id, p_variant_id, gs.student_id, 'not_started', p_due_at, 1
        FROM public.group_students gs
        WHERE gs.group_id = v_group_id
        RETURNING id, student_id
      )
      SELECT ins.id AS sa_id, s.profile_id
      FROM ins
      JOIN public.students s ON s.id = ins.student_id
      WHERE s.profile_id IS NOT NULL
    LOOP
      PERFORM public.queue_variant_telegram_notification(
        p_profile_id            := v_row.profile_id,
        p_student_assignment_id := v_row.sa_id,
        p_assignment_id         := v_assignment_id,
        p_variant_id            := p_variant_id,
        p_event_type            := 'variant_assigned',
        p_deduplication_key     := format('variant_assigned:%s:%s', v_row.sa_id, v_row.profile_id),
        p_payload := jsonb_build_object(
          'title',          v_variant.title,
          'subject',        v_variant.subject,
          'exam_type',      v_variant.exam_type,
          'group_name',     v_group_name,
          'tasks_count',    v_variant.tasks_count,
          'due_at',         p_due_at,
          'available_from', NULL,
          'link',           '/student/variants/' || v_row.sa_id::text,
          'button_text',    'Открыть вариант'
        )
      );
    END LOOP;

    v_created := v_created + 1;
  END LOOP;

  RETURN v_created;
END;
$function$;

comment on function public.attach_variant_to_topic(uuid, uuid, uuid[], timestamptz) is
  'Привязать тест к теме курса = выдать его выбранным группам курса и уведомить учеников.';
