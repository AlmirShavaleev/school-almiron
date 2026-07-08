-- ============================================================
-- Task Collections — teacher-curated sets of catalog tasks
-- ============================================================

-- ── 1. Custom type for atomic RPC input ──────────────────────
CREATE TYPE public.collection_item_input AS (
  catalog_task_id UUID,
  position        INTEGER,
  custom_number   TEXT
);

-- ── 2. task_collections ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_collections (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  description TEXT,
  subject     TEXT        NOT NULL,
  work_type   TEXT        NOT NULL DEFAULT 'custom',
  pdf_config  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_archived BOOLEAN     NOT NULL DEFAULT false
);

CREATE TRIGGER task_collections_updated_at
  BEFORE UPDATE ON public.task_collections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. task_collection_items ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_collection_items (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id   UUID        NOT NULL REFERENCES public.task_collections(id) ON DELETE CASCADE,
  catalog_task_id UUID        NOT NULL REFERENCES public.catalog_tasks(id)    ON DELETE RESTRICT,
  position        INTEGER     NOT NULL CHECK (position > 0),
  custom_number   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- one task per collection, one slot per position
  UNIQUE (collection_id, catalog_task_id),
  UNIQUE (collection_id, position)
);

-- ── 4. Indexes ────────────────────────────────────────────────
CREATE INDEX idx_task_collections_created_by ON public.task_collections (created_by);
CREATE INDEX idx_task_collection_items_collection ON public.task_collection_items (collection_id, position);
CREATE INDEX idx_task_collection_items_task ON public.task_collection_items (catalog_task_id);

-- ── 5. RLS ────────────────────────────────────────────────────
ALTER TABLE public.task_collections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_collection_items ENABLE ROW LEVEL SECURITY;

-- task_collections: creator-only
CREATE POLICY "tc_select" ON public.task_collections
  FOR SELECT USING (created_by = auth.uid());

CREATE POLICY "tc_insert" ON public.task_collections
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "tc_update" ON public.task_collections
  FOR UPDATE
  USING    (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "tc_delete" ON public.task_collections
  FOR DELETE USING (created_by = auth.uid());

-- task_collection_items: creator of parent collection
CREATE POLICY "tci_select" ON public.task_collection_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.task_collections
            WHERE id = collection_id AND created_by = auth.uid())
  );

CREATE POLICY "tci_insert" ON public.task_collection_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.task_collections
            WHERE id = collection_id AND created_by = auth.uid())
  );

CREATE POLICY "tci_update" ON public.task_collection_items
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.task_collections
            WHERE id = collection_id AND created_by = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.task_collections
            WHERE id = collection_id AND created_by = auth.uid())
  );

CREATE POLICY "tci_delete" ON public.task_collection_items
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.task_collections
            WHERE id = collection_id AND created_by = auth.uid())
  );

-- ── 6. Atomic save RPC ───────────────────────────────────────
--
-- Creates or updates a collection + replaces all items in one transaction.
-- Role check inside: only teacher / admin / owner.
-- Returns the collection id.
--
CREATE OR REPLACE FUNCTION public.save_collection_atomic(
  p_collection_id UUID,
  p_title         TEXT,
  p_description   TEXT,
  p_subject       TEXT,
  p_work_type     TEXT,
  p_items         public.collection_item_input[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_id   UUID;
  v_item public.collection_item_input;
BEGIN
  -- Role guard
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('teacher', 'admin', 'owner') THEN
    RAISE EXCEPTION 'Access denied: role % cannot create collections', v_role;
  END IF;

  IF p_collection_id IS NULL THEN
    -- Create new
    INSERT INTO public.task_collections
      (created_by, title, description, subject, work_type)
    VALUES
      (auth.uid(), p_title, p_description, p_subject, p_work_type)
    RETURNING id INTO v_id;
  ELSE
    -- Update existing (ownership enforced)
    UPDATE public.task_collections SET
      title       = p_title,
      description = p_description,
      subject     = p_subject,
      work_type   = p_work_type
    WHERE id = p_collection_id AND created_by = auth.uid();

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Access denied: collection % not found or not owned', p_collection_id;
    END IF;
    v_id := p_collection_id;
  END IF;

  -- Replace items atomically
  DELETE FROM public.task_collection_items WHERE collection_id = v_id;

  IF p_items IS NOT NULL THEN
    FOREACH v_item IN ARRAY p_items LOOP
      INSERT INTO public.task_collection_items
        (collection_id, catalog_task_id, position, custom_number)
      VALUES
        (v_id, v_item.catalog_task_id, v_item.position, v_item.custom_number);
    END LOOP;
  END IF;

  RETURN v_id;
END;
$$;
