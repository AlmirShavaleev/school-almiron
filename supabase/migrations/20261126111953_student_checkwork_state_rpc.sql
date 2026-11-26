CREATE OR REPLACE FUNCTION public.student_checkwork_state(p_topic_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO ''
AS $fn$
  WITH hw AS MATERIALIZED (
    SELECT h.* FROM public.topic_homework h
    JOIN public.topics t ON t.id=h.topic_id
    WHERE h.topic_id=p_topic_id AND h.is_published
      AND t.kind IN ('check','control')
      AND (SELECT public.auth_student_id()) IS NOT NULL
      AND public.topic_homework_student_can_see(h.id)
  ), attempts AS MATERIALIZED (
    SELECT a.* FROM public.topic_homework_attempts a JOIN hw ON hw.id=a.homework_id
    WHERE a.student_id=(SELECT public.auth_student_id())
  )
  SELECT jsonb_build_object(
    'homework',to_jsonb(hw),
    'window',public.topic_homework_my_window(hw.id),
    'files',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.position) FROM public.topic_homework_files f WHERE f.homework_id=hw.id),'[]'::jsonb),
    'attempts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attempt_number) FROM attempts a),'[]'::jsonb),
    'attemptFiles',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.position) FROM public.topic_homework_attempt_files f JOIN attempts a ON a.id=f.attempt_id),'[]'::jsonb),
    'reviews',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at) FROM public.topic_homework_reviews r JOIN attempts a ON a.id=r.attempt_id WHERE a.status<>'draft'),'[]'::jsonb)
  ) FROM hw;
$fn$;
REVOKE ALL ON FUNCTION public.student_checkwork_state(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.student_checkwork_state(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
