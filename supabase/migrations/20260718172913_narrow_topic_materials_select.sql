DROP POLICY IF EXISTS topic_materials_select ON public.topic_materials;
CREATE POLICY topic_materials_select ON public.topic_materials
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_owner()
    OR public.auth_is_staff_of_topic(topic_materials.topic_id)
    OR (
      public.auth_can_see_topic(topic_materials.topic_id)
      AND EXISTS (
        SELECT 1 FROM public.topics tp
        WHERE tp.id = topic_materials.topic_id
          AND (tp.available_from IS NULL OR tp.available_from <= CURRENT_DATE)
      )
    )
  );
