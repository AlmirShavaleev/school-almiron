-- §265, раздел 5 (из PENDING_265 агента). НЕ ПРИМЕНЕНО: ждёт подтверждения владельца в MCP (в теле функции есть DELETE).
-- До применения правка материалов каркаса может перенести шкалу каркаса в класс, если у классного ДЗ ещё нет оценок.

-- ══ 5. Каркас → классы: шкалу переносим, только когда её в каркасе поменяли ═══════════════════════
-- Тело — 20260913195322 (§172), изменена одна строка UPDATE (grade_scale). Вставка нового ДЗ в класс
-- по-прежнему берёт шкалу каркаса — триггер п. 2 поправит её по типу темы класса.
create or replace function public.template_sync_homework(p_template_topic_id uuid, p_copy_topic_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_tpl_hw  record;
  v_copy_hw uuid;
  v_scale_changed boolean;
BEGIN
  SELECT h.id, h.title, h.instructions, h.grade_scale, h.created_by
    INTO v_tpl_hw FROM public.topic_homework h WHERE h.topic_id = p_template_topic_id;

  IF v_tpl_hw.id IS NULL THEN
    -- ДЗ убрали в каркасе. В классе убираем только нетронутое: за попытками
    -- стоит работа учеников.
    DELETE FROM public.topic_homework ch
     WHERE ch.topic_id = p_copy_topic_id
       AND ch.source_homework_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.topic_homework_attempts a WHERE a.homework_id = ch.id);

    IF EXISTS (
      SELECT 1 FROM public.topic_homework ch
       WHERE ch.topic_id = p_copy_topic_id AND ch.source_homework_id IS NOT NULL
    ) THEN
      INSERT INTO public.template_sync_issues (template_topic_id, copy_topic_id, kind, detail)
      VALUES (p_template_topic_id, p_copy_topic_id, 'delete_kept',
              'ДЗ убрано в каркасе, но по нему есть работы учеников — осталось в классе');
    END IF;
    RETURN;
  END IF;

  SELECT id INTO v_copy_hw FROM public.topic_homework
   WHERE topic_id = p_copy_topic_id AND source_homework_id = v_tpl_hw.id;

  IF v_copy_hw IS NULL THEN
    -- У темы одно ДЗ (unique(topic_id)). Если в классе уже есть своё, чужое
    -- место не занимаем: пишем расхождение, преподаватель решит сам.
    IF EXISTS (SELECT 1 FROM public.topic_homework WHERE topic_id = p_copy_topic_id) THEN
      INSERT INTO public.template_sync_issues (template_topic_id, copy_topic_id, kind, detail)
      VALUES (p_template_topic_id, p_copy_topic_id, 'hw_conflict',
              'В каркасе появилось ДЗ, а в классе уже есть своё — оставлено классное');
      RETURN;
    END IF;

    INSERT INTO public.topic_homework
      (topic_id, title, instructions, is_published, created_by, due_at, grade_scale, source_homework_id)
    VALUES
      (p_copy_topic_id, v_tpl_hw.title, v_tpl_hw.instructions, false,
       coalesce(auth.uid(), v_tpl_hw.created_by), NULL, v_tpl_hw.grade_scale, v_tpl_hw.id)
    RETURNING id INTO v_copy_hw;
  ELSE
    -- §265. Шкалу каркаса переносим только в той транзакции, где её в каркасе поменяли (флаг ставит
    -- topic_homework_grade_scale_fill). Правка материалов каркаса классную шкалу не трогает: учитель
    -- класса мог выбрать 5-балльную. Пустой шкалы у каркаса после §265 не бывает, coalesce — страховка.
    v_scale_changed := position(',' || v_tpl_hw.id::text
                                IN coalesce(current_setting('app.hw_scale_changed', true), '')) > 0;
    UPDATE public.topic_homework ch
       SET title = v_tpl_hw.title, instructions = v_tpl_hw.instructions,
           grade_scale = CASE WHEN v_scale_changed THEN coalesce(v_tpl_hw.grade_scale, ch.grade_scale)
                              ELSE ch.grade_scale END,
           updated_at = now()
     WHERE ch.id = v_copy_hw
       AND (ch.title, ch.instructions, ch.grade_scale)
           IS DISTINCT FROM (v_tpl_hw.title, v_tpl_hw.instructions,
                             CASE WHEN v_scale_changed THEN coalesce(v_tpl_hw.grade_scale, ch.grade_scale)
                                  ELSE ch.grade_scale END);
  END IF;

  DELETE FROM public.topic_homework_files cf
   WHERE cf.homework_id = v_copy_hw
     AND cf.source_file_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.topic_homework_files tf
                      WHERE tf.id = cf.source_file_id AND tf.homework_id = v_tpl_hw.id);

  UPDATE public.topic_homework_files cf
     SET storage_path = tf.storage_path, original_filename = tf.original_filename,
         mime_type = tf.mime_type, size_bytes = tf.size_bytes, position = tf.position
    FROM public.topic_homework_files tf
   WHERE tf.id = cf.source_file_id AND cf.homework_id = v_copy_hw
     AND (cf.storage_path, cf.original_filename, cf.mime_type, cf.size_bytes, cf.position)
         IS DISTINCT FROM (tf.storage_path, tf.original_filename, tf.mime_type, tf.size_bytes, tf.position);

  INSERT INTO public.topic_homework_files
    (homework_id, storage_path, original_filename, mime_type, size_bytes, position, source_file_id)
  SELECT v_copy_hw, tf.storage_path, tf.original_filename, tf.mime_type, tf.size_bytes, tf.position, tf.id
    FROM public.topic_homework_files tf
   WHERE tf.homework_id = v_tpl_hw.id
     AND NOT EXISTS (SELECT 1 FROM public.topic_homework_files cf
                      WHERE cf.homework_id = v_copy_hw AND cf.source_file_id = tf.id);
END;
$function$;
