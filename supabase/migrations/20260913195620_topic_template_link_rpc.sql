-- Что экран должен знать про каркас (§172).
--
-- Одним запросом: это тема каркаса или отражение, в скольких классах она видна,
-- какие расхождения не удалось повторить. Иначе окно темы завело бы три
-- запроса вместо одного — а оно и так не быстрое.

create or replace function public.topic_template_link(p_topic_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    -- Тема каркаса: её правки уезжают в классы.
    'is_template', exists (
      select 1 from public.topics t
        join public.modules m on m.id = t.module_id
        join public.courses c on c.id = m.course_id
       where t.id = p_topic_id and c.is_template),
    -- Отражение: правится в каркасе, здесь только показывается.
    'source_topic_id', (select t.source_topic_id from public.topics t where t.id = p_topic_id),
    'source_course', (
      select c.title from public.topics t
        join public.topics st on st.id = t.source_topic_id
        join public.modules sm on sm.id = st.module_id
        join public.courses c on c.id = sm.course_id
       where t.id = p_topic_id),
    -- Классы, которые смотрят на эту тему каркаса. Закрытые курсы не считаем:
    -- «видно в 5 классах», из которых три в архиве, — неправда.
    'copies', coalesce((
      select jsonb_agg(jsonb_build_object('topic_id', ct.id, 'course', c.title) order by c.title)
        from public.topics ct
        join public.modules cm on cm.id = ct.module_id
        join public.courses c on c.id = cm.course_id
       where ct.source_topic_id = p_topic_id and c.is_active), '[]'::jsonb),
    'issues', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'kind', i.kind, 'detail', i.detail,
               'course', c.title) order by i.created_at)
        from public.template_sync_issues i
        join public.topics ct on ct.id = i.copy_topic_id
        join public.modules cm on cm.id = ct.module_id
        join public.courses c on c.id = cm.course_id
       where i.template_topic_id = p_topic_id or i.copy_topic_id = p_topic_id), '[]'::jsonb)
  )
  where public.topic_material_can_manage(p_topic_id);
$$;

comment on function public.topic_template_link(uuid) is
  'Каркас это или отражение, в скольких классах видно и что не повторилось. §172';

revoke all on function public.topic_template_link(uuid) from public, anon;
grant execute on function public.topic_template_link(uuid) to authenticated;

-- ── «Прикреплено 10 задач · в 3 классах» ────────────────────────────────────
--
-- Число классов приходит из той же RPC, что и прикрепление: тост, который
-- считает копии сам, рано или поздно разойдётся с тем, что произошло в базе.

create or replace function public.attach_catalog_tasks_to_topic(
  p_topic_id uuid,
  p_task_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_variant uuid;
  v_pos     integer;
  v_added   integer := 0;
  v_skipped integer := 0;
  v_rec     record;
BEGIN
  IF NOT public.topic_material_can_manage(p_topic_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: not staff of this course topic';
  END IF;

  IF p_task_ids IS NULL OR array_length(p_task_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_TASKS: nothing selected';
  END IF;

  SELECT id INTO v_variant FROM public.test_variants WHERE topic_id = p_topic_id;

  -- Предмет и экзамен берём у курса: набор задач принадлежит уроку, а не тому,
  -- кто его собрал, и в разделе «Тесты» он должен читаться так же, как курс.
  IF v_variant IS NULL THEN
    INSERT INTO public.test_variants
      (title, subject, exam_type, status, created_by, settings, tasks_count, source_type, topic_id)
    SELECT 'Задачи к уроку «' || t.title || '»',
           c.subject, c.exam_type, 'ready', auth.uid(), '{}'::jsonb, 0, 'teacher_assigned', p_topic_id
      FROM public.topics t
      JOIN public.modules m ON m.id = t.module_id
      JOIN public.courses c ON c.id = m.course_id
     WHERE t.id = p_topic_id
    RETURNING id INTO v_variant;
  END IF;

  IF v_variant IS NULL THEN
    RAISE EXCEPTION 'NO_TOPIC: topic not found';
  END IF;

  SELECT coalesce(max(position), 0) INTO v_pos
    FROM public.test_variant_items WHERE variant_id = v_variant;

  -- Порядок отбора сохраняем: преподаватель складывал задачи не наугад.
  FOR v_rec IN
    SELECT u.tid, ct.section_id, ct.max_points,
           public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type) AS auto_ok
      FROM unnest(p_task_ids) WITH ORDINALITY AS u(tid, ord)
      JOIN public.catalog_tasks ct ON ct.id = u.tid
     ORDER BY u.ord
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.test_variant_items
       WHERE variant_id = v_variant AND task_id = v_rec.tid
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_pos := v_pos + 1;

    INSERT INTO public.test_variant_items
      (variant_id, task_id, position, section_id, points, grading_type)
    VALUES
      (v_variant, v_rec.tid, v_pos, v_rec.section_id,
       coalesce(v_rec.max_points, 1),
       CASE WHEN v_rec.auto_ok THEN 'auto' ELSE 'manual' END);

    v_added := v_added + 1;
  END LOOP;

  UPDATE public.test_variants
     SET tasks_count = (SELECT count(*) FROM public.test_variant_items WHERE variant_id = v_variant),
         updated_at  = now()
   WHERE id = v_variant;

  RETURN (
    SELECT jsonb_build_object(
      'variant_id',     v_variant,
      'added',          v_added,
      'skipped',        v_skipped,
      'total',          count(*),
      'auto_checkable', count(*) FILTER (WHERE tvi.grading_type = 'auto'),
      'self_checked',   count(*) FILTER (WHERE tvi.grading_type = 'manual'),
      -- Сколько классов это увидело: синхронизация уже отработала триггером,
      -- здесь только считаем отражения (§172).
      'copies_synced',  (SELECT count(*) FROM public.topics ct
                          JOIN public.modules cm ON cm.id = ct.module_id
                          JOIN public.courses c ON c.id = cm.course_id
                         WHERE ct.source_topic_id = p_topic_id AND c.is_active)
    )
    FROM public.test_variant_items tvi WHERE tvi.variant_id = v_variant
  );
END;
$function$;

comment on function public.attach_catalog_tasks_to_topic(uuid, uuid[]) is
  'Кладёт отобранные в каталоге задачи в набор задач к уроку: добавляет к существующим, дублей не создаёт, выдач не шлёт; возвращает и число классов, куда это уехало. §164/§172';
