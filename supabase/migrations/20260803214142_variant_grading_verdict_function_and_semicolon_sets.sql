-- Класс «точка с запятой» из разбора §62: «19; 11» — основания трапеции,
-- «-6; 7» — корни уравнения, «14; 12.5; 29.4; 16.9» — стороны трапеции.
-- Здесь нужны ВСЕ значения, порядок не важен. Это противоположность классу
-- «через пробел», где засчитывается любое из эквивалентных.
--
-- Заодно решение о зачёте вынесено в одну функцию variant_answer_verdict.
-- До этого правило жило прямо в теле submit_variant, и каждый новый класс
-- эталонов требовал переписывать функцию на 200 строк целиком ради двух строк
-- — верный способ однажды потерять по дороге ветку partial_type.
--
-- Теперь submit_variant только делегирует, а пул автосборки спрашивает
-- variant_answer_can_auto_check. Одно правило на оба места.

-- Все значения обязательны: эталон через точку с запятой.
create or replace function public.variant_answer_required_set(p_correct_norm text)
returns numeric[]
language sql
immutable
set search_path to ''
as $$
  select case
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?( *; *-?[0-9]+(\.[0-9]+)?)+$'
      then (select array_agg(el::numeric order by el::numeric)
            from regexp_split_to_table(p_correct_norm, ' *; *') el)
    else null
  end;
$$;

comment on function public.variant_answer_required_set(text) is
  'Набор значений, которые ученик обязан назвать все. Порядок не важен — массив отсортирован.';

-- Ответ ученика как набор чисел. Разделителем принимаем и пробел, и точку с
-- запятой: заставлять угадывать пунктуацию эталона нечестно.
create or replace function public.variant_answer_student_set(p_student_norm text)
returns numeric[]
language sql
immutable
set search_path to ''
as $$
  select case
    when p_student_norm ~ '^-?[0-9]+(\.[0-9]+)?$'
      then array[p_student_norm::numeric]
    when p_student_norm ~ '^-?[0-9]+(\.[0-9]+)?([ ;]+-?[0-9]+(\.[0-9]+)?)+$'
      then (select array_agg(el::numeric order by el::numeric)
            from regexp_split_to_table(p_student_norm, '[ ;]+') el)
    else null
  end;
$$;

comment on function public.variant_answer_student_set(text) is
  'Ответ ученика как отсортированный набор чисел. NULL — не разбирается.';

create or replace function public.variant_answer_can_auto_check(p_correct_norm text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select p_correct_norm is not null
     and (public.variant_answer_alternatives(p_correct_norm)  is not null
       or public.variant_answer_required_set(p_correct_norm)  is not null);
$$;

comment on function public.variant_answer_can_auto_check(text) is
  'Поддаётся ли эталон автопроверке. Единственный источник правды для пула автосборки и для submit_variant.';

-- NULL — проверить нельзя; true/false — вердикт.
create or replace function public.variant_answer_verdict(
  p_correct_norm text,
  p_student_norm text
) returns boolean
language sql
immutable
set search_path to ''
as $$
  select case
    -- Любое из эквивалентных значений («13 31», «0.004 -0.004», одно число).
    when public.variant_answer_alternatives(p_correct_norm) is not null then
      coalesce(
        p_student_norm ~ '^-?[0-9]+(\.[0-9]+)?$'
        and p_student_norm::numeric = any (public.variant_answer_alternatives(p_correct_norm)),
        false)
    -- Все значения обязательны, порядок не важен.
    when public.variant_answer_required_set(p_correct_norm) is not null then
      coalesce(
        public.variant_answer_student_set(p_student_norm)
          = public.variant_answer_required_set(p_correct_norm),
        false)
    else null
  end;
$$;

comment on function public.variant_answer_verdict(text, text) is
  'Верен ли ответ ученика. NULL — эталон автопроверке не поддаётся, задача не должна была попасть в автосборку.';

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
    else public.variant_answer_can_auto_check(
           public.normalize_variant_answer(public.strip_html_simple(p_answer_html)))
  end;
$$;

comment on function public.variant_answer_is_auto_checkable(text, text) is
  'Сможет ли submit_variant проверить эталон этой задачи сам. Общий предикат для сэмплера и счётчиков доступности.';

-- ── submit_variant теперь только делегирует ──────────────────────────────────

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
      v_auto_check := public.variant_answer_can_auto_check(v_correct_norm);
    ELSE
      v_correct_norm := NULL;
      v_auto_check   := false;
    END IF;

    IF v_item.partial_type IS NOT NULL AND v_correct_norm IS NOT NULL THEN
      v_partial_score := public.score_auto_answer(v_student_norm, v_correct_norm, v_item.partial_type);
      v_is_correct    := (v_partial_score = 2);
      v_points_earned := ROUND((v_partial_score::numeric / 2) * v_item.points, 2);
    ELSIF v_auto_check THEN
      v_is_correct    := COALESCE(public.variant_answer_verdict(v_correct_norm, v_student_norm), false);
      v_points_earned := CASE WHEN v_is_correct THEN v_item.points::numeric ELSE 0 END;
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

revoke all on function public.variant_answer_required_set(text) from public, anon;
revoke all on function public.variant_answer_student_set(text)  from public, anon;
revoke all on function public.variant_answer_can_auto_check(text) from public, anon;
revoke all on function public.variant_answer_verdict(text, text) from public, anon;

grant execute on function public.variant_answer_required_set(text) to authenticated;
grant execute on function public.variant_answer_student_set(text)  to authenticated;
grant execute on function public.variant_answer_can_auto_check(text) to authenticated;
grant execute on function public.variant_answer_verdict(text, text) to authenticated;
