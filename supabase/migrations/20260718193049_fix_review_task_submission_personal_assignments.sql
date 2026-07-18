CREATE OR REPLACE FUNCTION public.auth_can_review_task_submission(p_assigned_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from assigned_collections ac
    left join groups g on g.id = ac.group_id
    where ac.id = p_assigned_id
      and (
        ac.teacher_id = auth.uid()
        or exists (select 1 from teachers t where t.id = g.teacher_id and t.profile_id = auth.uid())
        or exists (select 1 from curators c where c.id = g.curator_id and c.profile_id = auth.uid())
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.auth_can_review_task_submission(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.auth_can_review_task_submission(uuid) TO authenticated;
