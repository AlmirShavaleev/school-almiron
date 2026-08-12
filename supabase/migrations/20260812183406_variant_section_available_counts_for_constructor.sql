-- Карточка раздела в конструкторе показывала общее число задач, а генератор
-- берёт только автопроверяемые. У №21 «Качественная задача» карточка обещала
-- «4 задач», а сборка отвечала «доступно 0». Интерфейс и база спорили — §94.
--
-- Источник счётчика теперь один и тот же, что у выборки: та же функция
-- variant_answer_is_auto_checkable, которой живут пул автосборки и вердикт
-- submit_variant. Второй копии правила не заводим (§62, §66, §96).
--
-- Возвращаем ОБА числа. Общее нужно, чтобы отличить «раздела нет задач вовсе»
-- от «задачи есть, но автопроверке не поддаются»: первое прячем из выбора,
-- второе показываем честно с нулём — учитель должен видеть, что раздел
-- существует, но собрать из него нечего.
--
-- Состояние физики ЕГЭ на момент правки: доступных ноль ровно у трёх разделов —
-- №21 «Качественная задача» (4 задачи, все вторая часть), №23 «МКТ и
-- Термодинамика. Электродинамика» (51) и «Задачи старого формата ЕГЭ» (задач
-- нет вовсе). У прочих разделов второй части доступное есть, хоть и немного:
-- №22 — 11, №25 — 8, №26 — 5, №24 — 1.

create or replace function public.variant_section_available_counts(
  p_subject   text,
  p_exam_type text
) returns table (
  section_id uuid,
  total      integer,
  available  integer
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
        and public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type)
    )::integer
  from public.catalog_sections cs
  left join public.catalog_tasks ct on ct.section_id = cs.id
  where cs.subject = p_subject
    and cs.exam_type = p_exam_type
  group by cs.id;
$$;

comment on function public.variant_section_available_counts(text, text) is
  'Сколько задач в разделе всего и сколько из них годится для автосборки. Один источник счётчика для карточки, пресетов и выборки.';

revoke all on function public.variant_section_available_counts(text, text) from public, anon;
grant execute on function public.variant_section_available_counts(text, text) to authenticated;
