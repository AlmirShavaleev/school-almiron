-- Карточка-приветствие при добавлении ученика в курс.
--
-- События «ученик вступил» в системе не было: `new_homework` уходит в момент
-- публикации ДЗ тем, кто в группе на тот момент, а привязанный позже не
-- получал ничего.
--
-- Производитель — ТРИГГЕР на `group_students`, а не правки в функциях
-- вступления. Причины две. Первая: путей попадания в группу несколько
-- (invite_student_flow, distribute_join_request, distribute_student_courses,
-- ручная привязка), триггер покрывает их разом и не даст забыть новый.
-- Вторая, из §47.5: триггерной функции не нужен EXECUTE у вызывающего —
-- Postgres исполняет её независимо от прав, поэтому definer здесь чистый,
-- без грантов и без дыры «позови руками за кого угодно».

create or replace function public.notify_course_enrolled()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v record;
begin
  -- Всё, что ниже, — только оповещение. Его сбой не должен отменить саму
  -- привязку ученика к курсу: причина уходит в notification_dispatch_errors,
  -- пустых exception-блоков здесь нет (§47).
  begin
    select s.profile_id            as student_profile,
           g.id                    as group_id,
           g.name                  as group_name,
           c.title                 as course_title,
           c.owner_id              as course_owner,
           t.profile_id            as teacher_profile,
           tp.full_name            as teacher_name
      into v
      from public.groups g
      left join public.courses  c  on c.id  = g.course_id
      left join public.teachers t  on t.id  = g.teacher_id
      left join public.profiles tp on tp.id = t.profile_id
      join public.students s on s.id = new.student_id
     where g.id = new.group_id;

    if not found or v.student_profile is null then
      return new;
    end if;

    -- Преподавателю и владельцу курса карточку о самом себе не слать:
    -- в этой школе один человек часто и владелец, и преподаватель.
    if v.student_profile = v.teacher_profile or v.student_profile = v.course_owner then
      return new;
    end if;

    insert into public.notifications (user_id, title, message, type, link, dedup_key)
    values (
      v.student_profile,
      'Вы добавлены в курс',
      coalesce(v.course_title, v.group_name, 'Курс')
        || coalesce('. Преподаватель: ' || v.teacher_name, ''),
      'success',
      '/my-course/' || v.group_id,
      'course_enrolled:' || v.group_id || ':' || new.student_id
    )
    on conflict (dedup_key) do nothing;

    -- Производитель кладёт данные, текст собирает воркер (§65, §69).
    -- Строка появляется только при живой связке Telegram — так же, как у
    -- остальных событий; ждущих привязки строк в очереди не копим.
    insert into public.notification_queue
      (profile_id, channel, event_type, entity_type, entity_id,
       deduplication_key, payload, status, scheduled_for)
    select v.student_profile,
           'telegram',
           'course_enrolled',
           'group',
           v.group_id,
           'course_enrolled:' || v.group_id || ':' || new.student_id,
           jsonb_build_object(
             'course_title',  coalesce(v.course_title, v.group_name),
             'teacher_name',  v.teacher_name,
             'link',          '/my-course/' || v.group_id,
             'button_text',   'Открыть курс'
           ),
           'pending'::notification_queue_status,
           now()
      from public.telegram_connections tc
     where tc.profile_id = v.student_profile
       and tc.is_enabled
       and tc.disconnected_at is null
       and tc.telegram_chat_id is not null
    on conflict (deduplication_key) do nothing;
  exception when others then
    perform public.notification_log_dispatch_error(
      'notify_course_enrolled', new.group_id, sqlstate, sqlerrm);
  end;

  return new;
end $function$;

comment on function public.notify_course_enrolled() is
  'Карточка-приветствие при добавлении ученика в группу курса. Триггер, а не правка функций вступления: путей попадания в группу несколько, а триггерной функции не нужен EXECUTE у вызывающего. Дедуп по group_id + student_id — повторная привязка второй карточки не шлёт.';

alter function public.notify_course_enrolled() owner to postgres;

drop trigger if exists group_students_notify_enrolled on public.group_students;
create trigger group_students_notify_enrolled
  after insert on public.group_students
  for each row execute function public.notify_course_enrolled();
