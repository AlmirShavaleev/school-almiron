-- Применено оркестратором 05.10.2026 через MCP apply_migration (§266, часть «trenirovochnye_uroki_sravnenie_otveta»). Версия совпадает с schema_migrations.

create or replace function public.autocheck_number_of(p_raw text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when x.s ~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$' then x.s::numeric end
    from (
      select regexp_replace(
               translate(public.normalize_variant_answer(coalesce(p_raw, '')), E'−–—', '---'),
               E'[\\s   ]', '', 'g') as s
    ) x;
$$;

create or replace function public.autocheck_digits_of(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when x.s ~ '^[0-9]+$' then x.s end
    from (select regexp_replace(coalesce(p_raw, ''), E'[\\s   ,;.]', '', 'g') as s) x;
$$;

create or replace function public.autocheck_sorted_chars(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select string_agg(c, '' order by c) from regexp_split_to_table(p, '') as c;
$$;

create or replace function public.autocheck_answer_correct(
  p_type text, p_value numeric, p_tol numeric, p_text text, p_any_order boolean, p_raw text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'number' then
      case when public.autocheck_number_of(p_raw) is null then null
           else abs(public.autocheck_number_of(p_raw) - p_value) <= coalesce(p_tol, 0) end
    when 'digits' then
      case when public.autocheck_digits_of(p_raw) is null then null
           when p_any_order then public.autocheck_sorted_chars(public.autocheck_digits_of(p_raw))
                                 = public.autocheck_sorted_chars(p_text)
           else public.autocheck_digits_of(p_raw) = p_text end
    else null
  end;
$$;

create or replace function public.topic_autocheck_task_topic(p_task_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$ select t.topic_id from topic_autocheck_tasks t where t.id = p_task_id $$;

create or replace function public.topic_autocheck_task_can_manage(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select public.topic_material_can_manage(public.topic_autocheck_task_topic(p_task_id)) $$;

create or replace function public.topic_autocheck_task_closed(p_task_id uuid, p_profile_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(bool_or(a.is_correct) or count(*) >= 3, false)
    from topic_autocheck_answers a
   where a.task_id = p_task_id and a.profile_id = p_profile_id;
$$;

create or replace function public._topic_autocheck_student_of(p_topic_id uuid, p_profile_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.id
    from students s
    join group_students gs on gs.student_id = s.id
    join groups g          on g.id = gs.group_id
   where s.profile_id = p_profile_id
     and g.course_id = public.course_of_topic(p_topic_id)
   order by s.id
   limit 1;
$$;
