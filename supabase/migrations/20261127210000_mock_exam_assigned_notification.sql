-- Queue one assignment notice per exam, start time and student.
CREATE OR REPLACE FUNCTION public._reschedule_mock_exam_notifications(p_mock_exam_id uuid, v_exam mock_exams)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now     timestamptz := now();
  v_ends    timestamptz;
  v_until   timestamptz;
  v_epoch   bigint;
  v_payload jsonb;
begin
  update public.notification_queue q
     set status = 'cancelled'
   where q.entity_type = 'mock_exam'
     and q.entity_id = p_mock_exam_id
     and q.event_type in ('mock_exam_assigned', 'mock_exam_soon', 'mock_exam_started')
     and q.status = 'pending';
  if v_exam is null or v_exam.starts_at is null or v_exam.group_id is null or v_exam.starts_at <= v_now then
    return;
  end if;

  v_ends  := v_exam.starts_at + make_interval(mins => v_exam.duration_minutes);
  v_until := v_ends + make_interval(mins => v_exam.photo_grace_minutes);
  v_epoch := floor(extract(epoch from v_exam.starts_at))::bigint;
  v_payload := jsonb_build_object(
    'title',        v_exam.title,
    'exam_id',      v_exam.id,
    'group_id',     v_exam.group_id,
    'starts_at',    v_exam.starts_at,
    'ends_at',      v_ends,
    'photos_until', v_until,
    'link',         '/my-course/' || v_exam.group_id || '?mock=' || v_exam.id,
    'button_text',  'Открыть пробник'
  );

  insert into public.notification_queue as q
         (profile_id, channel, event_type, entity_type, entity_id,
          deduplication_key, payload, status, scheduled_for)
  select s.profile_id, 'telegram', ev.event_type, 'mock_exam', v_exam.id,
         ev.event_type || ':' || v_exam.id || ':' || v_epoch || ':' || s.profile_id,
         v_payload, 'pending'::public.notification_queue_status, ev.at
    from public.mock_exam_members gs
    join public.students s on s.id = gs.student_id and s.profile_id is not null
    cross join (values ('mock_exam_assigned', v_now),
                       ('mock_exam_soon',    v_exam.starts_at - interval '1 hour'),
                       ('mock_exam_started', v_exam.starts_at)) as ev(event_type, at)
   where gs.mock_exam_id = v_exam.id
     and (ev.event_type = 'mock_exam_assigned' or ev.at > v_now)
  on conflict (deduplication_key) do update
     set payload       = excluded.payload,
         scheduled_for = excluded.scheduled_for,
         status        = 'pending',
         attempts      = 0
   where q.status = 'cancelled';
end;
$function$;
