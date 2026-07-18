ALTER TABLE public.catalog_tasks
  ADD COLUMN IF NOT EXISTS difficulty text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalog_tasks_difficulty_check'
      AND conrelid = 'public.catalog_tasks'::regclass
  ) THEN
    ALTER TABLE public.catalog_tasks
      ADD CONSTRAINT catalog_tasks_difficulty_check
      CHECK (difficulty IS NULL OR difficulty IN ('лёгкая','средняя','сложная'));
  END IF;
END $$;
