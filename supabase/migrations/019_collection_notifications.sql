-- Server-side notification parity for assigned_collections/task_submissions.

CREATE OR REPLACE FUNCTION public.queue_collection_notification(
  p_profile_id uuid,
  p_assigned_id uuid,
  p_submission_id uuid,
  p_event_type text,
  p_deduplication_key text,
  p_payload jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_has_connection boolean;
  v_enabled boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.telegram_connections tc
    WHERE tc.profile_id = p_profile_id AND tc.is_enabled = true
      AND tc.disconnected_at IS NULL AND tc.telegram_chat_id IS NOT NULL
  ) INTO v_has_connection;
  IF NOT v_has_connection THEN RETURN 'not_connected'; END IF;

  SELECT coalesce(np.telegram, false) AND CASE
    WHEN p_event_type = 'collection_reviewed' THEN coalesce(np.checked, true)
    ELSE coalesce(np.homework, true)
  END INTO v_enabled
  FROM public.notification_prefs np WHERE np.user_id = p_profile_id;
  IF NOT coalesce(v_enabled, false) THEN RETURN 'disabled'; END IF;

  BEGIN
    INSERT INTO public.notification_queue (
      profile_id, channel, event_type, entity_type, entity_id,
      deduplication_key, payload, status, attempts, scheduled_for
    ) VALUES (
      p_profile_id, 'telegram', p_event_type,
      CASE WHEN p_submission_id IS NULL THEN 'assigned_collection' ELSE 'task_submission' END,
      coalesce(p_submission_id, p_assigned_id), p_deduplication_key,
      coalesce(p_payload, '{}'::jsonb), 'pending', 0, now()
    ) ON CONFLICT (deduplication_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'error';
  END;
  IF FOUND THEN RETURN 'queued'; END IF;
  RETURN 'duplicate';
END;
$$;

REVOKE ALL ON FUNCTION public.queue_collection_notification(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_collection_notification(uuid,uuid,uuid,text,text,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_assignment(p_collection_id uuid, p_student_id uuid DEFAULT NULL::uuid, p_group_id uuid DEFAULT NULL::uuid, p_due_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS assigned_collections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row assigned_collections;
  v_owns boolean;
  v_rec record;
  v_title text;
  v_due_text text;
BEGIN
  IF get_my_role() IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Only teachers can create assignments';
  END IF;

  IF (p_student_id IS NULL) = (p_group_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of student_id or group_id must be set';
  END IF;

  SELECT EXISTS (SELECT 1 FROM task_collections WHERE id = p_collection_id AND created_by = auth.uid()) INTO v_owns;
  IF NOT v_owns THEN
    RAISE EXCEPTION 'Not authorized for this collection';
  END IF;

  IF p_group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM groups g JOIN teachers t ON t.id = g.teacher_id
      WHERE g.id = p_group_id AND t.profile_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Not authorized for this group';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM group_students gs JOIN groups g ON g.id = gs.group_id JOIN teachers t ON t.id = g.teacher_id
      WHERE gs.student_id = p_student_id AND t.profile_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Not authorized for this student';
    END IF;
  END IF;

  INSERT INTO assigned_collections (collection_id, teacher_id, student_id, group_id, due_date, status)
  VALUES (p_collection_id, auth.uid(), p_student_id, p_group_id, p_due_date, 'active')
  RETURNING * INTO v_row;

  IF p_group_id IS NOT NULL THEN
    INSERT INTO assigned_collection_members (assigned_id, student_id)
    SELECT v_row.id, gs.student_id FROM group_students gs JOIN students s ON s.id = gs.student_id
    WHERE gs.group_id = p_group_id AND s.is_active = true
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO assigned_collection_members (assigned_id, student_id) VALUES (v_row.id, p_student_id)
    ON CONFLICT DO NOTHING;
  END IF;

  BEGIN
    SELECT title INTO v_title FROM task_collections WHERE id = p_collection_id;
    v_due_text := CASE WHEN p_due_date IS NULL THEN 'Без дедлайна'
      ELSE 'Дедлайн: ' || to_char(p_due_date AT TIME ZONE 'Europe/Moscow', 'DD.MM.YYYY HH24:MI') END;
    FOR v_rec IN SELECT s.profile_id FROM assigned_collection_members m JOIN students s ON s.id=m.student_id
      WHERE m.assigned_id=v_row.id AND s.profile_id IS NOT NULL LOOP
      INSERT INTO notifications(user_id,title,message,type,link)
      SELECT v_rec.profile_id,'Новое домашнее задание',format('«%s». %s',v_title,v_due_text),'info','/my-assignments/'||v_row.id
      WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=v_rec.profile_id
        AND n.title='Новое домашнее задание' AND n.link='/my-assignments/'||v_row.id);
      PERFORM queue_collection_notification(v_rec.profile_id,v_row.id,NULL,'collection_assigned',
        format('collection_assigned:%s:%s',v_row.id,v_rec.profile_id),
        jsonb_build_object('title',v_title,'due_at',p_due_date,'link','/my-assignments/'||v_row.id,'button_text','Открыть ДЗ'));
    END LOOP;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_lesson_homework(p_lesson_id uuid, p_collection_id uuid, p_due_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_confirm_dup boolean DEFAULT false)
 RETURNS assigned_collections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lesson lessons;
  v_row assigned_collections;
  v_owns_collection boolean;
  v_dup_exists boolean;
  v_rec record;
  v_title text;
  v_due_text text;
BEGIN
  IF get_my_role() IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Only teachers can assign lesson homework';
  END IF;

  SELECT * INTO v_lesson FROM lessons WHERE id = p_lesson_id;
  IF v_lesson.id IS NULL THEN
    RAISE EXCEPTION 'Lesson not found';
  END IF;

  IF NOT auth_owns_lesson(p_lesson_id) THEN
    RAISE EXCEPTION 'Not authorized for this lesson';
  END IF;

  IF v_lesson.student_id IS NULL AND v_lesson.group_id IS NULL THEN
    RAISE EXCEPTION 'Lesson has no student or group to assign to';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM task_collections WHERE id = p_collection_id AND created_by = auth.uid()
  ) INTO v_owns_collection;
  IF NOT v_owns_collection THEN
    RAISE EXCEPTION 'Not authorized for this collection';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM assigned_collections
    WHERE lesson_id = p_lesson_id AND collection_id = p_collection_id AND status = 'active'
  ) INTO v_dup_exists;

  IF v_dup_exists AND NOT p_confirm_dup THEN
    RAISE EXCEPTION 'DUPLICATE: this collection is already assigned to this lesson (pass p_confirm_dup to override)';
  END IF;

  -- student_id on lessons references profiles.id directly (not students.id) —
  -- resolve the corresponding students.id row for assigned_collections/roster.
  INSERT INTO assigned_collections (collection_id, teacher_id, student_id, group_id, due_date, status, lesson_id)
  VALUES (
    p_collection_id, auth.uid(),
    CASE WHEN v_lesson.student_id IS NOT NULL THEN (SELECT id FROM students WHERE profile_id = v_lesson.student_id) ELSE NULL END,
    v_lesson.group_id,
    p_due_date, 'active', p_lesson_id
  )
  RETURNING * INTO v_row;

  IF v_lesson.group_id IS NOT NULL THEN
    INSERT INTO assigned_collection_members (assigned_id, student_id)
    SELECT v_row.id, gs.student_id FROM group_students gs JOIN students s ON s.id = gs.student_id
    WHERE gs.group_id = v_lesson.group_id AND s.is_active = true
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO assigned_collection_members (assigned_id, student_id)
    VALUES (v_row.id, v_row.student_id)
    ON CONFLICT DO NOTHING;
  END IF;

  BEGIN
    SELECT title INTO v_title FROM task_collections WHERE id=p_collection_id;
    v_due_text := CASE WHEN p_due_date IS NULL THEN 'Без дедлайна'
      ELSE 'Дедлайн: '||to_char(p_due_date AT TIME ZONE 'Europe/Moscow','DD.MM.YYYY HH24:MI') END;
    FOR v_rec IN SELECT s.profile_id FROM assigned_collection_members m JOIN students s ON s.id=m.student_id
      WHERE m.assigned_id=v_row.id AND s.profile_id IS NOT NULL LOOP
      INSERT INTO notifications(user_id,title,message,type,link)
      SELECT v_rec.profile_id,'Новое домашнее задание',format('«%s». %s',v_title,v_due_text),'info','/my-assignments/'||v_row.id
      WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=v_rec.profile_id
        AND n.title='Новое домашнее задание' AND n.link='/my-assignments/'||v_row.id);
      PERFORM queue_collection_notification(v_rec.profile_id,v_row.id,NULL,'collection_assigned',
        format('collection_assigned:%s:%s',v_row.id,v_rec.profile_id),
        jsonb_build_object('title',v_title,'due_at',p_due_date,'link','/my-assignments/'||v_row.id,'button_text','Открыть ДЗ'));
    END LOOP;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_task_solution(p_assigned_id uuid, p_answers jsonb, p_files text[])
 RETURNS task_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid;
  v_existing   task_submissions;
  v_row        task_submissions;
  v_teacher_id uuid;
  v_title text;
  v_student_name text;
  v_event_type text;
  v_message text;
  v_dedup text;
BEGIN
  IF get_my_role() IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Only students can submit solutions';
  END IF;

  v_student_id := auth_student_id();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'No student profile for current user';
  END IF;

  IF NOT auth_is_assigned_student(p_assigned_id) THEN
    RAISE EXCEPTION 'Not authorized for this assignment';
  END IF;

  SELECT * INTO v_existing FROM task_submissions
  WHERE assigned_id = p_assigned_id AND student_id = v_student_id;

  IF v_existing.id IS NOT NULL AND v_existing.status NOT IN ('returned') THEN
    RAISE EXCEPTION 'Cannot resubmit: current status is %', v_existing.status;
  END IF;

  v_event_type := CASE WHEN v_existing.id IS NULL THEN 'collection_submitted' ELSE 'collection_resubmitted' END;

  INSERT INTO task_submissions (assigned_id, student_id, answers, files, status, submitted_at, updated_at)
  VALUES (p_assigned_id, v_student_id, COALESCE(p_answers, '{}'::jsonb), COALESCE(p_files, '{}'::text[]), 'submitted', now(), now())
  ON CONFLICT (assigned_id, student_id) DO UPDATE
    SET answers = EXCLUDED.answers, files = EXCLUDED.files, status = 'submitted',
        submitted_at = now(), updated_at = now(), teacher_comment = NULL, score = NULL, reviewed_at = NULL
  RETURNING * INTO v_row;

  BEGIN
    SELECT ac.teacher_id,tc.title,p.full_name INTO v_teacher_id,v_title,v_student_name
    FROM assigned_collections ac JOIN task_collections tc ON tc.id=ac.collection_id
    JOIN students s ON s.id=v_student_id JOIN profiles p ON p.id=s.profile_id
    WHERE ac.id=p_assigned_id;
    v_message := format('%s %s «%s»',v_student_name,
      CASE WHEN v_event_type='collection_resubmitted' THEN 'повторно сдал работу по ДЗ' ELSE 'сдал работу по ДЗ' END,
      v_title);
    INSERT INTO notifications(user_id,title,message,type,link)
    SELECT v_teacher_id,CASE WHEN v_event_type='collection_resubmitted' THEN 'Повторная сдача ДЗ' ELSE 'Новая сдача ДЗ' END,
      v_message,'info','/review-submissions/'||v_row.id
    WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=v_teacher_id AND n.message=v_message
      AND n.link='/review-submissions/'||v_row.id AND n.created_at>=v_row.submitted_at);
    v_dedup := CASE WHEN v_event_type='collection_submitted'
      THEN format('collection_submitted:%s:initial:%s',v_row.id,v_teacher_id)
      ELSE format('collection_resubmitted:%s:%s:%s',v_row.id,to_char(v_row.submitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),v_teacher_id) END;
    PERFORM queue_collection_notification(v_teacher_id,p_assigned_id,v_row.id,v_event_type,v_dedup,
      jsonb_build_object('title',v_title,'student_name',v_student_name,'submitted_at',v_row.submitted_at,
        'link','/review-submissions/'||v_row.id,'button_text','Проверить работу'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.grade_task_submission(p_submission_id uuid, p_status text, p_score numeric DEFAULT NULL::numeric, p_comment text DEFAULT NULL::text)
 RETURNS task_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row task_submissions;
  v_assigned_id uuid;
  v_profile_id uuid;
  v_title text;
  v_message text;
  v_type text;
BEGIN
  IF get_my_role() IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Only teachers can grade submissions';
  END IF;

  IF p_status NOT IN ('accepted', 'rejected', 'returned') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  SELECT assigned_id INTO v_assigned_id FROM task_submissions WHERE id = p_submission_id;
  IF v_assigned_id IS NULL THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;

  IF NOT auth_owns_assignment(v_assigned_id) THEN
    RAISE EXCEPTION 'Not authorized for this submission';
  END IF;

  UPDATE task_submissions
  SET status = p_status, score = p_score, teacher_comment = p_comment, reviewed_at = now(), updated_at = now()
  WHERE id = p_submission_id
  RETURNING * INTO v_row;

  BEGIN
    SELECT s.profile_id,tc.title INTO v_profile_id,v_title
    FROM students s JOIN assigned_collections ac ON ac.id=v_assigned_id
    JOIN task_collections tc ON tc.id=ac.collection_id WHERE s.id=v_row.student_id;
    v_type := CASE WHEN p_status='accepted' THEN 'success' WHEN p_status='returned' THEN 'warning' ELSE 'error' END;
    v_message := format('«%s»: %s%s',v_title,CASE p_status WHEN 'accepted' THEN 'принято' WHEN 'returned' THEN 'возвращено на доработку' ELSE 'отклонено' END,
      CASE WHEN p_score IS NOT NULL THEN format(', балл: %s',p_score) ELSE '' END);
    INSERT INTO notifications(user_id,title,message,type,link)
    SELECT v_profile_id,'Результат проверки ДЗ',v_message,v_type,'/my-assignments/'||v_assigned_id
    WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=v_profile_id AND n.message=v_message
      AND n.link='/my-assignments/'||v_assigned_id AND n.created_at>=v_row.reviewed_at);
    PERFORM queue_collection_notification(v_profile_id,v_assigned_id,v_row.id,'collection_reviewed',
      format('collection_reviewed:%s:%s:%s:%s',v_row.id,p_status,
        to_char(v_row.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),v_profile_id),
      jsonb_build_object('title',v_title,'status',p_status,'score',p_score,'comment',p_comment,
        'link','/my-assignments/'||v_assigned_id,'button_text','Открыть ДЗ'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_assignment(uuid,uuid,uuid,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_lesson_homework(uuid,uuid,timestamptz,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_task_solution(uuid,jsonb,text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grade_task_submission(uuid,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_assignment(uuid,uuid,uuid,timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_lesson_homework(uuid,uuid,timestamptz,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_task_solution(uuid,jsonb,text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grade_task_submission(uuid,text,numeric,text) TO authenticated, service_role;
