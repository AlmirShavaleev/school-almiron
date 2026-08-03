-- §49. Событие сдачи ДЗ существовало под двумя именами.
--
-- §16 завёл `topic_homework_submitted` (помощник
-- `topic_homework_enqueue_submitted`, дедуп `topic_hw_submitted:…`) и ветку под
-- него в `process-notification-queue`. §42 врезку заменил рукописным блоком с
-- новым именем `homework_submitted` — ветки под это имя нет, поэтому карточка
-- ушла бы через `default` серой строкой; заодно потерялся SECURITY DEFINER,
-- отсюда и 42501 из §47.
--
-- Возвращаем имя, которое уже умеет обрабатывать задеплоенный воркер, и
-- приводим payload ровно под ту ветку switch, что стоит в проде: она читает
-- student_name, attempt_number, course_title, title и link.
--
-- Дедуп-префикс остаётся `hw_submitted:` (из §47): менять его незачем, а
-- расхождение со старым `topic_hw_submitted:` теперь безопасно — второй
-- производитель этого события удаляется ниже.
--
-- Логика сдачи не тронута: `topic_homework_submit_attempt` не меняется вовсе.

create or replace function public.notify_homework_submitted(p_attempt_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v_attempt      record;
  v_course_title text;
  v_line         text;
  v_caller       uuid := auth.uid();
begin
  select a.attempt_number,
         a.status::text as attempt_status,
         h.title as hw_title,
         t.title as topic_title,
         s.profile_id as student_profile,
         coalesce(p.full_name, 'Ученик') as student_name,
         public.course_of_topic(t.id) as course_id
    into v_attempt
    from topic_homework_attempts a
    join topic_homework h on h.id = a.homework_id
    join topics t on t.id = h.topic_id
    join students s on s.id = a.student_id
    left join profiles p on p.id = s.profile_id
   where a.id = p_attempt_id;

  if not found then
    perform public.notification_log_dispatch_error(
      'notify_homework_submitted', p_attempt_id, 'NOROW', 'Попытка не найдена');
    return;
  end if;

  if v_attempt.attempt_status <> 'submitted' then
    perform public.notification_log_dispatch_error(
      'notify_homework_submitted', p_attempt_id, 'STATE',
      'Попытка не в статусе submitted: ' || v_attempt.attempt_status);
    return;
  end if;

  -- Функция definer, поэтому право на вызов она обязана проверить сама:
  -- иначе любой авторизованный смог бы разослать оповещение по чужой сдаче.
  -- auth.uid() = null означает серверный контекст (service_role, крон) — там
  -- проверять нечего.
  if v_caller is not null
     and v_caller <> v_attempt.student_profile
     and not exists (
       select 1 from public.course_staff_profiles(v_attempt.course_id) st
        where st.profile_id = v_caller)
  then
    perform public.notification_log_dispatch_error(
      'notify_homework_submitted', p_attempt_id, '42501',
      'Вызов не от ученика этой попытки и не от персонала курса: ' || v_caller);
    return;
  end if;

  select c.title into v_course_title from courses c where c.id = v_attempt.course_id;

  v_line := v_attempt.student_name
    || case when v_attempt.attempt_number > 1 then ' пересдал: ' else ' сдал работу: ' end
    || v_attempt.topic_title || ' — ' || v_attempt.hw_title
    || case when v_attempt.attempt_number > 1
            then ' (попытка №' || v_attempt.attempt_number || ')' else '' end;

  -- Сбой рассылки не должен отменять сдачу, поэтому исключение по-прежнему
  -- гасится — но причина остаётся в notification_dispatch_errors.
  -- Повторно его raise'ить нельзя: откат подтранзакции унёс бы и саму запись.
  begin
    insert into notifications (user_id, title, message, type, link, dedup_key)
    select st.profile_id,
           case when v_attempt.attempt_number > 1 then 'Повторная сдача' else 'Работа сдана на проверку' end,
           v_line,
           'info',
           '/homework-queue',
           'hw_submitted:' || p_attempt_id || ':' || v_attempt.attempt_number || ':' || st.profile_id
      from public.course_staff_profiles(v_attempt.course_id) st
     on conflict do nothing;

    -- Поля payload — ровно те, что читает ветка `topic_homework_submitted`
    -- в задеплоенном process-notification-queue. Собранной фразы там больше
    -- нет: текст карточки строит воркер.
    insert into notification_queue
      (profile_id, channel, event_type, entity_type, entity_id,
       deduplication_key, payload, status, scheduled_for)
    select st.profile_id,
           'telegram',
           'topic_homework_submitted',
           'topic_homework_attempt',
           p_attempt_id,
           'hw_submitted:' || p_attempt_id || ':' || v_attempt.attempt_number || ':' || st.profile_id,
           jsonb_build_object(
             'student_name',   v_attempt.student_name,
             'title',          v_attempt.topic_title || ' — ' || v_attempt.hw_title,
             'course_title',   v_course_title,
             'attempt_number', v_attempt.attempt_number,
             'link',           '/homework-queue'
           ),
           'pending'::notification_queue_status,
           now()
      from public.course_staff_profiles(v_attempt.course_id) st
      join telegram_connections tc
        on tc.profile_id = st.profile_id
       and tc.is_enabled
       and tc.disconnected_at is null
       and tc.telegram_chat_id is not null
     on conflict (deduplication_key) do nothing;
  exception when others then
    perform public.notification_log_dispatch_error(
      'notify_homework_submitted', p_attempt_id, sqlstate, sqlerrm);
  end;
end $function$;

-- Второй производитель того же события. Мёртв: ни один триггер и ни одна
-- функция его не зовут (проверено по pg_trigger и по телам pg_proc), клиент
-- тоже не вызывает, строк `topic_homework_submitted` в очереди за всё время
-- ноль. Оставлять нельзя: два живых источника одного события с разными
-- дедуп-ключами дали бы преподавателю по две карточки на сдачу.
drop function if exists public.topic_homework_enqueue_submitted(uuid);
