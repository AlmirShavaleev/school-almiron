-- §176 (применено оркестратором 14.09, версия 20260914213339; права под учеником проверены в откатанной транзакции). Задачи к уроку: разбор после первой попытки, ответ после открытого решения не засчитывается.
--
-- Что меняется против §162 (миграция 20260912201835) — только правила
-- трёх функций, схема не трогается:
--
--   reveal_topic_task_solution — у задачи с коротким ответом разбор открывается
--     после ХОТЯ БЫ ОДНОЙ попытки (attempts_count >= 1 по строке ответа) либо
--     после верного, а не только после верного. До первой попытки — прежний
--     отказ с новым кодом NOT_ATTEMPTED_YET (клиент знает оба кода). Решение
--     владельца 14.09: «решение можно посмотреть по кнопке, даже если ответил
--     неправильно». Ограничение «не раньше первой попытки» остаётся: иначе
--     разбор был бы ответом (§162).
--
--   answer_topic_task — если по задаче solution_shown_at не null и она ещё не
--     закрыта, ответ не принимается: SOLUTION_SHOWN. Задача, у которой
--     подсмотрели разбор, закрывается только отметкой «Разобрал» (closed_by =
--     'self') и у преподавателя считается «по разбору», а не «по ответу».
--     Иначе «решил с N-й попытки» после открытого решения было бы враньём.
--
--   close_topic_task_self — принимает и задачу с коротким ответом, если разбор
--     показан: проверка AUTO_CHECKABLE снята, SOLUTION_NOT_SHOWN остаётся. Новое
--     ограничение ALREADY_SOLVED: закрытую задачу (в т. ч. верным ответом с
--     открытым потом разбором) второй раз не закрыть — раньше это прикрывала
--     проверка AUTO_CHECKABLE, а без неё UPDATE перебил бы closed_by = 'auto'
--     на 'self'.
--
-- Проверка ответа по-прежнему одна на проект (normalize_variant_answer +
-- variant_answer_verdict), тело answer_topic_task в этой части не менялось.

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
  v_closed   text;
  v_shown    timestamptz;
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

  SELECT closed_by, solution_shown_at INTO v_closed, v_shown
  FROM public.test_variant_answers
  WHERE student_assignment_id = v_sa_id AND variant_item_id = p_item_id;

  IF v_closed IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_SOLVED: task is already closed';
  END IF;

  -- После подсмотренного разбора ответ не засчитывается «по ответу»: задача
  -- закрывается отметкой «Разобрал» (§176).
  IF v_shown IS NOT NULL THEN
    RAISE EXCEPTION 'SOLUTION_SHOWN: answer after solution is self-check';
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
  'Ответ на задачу к уроку с мгновенным вердиктом. Попыток без лимита, верный ответ запирает задачу; после открытого разбора ответ не принимается (SOLUTION_SHOWN). §162, §176';

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
  v_sa_id    uuid;
  v_task     record;
  v_correct  boolean;
  v_attempts integer;
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

  SELECT COALESCE(is_correct, false), COALESCE(attempts_count, 0)
  INTO v_correct, v_attempts
  FROM public.test_variant_answers
  WHERE student_assignment_id = v_sa_id AND variant_item_id = p_item_id;

  -- У задачи с коротким ответом разбор открывается после хотя бы одной
  -- попытки (§176) либо после верного ответа. До первой попытки — нет:
  -- попыток без лимита, и разбор до единственной попытки был бы ответом.
  IF v_task.auto_ok AND NOT COALESCE(v_correct, false) AND COALESCE(v_attempts, 0) < 1 THEN
    RAISE EXCEPTION 'NOT_ATTEMPTED_YET: solution opens after the first attempt';
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
  'Показать разбор задачи к уроку. Для задач с коротким ответом — после хотя бы одной попытки или верного ответа. Фиксирует факт показа. §162, §176';

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
  v_closed text;
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

  SELECT closed_by, solution_shown_at INTO v_closed, v_shown
  FROM public.test_variant_answers
  WHERE student_assignment_id = v_sa_id AND variant_item_id = p_item_id;

  -- Закрытую задачу второй раз не закрыть: иначе задача, решённая ответом и
  -- разобранная потом, стала бы «по разбору».
  IF v_closed IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_SOLVED: task is already closed';
  END IF;

  -- Отметить «разобрал», не открыв разбор, нельзя. Задачу с коротким ответом
  -- сюда тоже пускаем — но только после показа решения (§176): у неё после
  -- разбора ответ уже не принимается, других выходов нет.
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
  'Закрыть задачу к уроку самооценкой — после показа разбора; с §176 и для задач с коротким ответом. §162, §176';

-- Права не меняются: revoke/grant из 20260912201835 действуют для тех же
-- сигнатур. Повторяем на случай, если функция пересоздана с другими
-- default-правами.
revoke all on function public.answer_topic_task(uuid, uuid, text)        from public, anon;
revoke all on function public.reveal_topic_task_solution(uuid, uuid)     from public, anon;
revoke all on function public.close_topic_task_self(uuid, uuid)          from public, anon;
grant execute on function public.answer_topic_task(uuid, uuid, text)    to authenticated;
grant execute on function public.reveal_topic_task_solution(uuid, uuid) to authenticated;
grant execute on function public.close_topic_task_self(uuid, uuid)      to authenticated;

-- ── Сценарий проверки прав под учеником (оркестратор, после применения) ───────
--
-- Нужна тема с задачами и ученик с выдачей (или тема, которую ученик уже
-- открывал — ensure_topic_task_rows заведёт строку). Задача с коротким ответом
-- и БЕЗ попыток у этого ученика: <item_id>. Все вызовы — в транзакции с
-- ROLLBACK в конце, чтобы прод не остался с пробными ответами.
--
-- begin;
-- select set_config('role','authenticated',true);
-- select set_config('request.jwt.claims','{"sub":"<profile uuid ученика>","role":"authenticated"}',true);
-- -- 1. до попытки reveal → отказ NOT_ATTEMPTED_YET
-- select public.reveal_topic_task_solution('<topic_id>','<item_id>');
-- -- 2. неверный ответ → is_correct=false, attempts_count=1
-- select public.answer_topic_task('<topic_id>','<item_id>','заведомо неверно');
-- -- 3. после неверной reveal → успех (solution_html и т. д.)
-- select public.reveal_topic_task_solution('<topic_id>','<item_id>');
-- -- 4. answer после reveal → отказ SOLUTION_SHOWN
-- select public.answer_topic_task('<topic_id>','<item_id>','что угодно');
-- -- 5. close_self после reveal у авто-проверяемой → успех, closed_by='self'
-- select public.close_topic_task_self('<topic_id>','<item_id>');
-- -- 6. повторный close_self → отказ ALREADY_SOLVED
-- select public.close_topic_task_self('<topic_id>','<item_id>');
-- rollback;
