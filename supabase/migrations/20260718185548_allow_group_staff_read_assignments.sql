CREATE OR REPLACE FUNCTION public.auth_is_group_staff_of_assignment(p_assigned_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.assigned_collections ac
    where ac.id = p_assigned_id
      and (
        (ac.group_id is not null
         and (public.auth_is_teacher_of_group(ac.group_id)
           or public.auth_is_curator_of_group(ac.group_id)))
        or (ac.student_id is not null and exists (
              select 1 from public.group_students gs
              where gs.student_id = ac.student_id
                and (public.auth_is_teacher_of_group(gs.group_id)
                  or public.auth_is_curator_of_group(gs.group_id))))
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.auth_is_group_staff_of_assignment(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.auth_is_group_staff_of_assignment(uuid) TO authenticated;

DROP POLICY IF EXISTS ac_teacher_select ON public.assigned_collections;
CREATE POLICY ac_teacher_select ON public.assigned_collections
  FOR SELECT
  TO public
  USING (
    (get_my_role() = 'teacher'::user_role AND teacher_id = auth.uid())
    OR (get_my_role() IN ('teacher'::user_role, 'curator'::user_role)
        AND public.auth_is_group_staff_of_assignment(id))
  );

DROP POLICY IF EXISTS acm_teacher_select ON public.assigned_collection_members;
CREATE POLICY acm_teacher_select ON public.assigned_collection_members
  FOR SELECT
  TO public
  USING (
    get_my_role() = ANY (ARRAY['teacher'::user_role, 'curator'::user_role])
    AND (
      public.auth_can_review_task_submission(assigned_id)
      OR public.auth_is_group_staff_of_assignment(assigned_id)
    )
  );
