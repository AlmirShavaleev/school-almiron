-- Прикрепление задач к уроку из каталога и ленивая выдача (§164).
--
-- Отбор задач остаётся каталожным: подборка, фильтры, «В подборку» — ими и
-- пользуемся, второго способа отбирать задачи не заводим. Сюда приходит уже
-- готовый список `catalog_tasks.id`.
--
-- Выдача больше не создаётся в момент прикрепления. Строка выдачи нужна ровно
-- затем, чтобы было куда писать ответы, а список задач (§162) читается по
-- варианту и без неё. Поэтому она заводится при первом обращении ученика к
-- задачам темы — это разом закрывает «ученик пришёл в класс позже», «задачи
-- прикрепили после зачисления» и «класс скопирован из шаблона», и не требует
-- ни одного триггера на зачислении.
--
-- Заодно исчезает карточка `variant_assigned` за задачи к уроку: она вела на
-- экзаменационный экран `/student/variants/<id>`, а задачи живут на теме.
--
-- Проверка ответов (`answer_topic_task`, `variant_answer_verdict`) не тронута.

-- ── Строка выдачи заводится по факту доступа, а не по событию зачисления ─────

create or replace function public.ensure_topic_task_rows(p_topic_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_student  uuid;
  v_variant  record;
  v_course   uuid;
  v_group    uuid;
  v_assign   uuid;
  v_sa       uuid;
BEGIN
  v_student := public.auth_student_id();
  IF v_student IS NULL THEN
    RETURN NULL;
  END IF;

  -- Право на задачи — это право на тему. Своего условия здесь нет и быть не
  -- должно: закрытая тема закрыта целиком (§21/§29 — ручные копии проверок).
  IF NOT public.course_student_can_see_topic(p_topic_id) THEN
    RETURN NULL;
  END IF;

  SELECT v.id, v.created_by INTO v_variant
  FROM public.test_variants v
  WHERE v.topic_id = p_topic_id;

  IF v_variant.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT tvsa.id INTO v_sa
  FROM public.test_variant_assignments tva
  JOIN public.test_variant_student_assignments tvsa ON tvsa.assignment_id = tva.id
  WHERE tva.topic_id   = p_topic_id
    AND tva.variant_id = v_variant.id
    AND tvsa.student_id = v_student
    AND tvsa.status <> 'cancelled'
  LIMIT 1;

  IF v_sa IS NOT NULL THEN
    RETURN v_sa;
  END IF;

  v_course := public.course_of_topic(p_topic_id);

  -- Доступ к курсу бывает двух видов: через группу и личный (`student_courses`).
  -- Групповому ученику выдача общая — иначе преподаватель не соберёт группу в
  -- один счёт; личному она своя, иначе её некуда положить: строка выдачи держит
  -- либо группу, либо ученика (tva_one_target).
  SELECT g.id INTO v_group
  FROM public.group_students gs
  JOIN public.groups g ON g.id = gs.group_id
  WHERE gs.student_id = v_student
    AND g.course_id = v_course
  LIMIT 1;

  IF v_group IS NOT NULL THEN
    SELECT id INTO v_assign
    FROM public.test_variant_assignments
    WHERE variant_id = v_variant.id AND topic_id = p_topic_id AND group_id = v_group;

    IF v_assign IS NULL THEN
      INSERT INTO public.test_variant_assignments
        (variant_id, assigned_by, student_id, group_id, topic_id,
         max_attempts, allow_retry, show_answers_after_submit, show_solutions_after_submit, status)
      VALUES
        (v_variant.id, v_variant.created_by, NULL, v_group, p_topic_id,
         1, false, true, true, 'assigned')
      RETURNING id INTO v_assign;
    END IF;
  ELSE
    SELECT id INTO v_assign
    FROM public.test_variant_assignments
    WHERE variant_id = v_variant.id AND topic_id = p_topic_id AND student_id = v_student;

    IF v_assign IS NULL THEN
      INSERT INTO public.test_variant_assignments
        (variant_id, assigned_by, student_id, group_id, topic_id,
         max_attempts, allow_retry, show_answers_after_submit, show_solutions_after_submit, status)
      VALUES
        (v_variant.id, v_variant.created_by, v_student, NULL, p_topic_id,
         1, false, true, true, 'assigned')
      RETURNING id INTO v_assign;
    END IF;
  END IF;

  -- Две вкладки разом — обычное дело; уникальный индекс (assignment_id,
  -- student_id) не даст завести вторую строку, и мы просто берём готовую.
  INSERT INTO public.test_variant_student_assignments
    (assignment_id, variant_id, student_id, status, max_attempts)
  VALUES
    (v_assign, v_variant.id, v_student, 'not_started', 1)
  ON CONFLICT (assignment_id, student_id) DO NOTHING
  RETURNING id INTO v_sa;

  IF v_sa IS NULL THEN
    SELECT id INTO v_sa
    FROM public.test_variant_student_assignments
    WHERE assignment_id = v_assign AND student_id = v_student;
  END IF;

  RETURN v_sa;
END;
$function$;

comment on function public.ensure_topic_task_rows(uuid) is
  'Заводит выдачу задач к уроку по факту доступа к теме, без уведомлений, идемпотентно. §164';

-- ── Что видит ученик: тот же один запрос, но он же и заводит выдачу ──────────
--
-- Функция стала volatile ровно за этим. Второй запрос при открытии темы мы уже
-- не заводим: §162 сдавался с обещанием «один запрос на тему» и оно держится.

create or replace function public.topic_tasks_for_student(p_topic_id uuid)
returns table (
  student_assignment_id uuid,
  item_id               uuid,
  item_position         integer,
  task_id               uuid,
  statement_html        text,
  assets                jsonb,
  max_points            smallint,
  auto_checkable        boolean,
  answer_raw            text,
  is_correct            boolean,
  attempts_count        integer,
  closed_by             text,
  solution_shown_at     timestamptz,
  solution_html         text,
  answer_html           text
)
language plpgsql
security definer
set search_path to ''
as $function$
BEGIN
  PERFORM public.ensure_topic_task_rows(p_topic_id);

  RETURN QUERY
  select
    tvsa.id, tvi.id, tvi.position, ct.id,
    ct.statement_html,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'task_id', a.task_id, 'kind', a.kind,
               'storage_path', a.storage_path, 'alt', a.alt, 'position', a.position)
             order by a.position)
        from public.catalog_task_assets a where a.task_id = ct.id
    ), '[]'::jsonb),
    ct.max_points,
    public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type),
    tva_ans.answer_raw,
    tva_ans.is_correct,
    coalesce(tva_ans.attempts_count, 0),
    tva_ans.closed_by,
    tva_ans.solution_shown_at,
    -- Разбор наружу только после того, как он открыт явным действием.
    case when tva_ans.solution_shown_at is not null then ct.solution_html end,
    case when tva_ans.solution_shown_at is not null then ct.answer_html   end
  from public.test_variant_assignments tva
  join public.test_variant_student_assignments tvsa on tvsa.assignment_id = tva.id
  join public.students s   on s.id = tvsa.student_id
  join public.test_variant_items tvi on tvi.variant_id = tva.variant_id
  join public.catalog_tasks ct on ct.id = tvi.task_id
  left join public.test_variant_answers tva_ans
         on tva_ans.student_assignment_id = tvsa.id
        and tva_ans.variant_item_id = tvi.id
  where tva.topic_id = p_topic_id
    and s.profile_id = auth.uid()
    and tvsa.status <> 'cancelled'
    and public.course_student_can_see_topic(p_topic_id)
  order by tvi.position;
END;
$function$;

comment on function public.topic_tasks_for_student(uuid) is
  'Задачи к уроку и моё состояние по каждой, одним запросом; заодно заводит выдачу при первом обращении. §162/§164';

-- ── Прикрепление отобранного в каталоге ──────────────────────────────────────

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
      'self_checked',   count(*) FILTER (WHERE tvi.grading_type = 'manual')
    )
    FROM public.test_variant_items tvi WHERE tvi.variant_id = v_variant
  );
END;
$function$;

comment on function public.attach_catalog_tasks_to_topic(uuid, uuid[]) is
  'Кладёт отобранные в каталоге задачи в набор задач к уроку: добавляет к существующим, дублей не создаёт, выдач не шлёт. §164';

-- ── Что прикреплено: экран преподавателя ─────────────────────────────────────

create or replace function public.topic_tasks_for_staff(p_topic_id uuid)
returns table (
  item_id        uuid,
  item_position  integer,
  task_id        uuid,
  external_id    text,
  statement_html text,
  exam_part      smallint,
  max_points     smallint,
  auto_checkable boolean,
  answers_count  integer,
  closed_count   integer
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    tvi.id, tvi.position, ct.id, ct.external_id, ct.statement_html,
    ct.exam_part, ct.max_points,
    public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type),
    (select count(*)::integer from public.test_variant_answers a
      where a.variant_item_id = tvi.id),
    (select count(*)::integer from public.test_variant_answers a
      where a.variant_item_id = tvi.id and a.closed_by is not null)
  from public.test_variants v
  join public.test_variant_items tvi on tvi.variant_id = v.id
  join public.catalog_tasks ct on ct.id = tvi.task_id
  where v.topic_id = p_topic_id
    and public.topic_material_can_manage(p_topic_id)
  order by tvi.position;
$$;

comment on function public.topic_tasks_for_staff(uuid) is
  'Задачи, прикреплённые к уроку, с числом ответов по каждой — для экрана преподавателя. §164';

-- ── Убрать задачу ────────────────────────────────────────────────────────────

create or replace function public.topic_task_detach_item(
  p_topic_id uuid,
  p_item_id  uuid,
  p_force    boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_variant uuid;
  v_answers integer;
BEGIN
  IF NOT public.topic_material_can_manage(p_topic_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: not staff of this course topic';
  END IF;

  SELECT v.id INTO v_variant
  FROM public.test_variants v
  JOIN public.test_variant_items tvi ON tvi.variant_id = v.id
  WHERE v.topic_id = p_topic_id AND tvi.id = p_item_id;

  IF v_variant IS NULL THEN
    RAISE EXCEPTION 'NO_ITEM: task is not attached to this topic';
  END IF;

  SELECT count(*)::integer INTO v_answers
  FROM public.test_variant_answers WHERE variant_item_id = p_item_id;

  -- Убрать задачу, по которой уже отвечали, — значит стереть ответы. Молча так
  -- не делаем: преподаватель должен увидеть число и подтвердить.
  IF v_answers > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'HAS_ANSWERS:%', v_answers;
  END IF;

  DELETE FROM public.test_variant_answers WHERE variant_item_id = p_item_id;
  DELETE FROM public.test_variant_items   WHERE id = p_item_id;

  -- Позиции подтягиваем без дыр: они же номера задач на экране ученика.
  WITH ordered AS (
    SELECT id, row_number() OVER (ORDER BY position) AS rn
      FROM public.test_variant_items WHERE variant_id = v_variant
  )
  UPDATE public.test_variant_items tvi
     SET position = -ordered.rn
    FROM ordered WHERE ordered.id = tvi.id;

  UPDATE public.test_variant_items SET position = -position
   WHERE variant_id = v_variant AND position < 0;

  UPDATE public.test_variants
     SET tasks_count = (SELECT count(*) FROM public.test_variant_items WHERE variant_id = v_variant),
         updated_at  = now()
   WHERE id = v_variant;

  RETURN jsonb_build_object('removed_answers', v_answers);
END;
$function$;

comment on function public.topic_task_detach_item(uuid, uuid, boolean) is
  'Убирает задачу из набора задач к уроку. С ответами — только осознанно, через p_force. §164';

-- ── Поменять порядок ─────────────────────────────────────────────────────────

create or replace function public.topic_task_move_item(
  p_topic_id uuid,
  p_item_id  uuid,
  p_delta    integer
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_variant  uuid;
  v_pos      integer;
  v_other    uuid;
  v_otherpos integer;
BEGIN
  IF NOT public.topic_material_can_manage(p_topic_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED: not staff of this course topic';
  END IF;

  SELECT v.id, tvi.position INTO v_variant, v_pos
  FROM public.test_variants v
  JOIN public.test_variant_items tvi ON tvi.variant_id = v.id
  WHERE v.topic_id = p_topic_id AND tvi.id = p_item_id;

  IF v_variant IS NULL THEN
    RAISE EXCEPTION 'NO_ITEM: task is not attached to this topic';
  END IF;

  -- Соседа ищем по факту, а не по «позиция ± 1»: дыр быть не должно, но
  -- арифметика на позициях ломается ровно там, где они разъехались.
  IF p_delta < 0 THEN
    SELECT id, position INTO v_other, v_otherpos
    FROM public.test_variant_items
    WHERE variant_id = v_variant AND position < v_pos
    ORDER BY position DESC LIMIT 1;
  ELSE
    SELECT id, position INTO v_other, v_otherpos
    FROM public.test_variant_items
    WHERE variant_id = v_variant AND position > v_pos
    ORDER BY position ASC LIMIT 1;
  END IF;

  IF v_other IS NULL THEN
    RETURN;
  END IF;

  -- Через временную отрицательную позицию: (variant_id, position) уникальна.
  UPDATE public.test_variant_items SET position = -1 WHERE id = p_item_id;
  UPDATE public.test_variant_items SET position = v_pos WHERE id = v_other;
  UPDATE public.test_variant_items SET position = v_otherpos WHERE id = p_item_id;
END;
$function$;

comment on function public.topic_task_move_item(uuid, uuid, integer) is
  'Меняет задачу местами с соседней в наборе задач к уроку. §164';

-- ── Счётчики преподавателя ───────────────────────────────────────────────────
--
-- Две правки против §162. Первая: задачи считаются по варианту-носителю, иначе
-- при ленивой выдаче тема, которую ещё никто не открыл, показывала бы ноль
-- задач. Вторая: «из скольких» — это ученики курса, а не строки выдачи; раньше
-- знаменатель рос по мере того, как ученики открывали тему, и «решают 3 из 3»
-- читалось как полный успех при шестнадцати учениках в классе.

create or replace function public.topic_task_progress_for_staff(p_topic_id uuid)
returns table (
  tasks_total       integer,
  students_total    integer,
  students_started  integer,
  students_done     integer,
  closed_auto       integer,
  closed_self       integer
)
language sql
stable
security definer
set search_path to ''
as $$
  with items as (
    select count(tvi.id)::integer n
    from public.test_variants v
    join public.test_variant_items tvi on tvi.variant_id = v.id
    where v.topic_id = p_topic_id
  ),
  roster as (
    select count(distinct gs.student_id)::integer n
    from public.group_students gs
    join public.groups g on g.id = gs.group_id
    where g.course_id = public.course_of_topic(p_topic_id)
  ),
  per_student as (
    select tvsa.student_id,
           count(a.id) filter (where a.closed_by is not null)::integer closed,
           count(a.id)::integer touched,
           count(a.id) filter (where a.closed_by = 'auto')::integer c_auto,
           count(a.id) filter (where a.closed_by = 'self')::integer c_self
    from public.test_variant_assignments tva
    join public.test_variant_student_assignments tvsa on tvsa.assignment_id = tva.id
    left join public.test_variant_answers a on a.student_assignment_id = tvsa.id
    where tva.topic_id = p_topic_id
    group by tvsa.student_id
  )
  select
    coalesce((select n from items), 0),
    greatest(
      coalesce((select n from roster), 0),
      (select count(*)::integer from per_student)
    ),
    (select count(*)::integer from per_student where touched > 0),
    (select count(*)::integer from per_student
      where closed > 0 and closed >= coalesce((select n from items), 0)),
    (select coalesce(sum(c_auto), 0)::integer from per_student),
    (select coalesce(sum(c_self), 0)::integer from per_student)
  where public.topic_material_can_manage(p_topic_id);
$$;

comment on function public.topic_task_progress_for_staff(uuid) is
  'Задач к уроку и как их решают: сколько учеников курса начали, сколько закрыли всё, чем закрывали. §162/§164';

revoke all on function public.ensure_topic_task_rows(uuid)                    from public, anon;
revoke all on function public.attach_catalog_tasks_to_topic(uuid, uuid[])     from public, anon;
revoke all on function public.topic_tasks_for_staff(uuid)                     from public, anon;
revoke all on function public.topic_task_detach_item(uuid, uuid, boolean)     from public, anon;
revoke all on function public.topic_task_move_item(uuid, uuid, integer)       from public, anon;

grant execute on function public.ensure_topic_task_rows(uuid)                to authenticated;
grant execute on function public.attach_catalog_tasks_to_topic(uuid, uuid[]) to authenticated;
grant execute on function public.topic_tasks_for_staff(uuid)                 to authenticated;
grant execute on function public.topic_task_detach_item(uuid, uuid, boolean) to authenticated;
grant execute on function public.topic_task_move_item(uuid, uuid, integer)   to authenticated;
grant execute on function public.topic_tasks_for_student(uuid)               to authenticated;
grant execute on function public.topic_task_progress_for_staff(uuid)         to authenticated;
