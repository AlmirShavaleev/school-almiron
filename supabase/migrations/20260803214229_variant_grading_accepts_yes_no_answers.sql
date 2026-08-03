-- Класс «да»/«нет» из разбора §62: 178 задач (97 «нет», 81 «да»). Решение
-- владельца — включить точным сравнением после нормализации регистра.
-- Эквивалентности здесь не нужны: допустимых строк ровно две, вариантов записи
-- нет, риска подарить полбалла нет.
--
-- Строго «да» или «нет» и ничего кроме. Родственные формулировки из каталога
-- («нет. нельзя» — 12 задач, «нет. не может» — 9) сознательно НЕ включены: там
-- за первым словом идёт обоснование, и засчитывать по первому слову значит
-- зачесть ответ, обоснования не проверив.
--
-- Остальные 431 текстовые («задача на доказательство», «доказательство»,
-- «задача на построение», «рисунок») автопроверке не подлежат никогда —
-- подтверждено владельцем, место им вне автосборки.

create or replace function public.variant_answer_can_auto_check(p_correct_norm text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select p_correct_norm is not null
     and (public.variant_answer_alternatives(p_correct_norm) is not null
       or public.variant_answer_required_set(p_correct_norm) is not null
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
    -- Да/нет: точное совпадение, регистр уже снят нормализацией.
    when p_correct_norm in ('да', 'нет') then
      (p_student_norm = p_correct_norm)
    else null
  end;
$$;

comment on function public.variant_answer_verdict(text, text) is
  'Верен ли ответ ученика. NULL — эталон автопроверке не поддаётся, задача не должна была попасть в автосборку.';
