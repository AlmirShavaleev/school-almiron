-- Каркас → классы: правка шаблона повторяется в копиях (§172).
--
-- Решение владельца 13.09: «основной материал мы добавляем в курсе каркаса, а
-- всё, что там есть, видно и по подгруппам», и «все изменения в каркасе
-- автоматически подтягиваются в курсы» — без кнопки «синхронизировать».
--
-- Что НЕ переносится никогда: `is_open`, `available_from`, учебный план,
-- `due_at` и `is_published` у ДЗ, отметки, ответы, присутствие. Расписание и
-- открытие — про класс, а не про каркас (§151).
--
-- Синхронизация идёт в той же транзакции, что и правка шаблона. Если правка не
-- легла в копию, правка шаблона НЕ откатывается: молчаливый откат работы
-- владельца — худший из исходов. Расхождение записывается в
-- `template_sync_issues`, и преподаватель видит его на теме.
--
-- Прав никому не прибавляется: функции definer, но входная правка проходит
-- обычную RLS шаблона. Синхронизация лишь повторяет то, что уже разрешено.

-- ── Куда складываем расхождения ─────────────────────────────────────────────

create table if not exists public.template_sync_issues (
  id                uuid primary key default gen_random_uuid(),
  template_topic_id uuid not null references public.topics(id) on delete cascade,
  copy_topic_id     uuid not null references public.topics(id) on delete cascade,
  kind              text not null,
  detail            text,
  created_at        timestamptz not null default now()
);

create index if not exists template_sync_issues_template_idx on public.template_sync_issues (template_topic_id);
create index if not exists template_sync_issues_copy_idx     on public.template_sync_issues (copy_topic_id);

comment on table public.template_sync_issues is
  'Что не удалось повторить в копии курса: kept_with_answers, delete_kept, hw_conflict. §172';

alter table public.template_sync_issues enable row level security;

drop policy if exists template_sync_issues_read on public.template_sync_issues;
create policy template_sync_issues_read on public.template_sync_issues
  for select to authenticated
  using (
    public.topic_material_can_manage(template_topic_id)
    or public.topic_material_can_manage(copy_topic_id)
  );

-- ── Мелкие проверки ─────────────────────────────────────────────────────────

create or replace function public.topic_is_in_template(p_topic_id uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.topics t
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
     where t.id = p_topic_id and c.is_template
  );
$$;

comment on function public.topic_is_in_template(uuid) is
  'Тема принадлежит курсу-каркасу — значит её правки едут в копии. §172';

/**
 * Следы учеников на теме: отметки, ответы на задачи, попытки ДЗ, отклонения
 * учебного плана. Тема со следами не удаляется вслед за шаблоном — это чужая
 * работа, и решение убрать её остаётся за преподавателем.
 */
create or replace function public.topic_has_student_traces(p_topic_id uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from public.topic_section_marks where topic_id = p_topic_id)
      or exists (
           select 1 from public.topic_homework_attempts a
             join public.topic_homework h on h.id = a.homework_id
            where h.topic_id = p_topic_id)
      or exists (
           select 1 from public.test_variant_answers ans
             join public.test_variant_student_assignments sa on sa.id = ans.student_assignment_id
             join public.test_variant_assignments tva on tva.id = sa.assignment_id
            where tva.topic_id = p_topic_id)
      or exists (select 1 from public.course_study_plan_overrides where topic_id = p_topic_id);
$$;

-- ── Порядок: свои идут после шаблонных ──────────────────────────────────────
--
-- Связанные темы и модули получают номер шаблона, свои сохраняют свой; при
-- совпадении номеров своё встаёт следом. Сортировка та же, что в клиенте
-- (`order_index`, затем `created_at`), иначе экран и база разошлись бы.

create or replace function public.template_renumber_topics(p_module_id uuid)
returns void language sql security definer set search_path to ''
as $$
  with ord as (
    select id,
           (row_number() over (
              order by order_index,
                       case when source_topic_id is null then 1 else 0 end,
                       created_at)) - 1 as rn
      from public.topics where module_id = p_module_id
  )
  update public.topics t set order_index = ord.rn
    from ord where ord.id = t.id and t.order_index is distinct from ord.rn;
$$;

create or replace function public.template_renumber_modules(p_course_id uuid)
returns void language sql security definer set search_path to ''
as $$
  with ord as (
    select id,
           (row_number() over (
              order by order_index,
                       case when source_module_id is null then 1 else 0 end,
                       created_at)) - 1 as rn
      from public.modules where course_id = p_course_id
  )
  update public.modules m set order_index = ord.rn
    from ord where ord.id = m.id and m.order_index is distinct from ord.rn;
$$;

-- ── Главное: синхронизация одной темы ───────────────────────────────────────

create or replace function public.template_sync_topic_apply(p_template_topic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_tpl        record;
  v_copy       record;
  v_tpl_var    record;
  v_copy_var   uuid;
  v_item       record;
  v_n          integer;
  v_copies     integer := 0;
  v_ins        integer := 0;
  v_upd        integer := 0;
  v_del        integer := 0;
  v_tasks_ins  integer := 0;
  v_tasks_del  integer := 0;
  v_kept       integer := 0;
  v_issues     integer := 0;
  v_maxpos     integer;
BEGIN
  SELECT t.id, t.title, t.order_index, t.max_score, m.course_id
    INTO v_tpl
    FROM public.topics t
    JOIN public.modules m ON m.id = t.module_id
   WHERE t.id = p_template_topic_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('copies', 0, 'skipped', 'no_topic');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.courses c WHERE c.id = v_tpl.course_id AND c.is_template) THEN
    RETURN jsonb_build_object('copies', 0, 'skipped', 'not_a_template');
  END IF;

  SELECT v.id, v.title, v.created_by INTO v_tpl_var
    FROM public.test_variants v WHERE v.topic_id = p_template_topic_id;

  FOR v_copy IN
    SELECT ct.id AS topic_id, cm.course_id
      FROM public.topics ct
      JOIN public.modules cm ON cm.id = ct.module_id
     WHERE ct.source_topic_id = p_template_topic_id
  LOOP
    v_copies := v_copies + 1;

    -- Прошлые расхождения по этой паре снимаем: плашка должна описывать
    -- сегодняшнее состояние, а не историю попыток.
    DELETE FROM public.template_sync_issues
     WHERE template_topic_id = p_template_topic_id AND copy_topic_id = v_copy.topic_id;

    -- 1. Сама тема: название, порядок, балл. Открытие и дата — классные.
    UPDATE public.topics
       SET title = v_tpl.title, order_index = v_tpl.order_index, max_score = v_tpl.max_score
     WHERE id = v_copy.topic_id
       AND (title, order_index, max_score) IS DISTINCT FROM (v_tpl.title, v_tpl.order_index, v_tpl.max_score);

    -- 2. Материалы. Сначала исчезнувшие в шаблоне.
    DELETE FROM public.topic_material_items ci
     WHERE ci.topic_id = v_copy.topic_id
       AND ci.source_item_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.topic_material_items ti
          WHERE ti.id = ci.source_item_id AND ti.topic_id = p_template_topic_id);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_del := v_del + v_n;

    UPDATE public.topic_material_items ci
       SET kind = ti.kind, title = ti.title, content = ti.content, url = ti.url,
           storage_path = ti.storage_path, file_name = ti.file_name,
           mime_type = ti.mime_type, size_bytes = ti.size_bytes,
           position = ti.position, is_visible = ti.is_visible, section = ti.section,
           updated_at = now()
      FROM public.topic_material_items ti
     WHERE ti.id = ci.source_item_id
       AND ci.topic_id = v_copy.topic_id
       AND ti.topic_id = p_template_topic_id
       AND (ci.kind, ci.title, ci.content, ci.url, ci.storage_path, ci.file_name,
            ci.mime_type, ci.size_bytes, ci.position, ci.is_visible, ci.section)
           IS DISTINCT FROM
           (ti.kind, ti.title, ti.content, ti.url, ti.storage_path, ti.file_name,
            ti.mime_type, ti.size_bytes, ti.position, ti.is_visible, ti.section);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_upd := v_upd + v_n;

    -- Пути к файлам те же: копия ссылается на тот же объект (§101), никакой
    -- перезаливки — именно она когда-то стоила 584 МБ на один курс.
    INSERT INTO public.topic_material_items (
      topic_id, kind, title, content, url, storage_path, file_name, mime_type,
      size_bytes, position, is_visible, section, created_by, source_item_id)
    SELECT v_copy.topic_id, ti.kind, ti.title, ti.content, ti.url, ti.storage_path,
           ti.file_name, ti.mime_type, ti.size_bytes, ti.position, ti.is_visible,
           ti.section, coalesce(auth.uid(), ti.created_by), ti.id
      FROM public.topic_material_items ti
     WHERE ti.topic_id = p_template_topic_id
       AND NOT EXISTS (
         SELECT 1 FROM public.topic_material_items ci
          WHERE ci.topic_id = v_copy.topic_id AND ci.source_item_id = ti.id);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_ins := v_ins + v_n;

    -- 3. Домашнее задание. `is_published` и `due_at` не переносятся: срок и
    --    публикация — решение класса, а не каркаса.
    PERFORM public.template_sync_homework(p_template_topic_id, v_copy.topic_id);

    -- 4. Задачи к уроку. Набор у темы один (§164), связь идёт через тему.
    IF v_tpl_var.id IS NOT NULL THEN
      SELECT id INTO v_copy_var FROM public.test_variants WHERE topic_id = v_copy.topic_id;

      IF v_copy_var IS NULL THEN
        INSERT INTO public.test_variants
          (title, subject, exam_type, status, created_by, settings, tasks_count, source_type, topic_id)
        SELECT v_tpl_var.title, c.subject, c.exam_type, 'ready',
               coalesce(auth.uid(), v_tpl_var.created_by), '{}'::jsonb, 0, 'teacher_assigned', v_copy.topic_id
          FROM public.courses c WHERE c.id = v_copy.course_id
        RETURNING id INTO v_copy_var;
      END IF;

      -- Убранное в шаблоне убираем и здесь — но не вместе с чужими ответами.
      FOR v_item IN
        SELECT ci.id, ci.task_id,
               (SELECT count(*) FROM public.test_variant_answers a WHERE a.variant_item_id = ci.id) AS answers
          FROM public.test_variant_items ci
         WHERE ci.variant_id = v_copy_var
           AND NOT EXISTS (
             SELECT 1 FROM public.test_variant_items ti
              WHERE ti.variant_id = v_tpl_var.id AND ti.task_id = ci.task_id)
      LOOP
        IF v_item.answers > 0 THEN
          v_kept := v_kept + 1;
          INSERT INTO public.template_sync_issues (template_topic_id, copy_topic_id, kind, detail)
          VALUES (p_template_topic_id, v_copy.topic_id, 'kept_with_answers',
                  format('Задача убрана из каркаса, но по ней уже есть ответы (%s) — осталась в классе', v_item.answers));
          v_issues := v_issues + 1;
        ELSE
          DELETE FROM public.test_variant_items WHERE id = v_item.id;
          v_tasks_del := v_tasks_del + 1;
        END IF;
      END LOOP;

      -- Позиции освобождаем целиком: (variant_id, position) уникальна, и
      -- переносить порядок «по месту» значит ловить конфликт на каждой второй.
      UPDATE public.test_variant_items SET position = -position - 1
       WHERE variant_id = v_copy_var;

      UPDATE public.test_variant_items ci
         SET position = ti.position, points = ti.points,
             grading_type = ti.grading_type, section_id = ti.section_id
        FROM public.test_variant_items ti
       WHERE ti.variant_id = v_tpl_var.id
         AND ci.variant_id = v_copy_var
         AND ci.task_id = ti.task_id;

      INSERT INTO public.test_variant_items (variant_id, task_id, position, section_id, points, grading_type)
      SELECT v_copy_var, ti.task_id, ti.position, ti.section_id, ti.points, ti.grading_type
        FROM public.test_variant_items ti
       WHERE ti.variant_id = v_tpl_var.id
         AND NOT EXISTS (
           SELECT 1 FROM public.test_variant_items ci
            WHERE ci.variant_id = v_copy_var AND ci.task_id = ti.task_id);
      GET DIAGNOSTICS v_n = ROW_COUNT; v_tasks_ins := v_tasks_ins + v_n;

      -- Оставшиеся в минусе — те, что удержали ответы. Ставим их в конец.
      SELECT coalesce(max(position), 0) INTO v_maxpos
        FROM public.test_variant_items WHERE variant_id = v_copy_var AND position >= 0;

      FOR v_item IN
        SELECT id FROM public.test_variant_items
         WHERE variant_id = v_copy_var AND position < 0 ORDER BY position DESC
      LOOP
        v_maxpos := v_maxpos + 1;
        UPDATE public.test_variant_items SET position = v_maxpos WHERE id = v_item.id;
      END LOOP;

      UPDATE public.test_variants
         SET tasks_count = (SELECT count(*) FROM public.test_variant_items WHERE variant_id = v_copy_var),
             updated_at = now()
       WHERE id = v_copy_var;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'copies', v_copies,
    'items_inserted', v_ins, 'items_updated', v_upd, 'items_deleted', v_del,
    'tasks_inserted', v_tasks_ins, 'tasks_deleted', v_tasks_del,
    'kept_with_answers', v_kept, 'issues', v_issues);
END;
$function$;

comment on function public.template_sync_topic_apply(uuid) is
  'Повторяет содержимое темы каркаса во всех связанных темах классов. Без проверки прав — зовётся триггерами и догоном. §172';

-- ── ДЗ вынесено отдельно: у него свои «не переносить» ───────────────────────

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
    UPDATE public.topic_homework
       SET title = v_tpl_hw.title, instructions = v_tpl_hw.instructions,
           grade_scale = v_tpl_hw.grade_scale, updated_at = now()
     WHERE id = v_copy_hw
       AND (title, instructions, grade_scale)
           IS DISTINCT FROM (v_tpl_hw.title, v_tpl_hw.instructions, v_tpl_hw.grade_scale);
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

-- ── Модуль и курс: новые темы и новые модули ────────────────────────────────

create or replace function public.template_sync_module_apply(p_template_module_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_tpl    record;
  v_copy   record;
  v_topic  record;
  v_new    uuid;
  v_topics integer := 0;
BEGIN
  SELECT m.id, m.title, m.order_index, m.course_id INTO v_tpl
    FROM public.modules m WHERE m.id = p_template_module_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('copies', 0); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.courses c WHERE c.id = v_tpl.course_id AND c.is_template) THEN
    RETURN jsonb_build_object('copies', 0, 'skipped', 'not_a_template');
  END IF;

  FOR v_copy IN
    SELECT cm.id, cm.course_id FROM public.modules cm WHERE cm.source_module_id = p_template_module_id
  LOOP
    UPDATE public.modules
       SET title = v_tpl.title, order_index = v_tpl.order_index
     WHERE id = v_copy.id
       AND (title, order_index) IS DISTINCT FROM (v_tpl.title, v_tpl.order_index);

    FOR v_topic IN
      SELECT t.id, t.title, t.order_index, t.max_score, t.is_open
        FROM public.topics t WHERE t.module_id = p_template_module_id ORDER BY t.order_index
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.topics ct
                      WHERE ct.module_id = v_copy.id AND ct.source_topic_id = v_topic.id) THEN
        -- Правило копирования из §101: nullif(is_open, true). Дата открытия не
        -- переносится вовсе — она про расписание класса.
        INSERT INTO public.topics (module_id, title, order_index, max_score, is_open, available_from, source_topic_id)
        VALUES (v_copy.id, v_topic.title, v_topic.order_index, v_topic.max_score,
                nullif(v_topic.is_open, true), NULL, v_topic.id)
        RETURNING id INTO v_new;
        v_topics := v_topics + 1;
      END IF;

      PERFORM public.template_sync_topic_apply(v_topic.id);
    END LOOP;

    PERFORM public.template_renumber_topics(v_copy.id);
    PERFORM public.template_renumber_modules(v_copy.course_id);
  END LOOP;

  RETURN jsonb_build_object('topics_created', v_topics);
END;
$function$;

create or replace function public.template_sync_course_apply(p_template_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_copy    record;
  v_module  record;
  v_new     uuid;
  v_mods    integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.courses c WHERE c.id = p_template_course_id AND c.is_template) THEN
    RETURN jsonb_build_object('copies', 0, 'skipped', 'not_a_template');
  END IF;

  FOR v_copy IN SELECT id FROM public.courses WHERE copied_from_course_id = p_template_course_id
  LOOP
    FOR v_module IN
      SELECT m.id, m.title, m.order_index FROM public.modules m
       WHERE m.course_id = p_template_course_id ORDER BY m.order_index
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.modules cm
                      WHERE cm.course_id = v_copy.id AND cm.source_module_id = v_module.id) THEN
        INSERT INTO public.modules (course_id, title, order_index, source_module_id)
        VALUES (v_copy.id, v_module.title, v_module.order_index, v_module.id)
        RETURNING id INTO v_new;
        v_mods := v_mods + 1;
      END IF;
    END LOOP;
  END LOOP;

  FOR v_module IN SELECT id FROM public.modules WHERE course_id = p_template_course_id
  LOOP
    PERFORM public.template_sync_module_apply(v_module.id);
  END LOOP;

  RETURN jsonb_build_object('modules_created', v_mods);
END;
$function$;

-- ── То же самое, но руками: кнопка «Повторить» ──────────────────────────────

create or replace function public.template_sync_topic(p_template_topic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
BEGIN
  IF NOT public.topic_material_can_manage(p_template_topic_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: not staff of this course topic';
  END IF;
  RETURN public.template_sync_topic_apply(p_template_topic_id);
END;
$function$;

comment on function public.template_sync_topic(uuid) is
  'Повторить содержимое темы каркаса в классах руками — кнопка «Повторить» на плашке расхождений. §172';

revoke all on function public.template_sync_topic(uuid) from public, anon;
grant execute on function public.template_sync_topic(uuid) to authenticated;

revoke all on function public.template_sync_topic_apply(uuid)  from public, anon;
revoke all on function public.template_sync_module_apply(uuid) from public, anon;
revoke all on function public.template_sync_course_apply(uuid) from public, anon;
revoke all on function public.template_sync_homework(uuid, uuid) from public, anon;
