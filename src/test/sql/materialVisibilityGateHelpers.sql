CREATE OR REPLACE FUNCTION public.topic_is_timed(p_topic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from topics t where t.id = p_topic_id and t.kind in ('check', 'control')
  );
$function$;

CREATE OR REPLACE FUNCTION public.topic_homework_is_timed(p_homework_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from topic_homework h join topics t on t.id = h.topic_id
     where h.id = p_homework_id and t.kind in ('check', 'control')
  );
$function$;

CREATE OR REPLACE FUNCTION public.topic_homework_condition_open(p_homework_id uuid, p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when not public.topic_homework_is_timed(p_homework_id) then true
    else coalesce((
      select w.opens_at <= now()
        from public.topic_homework_student_window(p_homework_id, p_student_id) w
    ), false)
    or exists (
      select 1 from topic_homework_attempts a
       where a.homework_id = p_homework_id and a.student_id = p_student_id
         and a.status <> 'draft'
    )
  end;
$function$;

CREATE OR REPLACE FUNCTION public.topic_condition_visible(p_topic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select not public.topic_is_timed(p_topic_id)
      or exists (
        select 1 from topic_homework h
         where h.topic_id = p_topic_id
           and public.topic_homework_condition_open(h.id, public.auth_student_id())
      );
$function$;

CREATE OR REPLACE FUNCTION public.topic_solution_unlocked(p_topic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    exists (
      select 1 from app_feature_flags f where f.key = 'read_only_mode' and f.enabled
    )
    or not exists (
      select 1 from topic_homework h where h.topic_id = p_topic_id
    )
    or exists (
      select 1
        from topic_homework_attempts a
        join topic_homework h on h.id = a.homework_id
       where h.topic_id = p_topic_id
         and a.student_id = public.auth_student_id()
         and a.status = 'accepted'
    );
$function$;
