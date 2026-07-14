begin;

alter table public.catalog_tasks
  add column if not exists partial_type text
  check (partial_type in ('multi_choice', 'matching') or partial_type is null);

comment on column public.catalog_tasks.partial_type is
  'Autograding mode for physics part 1 partial scoring: multi_choice | matching | null';

with physics_partial_map as (
  select *
  from (
    values
      ('Физика'::text, 'ЕГЭ'::text,  5::int, 'multi_choice'::text, 2::int),
      ('Физика'::text, 'ЕГЭ'::text,  9::int, 'multi_choice'::text, 2::int),
      ('Физика'::text, 'ЕГЭ'::text, 14::int, 'multi_choice'::text, 2::int),
      ('Физика'::text, 'ЕГЭ'::text, 18::int, 'multi_choice'::text, 2::int),
      ('Физика'::text, 'ЕГЭ'::text,  6::int, 'matching'::text, 2::int),
      ('Физика'::text, 'ЕГЭ'::text, 10::int, 'matching'::text, 2::int),
      ('Физика'::text, 'ЕГЭ'::text, 15::int, 'matching'::text, 2::int),
      ('Физика'::text, 'ЕГЭ'::text, 17::int, 'matching'::text, 2::int),
      ('Физика'::text, 'ОГЭ'::text,  1::int, 'matching'::text, 2::int),
      ('Физика'::text, 'ОГЭ'::text,  2::int, 'matching'::text, 2::int),
      ('Физика'::text, 'ОГЭ'::text,  4::int, 'matching'::text, 2::int),
      ('Физика'::text, 'ОГЭ'::text, 12::int, 'matching'::text, 2::int),
      ('Физика'::text, 'ОГЭ'::text, 13::int, 'matching'::text, 2::int),
      ('Физика'::text, 'ОГЭ'::text, 14::int, 'multi_choice'::text, 2::int),
      ('Физика'::text, 'ОГЭ'::text, 16::int, 'multi_choice'::text, 2::int)
  ) as m(subject, exam_type, section_external_id, partial_type, max_points)
)
update public.catalog_tasks t
set
  partial_type = m.partial_type,
  max_points = m.max_points
from public.catalog_sections s
join physics_partial_map m
  on m.subject = s.subject
 and m.exam_type = s.exam_type
 and m.section_external_id = s.external_id
where t.section_id = s.id;

update public.catalog_tasks t
set partial_type = null
from public.catalog_sections s
where t.section_id = s.id
  and not exists (
    select 1
    from (
      values
        ('Физика'::text, 'ЕГЭ'::text,  5::int),
        ('Физика'::text, 'ЕГЭ'::text,  6::int),
        ('Физика'::text, 'ЕГЭ'::text,  9::int),
        ('Физика'::text, 'ЕГЭ'::text, 10::int),
        ('Физика'::text, 'ЕГЭ'::text, 14::int),
        ('Физика'::text, 'ЕГЭ'::text, 15::int),
        ('Физика'::text, 'ЕГЭ'::text, 17::int),
        ('Физика'::text, 'ЕГЭ'::text, 18::int),
        ('Физика'::text, 'ОГЭ'::text,  1::int),
        ('Физика'::text, 'ОГЭ'::text,  2::int),
        ('Физика'::text, 'ОГЭ'::text,  4::int),
        ('Физика'::text, 'ОГЭ'::text, 12::int),
        ('Физика'::text, 'ОГЭ'::text, 13::int),
        ('Физика'::text, 'ОГЭ'::text, 14::int),
        ('Физика'::text, 'ОГЭ'::text, 16::int)
    ) keep(subject, exam_type, section_external_id)
    where keep.subject = s.subject
      and keep.exam_type = s.exam_type
      and keep.section_external_id = s.external_id
  );

create or replace function public.normalize_answer_digits(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p_value, ''), '\D', '', 'g')
$$;

create or replace function public.score_partial_multi_choice(
  p_student_raw text,
  p_correct_raw text
)
returns integer
language plpgsql
immutable
as $$
declare
  v_student text := public.normalize_answer_digits(p_student_raw);
  v_correct text := public.normalize_answer_digits(p_correct_raw);
  v_symdiff_count integer;
begin
  if v_student = '' or v_correct = '' then
    return 0;
  end if;

  with student_digits as (
    select ch, count(*) as cnt
    from regexp_split_to_table(v_student, '') ch
    where ch <> ''
    group by ch
  ),
  correct_digits as (
    select ch, count(*) as cnt
    from regexp_split_to_table(v_correct, '') ch
    where ch <> ''
    group by ch
  ),
  merged as (
    select
      coalesce(s.ch, c.ch) as ch,
      coalesce(s.cnt, 0) as student_cnt,
      coalesce(c.cnt, 0) as correct_cnt
    from student_digits s
    full join correct_digits c using (ch)
  )
  select coalesce(sum(abs(student_cnt - correct_cnt)), 0)
    into v_symdiff_count
  from merged;

  if v_symdiff_count = 0 then
    return 2;
  elsif v_symdiff_count = 1 then
    return 1;
  else
    return 0;
  end if;
end;
$$;

create or replace function public.score_partial_matching(
  p_student_raw text,
  p_correct_raw text
)
returns integer
language plpgsql
immutable
as $$
declare
  v_student text := public.normalize_answer_digits(p_student_raw);
  v_correct text := public.normalize_answer_digits(p_correct_raw);
  v_len_student integer := char_length(v_student);
  v_len_correct integer := char_length(v_correct);
  v_mismatches integer := 0;
  i integer;
begin
  if v_student = '' or v_correct = '' then
    return 0;
  end if;

  if v_len_student > v_len_correct then
    return 0;
  end if;

  for i in 1..v_len_correct loop
    if substr(v_student, i, 1) is distinct from substr(v_correct, i, 1) then
      v_mismatches := v_mismatches + 1;
    end if;
  end loop;

  if v_mismatches = 0 then
    return 2;
  elsif v_mismatches = 1 then
    return 1;
  else
    return 0;
  end if;
end;
$$;

create or replace function public.score_auto_answer(
  p_student_raw text,
  p_correct_raw text,
  p_partial_type text
)
returns integer
language plpgsql
immutable
as $$
begin
  case p_partial_type
    when 'multi_choice' then
      return public.score_partial_multi_choice(p_student_raw, p_correct_raw);
    when 'matching' then
      return public.score_partial_matching(p_student_raw, p_correct_raw);
    else
      if public.normalize_answer_digits(p_student_raw) = public.normalize_answer_digits(p_correct_raw)
         and public.normalize_answer_digits(p_correct_raw) <> '' then
        return 1;
      else
        return 0;
      end if;
  end case;
end;
$$;

-- NOTE:
-- The current body of public.submit_variant(...) is not versioned in this repo.
-- Apply the new scoring inside that function in the live DB using:
--
--   public.score_auto_answer(
--     tva.answer_raw,
--     ct.answer_html,
--     ct.partial_type
--   )
--
-- and source max points from ct.max_points for auto-graded tasks.

commit;
