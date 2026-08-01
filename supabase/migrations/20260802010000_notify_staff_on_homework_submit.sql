-- ============================================================
-- Преподаватель не узнавал, что работу сдали.
--
-- Ученику уведомления приходили: «Новое домашнее задание» и «Домашнее задание
-- проверено». Обратной стороны не было вовсе — сдача и пересдача проходили
-- молча, и преподаватель узнавал о них, только если сам заходил в очередь.
--
-- Теперь `topic_homework_submit_attempt` оповещает всех, кто может проверять
-- этот курс: строка в `notifications` (она же поднимает счётчик в меню) и
-- событие в `notification_queue` для Telegram.
--
-- Три решения, которые стоит понимать:
--
--  1. Список получателей собирается ЗЕРКАЛЬНО функции `course_is_staff` —
--     владелец курса, преподаватель группы, куратор группы и куратор курса.
--     Админы платформы намеренно не включены: им прилетало бы по каждой сдаче
--     во всей школе.
--  2. Текст для Telegram собирается в поле `title`, а не отдельным шаблоном в
--     edge-функции: своего шаблона у события `homework_submitted` там пока нет,
--     и оно попадает в ветку по умолчанию «Новое уведомление: <title>».
--     Готовый человеческий `title` делает эту ветку читаемой, не требуя
--     передеплоя работающего конвейера рассылки. Красивая карточка — отдельный
--     шаг, и делать его надо аккуратно: это единственный живой канал связи с
--     учениками.
--  3. Ключ дедупликации включает НОМЕР ПОПЫТКИ. Пересдача — отдельное событие,
--     и она обязана прозвенеть: именно её ждут после возврата на доработку. Без
--     номера вторая сдача той же работы молча схлопнулась бы в дубликат первой.
--
-- Оповещение обёрнуто в свой блок с проглатыванием ошибки. Сдача к этому
-- моменту уже принята системой; откатывать её из-за неотправленного сообщения
-- хуже, чем промолчать.
-- ============================================================

-- Кто получает оповещения по курсу. Зеркало `course_is_staff`, но списком, а
-- не проверкой одного человека.
create or replace function public.course_staff_profiles(p_course_id uuid)
returns table (profile_id uuid)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select distinct x.profile_id from (
    select c.owner_id as profile_id from courses c
     where c.id = p_course_id and c.owner_id is not null
    union
    select t.profile_id from groups g join teachers t on t.id = g.teacher_id
     where g.course_id = p_course_id and t.profile_id is not null
    union
    select cu.profile_id from groups g join curators cu on cu.id = g.curator_id
     where g.course_id = p_course_id and cu.profile_id is not null
    union
    select cc.profile_id from course_curators cc
     where cc.course_id = p_course_id and cc.profile_id is not null
  ) x;
$$;

grant execute on function public.course_staff_profiles(uuid) to authenticated, service_role;

create or replace function public.topic_homework_submit_attempt(p_attempt_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt record;
  v_course_id uuid;
  v_course_title text;
  v_line text;
  v_tg_title text;
begin
  update topic_homework_attempts
     set status = 'submitted', submitted_at = now()
   where id = p_attempt_id
     and status = 'draft';

  if not found then
    raise exception 'Попытка не найдена, уже сдана или нет прав';
  end if;

  begin
    select a.attempt_number,
           h.title as hw_title,
           t.title as topic_title,
           coalesce(p.full_name, 'Ученик') as student_name,
           public.course_of_topic(t.id) as course_id
      into v_attempt
      from topic_homework_attempts a
      join topic_homework h on h.id = a.homework_id
      join topics t on t.id = h.topic_id
      join students s on s.id = a.student_id
      left join profiles p on p.id = s.profile_id
     where a.id = p_attempt_id;

    v_course_id := v_attempt.course_id;
    select c.title into v_course_title from courses c where c.id = v_course_id;

    v_line := v_attempt.student_name
      || case when v_attempt.attempt_number > 1 then ' пересдал: ' else ' сдал работу: ' end
      || v_attempt.topic_title || ' — ' || v_attempt.hw_title
      || case when v_attempt.attempt_number > 1
              then ' (попытка №' || v_attempt.attempt_number || ')' else '' end;

    v_tg_title := v_line || coalesce(' · ' || v_course_title, '');

    insert into notifications (user_id, title, message, type, link, dedup_key)
    select st.profile_id,
           case when v_attempt.attempt_number > 1 then 'Повторная сдача' else 'Работа сдана на проверку' end,
           v_line,
           'info',
           '/homework-queue',
           'hw_submitted:' || p_attempt_id || ':' || v_attempt.attempt_number || ':' || st.profile_id
      from public.course_staff_profiles(v_course_id) st
     on conflict do nothing;

    insert into notification_queue
      (profile_id, channel, event_type, entity_type, entity_id,
       deduplication_key, payload, status, scheduled_for)
    select st.profile_id,
           'telegram',
           'homework_submitted',
           'topic_homework_attempt',
           p_attempt_id,
           'hw_submitted:' || p_attempt_id || ':' || v_attempt.attempt_number || ':' || st.profile_id,
           jsonb_build_object(
             'title', v_tg_title,
             'course_title', v_course_title,
             'student_name', v_attempt.student_name,
             'attempt_number', v_attempt.attempt_number
           ),
           'pending'::notification_queue_status,
           now()
      from public.course_staff_profiles(v_course_id) st
      join telegram_connections tc
        on tc.profile_id = st.profile_id
       and tc.is_enabled
       and tc.disconnected_at is null
       and tc.telegram_chat_id is not null
     on conflict (deduplication_key) do nothing;
  exception when others then
    null;
  end;
end $$;
