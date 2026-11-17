CREATE OR REPLACE FUNCTION public.student_tmi_solution_topics()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with candidates as materialized (
    select c.topic_id from public.student_candidate_topics() as c(topic_id)
  ),
  accepted_topics as materialized (
    select distinct h.topic_id
      from public.topic_homework_attempts a
      join public.topic_homework h on h.id = a.homework_id
     where a.student_id = (select public.auth_student_id())
       and a.status = 'accepted'
  )
  select coalesce(array_agg(c.topic_id), '{}'::uuid[])
    from candidates c
   where public.topic_autocheck_solutions_unlocked(c.topic_id)
     and ((select exists (
           select 1 from public.app_feature_flags f
            where f.key = 'read_only_mode' and f.enabled
         ))
      or not exists (select 1 from public.topic_homework h where h.topic_id = c.topic_id)
      or c.topic_id in (select a.topic_id from accepted_topics a));
$function$
