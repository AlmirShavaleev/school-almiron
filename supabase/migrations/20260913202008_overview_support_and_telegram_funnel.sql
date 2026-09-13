-- §169 (применено оркестратором 13.09, версия 20260913202008): два сигнала для списка дел в «Обзоре» — необработанные обращения и
-- воронка привязки Telegram за 7 дней.
--
-- Дописываем существующую функцию (последняя версия — 20260909174536),
-- добавляюще: старые ключи не тронуты, их читает работающий дашборд. Считать
-- эти числа на клиенте нельзя дважды: support_requests открыта админу на
-- select, но «одно число живёт в одном месте» (§147) — и «Обзор» остаётся
-- одним запросом.
--
--   support_new — обращения «Сообщить о проблеме» со статусом 'new'.
--     Обращение с любым другим статусом уже кто-то видел; «в работе» — не
--     «необработанное».
--   telegram_links_created_7d — ссылок привязки создано за 7 суток
--     (telegram_link_tokens.created_at). Считаем ссылки, а не людей: один
--     человек может создать несколько ссылок, и каждая неудачная — часть
--     той самой поломки, которую строка должна показать.
--   telegram_links_connected_7d — привязок состоялось за 7 суток
--     (telegram_connections.connected_at). Строка в таблице одна на профиль
--     (upsert по profile_id), connected_at переписывается при повторной
--     привязке — то есть это «людей, привязавшихся за неделю», и Y может
--     быть меньше X даже при здоровой привязке (одна ссылка потрачена, вторая
--     создана «на всякий случай»). Порог «X ≥ 5 и Y/X < 1/2» на клиенте это
--     учитывает: тревога только при заметной просадке, не при 4 из 5.
--     Отвязанные потом не исключаются намеренно: вопрос строки — «работает
--     ли привязка», а не «сколько сейчас подключено» (это telegram_connected).
--
-- Окно 7 суток — скользящее по now(), как у homework_submitted_7d; дневные
-- границы по Москве здесь ни к чему: сравниваются два числа в одном окне.

create or replace function public.admin_school_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    'homework_submitted_today',
      (select count(*) from public.topic_homework_attempts
        where submitted_at is not null
          and (submitted_at at time zone 'Europe/Moscow')::date = v_today),
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
    -- Возраст самой старой непроверенной работы в календарных днях по Москве.
    -- min() по пустому множеству даёт null, и он же уходит наружу — очередь
    -- пуста, а не «ждёт ноль дней».
    'homework_oldest_pending_days',
      (select v_today - (min(a.submitted_at) at time zone 'Europe/Moscow')::date
         from public.topic_homework_attempts a
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
        where visited_on > v_today - 7),

    -- §169. Необработанные обращения: только статус 'new'. Частичный индекс
    -- idx_support_requests_status (status <> 'closed') этот запрос покрывает.
    'support_new',
      (select count(*) from public.support_requests where status = 'new'),

    -- §169. Воронка привязки Telegram за 7 суток: ссылок создано и привязок
    -- состоялось. Два числа об одном процессе — из одного места, как пара
    -- homework_pending / homework_oldest_pending_days.
    'telegram_links_created_7d',
      (select count(*) from public.telegram_link_tokens
        where created_at > now() - interval '7 days'),
    'telegram_links_connected_7d',
      (select count(*) from public.telegram_connections
        where connected_at > now() - interval '7 days')
  )
  into v_result;

  return v_result;
end;
$function$;
