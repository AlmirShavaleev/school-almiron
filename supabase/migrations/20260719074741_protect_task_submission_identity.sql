DROP POLICY ts_teacher_update
ON public.task_submissions;

CREATE FUNCTION public.fn_protect_task_submission_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'task_submissions.id is immutable';
  END IF;

  IF NEW.assigned_id IS DISTINCT FROM OLD.assigned_id THEN
    RAISE EXCEPTION 'task_submissions.assigned_id is immutable';
  END IF;

  IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
    RAISE EXCEPTION 'task_submissions.student_id is immutable';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'task_submissions.created_at is immutable';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL
ON FUNCTION public.fn_protect_task_submission_identity()
FROM PUBLIC;

CREATE TRIGGER trg_protect_task_submission_identity
  BEFORE UPDATE ON public.task_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_protect_task_submission_identity();
