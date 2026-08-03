-- Ученик, проходящий тест, получал внешний номер задачи (task_ext_id) сразу.
-- Показ решений в каталоге — намеренный продукт, поэтому номер во время попытки
-- фактически работал ссылкой на готовый ответ. Закрываем номер тем же условием,
-- что и эталон: до сдачи NULL. После сдачи ответ и так показывается, скрывать
-- номер там смысла нет. source_url не отдавался и не отдаётся (§52).
--
-- Заодно RPC начинает отдавать max_points и partial_type: без них клиент лез за
-- ними в catalog_tasks напрямую и попутно тянул оттуда answer_html в обход
-- этой самой проверки.

DROP FUNCTION IF EXISTS public.get_variant_items_for_student(uuid);

CREATE FUNCTION public.get_variant_items_for_student(p_student_assignment_id uuid)
 RETURNS TABLE(
   item_id uuid, variant_id uuid, task_id uuid, item_position integer, points integer,
   grading_type text, statement_html text, has_answer boolean, has_solution boolean,
   task_ext_id bigint, subject text, exam_type text, exam_part smallint,
   max_points smallint, partial_type text, source_type text,
   solution_html text, solution_plan_html text, grade_criteria_html text, answer_html text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tvsa record;
BEGIN
  SELECT tvsa.id, tvsa.variant_id, tvsa.status
  INTO v_tvsa
  FROM public.test_variant_student_assignments tvsa
  JOIN public.students s ON s.id = tvsa.student_id
  WHERE tvsa.id = p_student_assignment_id
    AND s.profile_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESS_DENIED: assignment not found or not owned by caller';
  END IF;

  IF v_tvsa.status = 'not_started' THEN
    RAISE EXCEPTION 'NOT_STARTED: start the assignment first';
  END IF;

  RETURN QUERY
  SELECT
    tvi.id, tvi.variant_id, tvi.task_id, tvi.position, tvi.points, tvi.grading_type,
    ct.statement_html, ct.has_answer, ct.has_solution,
    CASE WHEN v_tvsa.status IN ('submitted','completed') THEN ct.external_id         ELSE NULL END,
    ct.subject, ct.exam_type, ct.exam_part, ct.max_points, ct.partial_type, tv.source_type,
    CASE WHEN v_tvsa.status IN ('submitted','completed') THEN ct.solution_html       ELSE NULL END,
    CASE WHEN v_tvsa.status IN ('submitted','completed') THEN ct.solution_plan_html  ELSE NULL END,
    CASE WHEN v_tvsa.status IN ('submitted','completed') THEN ct.grade_criteria_html ELSE NULL END,
    CASE WHEN v_tvsa.status IN ('submitted','completed') THEN ct.answer_html         ELSE NULL END
  FROM public.test_variant_items tvi
  JOIN public.catalog_tasks ct ON ct.id = tvi.task_id
  JOIN public.test_variants tv ON tv.id = tvi.variant_id
  WHERE tvi.variant_id = v_tvsa.variant_id
  ORDER BY tvi.position;
END;
$function$;

comment on function public.get_variant_items_for_student(uuid) is
  'Задачи варианта для ученика. Эталон, решение и номер задачи — только после сдачи. §52';

-- Раньше функция была исполнима для anon: до данных дело не доходило (auth.uid()
-- пуст → ACCESS_DENIED), но выдавать её анониму незачем.
REVOKE ALL ON FUNCTION public.get_variant_items_for_student(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_variant_items_for_student(uuid) TO authenticated;
