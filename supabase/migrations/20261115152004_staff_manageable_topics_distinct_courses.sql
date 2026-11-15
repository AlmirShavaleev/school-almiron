-- 15.11. staff_manageable_topics(): course_is_staff() вызывается по разу на курс,
-- а не на каждую строку modules (153 строки → ~20 курсов). Функция входит в
-- политики SELECT topic_homework, topic_material_items, topic_test_assignments,
-- course_lessons и т. д. и вычисляется в КАЖДОМ запросе к ним — в том числе
-- у ученика, у которого результат всегда пустой: было ~33 мс на запрос,
-- стало ~5 мс. Результат тот же (сверено на 73 учётках: админы, владелец,
-- преподаватели, кураторы, 60 учеников). Набор курсов берётся из modules,
-- как раньше (а не из courses), — чтобы и сироты-модули давали то же самое.
-- materialized: иначе планировщик может протолкнуть условие внутрь DISTINCT
-- и снова звать course_is_staff на каждую строку.
create or replace function public.staff_manageable_topics()
returns uuid[]
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with course_ids as materialized (
    select distinct m.course_id from modules m where m.course_id is not null
  )
  select coalesce(array_agg(tp.id), '{}'::uuid[])
    from topics tp
    join modules m on m.id = tp.module_id
   where m.course_id = any (array(
           select ci.course_id from course_ids ci
            where public.course_is_staff(ci.course_id)));
$function$;
