-- Restore with a NEW reviewed migration if rollback is required.
-- Do not delete or edit the applied migration history.
set local lock_timeout = '3s';
set local statement_timeout = '20s';

CREATE OR REPLACE FUNCTION public.student_active_works(p_student_id uuid)
 RETURNS TABLE(kind text, work_kind text, homework_id uuid, mock_exam_id uuid, topic_id uuid, course_id uuid, group_id uuid, title text, opens_at timestamp with time zone, closes_at timestamp with time zone, personal boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select 'timed'::text, t.kind, h.id, null::uuid, t.id, m.course_id,
         (select g.id from public.groups g
            join public.group_students gs on gs.group_id = g.id
           where g.course_id = m.course_id and gs.student_id = p_student_id
           limit 1),
         t.title, w.opens_at, w.closes_at, w.personal
    from public.topic_homework h
    join public.topics t on t.id = h.topic_id and t.kind in ('check', 'control')
    join public.modules m on m.id = t.module_id
   cross join lateral public.topic_homework_student_window(h.id, p_student_id) w
   where p_student_id is not null
     and h.is_published
     and ((h.opens_at <= now() and now() < h.closes_at)
          or exists (select 1 from public.topic_homework_personal_windows pw
                      where pw.homework_id = h.id and pw.student_id = p_student_id))
     and w.opens_at <= now() and now() < w.closes_at
     and public.topic_open_with((select public.progress_open_by_student(null, array[p_student_id])), p_student_id::text || ':' || t.id::text, t.is_open, t.available_from)
     and (exists (select 1 from public.group_students gs
                    join public.groups g on g.id = gs.group_id
                   where gs.student_id = p_student_id and g.course_id = m.course_id)
          or exists (select 1 from public.student_courses sc
                      where sc.student_id = p_student_id and sc.course_id = m.course_id
                        and sc.status in ('active', 'trial')
                        and (sc.expires_at is null or sc.expires_at > now())))
     and not exists (select 1 from public.topic_homework_attempts a
                      where a.homework_id = h.id and a.student_id = p_student_id and a.status <> 'draft')
  union all
  select 'mock'::text, 'mock'::text, null::uuid, me.id, null::uuid, g.course_id, me.group_id,
         me.title, w.starts_at, w.ends_at, false
    from public.mock_exams me
    join public.group_students gs on gs.group_id = me.group_id and gs.student_id = p_student_id
    join public.groups g on g.id = me.group_id
   cross join lateral public.mock_exam_window(me.id) w
   where p_student_id is not null
     and me.starts_at is not null
     and w.starts_at <= now() and now() < w.ends_at
     and not exists (select 1 from public.mock_exam_sheets sh
                      where sh.mock_exam_id = me.id and sh.student_id = p_student_id
                        and sh.submitted_at is not null);
$function$;

alter policy topic_homework_attempts_select on public.topic_homework_attempts
using ((student_id = public.auth_student_id()) or public.topic_homework_can_manage(homework_id));
