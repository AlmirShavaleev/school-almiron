-- Дословно из supabase/migrations (последние редакции):
-- normalize_variant_answer — 20260803163437; variant_answer_alternatives — 20260803164236;
-- required_set / student_set — 20260803214142; value_error_pair / verdict — 20260805223728.
CREATE OR REPLACE FUNCTION public.normalize_variant_answer(raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT lower(
    btrim(
      regexp_replace(
        replace(raw, ',', '.'),
        '\s+', ' ', 'g'
      )
    )
  );
$function$;
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
create or replace function public.variant_answer_value_error_pair(p_correct_norm text)
returns numeric[]
language sql
immutable
set search_path to ''
as $$
  with valid as (
    select left(p_correct_norm, i) lft, substr(p_correct_norm, i + 1) rgt
    from generate_series(1, coalesce(length(p_correct_norm), 0) - 1) i
    -- Каноническая запись обеих частей: «00,005» не число, а след неверного реза.
    where left(p_correct_norm, i)       ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      and substr(p_correct_norm, i + 1) ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      -- Погрешность не бывает больше самого значения.
      and left(p_correct_norm, i)::numeric >= substr(p_correct_norm, i + 1)::numeric
  )
  select case
    -- Одиночное число разбирать нечего: им занимается variant_answer_alternatives.
    -- Проверка стоит здесь, а не в порядке ветвей, чтобы перестановка ветвей
    -- когда-нибудь не превратила ответ «125» в «12 ± 5».
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?$' then null
    when count(*) = 1 then array[min(lft)::numeric, min(rgt)::numeric]
    else null
  end
  from valid;
$$;
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
    -- Все значения обязательны, порядок не важен («19; 11», «-6; 7»).
    when public.variant_answer_required_set(p_correct_norm) is not null then
      coalesce(
        public.variant_answer_student_set(p_student_norm)
          = public.variant_answer_required_set(p_correct_norm),
        false)
    -- Значение и погрешность: нужны ОБЕ части и именно в этом порядке.
    -- Разделитель у ученика любой разумный — пробел, точка с запятой, «±», —
    -- либо слитно, как в эталоне.
    when public.variant_answer_value_error_pair(p_correct_norm) is not null then
      coalesce(
        p_student_norm = p_correct_norm
        or (
          p_student_norm ~ '^[0-9]+(\.[0-9]+)?[ ;±]+[0-9]+(\.[0-9]+)?$'
          and (regexp_split_to_array(p_student_norm, '[ ;±]+'))[1]::numeric
              = (public.variant_answer_value_error_pair(p_correct_norm))[1]
          and (regexp_split_to_array(p_student_norm, '[ ;±]+'))[2]::numeric
              = (public.variant_answer_value_error_pair(p_correct_norm))[2]
        ),
        false)
    -- Да/нет: точное совпадение, регистр уже снят нормализацией.
    when p_correct_norm in ('да', 'нет') then
      (p_student_norm = p_correct_norm)
    else null
  end;
$$;
revoke all on function public.variant_answer_required_set(text) from public, anon;
revoke all on function public.variant_answer_student_set(text)  from public, anon;
revoke all on function public.variant_answer_verdict(text, text) from public, anon;

grant execute on function public.variant_answer_required_set(text) to authenticated;
grant execute on function public.variant_answer_student_set(text)  to authenticated;
grant execute on function public.variant_answer_verdict(text, text) to authenticated;
revoke all on function public.variant_answer_value_error_pair(text) from public, anon;
grant execute on function public.variant_answer_value_error_pair(text) to authenticated;
revoke all on function public.variant_answer_alternatives(text) from public, anon; grant execute on function public.variant_answer_alternatives(text) to authenticated;
