-- §47. Сдача ДЗ не создавала ни одной строки уведомления.
--
-- Причина (воспроизведена транзакцией с откатом на проде 2026-08-03):
-- topic_homework_submit_attempt — SECURITY INVOKER, вызывает её ученик, а
-- политики notifications_insert_admin и nq_insert_staff пускают только
-- персонала. Первый же `insert into notifications` падал с 42501
-- "new row violates row-level security policy" и глох в
-- `exception when others then null`; до вставки в notification_queue
-- управление вообще не доходило.
--
-- Второй, независимый дефект: telegram_connections ученику не видна (политики
-- tc_select_own / tc_select_admin), поэтому join в очереди схлопывался бы в
-- ноль строк даже без ошибки — то есть чинить одну только вставку мало.
--
-- Блок уведомления вынесен в notify_homework_submitted, логика сдачи не
-- тронута.

-- 1. Куда пишутся причины несозданных уведомлений ------------------------

create table if not exists public.notification_dispatch_errors (
  id         uuid primary key default gen_random_uuid(),
  source     text not null,
  entity_id  uuid,
  sqlstate   text,
  message    text,
  created_at timestamptz not null default now()
);

comment on table public.notification_dispatch_errors is
  'Причины, по которым уведомление не было создано. Пишет только SECURITY DEFINER-хелпер: клиентских insert-политик нет и заводить их нельзя. Чистку старых строк позже повесить на существующий крон уведомлений, отдельный крон не заводить.';

create index if not exists idx_notification_dispatch_errors_created_at
  on public.notification_dispatch_errors (created_at desc);

alter table public.notification_dispatch_errors enable row level security;

drop policy if exists nde_select_admin on public.notification_dispatch_errors;
create policy nde_select_admin on public.notification_dispatch_errors
  for select using (public.is_admin_or_owner());

revoke all on table public.notification_dispatch_errors from public, anon, authenticated;
grant select on table public.notification_dispatch_errors to authenticated;

-- 2. Запись причины. Definer, снаружи не вызывается вообще ---------------

create or replace function public.notification_log_dispatch_error(
  p_source    text,
  p_entity_id uuid,
  p_sqlstate  text,
  p_message   text
) returns void
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.notification_dispatch_errors (source, entity_id, sqlstate, message)
  values (p_source, p_entity_id, p_sqlstate, left(coalesce(p_message, ''), 2000));
end $function$;

alter function public.notification_log_dispatch_error(text, uuid, text, text) owner to postgres;
revoke all on function public.notification_log_dispatch_error(text, uuid, text, text)
  from public, anon, authenticated;

-- 3. Само оповещение о сдаче. Definer: обходит RLS на notifications,
--    notification_queue и telegram_connections ----------------------------

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
  v_tg_title     text;
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

  v_tg_title := v_line || coalesce(' · ' || v_course_title, '');

  -- Сбой рассылки не должен отменять сдачу, поэтому исключение по-прежнему
  -- гасится — но теперь причина остаётся в notification_dispatch_errors.
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

alter function public.notify_homework_submitted(uuid) owner to postgres;
revoke all on function public.notify_homework_submitted(uuid) from public, anon;
-- authenticated нужен EXECUTE: хелпер вызывается изнутри
-- topic_homework_submit_attempt, а та SECURITY INVOKER — право проверяется по
-- вызывающему. Произвол закрыт проверкой прав в теле хелпера, см. выше.
grant execute on function public.notify_homework_submitted(uuid) to authenticated;

-- 4. Сдача. Изменён строго блок уведомления ------------------------------

create or replace function public.topic_homework_submit_attempt(p_attempt_id uuid)
  returns void
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $function$
begin
  update topic_homework_attempts
     set status = 'submitted', submitted_at = now()
   where id = p_attempt_id
     and status = 'draft';

  if not found then
    raise exception 'Попытка не найдена, уже сдана или нет прав';
  end if;

  -- Дальше только оповещение. Его сбой не должен отменять сдачу: работа уже
  -- принята системой, откатывать её из-за неотправленного сообщения хуже,
  -- чем промолчать. Молчать полностью тоже нельзя — причина уходит в
  -- notification_dispatch_errors внутри хелпера, здесь остаётся последний
  -- рубеж на случай, если не удался сам вызов.
  begin
    perform public.notify_homework_submitted(p_attempt_id);
  exception when others then
    raise warning 'Уведомление о сдаче % не создано: % — %', p_attempt_id, sqlstate, sqlerrm;
  end;
end $function$;
