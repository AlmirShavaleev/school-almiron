-- Run together with the three function definitions saved before the migration.
-- Preserve plan tables and their rows for recovery.
do $$
begin
  if to_regprocedure('cron.unschedule(text)') is not null
     and exists (select 1 from cron.job where jobname = 'student-work-plan-notices') then
    perform cron.unschedule('student-work-plan-notices');
  end if;
end
$$;

drop trigger if exists student_work_plan_freeze_topic on public.topics;

revoke execute on function
  public.student_work_plan_read(text,uuid,uuid,integer,integer,text),
  public.student_work_plan_catalog(uuid,uuid[]),
  public.student_work_plan_save(jsonb,jsonb,uuid,integer),
  public.student_work_plan_copy_targets(uuid),
  public.student_work_plan_copy(uuid,date,uuid,uuid[],uuid,boolean,boolean,boolean),
  public.student_work_plan_repeat_tasks(uuid,uuid),
  public.student_work_plan_repeat_check(uuid,uuid,text),
  public.student_work_plan_repeat_homework_ids(uuid,uuid),
  public.student_work_plan_repeat_homework_start(uuid,uuid)
from authenticated;

update public.notification_queue
set status = 'cancelled'
where event_type = 'student_work_plan' and status = 'pending';
