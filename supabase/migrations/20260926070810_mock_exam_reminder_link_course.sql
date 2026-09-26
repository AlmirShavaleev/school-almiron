-- §224.1. Ссылка «Открыть пробник» в Telegram — на страницу курса с ?mock=<id>.
--
-- До §224.1 кнопка вела прямо на /my-course/<группа>/mock/<пробник>. Этой
-- страницы нет в версии сайта без пробников, и ученик получил бы «страница не
-- найдена». Страница курса есть в любой версии; версия с пробниками по
-- ?mock= сразу открывает пробник (StudentCoursePage, replace).
-- Меняется одна строка payload в триггерной функции; ещё не ушедшие строки
-- очереди переписываются на новую ссылку.

create or replace function public.mock_exam_schedule_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam    public.mock_exams;
  v_now     timestamptz := now();
  v_ends    timestamptz;
  v_until   timestamptz;
  v_epoch   bigint;
  v_payload jsonb;
begin
  if tg_op = 'UPDATE'
     and (old.starts_at, old.duration_minutes, old.group_id, old.title, old.photo_grace_minutes)
         is not distinct from (new.starts_at, new.duration_minutes, new.group_id, new.title, new.photo_grace_minutes) then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    update public.notification_queue q
       set status = 'cancelled'
     where q.entity_type = 'mock_exam'
       and q.entity_id = old.id
       and q.event_type in ('mock_exam_soon', 'mock_exam_started')
       and q.status = 'pending';
  end if;
  if tg_op = 'DELETE' then
    return null;
  end if;

  v_exam := new;
  if v_exam.starts_at is null or v_exam.group_id is null or v_exam.starts_at <= v_now then
    return null;
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
    from public.group_students gs
    join public.students s on s.id = gs.student_id and s.profile_id is not null
    cross join (values ('mock_exam_soon',    v_exam.starts_at - interval '1 hour'),
                       ('mock_exam_started', v_exam.starts_at)) as ev(event_type, at)
   where gs.group_id = v_exam.group_id
     and ev.at > v_now
  on conflict (deduplication_key) do update
     set payload       = excluded.payload,
         scheduled_for = excluded.scheduled_for,
         status        = 'pending',
         attempts      = 0
   where q.status = 'cancelled';

  return null;
end;
$$;

comment on function public.mock_exam_schedule_notifications() is
  '§224, §224.1. Триггер mock_exams: ставит ученикам группы Telegram «через час — пробник» (starts_at − 1 ч) и «пробник начался» (starts_at) в notification_queue; при переносе, смене группы, названия, длительности, снятии времени и удалении гасит ещё не ушедшие. Прошедшие моменты не ставит. Ссылка — на страницу курса с ?mock=<id> (§224.1).';

alter function public.mock_exam_schedule_notifications() owner to postgres;
revoke all on function public.mock_exam_schedule_notifications() from public, anon, authenticated;

update public.notification_queue q
   set payload = jsonb_set(q.payload, '{link}',
         to_jsonb('/my-course/' || (q.payload->>'group_id') || '?mock=' || (q.payload->>'exam_id')))
 where q.entity_type = 'mock_exam'
   and q.event_type in ('mock_exam_soon', 'mock_exam_started')
   and q.status = 'pending'
   and q.payload ? 'group_id' and q.payload ? 'exam_id';
