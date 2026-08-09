-- Плитка «Привязано Telegram» считала `is_enabled` и не смотрела на
-- `disconnected_at`.
--
-- Сегодня это не враньё: обе точки отвязки — edge-функция `disconnect-telegram`
-- и ветка «бот заблокирован» в `process-notification-queue` — снимают ОБА поля
-- разом, а `telegram-bot-webhook` при повторной привязке оба возвращает.
-- Поэтому после отвязки `is_enabled` уже false, и счётчик сходится.
--
-- Правим ради согласия с остальным кодом: `lesson-reminder-scheduler`,
-- `process-notification-queue`, `send-telegram-test` и `telegramLinkApi`
-- спрашивают ОБА условия. Плитка была единственным местом с половинным
-- условием — и если однажды появится писатель, трогающий одно поле, разойдётся
-- именно она, причём молча. Дешевле совпадать сейчас, чем ловить расхождение
-- в цифре, которой верят.
--
-- Меняется одна строка запроса; остальное тело — как в §78.

create or replace function public.admin_school_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_result jsonb;
begin
  if not public.is_admin_or_owner() then
    raise exception 'ONLY_ADMIN_SEES_SCHOOL_STATS' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'teachers',            (select count(*) from public.teachers  where is_active),
    'students',            (select count(*) from public.students  where is_active),
    'courses',             (select count(*) from public.courses   where is_active),

    'homework_submitted_total',
      (select count(*) from public.topic_homework_attempts where submitted_at is not null),
    'homework_submitted_7d',
      (select count(*) from public.topic_homework_attempts
        where submitted_at > now() - interval '7 days'),
    'homework_reviewed',
      (select count(*) from public.topic_homework_reviews),
    -- «Ждут проверки» — сданные попытки без строки разбора. Считаем по факту
    -- отсутствия разбора, а не по статусу: статус может уехать (returned_for_
    -- revision тоже уже проверен), а разбор либо есть, либо нет.
    'homework_pending',
      (select count(*) from public.topic_homework_attempts a
        where a.submitted_at is not null
          and not exists (select 1 from public.topic_homework_reviews r
                           where r.attempt_id = a.id)),

    'variants_completed',
      (select count(*) from public.test_variant_student_assignments
        where submitted_at is not null),

    -- Живая привязка — включена И не отвязана. Оба условия, как везде.
    'telegram_connected',
      (select count(*) from public.telegram_connections
        where is_enabled and disconnected_at is null),

    'visits_today',
      (select count(*) from public.app_visits where visited_on = v_today),
    'visits_7d',
      (select count(distinct profile_id) from public.app_visits
        where visited_on > v_today - 7)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_school_stats() from public, anon;
grant execute on function public.admin_school_stats() to authenticated;
