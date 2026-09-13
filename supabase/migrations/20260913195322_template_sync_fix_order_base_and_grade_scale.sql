-- Две поправки, найденные замером перед догоном (§172).
--
-- 1. `order_index` в проекте — с ЕДИНИЦЫ. Пересчёт порядка писал 0-based, и
--    сухой прогон догона показал 382 изменённые темы и 51 модуль в живых
--    классах: все номера сдвинулись бы на единицу. Экраны сортируют по
--    `order_index`, так что видимого развала не случилось бы — и тем хуже:
--    молчаливая перенумерация всей программы семи курсов ради нуля пользы.
--    Теперь пересчёт держит ту же базу, что уже стоит у детей этого родителя,
--    и на совпадающем порядке не пишет ничего.
--
-- 2. `grade_scale` у ДЗ каркаса пустой, а в шести классах выставлен
--    («five», «hundred»). Перенос «как есть» затёр бы живую настройку
--    преподавателя пустотой. Каркас передаёт шкалу, только если она у него
--    задана; пустым значением классную настройку не сбиваем — ровно по той же
--    причине, по которой не переносятся `due_at` и `is_published`.

create or replace function public.template_renumber_topics(p_module_id uuid)
returns void language sql security definer set search_path to ''
as $$
  with base as (
    select coalesce(min(order_index), 1) as b from public.topics where module_id = p_module_id
  ),
  ord as (
    select t.id,
           (select b from base) + (row_number() over (
              order by t.order_index,
                       case when t.source_topic_id is null then 1 else 0 end,
                       t.created_at)) - 1 as rn
      from public.topics t where t.module_id = p_module_id
  )
  update public.topics t set order_index = ord.rn
    from ord where ord.id = t.id and t.order_index is distinct from ord.rn;
$$;

create or replace function public.template_renumber_modules(p_course_id uuid)
returns void language sql security definer set search_path to ''
as $$
  with base as (
    select coalesce(min(order_index), 1) as b from public.modules where course_id = p_course_id
  ),
  ord as (
    select m.id,
           (select b from base) + (row_number() over (
              order by m.order_index,
                       case when m.source_module_id is null then 1 else 0 end,
                       m.created_at)) - 1 as rn
      from public.modules m where m.course_id = p_course_id
  )
  update public.modules m set order_index = ord.rn
    from ord where ord.id = m.id and m.order_index is distinct from ord.rn;
$$;

create or replace function public.template_sync_homework(p_template_topic_id uuid, p_copy_topic_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_tpl_hw  record;
  v_copy_hw uuid;
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
    -- Шкала оценивания: переносим только заданную. Пустой каркас не отменяет
    -- того, что преподаватель уже выставил в классе.
    UPDATE public.topic_homework ch
       SET title = v_tpl_hw.title, instructions = v_tpl_hw.instructions,
           grade_scale = coalesce(v_tpl_hw.grade_scale, ch.grade_scale), updated_at = now()
     WHERE ch.id = v_copy_hw
       AND (ch.title, ch.instructions, ch.grade_scale)
           IS DISTINCT FROM (v_tpl_hw.title, v_tpl_hw.instructions,
                             coalesce(v_tpl_hw.grade_scale, ch.grade_scale));
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
