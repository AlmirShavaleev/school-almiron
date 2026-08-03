-- Класс «перечисление через пробел» из разбора §62: 77 задач, где эталон —
-- несколько значений подряд. Разбор показал, что это НЕ однородный класс:
--
--   «13 31», «12 21», «23 32»  — одно множество цифр в разном порядке
--                                (задачи «какие утверждения истинны»)
--   «0.004 -0.004»             — плюс-минус одно значение
--   «1.75 6.25»                — РАЗНЫЕ величины, нужны обе
--
-- Поэтому правило «принимать любое из» включается не для всех перечислений, а
-- только там, где значения заведомо эквивалентны. Критерий: у всех элементов
-- совпадает мультимножество цифр (знак и точка отбрасываются). «13» и «31» —
-- да. «0.004» и «-0.004» — да. «1.75» и «6.25» — нет.
--
-- Так покрываются 62 задачи; оставшиеся 15 остаются вне автопроверки. Отдать им
-- балл за одно из двух разных значений — это подарить половину ответа, что
-- прямо хуже нынешнего нуля.
--
-- Точка с запятой («19; 11» — основания трапеции, «-6; 7» — корни) в это
-- правило НЕ входит: там нужны все части. Отдельным шагом.

create or replace function public.variant_answer_alternatives(p_correct_norm text)
returns numeric[]
language sql
immutable
set search_path to ''
as $$
  select case
    -- Одно число — единственная альтернатива.
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?$'
      then array[p_correct_norm::numeric]
    -- Перечисление через пробел, и только если значения эквивалентны.
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?( +-?[0-9]+(\.[0-9]+)?)+$'
     and (
       select count(distinct (
         select string_agg(c, '' order by c)
         from regexp_split_to_table(replace(replace(el, '-', ''), '.', ''), '') c
       ))
       from regexp_split_to_table(p_correct_norm, ' +') el
     ) = 1
      then (select array_agg(el::numeric) from regexp_split_to_table(p_correct_norm, ' +') el)
    else null
  end;
$$;

comment on function public.variant_answer_alternatives(text) is
  'Значения, любое из которых засчитывается. NULL — эталон автопроверке не поддаётся. Перечисление принимается только при эквивалентных значениях (перестановка цифр, плюс-минус).';

-- Предикат пула теперь опирается на ту же функцию: что умеет проверить
-- submit_variant, то и попадает в автосборку. Одно правило, не две копии.
create or replace function public.variant_answer_is_auto_checkable(
  p_answer_html  text,
  p_partial_type text
) returns boolean
language sql
immutable
set search_path to ''
as $$
  select case
    when p_answer_html is null or p_answer_html = '' then false
    when p_partial_type is not null then true
    else public.variant_answer_alternatives(
           public.normalize_variant_answer(public.strip_html_simple(p_answer_html))
         ) is not null
  end;
$$;

comment on function public.variant_answer_is_auto_checkable(text, text) is
  'Сможет ли submit_variant проверить эталон этой задачи сам. Общий предикат для сэмплера и счётчиков доступности.';

-- ── Само сравнение ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_variant(p_student_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tvsa             record;
  v_item             record;
  v_student_norm     text;
  v_correct_norm     text;
  v_alts             numeric[];
  v_auto_check       boolean;
  v_is_correct       boolean;
  v_points_earned    numeric(10,2);
  v_partial_score    integer;
  v_answered_cnt     integer       := 0;
  v_correct_cnt      integer       := 0;
  v_auto_score       numeric(10,2) := 0;
  v_total_max        numeric(10,2) := 0;
  v_manual_rev_cnt   integer       := 0;
  v_percentage       numeric(5,2);
  v_has_attach       boolean;
  v_grading_status   text;
BEGIN
  SELECT tvsa.id, tvsa.status, tvsa.variant_id, tvsa.started_at,
         tvsa.submitted_at, tvsa.completed_at,
         tvsa.answered_count, tvsa.correct_count,
         tvsa.score, tvsa.max_score, tvsa.percentage,
         tvsa.grading_status
  INTO v_tvsa
  FROM public.test_variant_student_assignments tvsa
  JOIN public.students s ON s.id = tvsa.student_id
  WHERE tvsa.id = p_student_assignment_id
    AND s.profile_id = auth.uid()
  FOR UPDATE OF tvsa;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESS_DENIED: assignment not found or not owned by caller';
  END IF;

  IF v_tvsa.status = 'cancelled' THEN
    RAISE EXCEPTION 'ACCESS_DENIED: assignment is cancelled';
  END IF;

  IF v_tvsa.status IN ('submitted', 'completed') THEN
    RETURN jsonb_build_object(
      'status',               v_tvsa.status,
      'answered_count',       v_tvsa.answered_count,
      'correct_count',        v_tvsa.correct_count,
      'score',                v_tvsa.score,
      'max_score',            v_tvsa.max_score,
      'percentage',           v_tvsa.percentage,
      'grading_status',       v_tvsa.grading_status,
      'manual_review_count',  0,
      'submitted_at',         v_tvsa.submitted_at,
      'completed_at',         v_tvsa.completed_at
    );
  END IF;

  IF v_tvsa.started_at IS NULL THEN
    RAISE EXCEPTION 'NOT_STARTED: cannot submit a variant that was never started';
  END IF;

  FOR v_item IN (
    SELECT tvi.id AS item_id, tvi.points, tvi.grading_type,
           ct.answer_html, ct.has_answer, ct.partial_type
    FROM public.test_variant_items tvi
    JOIN public.catalog_tasks ct ON ct.id = tvi.task_id
    WHERE tvi.variant_id = v_tvsa.variant_id
    ORDER BY tvi.position
  ) LOOP
    v_total_max := v_total_max + v_item.points;

    SELECT tva.answer_normalized, tva.has_attachment
    INTO v_student_norm, v_has_attach
    FROM public.test_variant_answers tva
    WHERE tva.student_assignment_id = p_student_assignment_id
      AND tva.variant_item_id = v_item.item_id;

    v_student_norm := COALESCE(v_student_norm, '');
    v_has_attach   := COALESCE(v_has_attach, false);

    IF v_student_norm != '' OR v_has_attach THEN
      v_answered_cnt := v_answered_cnt + 1;
    END IF;

    -- ── MANUAL task ────────────────────────────────────────────────────────
    IF v_item.grading_type = 'manual' THEN
      IF v_student_norm != '' OR v_has_attach THEN
        v_manual_rev_cnt := v_manual_rev_cnt + 1;

        INSERT INTO public.test_variant_answers (
          student_assignment_id, variant_item_id,
          answer_raw, answer_normalized,
          is_correct, points_earned, points_max,
          has_attachment,
          grading_status, submitted_at
        ) VALUES (
          p_student_assignment_id, v_item.item_id,
          v_student_norm, v_student_norm,
          NULL, NULL, v_item.points,
          v_has_attach,
          'pending_review', now()
        )
        ON CONFLICT (student_assignment_id, variant_item_id)
        DO UPDATE SET
          is_correct    = NULL,
          points_earned = NULL,
          points_max    = v_item.points,
          has_attachment = EXCLUDED.has_attachment,
          grading_status = 'pending_review',
          submitted_at  = now();
      ELSE
        UPDATE public.test_variant_answers
        SET is_correct     = false,
            points_earned  = 0,
            points_max     = v_item.points,
            grading_status = 'not_answered',
            submitted_at   = now()
        WHERE student_assignment_id = p_student_assignment_id
          AND variant_item_id = v_item.item_id;
      END IF;
      CONTINUE;
    END IF;

    -- ── AUTO task ───────────────────────────────────────────────────────────
    IF v_item.has_answer
       AND v_item.answer_html IS NOT NULL
       AND v_item.answer_html != ''
    THEN
      v_correct_norm := public.normalize_variant_answer(
        public.strip_html_simple(v_item.answer_html)
      );
      -- Одно число или перечисление эквивалентных значений («13 31», «±0.004»).
      v_alts       := public.variant_answer_alternatives(v_correct_norm);
      v_auto_check := v_alts IS NOT NULL;
    ELSE
      v_correct_norm := NULL;
      v_alts         := NULL;
      v_auto_check   := false;
    END IF;

    IF v_item.partial_type IS NOT NULL AND v_correct_norm IS NOT NULL THEN
      v_partial_score := public.score_auto_answer(v_student_norm, v_correct_norm, v_item.partial_type);
      v_is_correct    := (v_partial_score = 2);
      v_points_earned := ROUND((v_partial_score::numeric / 2) * v_item.points, 2);
    ELSIF v_auto_check THEN
      IF v_student_norm != '' AND v_student_norm ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
        v_is_correct    := (v_student_norm::numeric = ANY (v_alts));
        v_points_earned := CASE WHEN v_is_correct THEN v_item.points::numeric ELSE 0 END;
      ELSE
        v_is_correct    := false;
        v_points_earned := 0;
      END IF;
    ELSE
      v_is_correct    := NULL;
      v_points_earned := NULL;
    END IF;

    IF v_is_correct IS TRUE THEN
      v_correct_cnt := v_correct_cnt + 1;
    END IF;
    v_auto_score := v_auto_score + COALESCE(v_points_earned, 0);

    UPDATE public.test_variant_answers
    SET is_correct     = v_is_correct,
        points_earned  = v_points_earned,
        points_max     = v_item.points,
        grading_status = 'auto_graded',
        submitted_at   = now()
    WHERE student_assignment_id = p_student_assignment_id
      AND variant_item_id = v_item.item_id;
  END LOOP;

  IF v_manual_rev_cnt > 0 THEN
    v_grading_status := 'needs_review';
    v_percentage := NULL;
  ELSE
    v_grading_status := 'auto_graded';
    IF v_total_max > 0 THEN
      v_percentage := ROUND(v_auto_score / v_total_max * 100, 2);
    ELSE
      v_percentage := NULL;
    END IF;
  END IF;

  UPDATE public.test_variant_student_assignments
  SET status              = 'submitted',
      submitted_at        = now(),
      completed_at        = now(),
      answered_count      = v_answered_cnt,
      correct_count       = v_correct_cnt,
      score               = v_auto_score,
      max_score           = v_total_max,
      percentage          = v_percentage,
      auto_score          = v_auto_score,
      manual_review_count = v_manual_rev_cnt,
      grading_status      = v_grading_status,
      attempts_used       = attempts_used + 1,
      updated_at          = now()
  WHERE id = p_student_assignment_id;

  RETURN jsonb_build_object(
    'status',               'submitted',
    'answered_count',       v_answered_cnt,
    'correct_count',        v_correct_cnt,
    'score',                v_auto_score,
    'max_score',            v_total_max,
    'percentage',           v_percentage,
    'grading_status',       v_grading_status,
    'manual_review_count',  v_manual_rev_cnt,
    'submitted_at',         now(),
    'completed_at',         now()
  );
END;
$function$;

revoke all on function public.variant_answer_alternatives(text) from public, anon;
grant execute on function public.variant_answer_alternatives(text) to authenticated;
