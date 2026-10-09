-- §282 «Подписка», часть 2: очередь писем, автосписание по расписанию.
--
-- PENDING: применяет оркестратор ПОСЛЕ деплоя edge-функции subscription-renew.
--
-- Добавляющая: новая таблица `subscription_mail_outbox`, новые функции
-- `_subscription_mail_enqueue`, `subscription_mail_claim`, `subscription_mail_done`,
-- задание pg_cron `subscription-renew`. Заменяются (`create or replace`) только
-- четыре функции, созданные в 20261009212242_subscriptions_282 этой же веткой;
-- данных учеников и чужих объектов миграция не касается.
--
-- Почему заменяются свои функции:
--  * `subscription_renewal_due` — списываем с запасом 2 часа ДО конца периода:
--    расписание раз в час, иначе между концом периода и запуском доступ
--    на минуты закрывался бы у того, кто платит автоматически;
--  * `subscription_expire_tick` — не трогает подписки с включённым
--    автопродлением: их статус ведёт автосписание (отказы → past_due →
--    expired в `_subscription_renewal_failed`); раньше expire_tick мог
--    перевести в expired подписку, которую расписание ещё не успело списать;
--  * `_subscription_notify` — кроме уведомления в кабинете ставит письмо
--    в очередь (неудачное списание, подписка закончилась);
--  * `subscription_set_auto_renew` — письмо «автопродление отключено».
--
-- Раздел 2б — исправления по ревью §282 (10.10): отказ банка не переоткрывает
-- отменённую/возвращённую подписку; брошенное оформление не меняет тариф
-- автосписания (тариф и email запоминаются в строке платежа — два новых
-- столбца в `subscription_payments`, строк в ней на проде 0); несовпадение
-- суммы закрывает платёж; параллельный запуск не создаёт второе списание;
-- частичный возврат не закрывает доступ (новая перегрузка
-- `subscription_apply_refund` с суммой); «Моя подписка» знает период тарифа.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Очередь писем
-- ─────────────────────────────────────────────────────────────────────────

create table public.subscription_mail_outbox (
  id              bigint generated always as identity primary key,
  subscription_id uuid not null references public.student_subscriptions(id) on delete cascade,
  kind            text not null check (kind in ('charge_failed','expired','auto_renew_off')),
  dedup_key       text not null unique,
  attempts        smallint not null default 0,
  last_error      text,
  skipped_reason  text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index subscription_mail_outbox_pending_idx
  on public.subscription_mail_outbox (created_at)
  where sent_at is null and skipped_reason is null;

alter table public.subscription_mail_outbox enable row level security;

create policy subscription_mail_outbox_admin on public.subscription_mail_outbox
  for select to authenticated using (public.is_admin_or_owner());

revoke all on public.subscription_mail_outbox from anon, authenticated;
grant select on public.subscription_mail_outbox to authenticated;

create function public._subscription_mail_enqueue(p_subscription_id uuid, p_kind text, p_dedup text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.subscription_mail_outbox (subscription_id, kind, dedup_key)
  values (p_subscription_id, p_kind, p_subscription_id || ':' || p_dedup)
  on conflict (dedup_key) do nothing;
end $$;

-- Письма к отправке: забирает пачку и сразу считает попытку (повторный
-- запуск не пошлёт то же письмо параллельно). Адрес — email чека, иначе
-- email профиля. Старше трёх суток и после 5 попыток — не шлём.
create function public.subscription_mail_claim(p_limit int default 20)
returns table (
  id                bigint,
  kind              text,
  email             text,
  full_name         text,
  course_title      text,
  source            text,
  status            text,
  access_until      timestamptz,
  next_charge_at    timestamptz,
  last_charge_error text
)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with picked as (
    select o.id
      from public.subscription_mail_outbox o
     where o.sent_at is null and o.skipped_reason is null
       and o.attempts < 5
       and o.created_at > now() - interval '3 days'
     order by o.created_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  ), bumped as (
    update public.subscription_mail_outbox o
       set attempts = o.attempts + 1
      from picked
     where o.id = picked.id
    returning o.id, o.kind, o.subscription_id
  )
  select b.id, b.kind,
         coalesce(nullif(btrim(s.receipt_email), ''), pr.email),
         pr.full_name, c.title, s.source, s.status,
         s.access_until, s.next_charge_at, s.last_charge_error
    from bumped b
    join public.student_subscriptions s on s.id = b.subscription_id
    join public.students st on st.id = s.student_id
    join public.profiles pr on pr.id = st.profile_id
    join public.courses c on c.id = s.course_id;
end $$;

create function public.subscription_mail_done(p_id bigint, p_ok boolean, p_error text, p_skipped text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sub uuid;
begin
  update public.subscription_mail_outbox
     set sent_at        = case when p_ok then now() else sent_at end,
         skipped_reason = coalesce(p_skipped, skipped_reason),
         last_error     = case when p_ok then null else coalesce(p_error, last_error) end
   where id = p_id
  returning subscription_id into v_sub;
  if p_skipped is not null then
    insert into public.subscription_log (subscription_id, event, details)
    values (v_sub, 'mail_skipped', jsonb_build_object('outbox_id', p_id, 'reason', p_skipped));
  elsif not p_ok then
    insert into public.subscription_log (subscription_id, event, details)
    values (v_sub, 'mail_failed', jsonb_build_object('outbox_id', p_id, 'error', left(p_error, 500)));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Замены своих функций §282
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public._subscription_notify(p_subscription_id uuid, p_title text, p_message text, p_dedup text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
begin
  select st.profile_id into v_profile
    from public.student_subscriptions s join public.students st on st.id = s.student_id
   where s.id = p_subscription_id;
  if v_profile is null then return; end if;
  insert into public.notifications (user_id, title, message, type, link, dedup_key)
  values (v_profile, p_title, p_message, 'subscription', '/my-subscription',
          'subscription:' || p_subscription_id || ':' || p_dedup)
  on conflict do nothing;
  -- письма — только о том, что требует действия ученика
  if p_dedup like 'fail:%' then
    perform public._subscription_mail_enqueue(p_subscription_id, 'charge_failed', p_dedup);
  elsif p_dedup like 'expired:%' then
    perform public._subscription_mail_enqueue(p_subscription_id, 'expired', p_dedup);
  end if;
exception when others then
  -- уведомление не должно ломать денежную операцию
  insert into public.subscription_log (subscription_id, event, details)
  values (p_subscription_id, 'notify_failed', jsonb_build_object('message', sqlerrm));
end $$;

create or replace function public.subscription_renewal_due(p_limit int default 50)
returns table (subscription_id uuid)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id
    from public.student_subscriptions s
    join public.subscription_payment_methods m on m.subscription_id = s.id
   where s.auto_renew
     and s.status in ('active','past_due')
     and s.next_charge_at <= now() + interval '2 hours'
     and not exists (select 1 from public.subscription_payments p
                      where p.subscription_id = s.id and p.kind = 'renewal'
                        and p.status in ('pending','waiting_for_capture'))
   order by s.next_charge_at
   limit greatest(1, least(p_limit, 200));
$$;

create or replace function public.subscription_expire_tick()
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r   record;
  v_n int := 0;
begin
  for r in
    select s.id, s.status from public.student_subscriptions s
     where s.status in ('trial','active','past_due')
       and s.access_until <= now()
       and not (s.auto_renew and s.next_charge_at is not null)
       and not exists (select 1 from public.subscription_payments p
                        where p.subscription_id = s.id
                          and (p.status in ('pending','waiting_for_capture')
                               -- брошенная строка 'created' (оборвался ответ ЮKassa) не держит вечно
                               or (p.status = 'created' and p.created_at > now() - interval '1 day')))
     for update skip locked
  loop
    update public.student_subscriptions set status = 'expired', next_charge_at = null where id = r.id;
    perform public._subscription_notify(r.id,
      case when r.status = 'trial' then 'Пробный период закончился' else 'Подписка закончилась' end,
      'Доступ к курсу закрыт. Прогресс сохранён — оформите подписку, и всё вернётся.',
      'expired:' || to_char(now(), 'YYYYMMDD'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.subscription_set_auto_renew(p_subscription_id uuid, p_on boolean)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.student_subscriptions%rowtype;
begin
  select * into v_sub from public.student_subscriptions
   where id = p_subscription_id and student_id = public.auth_student_id()
   for update;
  if not found then
    raise exception 'Подписка не найдена' using errcode = '42501';
  end if;
  if p_on then
    if not exists (select 1 from public.subscription_payment_methods m where m.subscription_id = v_sub.id) then
      raise exception 'Нет сохранённой карты: оплатите следующий месяц вручную' using errcode = 'P0001', hint = 'NO_METHOD';
    end if;
    if v_sub.status not in ('active','past_due') then
      raise exception 'Подписка не активна' using errcode = 'P0001', hint = 'NOT_ACTIVE';
    end if;
    update public.student_subscriptions
       set auto_renew = true,
           next_charge_at = coalesce(next_charge_at, current_period_end)
     where id = v_sub.id;
  else
    update public.student_subscriptions
       set auto_renew = false, next_charge_at = null
     where id = v_sub.id;
    if v_sub.auto_renew then
      perform public._subscription_mail_enqueue(v_sub.id, 'auto_renew_off',
        'off:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
    end if;
  end if;
  insert into public.subscription_log (subscription_id, actor, event)
  values (v_sub.id, auth.uid(), case when p_on then 'auto_renew_on' else 'auto_renew_off' end);
  return jsonb_build_object('auto_renew', p_on);
end $$;


-- ─────────────────────────────────────────────────────────────────────────
-- 2б. Исправления по ревью §282 (свои функции и своя таблица)
-- ─────────────────────────────────────────────────────────────────────────

alter table public.subscription_payments
  add column tariff_id uuid references public.subscription_tariffs(id) on delete set null,
  add column receipt_email text;

create or replace function public._subscription_renewal_failed(p_subscription_id uuid, p_reason text)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sub   public.student_subscriptions%rowtype;
  v_retry smallint[];
  v_n     int;
  v_last  int;
begin
  select * into v_sub from public.student_subscriptions where id = p_subscription_id for update;
  if not found then return 'unknown'; end if;
  -- отменена/возвращена/автопродление выключено, пока платёж висел — не
  -- переоткрываем доступ отказом банка (ревью §282, находка 1)
  if v_sub.status not in ('active','past_due') or not v_sub.auto_renew then
    insert into public.subscription_log (subscription_id, event, details)
    values (p_subscription_id, 'renewal_failed_ignored', jsonb_build_object('status', v_sub.status, 'reason', p_reason));
    return 'skip';
  end if;
  select retry_days into v_retry from public.subscription_settings where id;
  v_retry := coalesce(v_retry, '{}');
  v_n := v_sub.charge_attempts + 1;
  v_last := coalesce(v_retry[cardinality(v_retry)], 0);

  if v_n <= cardinality(v_retry) then
    update public.student_subscriptions
       set status = 'past_due',
           charge_attempts = v_n,
           last_charge_error = p_reason,
           next_charge_at = current_period_end + make_interval(days => v_retry[v_n]),
           access_until = current_period_end + make_interval(days => v_last + 1)
     where id = p_subscription_id;
    perform public._subscription_notify(p_subscription_id,
      'Не удалось продлить подписку',
      'Списание не прошло. Повторим попытку, доступ к курсу пока сохраняется. Проверьте карту или оплатите вручную.',
      'fail:' || v_n);
    return 'retry';
  end if;

  update public.student_subscriptions
     set status = 'expired',
         charge_attempts = v_n,
         last_charge_error = p_reason,
         auto_renew = false,
         next_charge_at = null,
         access_until = least(coalesce(access_until, now()), now())
   where id = p_subscription_id;
  perform public._subscription_notify(p_subscription_id,
    'Подписка закончилась',
    'Продлить подписку не удалось, доступ к курсу закрыт. Прогресс сохранён — продлите подписку, и всё вернётся.',
    'expired:' || v_n);
  return 'expired';
end $$;

create or replace function public.subscription_checkout_begin(
  p_profile_id     uuid,
  p_tariff_id      uuid,
  p_save_card      boolean,
  p_is_minor       boolean,
  p_parent_consent boolean,
  p_accepted_offer boolean,
  p_receipt_email  text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_role    text;
  v_tariff  public.subscription_tariffs%rowtype;
  v_set     public.subscription_settings%rowtype;
  v_student uuid;
  v_sub     uuid;
  v_pay     uuid;
  v_email   text := nullif(btrim(p_receipt_email), '');
begin
  if not public.app_flag('subscriptions') then
    raise exception 'Оформление подписки сейчас недоступно' using errcode = 'P0001', hint = 'FLAG_OFF';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = p_profile_id;
  if v_role is distinct from 'student' then
    raise exception 'Подписку оформляет учётная запись ученика' using errcode = '42501', hint = 'NOT_STUDENT';
  end if;
  select * into v_tariff from public.subscription_tariffs where id = p_tariff_id and is_active;
  if not found then
    raise exception 'Тариф не найден или выключен' using errcode = 'P0001', hint = 'TARIFF_INACTIVE';
  end if;
  if not coalesce(p_accepted_offer, false) then
    raise exception 'Нужно согласие с офертой' using errcode = 'P0001', hint = 'NO_CONSENT';
  end if;
  if coalesce(p_is_minor, false) and not coalesce(p_parent_consent, false) then
    raise exception 'Нужно согласие родителя' using errcode = 'P0001', hint = 'NO_PARENT_CONSENT';
  end if;
  if v_email is null then
    select p.email into v_email from public.profiles p where p.id = p_profile_id;
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Нужен email для чека' using errcode = 'P0001', hint = 'BAD_EMAIL';
  end if;

  select * into v_set from public.subscription_settings where id;
  v_student := public._subscription_students_row(p_profile_id);

  insert into public.student_subscriptions (student_id, course_id, tariff_id, status, receipt_email)
  values (v_student, v_tariff.course_id, v_tariff.id, 'pending', v_email)
  -- существующую подписку НЕ меняем до оплаты: брошенное оформление другого
  -- тарифа не должно менять цену автосписания (ревью §282, находка 2);
  -- тариф и email уходят в строку платежа и применяются при успехе
  on conflict (student_id, course_id) do update
     set updated_at = now()
  returning id into v_sub;

  insert into public.subscription_consents
    (subscription_id, student_id, profile_id, offer_url, privacy_url,
     accepted_offer, is_minor, parent_consent, save_card, receipt_email)
  values
    (v_sub, v_student, p_profile_id, v_set.offer_url, v_set.privacy_url,
     true, coalesce(p_is_minor, false), coalesce(p_parent_consent, false),
     coalesce(p_save_card, false), v_email);

  insert into public.subscription_payments
    (subscription_id, student_id, kind, amount_rub, period_months, save_method_requested, tariff_id, receipt_email)
  values
    (v_sub, v_student, 'initial', v_tariff.price_rub, v_tariff.period_months, coalesce(p_save_card, false),
     v_tariff.id, v_email)
  returning id into v_pay;

  return jsonb_build_object(
    'payment_id',       v_pay,
    'subscription_id',  v_sub,
    'amount_rub',       v_tariff.price_rub,
    'description',      'Подписка «' || v_tariff.title || '»',
    'tariff_title',     v_tariff.title,
    'receipt_email',    v_email,
    'receipt_vat_code', v_tariff.receipt_vat_code,
    'save_card',        coalesce(p_save_card, false)
  );
end $$;

create or replace function public.subscription_apply_payment(
  p_yookassa_id    text,
  p_our_payment_id uuid,          -- metadata.payment_id: на случай, если attach не успел
  p_status         text,          -- pending | waiting_for_capture | succeeded | canceled
  p_amount_rub     numeric,
  p_method_id      text,
  p_method_saved   boolean,
  p_card_title     text,
  p_cancel_reason  text,
  p_paid_at        timestamptz
)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_pay   public.subscription_payments%rowtype;
  v_sub   public.student_subscriptions%rowtype;
  v_start timestamptz;
  v_end   timestamptz;
begin
  select * into v_pay from public.subscription_payments
   where yookassa_payment_id = p_yookassa_id
   for update;
  if not found and p_our_payment_id is not null then
    select * into v_pay from public.subscription_payments
     where id = p_our_payment_id and yookassa_payment_id is null
     for update;
    if found then
      update public.subscription_payments set yookassa_payment_id = p_yookassa_id where id = v_pay.id;
    end if;
  end if;
  if not found then
    insert into public.subscription_log (event, yookassa_object_id, details)
    values ('payment_unknown', p_yookassa_id, jsonb_build_object('status', p_status));
    return 'unknown';
  end if;

  if v_pay.status in ('succeeded','canceled','refunded','failed') then
    insert into public.subscription_log (subscription_id, payment_id, event, yookassa_object_id, details)
    values (v_pay.subscription_id, v_pay.id, 'payment_duplicate', p_yookassa_id,
            jsonb_build_object('have', v_pay.status, 'got', p_status));
    return 'duplicate';
  end if;

  if p_status in ('pending','waiting_for_capture') then
    update public.subscription_payments set status = p_status where id = v_pay.id;
    return 'pending';
  end if;

  if p_status = 'canceled' then
    update public.subscription_payments
       set status = 'canceled', cancellation_reason = p_cancel_reason
     where id = v_pay.id;
    insert into public.subscription_log (subscription_id, payment_id, event, yookassa_object_id, details)
    values (v_pay.subscription_id, v_pay.id, 'payment_canceled', p_yookassa_id,
            jsonb_build_object('reason', p_cancel_reason));
    if v_pay.kind = 'renewal' then
      return public._subscription_renewal_failed(v_pay.subscription_id, p_cancel_reason);
    end if;
    return 'canceled';
  end if;

  if p_status <> 'succeeded' then
    raise exception 'Неизвестный статус платежа: %', p_status;
  end if;

  if p_amount_rub is distinct from v_pay.amount_rub then
    insert into public.subscription_log (subscription_id, payment_id, event, yookassa_object_id, details)
    values (v_pay.subscription_id, v_pay.id, 'amount_mismatch', p_yookassa_id,
            jsonb_build_object('expected', v_pay.amount_rub, 'got', p_amount_rub));
    -- платёж закрывается (иначе открытое автосписание блокирует следующие,
    -- ревью §282, находка 5); деньги — разбор админом по журналу
    update public.subscription_payments
       set status = 'failed', cancellation_reason = 'amount_mismatch'
     where id = v_pay.id;
    if v_pay.kind = 'renewal' then
      perform public._subscription_renewal_failed(v_pay.subscription_id, 'amount_mismatch');
    end if;
    return 'amount_mismatch';
  end if;

  select * into v_sub from public.student_subscriptions where id = v_pay.subscription_id for update;

  -- Пока доступ открыт, новый период идёт с конца текущего, а не с сегодня:
  -- досрочная оплата не сгорает, а успешный повтор после past_due не дарит
  -- дни, которые ученик и так провёл с доступом.
  v_start := case when v_sub.status in ('trial','active','past_due')
                       and v_sub.access_until > now()
                       and v_sub.current_period_end is not null
                  then v_sub.current_period_end
                  else now() end;
  v_end := v_start + make_interval(months => v_pay.period_months);

  update public.subscription_payments
     set status = 'succeeded', paid_at = coalesce(p_paid_at, now())
   where id = v_pay.id;

  if v_pay.save_method_requested and coalesce(p_method_saved, false) and p_method_id is not null then
    insert into public.subscription_payment_methods (subscription_id, yookassa_method_id)
    values (v_sub.id, p_method_id)
    on conflict (subscription_id) do update
       set yookassa_method_id = excluded.yookassa_method_id, saved_at = now();
  end if;

  update public.student_subscriptions
     set tariff_id     = coalesce(v_pay.tariff_id, tariff_id),
         receipt_email = coalesce(v_pay.receipt_email, receipt_email)
   where id = v_sub.id;

  update public.student_subscriptions
     set status             = 'active',
         source             = case when source = 'manual' then source else 'purchase' end,
         current_period_end = v_end,
         access_until       = v_end,
         auto_renew         = case
                                when v_pay.save_method_requested and coalesce(p_method_saved, false)
                                     and p_method_id is not null then true
                                else auto_renew
                              end,
         card_title         = coalesce(p_card_title, card_title),
         charge_attempts    = 0,
         last_charge_error  = null,
         cancelled_at       = null
   where id = v_sub.id;

  update public.student_subscriptions
     set next_charge_at = case
                            when auto_renew and exists (select 1 from public.subscription_payment_methods m
                                                         where m.subscription_id = v_sub.id)
                            then v_end else null end
   where id = v_sub.id;

  insert into public.subscription_log (subscription_id, payment_id, event, yookassa_object_id, details)
  values (v_sub.id, v_pay.id, 'payment_succeeded', p_yookassa_id,
          jsonb_build_object('period_end', v_end, 'kind', v_pay.kind));

  perform public._subscription_enroll(v_sub.id);
  perform public._subscription_notify(v_sub.id,
    case when v_pay.kind = 'renewal' then 'Подписка продлена' else 'Подписка оформлена' end,
    'Курс открыт до ' || to_char(v_end at time zone 'Europe/Moscow', 'DD.MM.YYYY') || '.',
    'paid:' || v_pay.id);
  return 'succeeded';
end $$;

create or replace function public.subscription_renewal_begin(p_subscription_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sub    public.student_subscriptions%rowtype;
  v_tariff public.subscription_tariffs%rowtype;
  v_method text;
  v_pay    uuid;
  v_amount numeric;
  v_months smallint;
begin
  select * into v_sub from public.student_subscriptions where id = p_subscription_id for update;
  if not found or not v_sub.auto_renew or v_sub.status not in ('active','past_due') then
    return null;
  end if;
  select yookassa_method_id into v_method from public.subscription_payment_methods
   where subscription_id = p_subscription_id;
  if v_method is null then return null; end if;
  select * into v_tariff from public.subscription_tariffs where id = v_sub.tariff_id;

  select p.id, p.amount_rub, p.period_months into v_pay, v_amount, v_months
    from public.subscription_payments p
   where p.subscription_id = p_subscription_id and p.kind = 'renewal' and p.status = 'created';

  if v_pay is null and not (v_sub.next_charge_at <= now() + interval '2 hours') then
    -- параллельный запуск уже списал и сдвинул срок (ревью §282, находка 3)
    return null;
  end if;

  if v_pay is null then
    -- цена — текущая цена тарифа (владелец мог её поменять)
    insert into public.subscription_payments
      (subscription_id, student_id, kind, amount_rub, period_months, save_method_requested)
    values (v_sub.id, v_sub.student_id, 'renewal', v_tariff.price_rub, v_tariff.period_months, false)
    returning id, amount_rub, period_months into v_pay, v_amount, v_months;
  end if;

  return jsonb_build_object(
    'payment_id',         v_pay,
    'subscription_id',    v_sub.id,
    'amount_rub',         v_amount,
    'yookassa_method_id', v_method,
    'description',        'Подписка «' || v_tariff.title || '» — автопродление',
    'receipt_email',      v_sub.receipt_email,
    'receipt_vat_code',   v_tariff.receipt_vat_code
  );
end $$;

create or replace function public.my_subscriptions()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                 s.id,
           'course_id',          s.course_id,
           'course_title',       c.title,
           'group_id',           (select g.id from public.groups g where g.course_id = s.course_id
                                   order by g.created_at limit 1),
           'tariff_id',          s.tariff_id,
           'tariff_title',       t.title,
           'price_rub',          t.price_rub,
           'period_months',      t.period_months,
           'status',             s.status,
           'has_access',         s.status in ('trial','active','past_due') and s.access_until > now(),
           'current_period_end', s.current_period_end,
           'access_until',       s.access_until,
           'auto_renew',         s.auto_renew,
           'can_auto_renew',     exists (select 1 from public.subscription_payment_methods m
                                          where m.subscription_id = s.id),
           'next_charge_at',     s.next_charge_at,
           'last_charge_error',  s.last_charge_error,
           'card_title',         s.card_title,
           'payments',           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', p.id, 'kind', p.kind, 'amount_rub', p.amount_rub,
                      'status', p.status, 'paid_at', p.paid_at, 'created_at', p.created_at,
                      'refunded_at', p.refunded_at)
                    order by p.created_at desc)
               from public.subscription_payments p
              where p.subscription_id = s.id and p.status <> 'created'), '[]'::jsonb)
         ) order by s.created_at), '[]'::jsonb)
    from public.student_subscriptions s
    join public.courses c on c.id = s.course_id
    join public.subscription_tariffs t on t.id = s.tariff_id
   where s.student_id = public.auth_student_id();
$$;

-- Возврат с суммой: закрываем доступ только при полном возврате платежа.
create function public.subscription_apply_refund(p_yookassa_payment_id text, p_refund_id text, p_refund_rub numeric)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_pay public.subscription_payments%rowtype;
begin
  select * into v_pay from public.subscription_payments
   where yookassa_payment_id = p_yookassa_payment_id for update;
  if found and p_refund_rub is not null and p_refund_rub < v_pay.amount_rub then
    insert into public.subscription_log (subscription_id, payment_id, event, yookassa_object_id, details)
    values (v_pay.subscription_id, v_pay.id, 'refund_partial', p_refund_id,
            jsonb_build_object('refund_rub', p_refund_rub, 'payment_rub', v_pay.amount_rub));
    return 'partial';
  end if;
  return public.subscription_apply_refund(p_yookassa_payment_id, p_refund_id);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Права: служебные — только service_role
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public._subscription_mail_enqueue(uuid, text, text)',
    'public.subscription_mail_claim(int)',
    'public.subscription_mail_done(bigint, boolean, text, text)',
    'public._subscription_notify(uuid, text, text, text)',
    'public.subscription_renewal_due(int)',
    'public.subscription_expire_tick()',
    'public._subscription_renewal_failed(uuid, text)',
    'public.subscription_checkout_begin(uuid, uuid, boolean, boolean, boolean, boolean, text)',
    'public.subscription_apply_payment(text, uuid, text, numeric, text, boolean, text, text, timestamptz)',
    'public.subscription_renewal_begin(uuid)',
    'public.subscription_apply_refund(text, text, numeric)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'revoke all on function public.subscription_set_auto_renew(uuid, boolean) from public, anon';
  execute 'revoke all on function public.my_subscriptions() from public, anon';
  execute 'grant execute on function public.my_subscriptions() to authenticated, service_role';
  execute 'grant execute on function public.subscription_set_auto_renew(uuid, boolean) to authenticated, service_role';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. pg_cron: автосписание и письма раз в час (как student-reminders:
--    секрет из vault 'cron_secret', в тексте команды его нет).
-- ─────────────────────────────────────────────────────────────────────────

do $mig$
begin
  if to_regclass('cron.job') is not null
     and not exists (select 1 from cron.job where jobname = 'subscription-renew') then
    perform cron.schedule(
      'subscription-renew',
      '7 * * * *',
      $cron$
    SELECT net.http_post(
      url     := 'https://kthfozyfruorwjhvvsbw.supabase.co/functions/v1/subscription-renew',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
      ),
      body    := '{}'::jsonb
    );
  $cron$
    );
  end if;
end
$mig$;
