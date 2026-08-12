-- Счётчик из §125 считал по одному правилу — автопроверяемости. После перехода
-- на двойное правило он снова разошёлся бы с генератором: у раздела второй
-- части показывал бы ноль там, где выборка берёт задачи по критериям.
--
-- Считает та же variant_task_eligible, что и генератор. Числа разложены по
-- частям: в разделах №13–19 математики лежит смесь, и одно общее число снова
-- скрыло бы, из чего именно соберётся вариант.

drop function if exists public.variant_section_available_counts(text, text);

create function public.variant_section_available_counts(
  p_subject   text,
  p_exam_type text
) returns table (
  section_id    uuid,
  total         integer,
  available     integer,
  available_p1  integer,
  available_p2  integer
)
language sql
stable
set search_path to ''
as $$
  select
    cs.id,
    count(ct.id) filter (where ct.is_published)::integer,
    count(ct.id) filter (
      where ct.is_published
        and public.variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type,
                                         ct.grade_criteria_html, ct.max_points)
    )::integer,
    count(ct.id) filter (
      where ct.is_published and ct.exam_part is distinct from 2
        and public.variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type,
                                         ct.grade_criteria_html, ct.max_points)
    )::integer,
    count(ct.id) filter (
      where ct.is_published and ct.exam_part = 2
        and public.variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type,
                                         ct.grade_criteria_html, ct.max_points)
    )::integer
  from public.catalog_sections cs
  left join public.catalog_tasks ct on ct.section_id = cs.id
  where cs.subject = p_subject
    and cs.exam_type = p_exam_type
  group by cs.id;
$$;

comment on function public.variant_section_available_counts(text, text) is
  'Задачи раздела: всего, годных в вариант и с разбивкой по частям. Считает variant_task_eligible — та же, что и генератор.';

revoke all on function public.variant_section_available_counts(text, text) from public, anon;
grant execute on function public.variant_section_available_counts(text, text) to authenticated;
