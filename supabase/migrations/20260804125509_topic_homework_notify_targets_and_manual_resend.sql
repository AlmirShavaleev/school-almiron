-- Аккордеон «Оповестить в Telegram» в модалке ДЗ: список учеников с отметкой
-- о привязке и точечная отправка. Решение владельца 2026-08-04.
--
-- Событие и текст карточки НЕ меняются: кладётся тот же `new_homework` с тем
-- же payload, что и раньше. Это сознательно — новое событие или новый текст
-- потребовали бы согласования с чатом уведомлений, а переиспользование
-- существующей карточки не требует.

-- ── 1. Кто из учеников привязал Telegram ─────────────────────────────────────
-- Преподаватель не может читать telegram_connections: политики пускают только
-- к своей строке (tc_select_own) либо платформенного админа (tc_select_admin).
-- Поэтому definer-функция, и отдаёт она РОВНО boolean — ни chat_id, ни имени
-- в телеграме, ни времени привязки. Права — те же, что на само ДЗ.
--
-- `pending` показывает, что оповещение этому ученику уже стоит в очереди и
-- ещё не ушло: без этого преподаватель жал бы «отправить» повторно и получал
-- ноль без объяснения.
create or replace function public.topic_homework_notify_targets(p_homework_id uuid)
returns table(profile_id uuid, full_name text, telegram_linked boolean, pending boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select distinct on (s.profile_id)
         s.profile_id,
         coalesce(p.full_name, 'Ученик') as full_name,
         exists (select 1 from telegram_connections tc
                  where tc.profile_id = s.profile_id and tc.is_enabled) as telegram_linked,
         exists (select 1 from notification_queue q
                  where q.entity_id = p_homework_id
                    and q.profile_id = s.profile_id
                    and q.status = 'pending') as pending
    from topic_homework h
    join groups g on g.course_id = public.course_of_topic(h.topic_id)
    join group_students gs on gs.group_id = g.id
    join students s on s.id = gs.student_id and s.profile_id is not null
    join profiles p on p.id = s.profile_id
   where h.id = p_homework_id
     and public.topic_homework_can_manage(p_homework_id)
   order by s.profile_id, p.full_name;
$function$;

grant execute on function public.topic_homework_notify_targets(uuid) to authenticated;

-- ── 2. Отправка: точечная и повторяемая ──────────────────────────────────────
-- Было: ключ `topic_homework:<hw>:<profile>` и `on conflict do nothing`.
-- Оповестить второй раз было нельзя вообще — вызов молча возвращал 0, и
-- преподаватель не мог понять, ушло что-то или нет.
--
-- Стало: в ключ добавлено время вызова, поэтому повторная отправка проходит.
-- От задвоения защищает не ключ, а условие «нет ещё не ушедшей строки по этой
-- паре (ДЗ, ученик)»: двойной клик не наплодит очередь, а повторить после
-- доставки — можно. Это ровно то поведение, которого ждут от ручной кнопки.
--
-- p_profile_ids = null — «всем привязанным», как раньше.
drop function if exists public.topic_homework_notify_students(uuid);

create or replace function public.topic_homework_notify_students(
  p_homework_id uuid,
  p_profile_ids uuid[] default null
) returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_hw record;
  v_course_id uuid;
  v_course_title text;
  v_count integer;
begin
  if not public.topic_homework_can_manage(p_homework_id) then
    raise exception 'Нет прав на это ДЗ' using errcode = 'insufficient_privilege';
  end if;

  select h.*, t.title as topic_title into v_hw
    from topic_homework h join topics t on t.id = h.topic_id
   where h.id = p_homework_id;
  if not found then
    raise exception 'ДЗ не найдено';
  end if;
  if not v_hw.is_published then
    raise exception 'Сначала опубликуйте ДЗ' using errcode = 'check_violation';
  end if;

  v_course_id := public.course_of_topic(v_hw.topic_id);
  select c.title into v_course_title from courses c where c.id = v_course_id;

  insert into notification_queue
    (profile_id, channel, event_type, entity_type, entity_id,
     deduplication_key, payload, status, scheduled_for)
  -- distinct on (profile): ученик в двух группах курса получает одну ссылку.
  select distinct on (s.profile_id) s.profile_id,
         'telegram',
         'new_homework',
         'topic_homework',
         p_homework_id,
         'topic_homework:' || p_homework_id || ':' || s.profile_id || ':' ||
           to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
         jsonb_build_object(
           'title', public.topic_homework_card_title(v_hw.topic_title, v_hw.title),
           'course_title', v_course_title,
           -- ISO, а не готовая строка: вид даты собирает воркер (formatWhen).
           -- null означает «без дедлайна» и печатается именно так.
           'due_date', to_char(v_hw.due_at, 'YYYY-MM-DD'),
           'link', '/my-course/' || g.id || '/topic/' || v_hw.topic_id
         ),
         'pending'::notification_queue_status,
         now()
    from group_students gs
    join groups g on g.id = gs.group_id and g.course_id = v_course_id
    join students s on s.id = gs.student_id and s.profile_id is not null
    join telegram_connections tc on tc.profile_id = s.profile_id and tc.is_enabled
   where (p_profile_ids is null or s.profile_id = any (p_profile_ids))
     and not exists (
       select 1 from notification_queue q
        where q.entity_id = p_homework_id
          and q.profile_id = s.profile_id
          and q.status = 'pending')
  on conflict (deduplication_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $function$;

grant execute on function public.topic_homework_notify_students(uuid, uuid[]) to authenticated;
