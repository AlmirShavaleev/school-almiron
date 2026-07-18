-- 1. modules_manage_teacher
DROP POLICY IF EXISTS modules_manage_teacher ON public.modules;
CREATE POLICY modules_manage_teacher ON public.modules
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1
      FROM courses c
      JOIN groups g ON g.course_id = c.id
      JOIN teachers t ON t.id = g.teacher_id
      WHERE c.id = modules.course_id AND t.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = modules.course_id AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM courses c
      JOIN groups g ON g.course_id = c.id
      JOIN teachers t ON t.id = g.teacher_id
      WHERE c.id = modules.course_id AND t.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = modules.course_id AND c.owner_id = auth.uid()
    )
  );

-- 2. topics_manage_teacher
DROP POLICY IF EXISTS topics_manage_teacher ON public.topics;
CREATE POLICY topics_manage_teacher ON public.topics
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1
      FROM modules m
      JOIN courses c ON c.id = m.course_id
      JOIN groups g ON g.course_id = c.id
      JOIN teachers t ON t.id = g.teacher_id
      WHERE m.id = topics.module_id AND t.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = topics.module_id AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM modules m
      JOIN courses c ON c.id = m.course_id
      JOIN groups g ON g.course_id = c.id
      JOIN teachers t ON t.id = g.teacher_id
      WHERE m.id = topics.module_id AND t.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = topics.module_id AND c.owner_id = auth.uid()
    )
  );

-- 3. topic_materials_manage_teacher
DROP POLICY IF EXISTS topic_materials_manage_teacher ON public.topic_materials;
CREATE POLICY topic_materials_manage_teacher ON public.topic_materials
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1
      FROM topics tp
      JOIN modules m ON m.id = tp.module_id
      JOIN courses c ON c.id = m.course_id
      JOIN groups g ON g.course_id = c.id
      JOIN teachers t ON t.id = g.teacher_id
      WHERE tp.id = topic_materials.topic_id AND t.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.topics tp
      JOIN public.modules m ON m.id = tp.module_id
      JOIN public.courses c ON c.id = m.course_id
      WHERE tp.id = topic_materials.topic_id AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM topics tp
      JOIN modules m ON m.id = tp.module_id
      JOIN courses c ON c.id = m.course_id
      JOIN groups g ON g.course_id = c.id
      JOIN teachers t ON t.id = g.teacher_id
      WHERE tp.id = topic_materials.topic_id AND t.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.topics tp
      JOIN public.modules m ON m.id = tp.module_id
      JOIN public.courses c ON c.id = m.course_id
      WHERE tp.id = topic_materials.topic_id AND c.owner_id = auth.uid()
    )
  );

-- 4. auth_is_staff_of_topic: owner-ветка + search_path 'public','pg_temp'
CREATE OR REPLACE FUNCTION public.auth_is_staff_of_topic(p_topic_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from topics tp
    join modules m on m.id = tp.module_id
    where tp.id = p_topic_id
      and (
        exists (
          select 1 from public.courses c
          where c.id = m.course_id and c.owner_id = auth.uid()
        )
        or exists (
          select 1
          from groups g
          where g.course_id = m.course_id
            and (
              exists (select 1 from teachers t where t.id = g.teacher_id and t.profile_id = auth.uid())
              or exists (select 1 from curators c where c.id = g.curator_id and c.profile_id = auth.uid())
            )
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.auth_is_staff_of_topic(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.auth_is_staff_of_topic(uuid) TO authenticated;
