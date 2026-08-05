-- Формат ЕГЭ «значение и погрешность слитно»: №19 физики ЕГЭ, 81 задача с
-- эталонами вида «3,80,1» (= 3,8 и 0,1). В §71 это было записано как порча
-- импорта; каталог (§92) разобрался — это формат источника, а не мусор.
--
-- Разбиение синтаксически неоднозначно, и это не теория: при наивном правиле
-- «любой разрез на два числа» 41 эталон из 81 читается двумя способами
-- («0,150,005» → 0,1 ± 50,005 либо 0,15 ± 0,005). Однозначность даёт пара
-- ограничений, проверенных на всех 81:
--
--   1. Обе части в канонической записи — без лишних ведущих нулей. Это снимает
--      разрезы вроде «0,10» + «00,005» и убирает 30 из 41 неоднозначности.
--   2. Значение не меньше погрешности. Снимает остальные 11: у каждой
--      альтернативы вида «0,1 ± 8750,0125» погрешность больше значения, что для
--      измерения бессмысленно.
--
-- Итог на проде: 81 из 81 разбирается ЕДИНСТВЕННЫМ способом. Поэтому сравнение
-- идёт по двум числам, а не по слитной строке целиком: требовать от ученика
-- набрать «3,80,1» без разделителя было бы издевательством.
--
-- Функция возвращает NULL, если разрезов не один: неоднозначное — в ручную
-- проверку, как и было. Это её единственный режим отказа, и он безопасный.
--
-- Правило одно на пул и на зачёт (урок §62 и §66): can_auto_check и verdict
-- спрашивают одну и ту же функцию, копий нет.

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

comment on function public.variant_answer_value_error_pair(text) is
  'Значение и погрешность, слитно записанные в эталоне («3,80,1» → 3.8 и 0.1). NULL, если разбор не единственный — тогда задача идёт в ручную проверку.';

create or replace function public.variant_answer_can_auto_check(p_correct_norm text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select p_correct_norm is not null
     and (public.variant_answer_alternatives(p_correct_norm)     is not null
       or public.variant_answer_required_set(p_correct_norm)     is not null
       or public.variant_answer_value_error_pair(p_correct_norm) is not null
       or p_correct_norm in ('да', 'нет'));
$$;

comment on function public.variant_answer_can_auto_check(text) is
  'Поддаётся ли эталон автопроверке. Единственный источник правды для пула автосборки и для submit_variant.';

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

comment on function public.variant_answer_verdict(text, text) is
  'Верен ли ответ ученика. NULL — эталон автопроверке не поддаётся, задача не должна была попасть в автосборку.';

revoke all on function public.variant_answer_value_error_pair(text) from public, anon;
grant execute on function public.variant_answer_value_error_pair(text) to authenticated;
