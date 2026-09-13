-- Задачи к уроку (§162). Вердикт по каждой задаче сразу, попыток сколько
-- угодно, разбор после верного ответа. Задачи без короткого ответа закрываются
-- самооценкой — но только после показа решения.
--
-- Проверка ответа ОДНА на весь проект: normalize_variant_answer (§63) плюс
-- variant_answer_verdict (§66). Второй здесь не заводится ни в каком виде —
-- именно её отсутствие стоило нам разбора «;» и «да/нет» в §66.
--
-- Годность к автопроверке спрашиваем у variant_answer_is_auto_checkable
-- (§96/§127) — той же, по которой живут пул автосборки и вердикт. Задача,
-- которую она не берёт, идёт по пути «посмотрел решение → отметил сам».
--
-- Экзаменационный путь (save_variant_answer, submit_variant, finalize_grading)
-- не тронут: у него остаётся «сдать целиком», и живёт он вне темы.

-- ── Что видит ученик: всё одним запросом ─────────────────────────────────────

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
language sql
stable
security definer
set search_path to ''
as $$
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
$$;

comment on function public.topic_tasks_for_student(uuid) is
  'Задачи к уроку и моё состояние по каждой, одним запросом. Разбор отдаётся только после показа. §162';

-- ── Ответ с мгновенным вердиктом ─────────────────────────────────────────────

create or replace function public.answer_topic_task(
  p_topic_id     uuid,
  p_item_id      uuid,
  p_answer_raw   text
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_sa_id    uuid;
  v_task     record;
  v_norm     text;
  v_correct  boolean;
  v_attempts integer;
  v_points   integer;
BEGIN
  SELECT tvsa.id INTO v_sa_id
  FROM public.test_variant_assignments tva
  JOIN public.test_variant_student_assignments tvsa ON tvsa.assignment_id = tva.id
  JOIN public.students s ON s.id = tvsa.student_id
  JOIN public.test_variant_items tvi ON tvi.variant_id = tva.variant_id AND tvi.id = p_item_id
  WHERE tva.topic_id = p_topic_id
    AND s.profile_id = auth.uid()
    AND tvsa.status <> 'cancelled'
    AND public.course_student_can_see_topic(p_topic_id);

  IF v_sa_id IS NULL THEN
    RAISE EXCEPTION 'ACCESS_DENIED: task not found for this student';
  END IF;

  SELECT ct.answer_html, ct.partial_type, tvi.points,
         public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type) AS auto_ok
  INTO v_task
  FROM public.test_variant_items tvi
  JOIN public.catalog_tasks ct ON ct.id = tvi.task_id
  WHERE tvi.id = p_item_id;

  IF NOT v_task.auto_ok THEN
    RAISE EXCEPTION 'NOT_AUTO_CHECKABLE: this task is closed by self-check after the solution is shown';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.test_variant_answers
    WHERE student_assignment_id = v_sa_id AND variant_item_id = p_item_id
      AND closed_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_SOLVED: task is already closed';
  END IF;

  -- Ничего не надо «начинать»: открыл урок — решаешь. Попытка стартует сама.
  UPDATE public.test_variant_student_assignments
  SET status     = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = v_sa_id;

  v_norm := public.normalize_variant_answer(p_answer_raw);

  v_correct := COALESCE(
    public.variant_answer_verdict(
      public.normalize_variant_answer(public.strip_html_simple(v_task.answer_html)),
      v_norm),
    false);

  v_points := CASE WHEN v_correct THEN COALESCE(v_task.points, 1) ELSE 0 END;

  INSERT INTO public.test_variant_answers (
    student_assignment_id, variant_item_id, answer_raw, answer_normalized,
    is_correct, points_earned, points_max, attempts_count, closed_by,
    grading_status, first_answered_at, last_changed_at
  ) VALUES (
    v_sa_id, p_item_id, p_answer_raw, v_norm,
    v_correct, v_points, COALESCE(v_task.points, 1), 1,
    CASE WHEN v_correct THEN 'auto' END,
    'auto_graded', now(), now()
  )
  ON CONFLICT (student_assignment_id, variant_item_id) DO UPDATE
    SET answer_raw        = EXCLUDED.answer_raw,
        answer_normalized = EXCLUDED.answer_normalized,
        is_correct        = EXCLUDED.is_correct,
        points_earned     = EXCLUDED.points_earned,
        points_max        = EXCLUDED.points_max,
        attempts_count    = public.test_variant_answers.attempts_count + 1,
        closed_by         = EXCLUDED.closed_by,
        grading_status    = 'auto_graded',
        last_changed_at   = now()
  RETURNING attempts_count INTO v_attempts;

  RETURN jsonb_build_object(
    'is_correct',     v_correct,
    'attempts_count', v_attempts,
    'solved',         (SELECT count(*) FROM public.test_variant_answers a
                        WHERE a.student_assignment_id = v_sa_id AND a.closed_by IS NOT NULL),
    'total',          (SELECT count(*) FROM public.test_variant_items i
                        JOIN public.test_variant_student_assignments x ON x.id = v_sa_id
                       WHERE i.variant_id = x.variant_id)
  );
END;
$function$;

comment on function public.answer_topic_task(uuid, uuid, text) is
  'Ответ на задачу к уроку с мгновенным вердиктом. Попыток без лимита, верный ответ запирает задачу. §162';

-- ── Показать разбор ──────────────────────────────────────────────────────────

create or replace function public.reveal_topic_task_solution(
  p_topic_id uuid,
  p_item_id  uuid
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_sa_id   uuid;
  v_task    record;
  v_correct boolean;
BEGIN
  SELECT tvsa.id INTO v_sa_id
  FROM public.test_variant_assignments tva
  JOIN public.test_variant_student_assignments tvsa ON tvsa.assignment_id = tva.id
  JOIN public.students s ON s.id = tvsa.student_id
  JOIN public.test_variant_items tvi ON tvi.variant_id = tva.variant_id AND tvi.id = p_item_id
  WHERE tva.topic_id = p_topic_id
    AND s.profile_id = auth.uid()
    AND tvsa.status <> 'cancelled'
    AND public.course_student_can_see_topic(p_topic_id);

  IF v_sa_id IS NULL THEN
    RAISE EXCEPTION 'ACCESS_DENIED: task not found for this student';
  END IF;

  SELECT ct.answer_html, ct.solution_html, ct.solution_plan_html,
         public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type) AS auto_ok
  INTO v_task
  FROM public.test_variant_items tvi
  JOIN public.catalog_tasks ct ON ct.id = tvi.task_id
  WHERE tvi.id = p_item_id;

  SELECT COALESCE(is_correct, false) INTO v_correct
  FROM public.test_variant_answers
  WHERE student_assignment_id = v_sa_id AND variant_item_id = p_item_id;

  -- У задачи с коротким ответом разбор открывается только после верного:
  -- попыток без лимита, и разбор до верного был бы ответом.
  IF v_task.auto_ok AND NOT COALESCE(v_correct, false) THEN
    RAISE EXCEPTION 'NOT_SOLVED_YET: solution opens after the correct answer';
  END IF;

  INSERT INTO public.test_variant_answers (
    student_assignment_id, variant_item_id, answer_raw, answer_normalized,
    grading_status, solution_shown_at, first_answered_at, last_changed_at
  ) VALUES (
    v_sa_id, p_item_id, '', '', 'not_answered', now(), now(), now()
  )
  ON CONFLICT (student_assignment_id, variant_item_id) DO UPDATE
    SET solution_shown_at = COALESCE(public.test_variant_answers.solution_shown_at, now()),
        last_changed_at   = now();

  RETURN jsonb_build_object(
    'solution_html',      v_task.solution_html,
    'solution_plan_html', v_task.solution_plan_html,
    'answer_html',        v_task.answer_html
  );
END;
$function$;

comment on function public.reveal_topic_task_solution(uuid, uuid) is
  'Показать разбор задачи к уроку. Для задач с коротким ответом — только после верного ответа. Фиксирует факт показа. §162';

-- ── Закрыть самооценкой ──────────────────────────────────────────────────────

create or replace function public.close_topic_task_self(
  p_topic_id uuid,
  p_item_id  uuid
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_sa_id  uuid;
  v_auto   boolean;
  v_shown  timestamptz;
BEGIN
  SELECT tvsa.id INTO v_sa_id
  FROM public.test_variant_assignments tva
  JOIN public.test_variant_student_assignments tvsa ON tvsa.assignment_id = tva.id
  JOIN public.students s ON s.id = tvsa.student_id
  JOIN public.test_variant_items tvi ON tvi.variant_id = tva.variant_id AND tvi.id = p_item_id
  WHERE tva.topic_id = p_topic_id
    AND s.profile_id = auth.uid()
    AND tvsa.status <> 'cancelled'
    AND public.course_student_can_see_topic(p_topic_id);

  IF v_sa_id IS NULL THEN
    RAISE EXCEPTION 'ACCESS_DENIED: task not found for this student';
  END IF;

  SELECT public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
  INTO v_auto
  FROM public.test_variant_items tvi
  JOIN public.catalog_tasks ct ON ct.id = tvi.task_id
  WHERE tvi.id = p_item_id;

  -- Задачу с коротким ответом самооценкой не закрыть: для неё есть вердикт.
  IF v_auto THEN
    RAISE EXCEPTION 'AUTO_CHECKABLE: this task is closed by answering it';
  END IF;

  SELECT solution_shown_at INTO v_shown
  FROM public.test_variant_answers
  WHERE student_assignment_id = v_sa_id AND variant_item_id = p_item_id;

  -- Отметить «разобрал», не открыв разбор, нельзя.
  IF v_shown IS NULL THEN
    RAISE EXCEPTION 'SOLUTION_NOT_SHOWN: open the solution first';
  END IF;

  UPDATE public.test_variant_student_assignments
  SET status     = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = v_sa_id;

  UPDATE public.test_variant_answers
  SET closed_by       = 'self',
      grading_status  = 'graded',
      last_changed_at = now()
  WHERE student_assignment_id = v_sa_id AND variant_item_id = p_item_id;

  RETURN jsonb_build_object(
    'closed_by', 'self',
    'solved',    (SELECT count(*) FROM public.test_variant_answers a
                   WHERE a.student_assignment_id = v_sa_id AND a.closed_by IS NOT NULL),
    'total',     (SELECT count(*) FROM public.test_variant_items i
                   JOIN public.test_variant_student_assignments x ON x.id = v_sa_id
                  WHERE i.variant_id = x.variant_id)
  );
END;
$function$;

comment on function public.close_topic_task_self(uuid, uuid) is
  'Закрыть задачу к уроку самооценкой. Только для задач без короткого ответа и только после показа разбора. §162';

-- ── Что видит преподаватель ──────────────────────────────────────────────────

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
    select count(*)::integer n
    from public.test_variant_assignments tva
    join public.test_variant_items tvi on tvi.variant_id = tva.variant_id
    where tva.topic_id = p_topic_id
    limit 1
  ),
  per_student as (
    select tvsa.id,
           count(a.id) filter (where a.closed_by is not null)::integer closed,
           count(a.id)::integer touched,
           count(a.id) filter (where a.closed_by = 'auto')::integer c_auto,
           count(a.id) filter (where a.closed_by = 'self')::integer c_self
    from public.test_variant_assignments tva
    join public.test_variant_student_assignments tvsa on tvsa.assignment_id = tva.id
    left join public.test_variant_answers a on a.student_assignment_id = tvsa.id
    where tva.topic_id = p_topic_id
    group by tvsa.id
  )
  select
    coalesce((select n from items), 0),
    (select count(*)::integer from per_student),
    (select count(*)::integer from per_student where touched > 0),
    (select count(*)::integer from per_student
      where closed > 0 and closed >= coalesce((select n from items), 0)),
    (select coalesce(sum(c_auto), 0)::integer from per_student),
    (select coalesce(sum(c_self), 0)::integer from per_student)
  where public.topic_material_can_manage(p_topic_id);
$$;

comment on function public.topic_task_progress_for_staff(uuid) is
  'Задач к уроку и как их решают: сколько учеников начали, сколько закрыли всё, чем закрывали. §162';

revoke all on function public.topic_tasks_for_student(uuid)              from public, anon;
revoke all on function public.answer_topic_task(uuid, uuid, text)        from public, anon;
revoke all on function public.reveal_topic_task_solution(uuid, uuid)     from public, anon;
revoke all on function public.close_topic_task_self(uuid, uuid)          from public, anon;
revoke all on function public.topic_task_progress_for_staff(uuid)        from public, anon;

grant execute on function public.topic_tasks_for_student(uuid)          to authenticated;
grant execute on function public.answer_topic_task(uuid, uuid, text)    to authenticated;
grant execute on function public.reveal_topic_task_solution(uuid, uuid) to authenticated;
grant execute on function public.close_topic_task_self(uuid, uuid)      to authenticated;
grant execute on function public.topic_task_progress_for_staff(uuid)    to authenticated;
