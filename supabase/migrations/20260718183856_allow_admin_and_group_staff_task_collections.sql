-- 1. Новая функция: teacher/curator группы, которой назначена коллекция
CREATE OR REPLACE FUNCTION public.auth_is_group_staff_of_collection(p_collection_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.assigned_collections ac
    WHERE ac.collection_id = p_collection_id
      AND ac.group_id IS NOT NULL
      AND (public.auth_is_teacher_of_group(ac.group_id) OR public.auth_is_curator_of_group(ac.group_id))
  );
$function$;

REVOKE ALL ON FUNCTION public.auth_is_group_staff_of_collection(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.auth_is_group_staff_of_collection(uuid) TO authenticated;

-- 2. task_collections: 4 политики
DROP POLICY IF EXISTS tc_select ON public.task_collections;
CREATE POLICY tc_select ON public.task_collections
  FOR SELECT
  TO public
  USING (
    created_by = auth.uid()
    OR is_admin_or_owner()
    OR auth_is_group_staff_of_collection(id)
  );

DROP POLICY IF EXISTS tc_insert ON public.task_collections;
CREATE POLICY tc_insert ON public.task_collections
  FOR INSERT
  TO public
  WITH CHECK (
    created_by = auth.uid()
    OR is_admin_or_owner()
  );

DROP POLICY IF EXISTS tc_update ON public.task_collections;
CREATE POLICY tc_update ON public.task_collections
  FOR UPDATE
  TO public
  USING (
    created_by = auth.uid()
    OR is_admin_or_owner()
  )
  WITH CHECK (
    created_by = auth.uid()
    OR is_admin_or_owner()
  );

DROP POLICY IF EXISTS tc_delete ON public.task_collections;
CREATE POLICY tc_delete ON public.task_collections
  FOR DELETE
  TO public
  USING (
    created_by = auth.uid()
    OR is_admin_or_owner()
  );

-- 3. task_collection_items: те же 4 политики через материнскую таблицу
DROP POLICY IF EXISTS tci_select ON public.task_collection_items;
CREATE POLICY tci_select ON public.task_collection_items
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.task_collections tc
      WHERE tc.id = task_collection_items.collection_id
        AND (
          tc.created_by = auth.uid()
          OR is_admin_or_owner()
          OR auth_is_group_staff_of_collection(tc.id)
        )
    )
  );

DROP POLICY IF EXISTS tci_insert ON public.task_collection_items;
CREATE POLICY tci_insert ON public.task_collection_items
  FOR INSERT
  TO public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.task_collections tc
      WHERE tc.id = task_collection_items.collection_id
        AND (tc.created_by = auth.uid() OR is_admin_or_owner())
    )
  );

DROP POLICY IF EXISTS tci_update ON public.task_collection_items;
CREATE POLICY tci_update ON public.task_collection_items
  FOR UPDATE
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.task_collections tc
      WHERE tc.id = task_collection_items.collection_id
        AND (tc.created_by = auth.uid() OR is_admin_or_owner())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.task_collections tc
      WHERE tc.id = task_collection_items.collection_id
        AND (tc.created_by = auth.uid() OR is_admin_or_owner())
    )
  );

DROP POLICY IF EXISTS tci_delete ON public.task_collection_items;
CREATE POLICY tci_delete ON public.task_collection_items
  FOR DELETE
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.task_collections tc
      WHERE tc.id = task_collection_items.collection_id
        AND (tc.created_by = auth.uid() OR is_admin_or_owner())
    )
  );
