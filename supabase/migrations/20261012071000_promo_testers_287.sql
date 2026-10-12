-- §287 — промокоды и режим «только тестировщики» (решения владельца 10.10).
--
-- PENDING: применяет оркестратор после «да» владельца; применять ПОСЛЕ
-- PENDING_282_2 (порядок не важен для корректности, но так по номерам).
--
-- Только добавление и замена СВОИХ функций §282 (таблицы §282 пусты):
--   • новые таблицы: subscription_testers, subscription_promo_codes,
--     subscription_promo_redemptions, subscription_promo_attempts;
--   • новые столбцы своих таблиц §282: subscription_settings.audience,
--     subscription_payments.promo_redemption_id / discount_rub;
--   • create or replace своих функций §282: subscription_tariffs_public,
--     subscription_start_trial, subscription_checkout_begin (7 арг. —
--     делегирует новой перегрузке с промокодом), subscription_apply_payment,
--     subscription_payment_failed, subscription_renewal_begin, my_subscriptions,
--     _subscription_students_row (гонка первых оформлений, см. раздел 3),
--     subscription_expire_tick (+ очистка зависших резервов промокодов).
-- Политики и данные чужих таблиц не меняются. Доступ к курсу (RLS) промокод
-- не трогает: он влияет только на строку подписки и сумму платежа.
--
-- Режим флага: app_feature_flags.subscriptions (вкл/выкл) × audience:
--   выкл                 → off (как раньше);
--   вкл + 'testers'      → экраны и оформление только профилям из
--                          subscription_testers, остальным — как off;
--   вкл + 'everyone'     → on.
-- По умолчанию audience = 'testers': включение флага сначала открывает
-- подписку только тестировщикам.
--
-- Промокоды — три вида: скидка в % (на первый платёж или N платежей подряд,
-- включая автопродления), бесплатные дни, бесплатные месяцы (без карты).
-- Проверка и расчёт — только здесь. Отказ — один ответ «Промокод не подходит»
-- без причины (причина — в журнале для админа). Попытки ограничены:
-- 10 неудачных за 15 минут и 30 за сутки на профиль.
-- Погашение атомарно: счётчик использований растёт условным UPDATE под
-- блокировкой строки кода (check used_count <= max_uses — вторая страховка),
-- «один раз на ученика» — уникальный ключ (code_id, student_id).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Тестировщики и режим
-- ─────────────────────────────────────────────────────────────────────────

alter table public.subscription_settings
  add column audience text not null default 'testers'
  check (audience in ('testers', 'everyone'));

create table public.subscription_testers (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  note       text,
  added_at   timestamptz not null default now(),
  added_by   uuid references public.profiles(id) on delete set null
);

alter table public.subscription_testers enable row level security;
create policy subscription_testers_admin on public.subscription_testers
  for all to authenticated
  using (public.is_admin_or_owner()) with check (public.is_admin_or_owner());
revoke all on public.subscription_testers from anon, authenticated;
grant select, insert, update, delete on public.subscription_testers to authenticated;

-- Подписка включена для этого профиля? Единственное место правила режима.
create function public.subscription_enabled_for(p_profile_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.app_flag('subscriptions')
     and (coalesce((select s.audience from public.subscription_settings s where s.id), 'testers') = 'everyone'
          or exists (select 1 from public.subscription_testers t where t.profile_id = p_profile_id));
$$;

create function public.subscription_enabled()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.subscription_enabled_for(auth.uid());
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Промокоды
-- ─────────────────────────────────────────────────────────────────────────

create table public.subscription_promo_codes (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^[A-Z0-9-]{4,32}$'),
  kind              text not null check (kind in ('percent', 'free_days', 'free_months')),
  percent           smallint check (percent between 1 and 100),
  -- на сколько платежей подряд действует скидка (1 — только первый)
  discount_payments smallint not null default 1 check (discount_payments between 1 and 24),
  free_days         smallint check (free_days between 1 and 366),
  free_months       smallint check (free_months between 1 and 24),
  course_id         uuid references public.courses(id) on delete cascade,
  tariff_id         uuid references public.subscription_tariffs(id) on delete cascade,
  max_uses          int check (max_uses >= 1),
  used_count        int not null default 0 check (used_count >= 0),
  valid_from        timestamptz,
  valid_until       timestamptz,
  is_active         boolean not null default true,
  batch             text,
  note              text,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((kind = 'percent')     = (percent is not null)),
  check ((kind = 'free_days')   = (free_days is not null)),
  check ((kind = 'free_months') = (free_months is not null)),
  check (max_uses is null or used_count <= max_uses),
  check (valid_from is null or valid_until is null or valid_until > valid_from)
);

create index subscription_promo_codes_batch_idx on public.subscription_promo_codes (batch) where batch is not null;

create trigger subscription_promo_codes_updated_at
  before update on public.subscription_promo_codes
  for each row execute function public.update_updated_at();

-- Погашение. reserved — код зарезервирован под платёж, который ещё не прошёл
-- (отказ/отмена платежа — строка удаляется, использование возвращается);
-- applied — скидка/бесплатный период получены.
create table public.subscription_promo_redemptions (
  id              uuid primary key default gen_random_uuid(),
  code_id         uuid not null references public.subscription_promo_codes(id) on delete restrict,
  student_id      uuid not null references public.students(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid references public.student_subscriptions(id) on delete set null,
  tariff_id       uuid references public.subscription_tariffs(id) on delete set null,
  kind            text not null,
  percent         smallint,
  payments_total  smallint not null default 0,
  -- сколько ещё платежей пойдут со скидкой (уменьшается при успешной оплате)
  payments_left   smallint not null default 0 check (payments_left >= 0),
  status          text not null default 'reserved' check (status in ('reserved', 'applied')),
  saved_rub       numeric(10,2) not null default 0,
  created_at      timestamptz not null default now(),
  applied_at      timestamptz,
  unique (code_id, student_id)
);

create index subscription_promo_redemptions_sub_idx
  on public.subscription_promo_redemptions (subscription_id) where status = 'applied';

-- Попытки ввода — для ограничения перебора. Только definer-функции.
create table public.subscription_promo_attempts (
  id         bigint generated always as identity primary key,
  profile_id uuid not null,
  ok         boolean not null,
  created_at timestamptz not null default now()
);
create index subscription_promo_attempts_profile_idx
  on public.subscription_promo_attempts (profile_id, created_at desc);

alter table public.subscription_promo_codes enable row level security;
alter table public.subscription_promo_redemptions enable row level security;
alter table public.subscription_promo_attempts enable row level security;

create policy subscription_promo_codes_admin on public.subscription_promo_codes
  for select to authenticated using (public.is_admin_or_owner());
create policy subscription_promo_redemptions_admin on public.subscription_promo_redemptions
  for select to authenticated using (public.is_admin_or_owner());

revoke all on public.subscription_promo_codes from anon, authenticated;
revoke all on public.subscription_promo_redemptions from anon, authenticated;
revoke all on public.subscription_promo_attempts from anon, authenticated;
grant select on public.subscription_promo_codes to authenticated;
grant select on public.subscription_promo_redemptions to authenticated;

alter table public.subscription_payments
  add column promo_redemption_id uuid references public.subscription_promo_redemptions(id) on delete set null,
  add column discount_rub numeric(10,2) not null default 0 check (discount_rub >= 0);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Внутренние помощники промокодов (только definer-вызовы)
-- ─────────────────────────────────────────────────────────────────────────

create function public._promo_normalize(p_code text)
returns text
language sql immutable
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
$$;

-- 'RATE_LIMIT' — слишком много неудачных попыток, иначе null.
create function public._promo_rate_limited(p_profile_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select (select count(*) from public.subscription_promo_attempts a
           where a.profile_id = p_profile_id and not a.ok
             and a.created_at > now() - interval '15 minutes') >= 10
      or (select count(*) from public.subscription_promo_attempts a
           where a.profile_id = p_profile_id and not a.ok
             and a.created_at > now() - interval '1 day') >= 30;
$$;

-- Отказ: попытка в счёт лимита + журнал с причиной (только для админа).
create function public._promo_reject(p_profile_id uuid, p_code text, p_reason text, p_tariff_id uuid, p_stage text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- в счёт перебора идут только догадки; состояние своей подписки — нет
  if p_reason not in ('rate_limit', 'promo_active', 'busy', 'reserved_elsewhere') then
    insert into public.subscription_promo_attempts (profile_id, ok) values (p_profile_id, false);
  end if;
  insert into public.subscription_log (actor, event, details)
  values (p_profile_id, 'promo_rejected',
          jsonb_build_object('reason', p_reason, 'code', left(p_code, 32), 'tariff_id', p_tariff_id, 'stage', p_stage));
  return case p_reason
    when 'rate_limit' then jsonb_build_object('ok', false, 'error_code', 'RATE_LIMIT',
      'error', 'Слишком много попыток ввода промокода. Попробуйте позже.')
    when 'promo_active' then jsonb_build_object('ok', false, 'error_code', 'PROMO_ACTIVE',
      'error', 'По этой подписке уже действует скидка по промокоду')
    when 'busy' then jsonb_build_object('ok', false, 'error_code', 'PROMO_BUSY',
      'error', 'Оплата с этим промокодом уже начата. Завершите её или попробуйте через час.')
    else jsonb_build_object('ok', false, 'error_code', 'PROMO_INVALID', 'error', 'Промокод не подходит')
  end;
end $$;

-- Подходит ли код к тарифу для ученика. Возвращает причину отказа или null.
create function public._promo_unfit_reason(
  p_code public.subscription_promo_codes, p_tariff public.subscription_tariffs, p_student_id uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when p_code.id is null then 'not_found'
    when not p_code.is_active then 'inactive'
    when p_code.valid_from is not null and now() < p_code.valid_from then 'not_started'
    when p_code.valid_until is not null and now() >= p_code.valid_until then 'expired'
    when p_code.course_id is not null and p_code.course_id <> p_tariff.course_id then 'wrong_course'
    when p_code.tariff_id is not null and p_code.tariff_id <> p_tariff.id then 'wrong_tariff'
    when p_student_id is not null and exists (
           select 1 from public.subscription_promo_redemptions r
            where r.code_id = p_code.id and r.student_id = p_student_id and r.status = 'applied') then 'already_used'
    -- свой резерв (брошенная оплата этим же кодом) лимит не занимает повторно
    when p_code.max_uses is not null and p_code.used_count >= p_code.max_uses
         and not exists (select 1 from public.subscription_promo_redemptions r
                          where r.code_id = p_code.id and r.student_id = p_student_id and r.status = 'reserved') then 'limit'
    else null
  end;
$$;

-- Цена со скидкой, ₽. Меньше 1 ₽ ЮKassa не принимает — такая скидка
-- считается полной (платёж не создаётся).
create function public._promo_price(p_price numeric, p_percent smallint)
returns numeric
language sql immutable
as $$
  select case when r < 1 then 0 else r end
    from (select round(p_price * (100 - coalesce(p_percent, 0)) / 100.0, 2) as r) x;
$$;

-- Действующая скидка подписки (код погашен, остались платежи со скидкой) —
-- только для того тарифа, под который код применён: смена тарифа (месяц →
-- год) скидку не переносит (ревью §287, находка 2).
create function public._promo_active_for(p_subscription_id uuid, p_tariff_id uuid)
returns public.subscription_promo_redemptions
language sql stable security definer
set search_path = public, pg_temp
as $$
  select r.* from public.subscription_promo_redemptions r
   where r.subscription_id = p_subscription_id and r.status = 'applied'
     and r.kind = 'percent' and r.payments_left > 0
     and (r.tariff_id is null or r.tariff_id = p_tariff_id)
   order by r.created_at desc
   limit 1;
$$;

-- Платёж с промокодом прошёл: скидка учтена. Слот «платёж со скидкой» взят
-- ещё при создании платежа (ревью §287, находка 1) — здесь не уменьшается.
create function public._promo_payment_succeeded(p_payment_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_pay public.subscription_payments%rowtype;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id;
  if v_pay.promo_redemption_id is null then return; end if;
  update public.subscription_promo_redemptions
     set status = 'applied',
         applied_at = coalesce(applied_at, now()),
         saved_rub = saved_rub + v_pay.discount_rub
   where id = v_pay.promo_redemption_id;
  insert into public.subscription_log (subscription_id, payment_id, event, details)
  values (v_pay.subscription_id, v_pay.id, 'promo_payment',
          jsonb_build_object('redemption_id', v_pay.promo_redemption_id, 'discount_rub', v_pay.discount_rub));
end $$;

-- Платёж со скидкой не прошёл. Если код ещё только зарезервирован и его не
-- держит другой живой платёж — резерв снимается, использование возвращается;
-- иначе возвращается слот «платёж со скидкой», взятый этим платежом.
-- Строка 'created' старше суток (оборвался ответ ЮKassa) живой не считается.
create function public._promo_payment_released(p_payment_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_pay  public.subscription_payments%rowtype;
  v_code uuid;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id;
  if v_pay.promo_redemption_id is null then return; end if;
  delete from public.subscription_promo_redemptions r
   where r.id = v_pay.promo_redemption_id and r.status = 'reserved'
     and not exists (select 1 from public.subscription_payments p
                      where p.promo_redemption_id = r.id and p.id <> v_pay.id
                        and (p.status in ('pending','waiting_for_capture','succeeded')
                             or (p.status = 'created' and p.created_at > now() - interval '1 day')))
  returning r.code_id into v_code;
  if v_code is not null then
    update public.subscription_promo_codes set used_count = greatest(used_count - 1, 0) where id = v_code;
    insert into public.subscription_log (subscription_id, payment_id, event, details)
    values (v_pay.subscription_id, v_pay.id, 'promo_released', jsonb_build_object('code_id', v_code));
  else
    update public.subscription_promo_redemptions
       set payments_left = least(payments_left + 1, payments_total)
     where id = v_pay.promo_redemption_id;
    insert into public.subscription_log (subscription_id, payment_id, event, details)
    values (v_pay.subscription_id, v_pay.id, 'promo_slot_returned',
            jsonb_build_object('redemption_id', v_pay.promo_redemption_id));
  end if;
end $$;

-- Платёж 'created' старше суток с промокодом (ответ ЮKassa так и не пришёл):
-- резерв/слот освобождается, связь платежа с кодом снимается (второй раз не
-- освободится). Статус платежа не трогаем: если ЮKassa всё же его создала,
-- вебхук найдёт строку по metadata. Ревью §287, находка 4.
create function public._promo_sweep_stale()
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r   record;
  v_n int := 0;
begin
  for r in
    select p.id from public.subscription_payments p
     where p.status = 'created' and p.promo_redemption_id is not null
       and p.created_at < now() - interval '1 day'
     for update skip locked
  loop
    perform public._promo_payment_released(r.id);
    update public.subscription_payments set promo_redemption_id = null where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Бесплатный период по промокоду: без платежа и без карты. Если доступ уже
-- открыт — период продлевается с его конца (и автосписание сдвигается).
create function public._subscription_promo_grant(
  p_sub_id uuid, p_redemption_id uuid, p_interval interval, p_saved numeric, p_status text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sub  public.student_subscriptions%rowtype;
  v_base timestamptz;
  v_end  timestamptz;
begin
  select * into v_sub from public.student_subscriptions where id = p_sub_id for update;
  v_base := case when v_sub.status in ('trial','active','past_due') and v_sub.access_until > now()
                      and v_sub.current_period_end is not null
                 then greatest(v_sub.current_period_end, now()) else now() end;
  v_end := v_base + p_interval;
  update public.student_subscriptions
     set status = case when v_sub.status in ('active','past_due') and v_sub.access_until > now()
                       then 'active' else p_status end,
         source = case when source = 'purchase' and status in ('active','past_due') then source else 'manual' end,
         current_period_end = v_end,
         access_until = v_end,
         next_charge_at = case when auto_renew then v_end else null end,
         charge_attempts = 0,
         last_charge_error = null,
         cancelled_at = null
   where id = p_sub_id;
  update public.subscription_promo_redemptions
     set status = 'applied', applied_at = coalesce(applied_at, now()), saved_rub = saved_rub + p_saved
   where id = p_redemption_id;
  insert into public.subscription_log (subscription_id, event, details)
  values (p_sub_id, 'promo_redeemed', jsonb_build_object('redemption_id', p_redemption_id, 'until', v_end, 'free', true));
  perform public._subscription_enroll(p_sub_id);
  perform public._subscription_notify(p_sub_id, 'Промокод применён',
    'Курс открыт до ' || to_char(v_end at time zone 'Europe/Moscow', 'DD.MM.YYYY') || '.',
    'promo:' || p_redemption_id);
  return jsonb_build_object('free', true, 'subscription_id', p_sub_id, 'access_until', v_end);
end $$;

-- Строка students для профиля. Параллельные первые оформления одного ученика
-- падали на students_profile_id_key (нашёл тест гонки §287) — теперь ждут
-- друг друга на уникальном ключе и берут одну строку.
create or replace function public._subscription_students_row(p_profile_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
begin
  select s.id into v_student from public.students s where s.profile_id = p_profile_id;
  if v_student is null then
    insert into public.students (profile_id) values (p_profile_id)
    on conflict (profile_id) do nothing
    returning id into v_student;
    if v_student is null then
      select s.id into v_student from public.students s where s.profile_id = p_profile_id;
    end if;
  end if;
  return v_student;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Ученик: проверка кода (без погашения)
-- ─────────────────────────────────────────────────────────────────────────

create function public.subscription_promo_check(p_tariff_id uuid, p_code text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid := auth.uid();
  v_norm    text := public._promo_normalize(p_code);
  v_tariff  public.subscription_tariffs%rowtype;
  v_code    public.subscription_promo_codes%rowtype;
  v_student uuid;
  v_reason  text;
  v_amount  numeric;
begin
  if v_profile is null then
    raise exception 'Требуется вход' using errcode = '42501';
  end if;
  if not public.subscription_enabled_for(v_profile) then
    raise exception 'Оформление подписки сейчас недоступно' using errcode = 'P0001', hint = 'FLAG_OFF';
  end if;
  select * into v_tariff from public.subscription_tariffs where id = p_tariff_id and is_active;
  if not found then
    raise exception 'Тариф не найден или выключен' using errcode = 'P0001', hint = 'TARIFF_INACTIVE';
  end if;
  if public._promo_rate_limited(v_profile) then
    return public._promo_reject(v_profile, v_norm, 'rate_limit', p_tariff_id, 'check');
  end if;
  if v_norm !~ '^[A-Z0-9-]{4,32}$' then
    return public._promo_reject(v_profile, v_norm, 'bad_format', p_tariff_id, 'check');
  end if;
  select s.id into v_student from public.students s where s.profile_id = v_profile;
  if v_student is not null and (public._promo_active_for(
       (select ss.id from public.student_subscriptions ss
         where ss.student_id = v_student and ss.course_id = v_tariff.course_id), v_tariff.id)).id is not null then
    return public._promo_reject(v_profile, v_norm, 'promo_active', p_tariff_id, 'check');
  end if;
  select * into v_code from public.subscription_promo_codes where code = v_norm;
  v_reason := public._promo_unfit_reason(v_code, v_tariff, v_student);
  if v_reason is not null then
    return public._promo_reject(v_profile, v_norm, v_reason, p_tariff_id, 'check');
  end if;
  insert into public.subscription_promo_attempts (profile_id, ok) values (v_profile, true);
  v_amount := case when v_code.kind = 'percent' then public._promo_price(v_tariff.price_rub, v_code.percent) else 0 end;
  return jsonb_build_object(
    'ok',                true,
    'code',              v_code.code,
    'kind',              v_code.kind,
    'percent',           v_code.percent,
    'discount_payments', case when v_code.kind = 'percent' then v_code.discount_payments end,
    'free_days',         v_code.free_days,
    'free_months',       v_code.free_months,
    'price_rub',         v_tariff.price_rub,
    'amount_rub',        v_amount,
    'free',              v_amount = 0
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Оформление с промокодом (вызывает edge-функция subscription-checkout)
--    Отказы по промокоду — не исключение, а ответ { error_code, error }:
--    исключение откатило бы запись попытки и журнал.
-- ─────────────────────────────────────────────────────────────────────────

create function public.subscription_checkout_begin(
  p_profile_id     uuid,
  p_tariff_id      uuid,
  p_save_card      boolean,
  p_is_minor       boolean,
  p_parent_consent boolean,
  p_accepted_offer boolean,
  p_receipt_email  text,
  p_promo_code     text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_role     text;
  v_tariff   public.subscription_tariffs%rowtype;
  v_set      public.subscription_settings%rowtype;
  v_code     public.subscription_promo_codes%rowtype;
  v_active   public.subscription_promo_redemptions%rowtype;
  v_student  uuid;
  v_sub      uuid;
  v_pay      uuid;
  v_red      uuid;
  v_red_sub  uuid;
  v_norm     text := nullif(public._promo_normalize(p_promo_code), '');
  v_email    text := nullif(btrim(p_receipt_email), '');
  v_reason   text;
  v_amount   numeric;
  v_percent  smallint;
begin
  if not public.subscription_enabled_for(p_profile_id) then
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
  -- существующую подписку НЕ меняем до оплаты (ревью §282, находка 2)
  on conflict (student_id, course_id) do update set updated_at = now()
  returning id into v_sub;

  v_active := public._promo_active_for(v_sub, v_tariff.id);

  if v_norm is not null then
    if public._promo_rate_limited(p_profile_id) then
      return public._promo_reject(p_profile_id, v_norm, 'rate_limit', p_tariff_id, 'checkout');
    end if;
    if v_norm !~ '^[A-Z0-9-]{4,32}$' then
      return public._promo_reject(p_profile_id, v_norm, 'bad_format', p_tariff_id, 'checkout');
    end if;
    if v_active.id is not null then
      return public._promo_reject(p_profile_id, v_norm, 'promo_active', p_tariff_id, 'checkout');
    end if;
    -- блокировка строки кода: одновременные погашения идут по очереди
    select * into v_code from public.subscription_promo_codes where code = v_norm for update;
    v_reason := public._promo_unfit_reason(v_code, v_tariff, v_student);
    if v_reason is not null then
      return public._promo_reject(p_profile_id, v_norm, v_reason, p_tariff_id, 'checkout');
    end if;
    -- повторное оформление после брошенной оплаты — тот же резерв, но только
    -- в той же подписке (ревью §287, находка 3)
    select r.id, r.subscription_id into v_red, v_red_sub from public.subscription_promo_redemptions r
     where r.code_id = v_code.id and r.student_id = v_student and r.status = 'reserved';
    if v_red is not null and v_red_sub is distinct from v_sub then
      return public._promo_reject(p_profile_id, v_norm, 'reserved_elsewhere', p_tariff_id, 'checkout');
    end if;
    if v_red is null then
      update public.subscription_promo_codes
         set used_count = used_count + 1
       where id = v_code.id and (max_uses is null or used_count < max_uses);
      if not found then
        return public._promo_reject(p_profile_id, v_norm, 'limit', p_tariff_id, 'checkout');
      end if;
      insert into public.subscription_promo_redemptions
        (code_id, student_id, profile_id, subscription_id, tariff_id, kind, percent, payments_total, payments_left)
      values
        (v_code.id, v_student, p_profile_id, v_sub, v_tariff.id, v_code.kind, v_code.percent,
         case when v_code.kind = 'percent' then v_code.discount_payments else 0 end,
         case when v_code.kind = 'percent' then v_code.discount_payments else 0 end)
      returning id into v_red;
    end if;
    insert into public.subscription_promo_attempts (profile_id, ok) values (p_profile_id, true);
    insert into public.subscription_log (subscription_id, actor, event, details)
    values (v_sub, p_profile_id, 'promo_reserved',
            jsonb_build_object('code', v_code.code, 'kind', v_code.kind, 'redemption_id', v_red));
    v_percent := v_code.percent;
  elsif v_active.id is not null then
    -- скидка на N платежей подряд: ручная оплата следующего периода тоже со скидкой
    v_red := v_active.id;
    v_percent := v_active.percent;
  end if;

  insert into public.subscription_consents
    (subscription_id, student_id, profile_id, offer_url, privacy_url,
     accepted_offer, is_minor, parent_consent, save_card, receipt_email)
  values
    (v_sub, v_student, p_profile_id, v_set.offer_url, v_set.privacy_url,
     true, coalesce(p_is_minor, false), coalesce(p_parent_consent, false),
     coalesce(p_save_card, false), v_email);

  -- бесплатные виды и скидка «до нуля» — без платежа
  if v_code.id is not null and v_code.kind <> 'percent' then
    update public.student_subscriptions set tariff_id = v_tariff.id, receipt_email = v_email where id = v_sub;
    return public._subscription_promo_grant(v_sub, v_red,
      case when v_code.kind = 'free_days' then make_interval(days => v_code.free_days)
           else make_interval(months => v_code.free_months) end,
      case when v_code.kind = 'free_days'
           then round(v_tariff.price_rub * v_code.free_days / (30.0 * v_tariff.period_months), 2)
           else round(v_tariff.price_rub * v_code.free_months / v_tariff.period_months, 2) end,
      case when v_code.kind = 'free_days' then 'trial' else 'active' end);
  end if;

  -- слот «платёж со скидкой» берётся сразу: два незавершённых платежа не
  -- потратят одну скидку дважды (ревью §287, находка 1); вернётся при отказе
  if v_percent is not null then
    update public.subscription_promo_redemptions
       set payments_left = payments_left - 1
     where id = v_red and payments_left > 0;
    if not found then
      if v_code.id is not null then
        -- свой резерв, но все платежи со скидкой уже заняты незавершённой оплатой
        return public._promo_reject(p_profile_id, v_norm, 'busy', p_tariff_id, 'checkout');
      end if;
      v_red := null;
      v_percent := null;
    end if;
  end if;

  v_amount := case when v_percent is null then v_tariff.price_rub
                   else public._promo_price(v_tariff.price_rub, v_percent) end;

  if v_amount = 0 then
    update public.student_subscriptions set tariff_id = v_tariff.id, receipt_email = v_email where id = v_sub;
    return public._subscription_promo_grant(v_sub, v_red,
      make_interval(months => v_tariff.period_months), v_tariff.price_rub, 'active')
      || jsonb_build_object('payments_left', (select payments_left from public.subscription_promo_redemptions where id = v_red));
  end if;

  insert into public.subscription_payments
    (subscription_id, student_id, kind, amount_rub, period_months, save_method_requested, tariff_id, receipt_email,
     promo_redemption_id, discount_rub)
  values
    (v_sub, v_student, 'initial', v_amount, v_tariff.period_months, coalesce(p_save_card, false),
     v_tariff.id, v_email, v_red, v_tariff.price_rub - v_amount)
  returning id into v_pay;

  return jsonb_build_object(
    'payment_id',       v_pay,
    'subscription_id',  v_sub,
    'amount_rub',       v_amount,
    'price_rub',        v_tariff.price_rub,
    'description',      'Подписка «' || v_tariff.title || '»'
                        || case when v_percent is not null then ' — скидка ' || v_percent || ' %' else '' end,
    'tariff_title',     v_tariff.title,
    'receipt_email',    v_email,
    'receipt_vat_code', v_tariff.receipt_vat_code,
    'save_card',        coalesce(p_save_card, false)
  );
end $$;

-- Прежняя сигнатура (задеплоенная edge-функция v1) — то же без промокода.
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
language sql security definer
set search_path = public, pg_temp
as $$
  select public.subscription_checkout_begin(p_profile_id, p_tariff_id, p_save_card, p_is_minor,
                                            p_parent_consent, p_accepted_offer, p_receipt_email, null::text);
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Итог платежа и автосписание — со скидкой по промокоду
--    Тела — как в 20261009224520 (§282 после ревью), добавлены только вызовы
--    _promo_payment_succeeded / _promo_payment_released и расчёт суммы.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.subscription_apply_payment(
  p_yookassa_id    text,
  p_our_payment_id uuid,
  p_status         text,
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
    perform public._promo_payment_released(v_pay.id);
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
    update public.subscription_payments
       set status = 'failed', cancellation_reason = 'amount_mismatch'
     where id = v_pay.id;
    perform public._promo_payment_released(v_pay.id);
    if v_pay.kind = 'renewal' then
      perform public._subscription_renewal_failed(v_pay.subscription_id, 'amount_mismatch');
    end if;
    return 'amount_mismatch';
  end if;

  select * into v_sub from public.student_subscriptions where id = v_pay.subscription_id for update;

  v_start := case when v_sub.status in ('trial','active','past_due')
                       and v_sub.access_until > now()
                       and v_sub.current_period_end is not null
                  then v_sub.current_period_end
                  else now() end;
  v_end := v_start + make_interval(months => v_pay.period_months);

  update public.subscription_payments
     set status = 'succeeded', paid_at = coalesce(p_paid_at, now())
   where id = v_pay.id;

  perform public._promo_payment_succeeded(v_pay.id);

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

create or replace function public.subscription_payment_failed(p_payment_id uuid, p_reason text)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_pay public.subscription_payments%rowtype;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id for update;
  if not found or v_pay.status <> 'created' then return 'skip'; end if;
  update public.subscription_payments set status = 'failed', cancellation_reason = p_reason where id = v_pay.id;
  insert into public.subscription_log (subscription_id, payment_id, event, details)
  values (v_pay.subscription_id, v_pay.id, 'payment_request_failed', jsonb_build_object('reason', p_reason));
  perform public._promo_payment_released(v_pay.id);
  if v_pay.kind = 'renewal' then
    return public._subscription_renewal_failed(v_pay.subscription_id, p_reason);
  end if;
  return 'failed';
end $$;

create or replace function public.subscription_renewal_begin(p_subscription_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sub    public.student_subscriptions%rowtype;
  v_tariff public.subscription_tariffs%rowtype;
  v_promo  public.subscription_promo_redemptions%rowtype;
  v_method text;
  v_pay    uuid;
  v_amount numeric;
  v_months smallint;
  v_end    timestamptz;
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
    return null;
  end if;

  if v_pay is null then
    -- цена — текущая цена тарифа; со скидкой, если по промокоду остались платежи
    v_promo := public._promo_active_for(v_sub.id, v_sub.tariff_id);
    if v_promo.id is not null then
      update public.subscription_promo_redemptions
         set payments_left = payments_left - 1
       where id = v_promo.id and payments_left > 0;
      if not found then v_promo := null; end if;
    end if;
    v_amount := case when v_promo.id is null then v_tariff.price_rub
                     else public._promo_price(v_tariff.price_rub, v_promo.percent) end;

    if v_amount = 0 then
      -- скидка 100 % на этот платёж: период продлевается без списания
      v_end := (case when v_sub.access_until > now() and v_sub.current_period_end is not null
                     then v_sub.current_period_end else now() end)
               + make_interval(months => v_tariff.period_months);
      update public.student_subscriptions
         set status = 'active', current_period_end = v_end, access_until = v_end,
             next_charge_at = v_end, charge_attempts = 0, last_charge_error = null
       where id = v_sub.id;
      update public.subscription_promo_redemptions
         set saved_rub = saved_rub + v_tariff.price_rub
       where id = v_promo.id;
      insert into public.subscription_log (subscription_id, event, details)
      values (v_sub.id, 'promo_free_renewal', jsonb_build_object('redemption_id', v_promo.id, 'until', v_end));
      perform public._subscription_notify(v_sub.id, 'Подписка продлена',
        'По промокоду этот период бесплатный. Курс открыт до '
          || to_char(v_end at time zone 'Europe/Moscow', 'DD.MM.YYYY') || '.',
        'promo-renewal:' || to_char(v_end, 'YYYYMMDD'));
      return null;
    end if;

    insert into public.subscription_payments
      (subscription_id, student_id, kind, amount_rub, period_months, save_method_requested,
       promo_redemption_id, discount_rub)
    values (v_sub.id, v_sub.student_id, 'renewal', v_amount, v_tariff.period_months, false,
            v_promo.id, case when v_promo.id is null then 0 else v_tariff.price_rub - v_amount end)
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

-- Статусы по истечении срока — тело как в 20261009224520, добавлена очистка
-- зависших резервов промокодов (раз в 10 минут вместе с ним).
create or replace function public.subscription_expire_tick()
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r   record;
  v_n int := 0;
begin
  perform public._promo_sweep_stale();
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

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Режим тестировщиков в функциях ученика
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.subscription_tariffs_public()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',            t.id,
           'title',         t.title,
           'description',   t.description,
           'price_rub',     t.price_rub,
           'period_months', t.period_months,
           'trial_days',    t.trial_days,
           'course_id',     t.course_id,
           'course_title',  c.title
         ) order by t.sort_order, t.price_rub), '[]'::jsonb)
    from public.subscription_tariffs t
    join public.courses c on c.id = t.course_id
   where t.is_active and public.subscription_enabled();
$$;

create or replace function public.subscription_start_trial(
  p_tariff_id      uuid,
  p_is_minor       boolean,
  p_parent_consent boolean,
  p_accepted_offer boolean
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid := auth.uid();
  v_role    text;
  v_tariff  public.subscription_tariffs%rowtype;
  v_set     public.subscription_settings%rowtype;
  v_student uuid;
  v_sub     uuid;
  v_end     timestamptz;
begin
  if v_profile is null then
    raise exception 'Требуется вход' using errcode = '42501';
  end if;
  if not public.subscription_enabled_for(v_profile) then
    raise exception 'Оформление подписки сейчас недоступно' using errcode = 'P0001', hint = 'FLAG_OFF';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = v_profile;
  if v_role is distinct from 'student' then
    raise exception 'Подписку оформляет учётная запись ученика' using errcode = '42501', hint = 'NOT_STUDENT';
  end if;
  select * into v_tariff from public.subscription_tariffs where id = p_tariff_id and is_active;
  if not found or v_tariff.trial_days = 0 then
    raise exception 'У тарифа нет пробного периода' using errcode = 'P0001', hint = 'NO_TRIAL';
  end if;
  if not coalesce(p_accepted_offer, false) then
    raise exception 'Нужно согласие с офертой' using errcode = 'P0001', hint = 'NO_CONSENT';
  end if;
  if coalesce(p_is_minor, false) and not coalesce(p_parent_consent, false) then
    raise exception 'Нужно согласие родителя' using errcode = 'P0001', hint = 'NO_PARENT_CONSENT';
  end if;

  v_student := public._subscription_students_row(v_profile);

  if exists (select 1 from public.student_subscriptions s
              where s.student_id = v_student and s.course_id = v_tariff.course_id
                and (s.trial_used_at is not null or s.status <> 'pending')) then
    raise exception 'Пробный период по этому курсу уже был' using errcode = 'P0001', hint = 'TRIAL_USED';
  end if;

  select * into v_set from public.subscription_settings where id;
  v_end := now() + make_interval(days => v_tariff.trial_days);

  insert into public.student_subscriptions
    (student_id, course_id, tariff_id, status, source, current_period_end, access_until, trial_used_at)
  values
    (v_student, v_tariff.course_id, v_tariff.id, 'trial', 'trial', v_end, v_end, now())
  on conflict (student_id, course_id) do update
     set tariff_id = excluded.tariff_id, status = 'trial', source = 'trial',
         current_period_end = excluded.current_period_end,
         access_until = excluded.access_until, trial_used_at = now()
  returning id into v_sub;

  insert into public.subscription_consents
    (subscription_id, student_id, profile_id, offer_url, privacy_url,
     accepted_offer, is_minor, parent_consent, save_card)
  values
    (v_sub, v_student, v_profile, v_set.offer_url, v_set.privacy_url,
     true, coalesce(p_is_minor, false), coalesce(p_parent_consent, false), false);

  insert into public.subscription_log (subscription_id, actor, event, details)
  values (v_sub, v_profile, 'trial_started', jsonb_build_object('until', v_end));

  perform public._subscription_enroll(v_sub);
  return jsonb_build_object('subscription_id', v_sub, 'access_until', v_end);
end $$;

-- «Моя подписка»: + действующая скидка и скидка в истории платежей.
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
           'promo',              (select jsonb_build_object('percent', r.percent, 'payments_left', r.payments_left,
                                                            'next_amount_rub', public._promo_price(t.price_rub, r.percent))
                                    from public.subscription_promo_redemptions r
                                   where r.subscription_id = s.id and r.status = 'applied'
                                     and r.kind = 'percent' and r.payments_left > 0
                                     and (r.tariff_id is null or r.tariff_id = s.tariff_id)
                                   order by r.created_at desc limit 1),
           'payments',           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', p.id, 'kind', p.kind, 'amount_rub', p.amount_rub,
                      'discount_rub', p.discount_rub,
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

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Админка промокодов
-- ─────────────────────────────────────────────────────────────────────────

-- Случайный код: 10 знаков без похожих (0/O, 1/I), из gen_random_uuid.
create function public._promo_random_code(p_prefix text)
returns text
language plpgsql volatile
as $$
declare
  v_abc  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_b    bytea := uuid_send(gen_random_uuid());
  v_out  text := '';
  i      int;
begin
  for i in 0..9 loop
    v_out := v_out || substr(v_abc, (get_byte(v_b, i) % 32) + 1, 1);
  end loop;
  return case when coalesce(p_prefix, '') = '' then v_out else p_prefix || '-' || v_out end;
end $$;

-- Создать код (p_code задан) или пачку случайных (p_count). Параметры — jsonb:
-- kind, percent, discount_payments, free_days, free_months, course_id,
-- tariff_id, max_uses, valid_from, valid_until, note, code, count, prefix.
create function public.admin_promo_create(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_count  int := coalesce((p->>'count')::int, 1);
  v_code   text := nullif(public._promo_normalize(p->>'code'), '');
  v_prefix text := nullif(public._promo_normalize(p->>'prefix'), '');
  v_batch  text;
  v_codes  text[] := '{}';
  v_new    text;
  v_try    int;
  i        int;
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  if v_code is not null and v_count <> 1 then
    raise exception 'Код задан вручную — количество должно быть 1' using errcode = '22023';
  end if;
  if v_count not between 1 and 500 then
    raise exception 'Количество: от 1 до 500' using errcode = '22023';
  end if;
  if v_prefix is not null and v_prefix !~ '^[A-Z0-9]{1,12}$' then
    raise exception 'Префикс: латинские буквы и цифры, до 12 знаков' using errcode = '22023';
  end if;
  if v_code is not null and v_code !~ '^[A-Z0-9-]{4,32}$' then
    raise exception 'Код: латинские буквы, цифры и «-», от 4 до 32 знаков' using errcode = '22023';
  end if;
  v_batch := case when v_code is null then coalesce(v_prefix, 'PROMO') || '-' || to_char(now(), 'YYYYMMDD-HH24MISS') end;

  for i in 1..v_count loop
    v_try := 0;
    loop
      v_new := coalesce(v_code, public._promo_random_code(v_prefix));
      begin
        insert into public.subscription_promo_codes
          (code, kind, percent, discount_payments, free_days, free_months, course_id, tariff_id,
           max_uses, valid_from, valid_until, batch, note, created_by)
        values
          (v_new, p->>'kind', (p->>'percent')::smallint, coalesce((p->>'discount_payments')::smallint, 1),
           (p->>'free_days')::smallint, (p->>'free_months')::smallint,
           nullif(p->>'course_id', '')::uuid, nullif(p->>'tariff_id', '')::uuid,
           (p->>'max_uses')::int, nullif(p->>'valid_from', '')::timestamptz, nullif(p->>'valid_until', '')::timestamptz,
           v_batch, nullif(btrim(p->>'note'), ''), auth.uid());
        exit;
      exception when unique_violation then
        if v_code is not null then
          raise exception 'Такой код уже есть' using errcode = 'P0001', hint = 'PROMO_EXISTS';
        end if;
        v_try := v_try + 1;
        if v_try > 5 then raise; end if;
      end;
    end loop;
    v_codes := v_codes || v_new;
  end loop;

  insert into public.subscription_log (actor, event, details)
  values (auth.uid(), 'promo_created', jsonb_build_object('count', v_count, 'batch', v_batch, 'kind', p->>'kind'));
  return jsonb_build_object('codes', to_jsonb(v_codes), 'batch', v_batch);
end $$;

create function public.admin_promo_set_active(p_id uuid, p_on boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  update public.subscription_promo_codes set is_active = p_on where id = p_id;
  insert into public.subscription_log (actor, event, details)
  values (auth.uid(), case when p_on then 'promo_enabled' else 'promo_disabled' end, jsonb_build_object('code_id', p_id));
end $$;

create function public.admin_promo_codes()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', pc.id, 'code', pc.code, 'kind', pc.kind, 'percent', pc.percent,
             'discount_payments', pc.discount_payments, 'free_days', pc.free_days, 'free_months', pc.free_months,
             'course_id', pc.course_id, 'course_title', c.title, 'tariff_id', pc.tariff_id, 'tariff_title', t.title,
             'max_uses', pc.max_uses, 'used_count', pc.used_count,
             'valid_from', pc.valid_from, 'valid_until', pc.valid_until, 'is_active', pc.is_active,
             'batch', pc.batch, 'note', pc.note, 'created_at', pc.created_at,
             'saved_total_rub', coalesce((select sum(r.saved_rub) from public.subscription_promo_redemptions r
                                          where r.code_id = pc.id), 0)
           ) order by pc.created_at desc), '[]'::jsonb)
      from public.subscription_promo_codes pc
      left join public.courses c on c.id = pc.course_id
      left join public.subscription_tariffs t on t.id = pc.tariff_id
  );
end $$;

create function public.admin_promo_redemptions(p_code_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'code', pc.code, 'code_id', r.code_id, 'kind', r.kind,
             'full_name', pr.full_name, 'email', pr.email,
             'course_title', c.title, 'status', r.status,
             'payments_total', r.payments_total, 'payments_left', r.payments_left,
             'saved_rub', r.saved_rub, 'created_at', r.created_at, 'applied_at', r.applied_at
           ) order by r.created_at desc), '[]'::jsonb)
      from public.subscription_promo_redemptions r
      join public.subscription_promo_codes pc on pc.id = r.code_id
      join public.profiles pr on pr.id = r.profile_id
      left join public.student_subscriptions s on s.id = r.subscription_id
      left join public.courses c on c.id = s.course_id
     where p_code_id is null or r.code_id = p_code_id
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Права на функции
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.subscription_enabled_for(uuid)',
    'public._promo_rate_limited(uuid)',
    'public._promo_reject(uuid, text, text, uuid, text)',
    'public._promo_unfit_reason(public.subscription_promo_codes, public.subscription_tariffs, uuid)',
    'public._promo_active_for(uuid, uuid)',
    'public._promo_sweep_stale()',
    'public.subscription_expire_tick()',
    'public._promo_payment_succeeded(uuid)',
    'public._promo_payment_released(uuid)',
    'public._subscription_promo_grant(uuid, uuid, interval, numeric, text)',
    'public._promo_random_code(text)',
    'public._subscription_students_row(uuid)',
    'public.subscription_checkout_begin(uuid, uuid, boolean, boolean, boolean, boolean, text, text)',
    'public.subscription_checkout_begin(uuid, uuid, boolean, boolean, boolean, boolean, text)',
    'public.subscription_apply_payment(text, uuid, text, numeric, text, boolean, text, text, timestamptz)',
    'public.subscription_payment_failed(uuid, text)',
    'public.subscription_renewal_begin(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  foreach f in array array[
    'public.subscription_promo_check(uuid, text)',
    'public.subscription_start_trial(uuid, boolean, boolean, boolean)',
    'public.my_subscriptions()',
    'public.admin_promo_create(jsonb)',
    'public.admin_promo_set_active(uuid, boolean)',
    'public.admin_promo_codes()',
    'public.admin_promo_redemptions(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  execute 'revoke all on function public.subscription_enabled() from public';
  execute 'grant execute on function public.subscription_enabled() to anon, authenticated, service_role';
  execute 'revoke all on function public.subscription_tariffs_public() from public';
  execute 'grant execute on function public.subscription_tariffs_public() to anon, authenticated, service_role';
end $$;
