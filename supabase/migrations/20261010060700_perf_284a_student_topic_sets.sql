-- §284 (часть A): наборы тем ученика — считаются ОДИН раз на запрос (initplan),
-- а не на каждую строку topic_material_items. Только добавление функций.
create or replace function public.student_candidate_topics()
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select tp.id
    from topics tp
    join modules m on m.id = tp.module_id
   where m.course_id in (
           select g.course_id from group_students gs join groups g on g.id = gs.group_id
            where gs.student_id = public.auth_student_id()
           union
           select sc.course_id from student_courses sc
            where sc.student_id = public.auth_student_id()
         );
$$;

create or replace function public.student_tmi_visible_topics()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(t), '{}'::uuid[])
    from public.student_candidate_topics() t
   where public.course_student_can_see_topic(t);
$$;

create or replace function public.student_tmi_solution_topics()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(t), '{}'::uuid[])
    from public.student_candidate_topics() t
   where public.topic_solution_unlocked(t);
$$;

create or replace function public.student_tmi_condition_topics()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(t), '{}'::uuid[])
    from public.student_candidate_topics() t
   where public.topic_condition_visible(t);
$$;

revoke all on function public.student_candidate_topics()     from public, anon;
revoke all on function public.student_tmi_visible_topics()   from public, anon;
revoke all on function public.student_tmi_solution_topics()  from public, anon;
revoke all on function public.student_tmi_condition_topics() from public, anon;
grant execute on function public.student_candidate_topics()     to authenticated;
grant execute on function public.student_tmi_visible_topics()   to authenticated;
grant execute on function public.student_tmi_solution_topics()  to authenticated;
grant execute on function public.student_tmi_condition_topics() to authenticated;
