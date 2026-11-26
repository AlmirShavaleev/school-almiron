CREATE OR REPLACE FUNCTION public.topic_homework_autosubmit_due()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE r record; v_rows integer; v_done integer := 0;
BEGIN
  FOR r IN
    SELECT a.id,w.closes_at
    FROM public.topic_homework_attempts a
    JOIN public.topic_homework h ON h.id=a.homework_id
    JOIN public.topics t ON t.id=h.topic_id
    CROSS JOIN LATERAL public.topic_homework_student_window(a.homework_id,a.student_id) w
    WHERE a.status='draft' AND t.kind IN ('check','control')
      AND w.closes_at IS NOT NULL AND w.closes_at<=now()
      AND EXISTS (SELECT 1 FROM public.topic_homework_attempt_files f
        JOIN storage.objects o ON o.bucket_id='topic-homework-attempts' AND o.name=f.storage_path
        WHERE f.attempt_id=a.id)
    ORDER BY w.closes_at,a.id FOR UPDATE OF a SKIP LOCKED
  LOOP
    BEGIN
      PERFORM set_config('app.topic_homework_autosubmit',r.id::text,true);
      PERFORM set_config('app.topic_homework_incomplete_photos',r.id::text,true);
      UPDATE public.topic_homework_attempts SET status='submitted',submitted_at=r.closes_at,auto_submitted=true
      WHERE id=r.id AND status='draft';
      GET DIAGNOSTICS v_rows=ROW_COUNT;
      PERFORM set_config('app.topic_homework_autosubmit','',true);
      PERFORM set_config('app.topic_homework_incomplete_photos','',true);
      IF v_rows>0 THEN
        v_done:=v_done+1;
        BEGIN
          PERFORM public.notify_homework_submitted(r.id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'Autosubmit notification %: % — %',r.id,SQLSTATE,SQLERRM;
        END;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Autosubmit failed for %: % — %',r.id,SQLSTATE,SQLERRM;
    END;
  END LOOP;
  RETURN v_done;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.topic_homework_autosubmit_due() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.topic_homework_autosubmit_due() TO service_role;
SELECT cron.schedule('topic-homework-autosubmit-due','* * * * *','select public.topic_homework_autosubmit_due();');
