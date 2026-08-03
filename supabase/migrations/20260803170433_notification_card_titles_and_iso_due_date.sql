-- Два хвоста из утверждения текстов карточек (ТЕКСТЫ_ТГ_КАРТОЧЕК.md).
--
-- 1. Дедлайн «12.08.0020». Производитель форматировал дату сам —
--    `to_char(due_at, 'DD.MM.YYYY')`, и формат был верным: год 0020 лежит
--    в самой `topic_homework.due_at` (таких строк две, вторая — 0002-09-29,
--    год набран руками). Форматировать дату в SQL всё равно неправильно:
--    вид карточки — дело воркера, у него для этого есть formatWhen. Отдаём
--    ISO и null вместо строки «не указан».
--
-- 2. Заголовок «тема — ДЗ · тема». Название ДЗ часто уже содержит тему
--    («Разноускоренное движение» + «ДЗ · Разноускоренное движение»), и
--    склейка через тире удваивала её. Сводим в одну функцию: три
--    производителя собирали заголовок одинаковым выражением, и разъехаться
--    им нельзя.

-- 1. Общий сборщик заголовка ---------------------------------------------

create or replace function public.topic_homework_card_title(
  p_topic_title text,
  p_hw_title    text
) returns text
  language sql
  immutable
as $function$
  select case
    -- Название ДЗ пустое или общее («Домашнее задание») — тема и есть заголовок
    when nullif(btrim(coalesce(p_hw_title, '')), '') is null then btrim(coalesce(p_topic_title, ''))
    when lower(btrim(p_hw_title)) = lower(btrim(coalesce(p_topic_title, ''))) then btrim(coalesce(p_topic_title, ''))
    when lower(btrim(p_hw_title)) in ('домашнее задание', 'дз') then btrim(coalesce(p_topic_title, ''))
    -- Название ДЗ уже содержит тему — второй раз её не пишем
    when nullif(btrim(coalesce(p_topic_title, '')), '') is not null
     and position(lower(btrim(p_topic_title)) in lower(btrim(p_hw_title))) > 0
      then btrim(p_topic_title)
    when nullif(btrim(coalesce(p_topic_title, '')), '') is null then btrim(p_hw_title)
    else btrim(p_topic_title) || ' — ' || btrim(p_hw_title)
  end;
$function$;

comment on function public.topic_homework_card_title(text, text) is
  'Заголовок карточки ДЗ: тема и название работы без повтора. Название ДЗ часто уже содержит тему, а склейка через тире удваивала её. Общая точка для всех производителей уведомлений — расходиться им нельзя.';

alter function public.topic_homework_card_title(text, text) owner to postgres;

-- 2. Новое ДЗ: ISO-дата и заголовок без повтора ---------------------------

CREATE OR REPLACE FUNCTION public.topic_homework_notify_students(p_homework_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_hw record;
  v_course_id uuid;
  v_course_title text;
  v_topic_title text;
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
  v_topic_title := v_hw.topic_title;

  insert into notification_queue
    (profile_id, channel, event_type, entity_type, entity_id,
     deduplication_key, payload, status, scheduled_for)
  -- distinct on (profile): ученик в двух группах курса получает одну ссылку.
  select distinct on (s.profile_id) s.profile_id,
         'telegram',
         'new_homework',
         'topic_homework',
         p_homework_id,
         'topic_homework:' || p_homework_id || ':' || s.profile_id,
         jsonb_build_object(
           'title', public.topic_homework_card_title(v_topic_title, v_hw.title),
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
  on conflict (deduplication_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $function$;

-- 3. Сдача работы: заголовок без повтора ----------------------------------

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
  v_card_title   text;
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
  v_card_title := public.topic_homework_card_title(v_attempt.topic_title, v_attempt.hw_title);

  v_line := v_attempt.student_name
    || case when v_attempt.attempt_number > 1 then ' пересдал: ' else ' сдал работу: ' end
    || v_card_title
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
             'title',          v_card_title,
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

-- 4. Вердикт: тот же заголовок --------------------------------------------

CREATE OR REPLACE FUNCTION public.topic_homework_enqueue_reviewed(p_review_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v record;
  v_course_id uuid;
  v_course_title text;
  v_group_id uuid;
  v_link text;
  v_max_score integer;
  v_card_title text;
  v_count integer;
begin
  select r.id, r.decision, r.score, r.comment, r.reviewer_id,
         h.title as hw_title, h.grade_scale,
         t.id as topic_id, t.title as topic_title,
         s.id as student_id, s.profile_id as student_profile
    into v
    from topic_homework_reviews r
    join topic_homework_attempts a on a.id = r.attempt_id
    join topic_homework h on h.id = a.homework_id
    join topics t on t.id = h.topic_id
    join students s on s.id = a.student_id
   where r.id = p_review_id;

  if not found then return 0; end if;
  -- Право: только автор вердикта может породить это событие.
  if v.reviewer_id is distinct from auth.uid() then
    raise exception 'Нет прав' using errcode = 'insufficient_privilege';
  end if;
  if v.student_profile is null then return 0; end if;

  v_course_id := public.course_of_topic(v.topic_id);
  select c.title into v_course_title from courses c where c.id = v_course_id;
  -- Группа нужна только для ссылки на тему; у «курс = группа» она одна.
  select g.id into v_group_id
    from groups g join group_students gs on gs.group_id = g.id
   where g.course_id = v_course_id and gs.student_id = v.student_id
   limit 1;

  v_link := case when v_group_id is not null
                 then '/my-course/' || v_group_id || '/topic/' || v.topic_id
                 else '/my-homework' end;
  v_max_score := case v.grade_scale when 'five' then 5 when 'hundred' then 100 else null end;
  v_card_title := public.topic_homework_card_title(v.topic_title, v.hw_title);

  insert into notification_queue
    (profile_id, channel, event_type, entity_type, entity_id,
     deduplication_key, payload, status, scheduled_for)
  select v.student_profile,
         'telegram',
         'topic_homework_reviewed',
         'topic_homework_review',
         p_review_id,
         'topic_hw_reviewed:' || p_review_id,
         jsonb_build_object(
           'title', v_card_title,
           'course_title', v_course_title,
           'decision', v.decision,
           'score', v.score,
           'max_score', v_max_score,
           'comment', v.comment,
           'link', case when v_group_id is not null then v_link else null end
         ),
         'pending'::notification_queue_status,
         now()
    from telegram_connections tc
   where tc.profile_id = v.student_profile and tc.is_enabled
  on conflict (deduplication_key) do nothing;

  get diagnostics v_count = row_count;

  -- Колокольчик ученику: вердикт, балл и комментарий сразу в тексте, чтобы
  -- было видно суть, не открывая тему.
  insert into notifications (user_id, title, message, type, link, dedup_key)
  values (
    v.student_profile,
    case when v.decision = 'accepted' then 'Работа принята'
         else 'Работа возвращена на доработку' end,
    v_card_title
      || case when v.decision = 'accepted' and v.score is not null and v_max_score is not null
              then '. Оценка: ' || v.score || '/' || v_max_score
              when v.decision = 'accepted' and v.score is not null
              then '. Балл: ' || v.score
              else '' end
      || case when coalesce(btrim(v.comment), '') <> ''
              then '. ' || btrim(v.comment) else '' end,
    case when v.decision = 'accepted' then 'success' else 'warning' end,
    v_link,
    'topic_hw_reviewed:' || p_review_id
  )
  on conflict (dedup_key) do nothing;

  return v_count;
end $function$;
