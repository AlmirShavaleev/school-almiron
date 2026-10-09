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
                          and p.status in ('created','pending','waiting_for_capture'))
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
    'public.subscription_expire_tick()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'revoke all on function public.subscription_set_auto_renew(uuid, boolean) from public, anon';
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
