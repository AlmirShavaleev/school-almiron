set local lock_timeout='3s';
set local statement_timeout='25s';

alter function public.student_exam_evidence_rows(uuid,timestamptz) set plan_cache_mode='force_generic_plan';
alter function public.student_solved_task_days(uuid,date) set plan_cache_mode='force_generic_plan';
alter function public.progress_open_by_student(uuid[],uuid[]) set plan_cache_mode='force_generic_plan';
alter function public._progress_state(uuid,uuid[]) set plan_cache_mode='force_generic_plan';
