-- §147: два числа для списка дел в «Обзоре» админки.
--
-- Дописываем существующую функцию, старые ключи не трогаем: их читает уже
-- работающий дашборд. Считать эти два числа на клиенте значило бы завести
-- второй расчёт того же самого — правило «одно число живёт в одном месте»
-- запрещает это прямо.
--
--   homework_oldest_pending_days — сколько дней ждёт самая старая непроверенная
--     работа. null, когда очередь пуста: ноль дней («сдали сегодня») и «ждать
--     нечего» — разные состояния, и склеивать их нельзя.
--   homework_submitted_today — сколько работ сдали сегодня по московскому дню,
--     тому же, которым живёт visits_today.
--
-- «Ждут проверки» считается ровно так же, как в ключе homework_pending: по
-- отсутствию строки разбора, а не по статусу попытки. Копия предиката здесь
-- допустима лишь потому, что она стоит вплотную к оригиналу в одном теле
-- функции; выносить её наружу было бы хуже.

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
        where visited_on > v_today - 7)
  )
  into v_result;

  return v_result;
end;
$function$;
