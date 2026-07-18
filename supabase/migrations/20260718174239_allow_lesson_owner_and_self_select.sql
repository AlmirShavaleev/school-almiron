DROP POLICY IF EXISTS lessons_select_member ON public.lessons;
CREATE POLICY lessons_select_member ON public.lessons
  FOR SELECT
  TO public
  USING (
    is_admin_or_owner()
    OR auth_is_teacher_of_group(group_id)
    OR auth_is_curator_of_group(group_id)
    OR auth_is_student_in_group(group_id)
    OR (student_id IS NOT NULL AND student_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = lessons.teacher_id AND t.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = lessons.course_id AND c.owner_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.auth_is_staff_of_lesson(les_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM lessons l
      LEFT JOIN groups g   ON g.id = l.group_id
      LEFT JOIN teachers t ON t.id = COALESCE(l.teacher_id, g.teacher_id)
      LEFT JOIN curators c ON c.id = g.curator_id
    WHERE l.id = les_id
      AND (t.profile_id = auth.uid() OR c.profile_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    JOIN public.courses c ON c.id = l.course_id
    WHERE l.id = les_id AND c.owner_id = auth.uid()
  )
$function$;

REVOKE ALL ON FUNCTION public.auth_is_staff_of_lesson(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.auth_is_staff_of_lesson(uuid) TO authenticated;
