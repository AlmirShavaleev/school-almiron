-- §282 «Подписка»: схема платной подписки на курс-поток через ЮKassa.
--
-- PENDING: применяет оркестратор через MCP apply_migration после «да»
-- владельца, затем файл переименовывается по версии из schema_migrations.
--
-- Только добавляющая миграция: новые таблицы `app_feature_flags`,
-- `subscription_*`, `student_subscriptions` и функции к ним. Старые таблицы
-- оплаты (`plans`, `subscriptions`, `payments`, `payment_plans`,
-- `yookassa_payments`) и старые edge-функции не трогаются.
--
-- Единственное изменение существующего поведения — четыре `create or
-- replace` в разделе 9: к условию «ученик в группе курса» добавлен вызов
-- `subscription_access_ok`. Пока на курс нет ни одного тарифа, эта функция
-- возвращает true, поэтому для всех нынешних курсов результат прежний
-- (проверочный запрос — в письме `подписка_миграция.md`).
--
-- Правило доступа одно: `subscription_access_ok(student, course)`.
-- Платный курс = на него есть хотя бы один тариф (даже выключенный —
-- выключение тарифа не должно бесплатно открывать курс).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Флаги функций
-- ─────────────────────────────────────────────────────────────────────────

create table public.app_feature_flags (
  key         text primary key check (key ~ '^[a-z0-9_]{1,64}$'),
  enabled     boolean not null default false,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

alter table public.app_feature_flags enable row level security;

create policy app_feature_flags_select on public.app_feature_flags
  for select to anon, authenticated using (true);
create policy app_feature_flags_admin on public.app_feature_flags
  for all to authenticated
  using (public.is_admin_or_owner()) with check (public.is_admin_or_owner());

revoke all on public.app_feature_flags from anon, authenticated;
grant select on public.app_feature_flags to anon, authenticated;
grant insert, update, delete on public.app_feature_flags to authenticated;

insert into public.app_feature_flags (key, enabled, note)
values ('subscriptions', false, '§282: экраны платной подписки (тарифы, оплата, «Моя подписка»)');

create function public.app_flag(p_key text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select f.enabled from public.app_feature_flags f where f.key = p_key), false);
$$;

revoke all on function public.app_flag(text) from public;
grant execute on function public.app_flag(text) to anon, authenticated, service_role;

create trigger app_feature_flags_updated_at
  before update on public.app_feature_flags
  for each row execute function public.update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Настройки подписки (одна строка): ссылки на юридические тексты и
--    расписание повторов списания. Значения — из настроек, не из кода.
-- ─────────────────────────────────────────────────────────────────────────

create table public.subscription_settings (
  id                 boolean primary key default true check (id),
  offer_url          text,
  privacy_url        text,
  parent_consent_url text,
  -- через сколько дней после конца оплаченного периода повторять
  -- неудавшееся автосписание; первая попытка — в момент окончания периода
  retry_days         smallint[] not null default '{1,3}'
                     check (cardinality(retry_days) between 0 and 5
                            and 0 < all (retry_days)),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles(id) on delete set null
);

alter table public.subscription_settings enable row level security;

create policy subscription_settings_select on public.subscription_settings
  for select to anon, authenticated using (true);
create policy subscription_settings_admin on public.subscription_settings
  for all to authenticated
  using (public.is_admin_or_owner()) with check (public.is_admin_or_owner());

revoke all on public.subscription_settings from anon, authenticated;
grant select on public.subscription_settings to anon, authenticated;
grant insert, update on public.subscription_settings to authenticated;

insert into public.subscription_settings (id) values (true);

create trigger subscription_settings_updated_at
  before update on public.subscription_settings
  for each row execute function public.update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Тарифы
-- ─────────────────────────────────────────────────────────────────────────

create table public.subscription_tariffs (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references public.courses(id) on delete restrict,
  title            text not null check (length(btrim(title)) between 1 and 120),
  description      text,
  price_rub        numeric(10,2) not null check (price_rub > 0),
  period_months    smallint not null default 1 check (period_months between 1 and 12),
  trial_days       smallint not null default 0 check (trial_days between 0 and 60),
  is_active        boolean not null default false,
  sort_order       integer not null default 0,
  -- код ставки НДС для чека ЮKassa; null — объект receipt не передаётся
  receipt_vat_code smallint check (receipt_vat_code between 1 and 12),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id) on delete set null
);

create index subscription_tariffs_course_idx on public.subscription_tariffs (course_id);

alter table public.subscription_tariffs enable row level security;

-- anon не исполняет is_admin_or_owner(), поэтому политики раздельные
create policy subscription_tariffs_select_anon on public.subscription_tariffs
  for select to anon using (is_active);
create policy subscription_tariffs_select on public.subscription_tariffs
  for select to authenticated
  using (is_active or public.is_admin_or_owner());
create policy subscription_tariffs_admin on public.subscription_tariffs
  for all to authenticated
  using (public.is_admin_or_owner()) with check (public.is_admin_or_owner());

revoke all on public.subscription_tariffs from anon, authenticated;
grant select on public.subscription_tariffs to anon, authenticated;
grant insert, update, delete on public.subscription_tariffs to authenticated;

create trigger subscription_tariffs_updated_at
  before update on public.subscription_tariffs
  for each row execute function public.update_updated_at();

-- Тариф нельзя вешать на шаблон: в шаблон не зачисляют (§ reject_enrollment_into_template).
create function public.subscription_tariff_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.courses c where c.id = new.course_id and c.is_template) then
    raise exception 'Тариф нельзя привязать к шаблону курса: подписка открывает копию-поток'
      using errcode = 'P0001', hint = 'TARIFF_ON_TEMPLATE';
  end if;
  return new;
end $$;

create trigger subscription_tariffs_guard
  before insert or update of course_id on public.subscription_tariffs
  for each row execute function public.subscription_tariff_guard();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Подписки учеников
--    Одна строка на пару (ученик, курс); продление — в той же строке.
--    access_until — единственное поле, от которого зависит доступ:
--      trial/active  → конец оплаченного (пробного) периода;
--      past_due      → конец периода + последний повтор + 1 день (доступ
--                      сохраняется, пока идут повторы — решение владельца);
--      cancelled     → момент отмены/возврата (доступ закрыт сразу);
--      expired       → в прошлом.
-- ─────────────────────────────────────────────────────────────────────────

create table public.student_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references public.students(id) on delete cascade,
  course_id          uuid not null references public.courses(id) on delete restrict,
  tariff_id          uuid not null references public.subscription_tariffs(id) on delete restrict,
  status             text not null default 'pending'
                     check (status in ('pending','trial','active','past_due','cancelled','expired')),
  source             text not null default 'purchase'
                     check (source in ('purchase','trial','manual')),
  current_period_end timestamptz,
  access_until       timestamptz,
  auto_renew         boolean not null default false,
  next_charge_at     timestamptz,
  charge_attempts    smallint not null default 0,
  last_charge_error  text,
  card_title         text,
  receipt_email      text,
  trial_used_at      timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (student_id, course_id)
);

create index student_subscriptions_due_idx
  on public.student_subscriptions (next_charge_at)
  where auto_renew and next_charge_at is not null;
create index student_subscriptions_status_idx on public.student_subscriptions (status, access_until);

alter table public.student_subscriptions enable row level security;

create policy student_subscriptions_own on public.student_subscriptions
  for select to authenticated using (student_id = public.auth_student_id());
create policy student_subscriptions_admin on public.student_subscriptions
  for select to authenticated using (public.is_admin_or_owner());

-- писать с клиента нельзя никому: только definer-функции ниже и service role
revoke all on public.student_subscriptions from anon, authenticated;
grant select on public.student_subscriptions to authenticated;

create trigger student_subscriptions_updated_at
  before update on public.student_subscriptions
  for each row execute function public.update_updated_at();

-- Сохранённый способ оплаты ЮKassa — закрыт целиком (только service role).
create table public.subscription_payment_methods (
  subscription_id    uuid primary key references public.student_subscriptions(id) on delete cascade,
  yookassa_method_id text not null,
  saved_at           timestamptz not null default now()
);

alter table public.subscription_payment_methods enable row level security;
revoke all on public.subscription_payment_methods from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Платежи. id строки = Idempotence-Key запроса в ЮKassa.
-- ─────────────────────────────────────────────────────────────────────────

create table public.subscription_payments (
  id                    uuid primary key default gen_random_uuid(),
  subscription_id       uuid not null references public.student_subscriptions(id) on delete cascade,
  student_id            uuid not null references public.students(id) on delete cascade,
  kind                  text not null check (kind in ('initial','renewal')),
  yookassa_payment_id   text unique,
  amount_rub            numeric(10,2) not null check (amount_rub > 0),
  period_months         smallint not null check (period_months between 1 and 12),
  status                text not null default 'created'
                        check (status in ('created','pending','waiting_for_capture',
                                          'succeeded','canceled','refunded','failed')),
  cancellation_reason   text,
  save_method_requested boolean not null default false,
  confirmation_url      text,
  paid_at               timestamptz,
  refunded_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index subscription_payments_sub_idx on public.subscription_payments (subscription_id, created_at desc);
-- одно незавершённое автосписание на подписку: два запуска расписания не
-- спишут дважды
create unique index subscription_payments_one_open_renewal
  on public.subscription_payments (subscription_id)
  where kind = 'renewal' and status in ('created','pending','waiting_for_capture');

alter table public.subscription_payments enable row level security;

create policy subscription_payments_own on public.subscription_payments
  for select to authenticated using (student_id = public.auth_student_id());
create policy subscription_payments_admin on public.subscription_payments
  for select to authenticated using (public.is_admin_or_owner());

revoke all on public.subscription_payments from anon, authenticated;
grant select on public.subscription_payments to authenticated;

create trigger subscription_payments_updated_at
  before update on public.subscription_payments
  for each row execute function public.update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Согласия (места под юридические тексты; сами тексты — по ссылкам)
-- ─────────────────────────────────────────────────────────────────────────

create table public.subscription_consents (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.student_subscriptions(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  offer_url       text,
  privacy_url     text,
  accepted_offer  boolean not null check (accepted_offer),
  is_minor        boolean not null,
  parent_consent  boolean not null default false,
  save_card       boolean not null default false,
  receipt_email   text,
  created_at      timestamptz not null default now(),
  check (not is_minor or parent_consent)
);

create index subscription_consents_sub_idx on public.subscription_consents (subscription_id);

alter table public.subscription_consents enable row level security;

create policy subscription_consents_own on public.subscription_consents
  for select to authenticated using (profile_id = auth.uid());
create policy subscription_consents_admin on public.subscription_consents
  for select to authenticated using (public.is_admin_or_owner());

revoke all on public.subscription_consents from anon, authenticated;
grant select on public.subscription_consents to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Журнал: уведомления ЮKassa, ручные действия админа, сбои зачисления
-- ─────────────────────────────────────────────────────────────────────────

create table public.subscription_log (
  id                 bigint generated always as identity primary key,
  subscription_id    uuid references public.student_subscriptions(id) on delete set null,
  payment_id         uuid references public.subscription_payments(id) on delete set null,
  actor              uuid references public.profiles(id) on delete set null,
  event              text not null,
  yookassa_object_id text,
  details            jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index subscription_log_sub_idx on public.subscription_log (subscription_id, created_at desc);

alter table public.subscription_log enable row level security;

create policy subscription_log_admin on public.subscription_log
  for select to authenticated using (public.is_admin_or_owner());

revoke all on public.subscription_log from anon, authenticated;
grant select on public.subscription_log to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Правило доступа — ОДНО
-- ─────────────────────────────────────────────────────────────────────────

create function public.subscription_course_is_paid(p_course_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.subscription_tariffs t where t.course_id = p_course_id);
$$;

create function public.subscription_access_ok(p_student_id uuid, p_course_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select not public.subscription_course_is_paid(p_course_id)
      or exists (
           select 1 from public.student_subscriptions s
            where s.student_id = p_student_id
              and s.course_id  = p_course_id
              and s.status in ('trial','active','past_due')
              and s.access_until > now()
         );
$$;

-- Наружу не отдаём: по паре (ученик, курс) можно было бы узнать чужой
-- статус. Вызывается из definer-функций (их владелец — postgres).
revoke all on function public.subscription_course_is_paid(uuid) from public, anon, authenticated;
revoke all on function public.subscription_access_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function public.subscription_course_is_paid(uuid) to service_role;
grant execute on function public.subscription_access_ok(uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Встраивание правила в существующие ворота доступа ученика.
--    Тела — как на проде 09.10.2026, добавлено только условие подписки.
-- ─────────────────────────────────────────────────────────────────────────

-- 9.1 Центральные ворота живого контура: материалы тем, файлы, ДЗ темы,
--     тесты темы, уроки, автопроверка (через course_student_can_see_topic).
create or replace function public.course_student_has_access(p_course_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_course_id is not null and (
    exists (select 1 from group_students gs
              join groups g on g.id = gs.group_id
             where gs.student_id = public.auth_student_id()
               and g.course_id = p_course_id)
    or exists (select 1 from student_courses sc
                where sc.student_id = public.auth_student_id()
                  and sc.course_id = p_course_id
                  and sc.status in ('active', 'trial')
                  and (sc.expires_at is null or sc.expires_at > now()))
  )
  and public.subscription_access_ok(public.auth_student_id(), p_course_id);
$$;

-- 9.2 Пробники: ворота my_mock_exam, mock_exam_student_gate, файлы пробника.
create or replace function public.mock_exam_my_student_id(p_mock_exam_id uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id
    from public.mock_exams me
    join public.group_students gs on gs.group_id = me.group_id
    join public.students s on s.id = gs.student_id
    join public.groups g on g.id = me.group_id
   where me.id = p_mock_exam_id and s.profile_id = auth.uid()
     and public.subscription_access_ok(s.id, g.course_id)
   limit 1;
$$;

-- 9.3 Автопроверка задач темы (topic_autocheck_check / _finish).
create or replace function public._topic_autocheck_student_of(p_topic_id uuid, p_profile_id uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id
    from students s
    join group_students gs on gs.student_id = s.id
    join groups g          on g.id = gs.group_id
   where s.profile_id = p_profile_id
     and g.course_id = public.course_of_topic(p_topic_id)
     and public.subscription_access_ok(s.id, g.course_id)
   order by s.id
   limit 1;
$$;

-- 9.4 Файлы бакета course-materials (политика course_mat_select).
create or replace function public.auth_is_student_of_topic(p_topic_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from topics tp
    join modules m on m.id = tp.module_id
    join groups g  on g.course_id = m.course_id
    join group_students gs on gs.group_id = g.id
    join students s on s.id = gs.student_id
    where tp.id = p_topic_id and s.profile_id = auth.uid()
      and public.subscription_access_ok(s.id, g.course_id)
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 10. Внутренние помощники (только service role / definer-вызовы)
-- ─────────────────────────────────────────────────────────────────────────

-- Зачисление в группу потока. Не поднимает исключений наружу: деньги уже
-- списаны, сбой зачисления пишется в журнал и виден админу.
create function public._subscription_enroll(p_subscription_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sub   public.student_subscriptions%rowtype;
  v_group uuid;
  v_title text;
  v_count int;
begin
  select * into v_sub from public.student_subscriptions where id = p_subscription_id;
  if not found then return false; end if;

  select g.id into v_group from public.groups g
   where g.course_id = v_sub.course_id order by g.created_at limit 1;

  if v_group is null then
    select c.title into v_title from public.courses c where c.id = v_sub.course_id;
    insert into public.groups (course_id, name, teacher_id)
    values (
      v_sub.course_id, v_title,
      (select t.id from public.courses c left join public.teachers t on t.profile_id = c.owner_id
        where c.id = v_sub.course_id)
    )
    on conflict (course_id) do nothing
    returning id into v_group;
    if v_group is null then
      select g.id into v_group from public.groups g
       where g.course_id = v_sub.course_id order by g.created_at limit 1;
    end if;
  end if;

  if exists (select 1 from public.group_students gs
              where gs.group_id = v_group and gs.student_id = v_sub.student_id) then
    return true;
  end if;

  -- Платный поток не упирается в лимит группы (по умолчанию 30): оплативший
  -- ученик должен попасть в курс. Поднятие лимита — в журнал.
  select count(*) into v_count from public.group_students where group_id = v_group;
  update public.groups set max_students = v_count + 1
   where id = v_group and max_students <= v_count;
  if found then
    insert into public.subscription_log (subscription_id, event, details)
    values (p_subscription_id, 'group_capacity_raised',
            jsonb_build_object('group_id', v_group, 'max_students', v_count + 1));
  end if;

  insert into public.group_students (group_id, student_id)
  values (v_group, v_sub.student_id)
  on conflict do nothing;
  return true;
exception when others then
  insert into public.subscription_log (subscription_id, event, details)
  values (p_subscription_id, 'enroll_failed',
          jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm));
  return false;
end $$;

create function public._subscription_notify(p_subscription_id uuid, p_title text, p_message text, p_dedup text)
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
exception when others then
  -- уведомление не должно ломать денежную операцию
  insert into public.subscription_log (subscription_id, event, details)
  values (p_subscription_id, 'notify_failed', jsonb_build_object('message', sqlerrm));
end $$;

create function public._subscription_students_row(p_profile_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
begin
  select s.id into v_student from public.students s where s.profile_id = p_profile_id;
  if v_student is null then
    insert into public.students (profile_id) values (p_profile_id) returning id into v_student;
  end if;
  return v_student;
end $$;

-- Неудача автосписания: следующий повтор по расписанию из настроек или конец.
create function public._subscription_renewal_failed(p_subscription_id uuid, p_reason text)
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

-- ─────────────────────────────────────────────────────────────────────────
-- 11. Оплата: вызовы из edge-функций (service role). Пользователь
--     определяется в edge-функции по JWT и передаётся параметром, поэтому
--     authenticated эти функции вызвать не может.
-- ─────────────────────────────────────────────────────────────────────────

-- Начало оформления: строка подписки (pending, если её нет), согласие,
-- строка платежа. Возвращает данные для запроса в ЮKassa.
create function public.subscription_checkout_begin(
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
  on conflict (student_id, course_id) do update
     set tariff_id = excluded.tariff_id, receipt_email = excluded.receipt_email
  returning id into v_sub;

  insert into public.subscription_consents
    (subscription_id, student_id, profile_id, offer_url, privacy_url,
     accepted_offer, is_minor, parent_consent, save_card, receipt_email)
  values
    (v_sub, v_student, p_profile_id, v_set.offer_url, v_set.privacy_url,
     true, coalesce(p_is_minor, false), coalesce(p_parent_consent, false),
     coalesce(p_save_card, false), v_email);

  insert into public.subscription_payments
    (subscription_id, student_id, kind, amount_rub, period_months, save_method_requested)
  values
    (v_sub, v_student, 'initial', v_tariff.price_rub, v_tariff.period_months, coalesce(p_save_card, false))
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

-- Ответ ЮKassa на создание платежа.
create function public.subscription_payment_attach(
  p_payment_id        uuid,
  p_yookassa_id       text,
  p_status            text,
  p_confirmation_url  text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.subscription_payments
     set yookassa_payment_id = p_yookassa_id,
         confirmation_url    = p_confirmation_url,
         status = case when status = 'created' and p_status in ('pending','waiting_for_capture')
                       then p_status else status end
   where id = p_payment_id;
end $$;

-- Итог платежа. Вызывается вебхуком ПОСЛЕ запроса статуса в API ЮKassa
-- (телу уведомления не верим) и функцией автосписания. Идемпотентно:
-- статус платежа движется только вперёд, продление — ровно один раз.
create function public.subscription_apply_payment(
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

-- Возврат (refund.succeeded, после запроса статуса возврата в API ЮKassa):
-- доступ закрывается сразу (решение владельца 09.10).
create function public.subscription_apply_refund(p_yookassa_payment_id text, p_refund_id text)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_pay public.subscription_payments%rowtype;
begin
  select * into v_pay from public.subscription_payments
   where yookassa_payment_id = p_yookassa_payment_id for update;
  if not found then
    insert into public.subscription_log (event, yookassa_object_id, details)
    values ('refund_unknown_payment', p_refund_id, jsonb_build_object('payment', p_yookassa_payment_id));
    return 'unknown';
  end if;
  if v_pay.status = 'refunded' then
    return 'duplicate';
  end if;

  update public.subscription_payments set status = 'refunded', refunded_at = now() where id = v_pay.id;
  update public.student_subscriptions
     set status = 'cancelled', auto_renew = false, next_charge_at = null,
         access_until = now(), cancelled_at = now()
   where id = v_pay.subscription_id;
  insert into public.subscription_log (subscription_id, payment_id, event, yookassa_object_id)
  values (v_pay.subscription_id, v_pay.id, 'refund_succeeded', p_refund_id);
  perform public._subscription_notify(v_pay.subscription_id,
    'Оплата возвращена', 'Деньги возвращены, доступ к курсу закрыт.', 'refund:' || v_pay.id);
  return 'refunded';
end $$;

-- Автосписание: кого списывать сейчас.
create function public.subscription_renewal_due(p_limit int default 50)
returns table (subscription_id uuid)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id
    from public.student_subscriptions s
    join public.subscription_payment_methods m on m.subscription_id = s.id
   where s.auto_renew
     and s.status in ('active','past_due')
     and s.next_charge_at <= now()
     and not exists (select 1 from public.subscription_payments p
                      where p.subscription_id = s.id and p.kind = 'renewal'
                        and p.status in ('pending','waiting_for_capture'))
   order by s.next_charge_at
   limit greatest(1, least(p_limit, 200));
$$;

-- Строка платежа автосписания. Если прошлый запрос оборвался до ответа
-- ЮKassa (статус 'created'), возвращается ТА ЖЕ строка: её id — прежний
-- Idempotence-Key, повтор не спишет дважды.
create function public.subscription_renewal_begin(p_subscription_id uuid)
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

-- Ошибка запроса в ЮKassa, когда платёж точно не создан (4xx с ответом).
create function public.subscription_payment_failed(p_payment_id uuid, p_reason text)
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
  if v_pay.kind = 'renewal' then
    return public._subscription_renewal_failed(v_pay.subscription_id, p_reason);
  end if;
  return 'failed';
end $$;

-- Статусы по истечении срока (раз в 10 минут). Доступ от статуса не
-- зависит — его закрывает access_until; это для честного статуса в
-- кабинете и уведомления.
create function public.subscription_expire_tick()
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
       and not (s.auto_renew and s.next_charge_at > now())
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

-- ─────────────────────────────────────────────────────────────────────────
-- 12. Ученик (authenticated)
-- ─────────────────────────────────────────────────────────────────────────

-- Активные тарифы с названием курса — для витрины, в т.ч. до входа
-- (курс платного потока посторонним по RLS не виден).
create function public.subscription_tariffs_public()
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
   where t.is_active and public.app_flag('subscriptions');
$$;

-- Пробный период без карты (решение владельца 09.10): один раз на курс.
create function public.subscription_start_trial(
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
  if not public.app_flag('subscriptions') then
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

-- «Моя подписка»: подписки ученика с историей платежей.
create function public.my_subscriptions()
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

-- Состояние доступа к курсу для экрана курса: отличить «закрыто
-- подпиской» от «пусто» (симптом RLS, похожий на «нет данных»).
create function public.my_course_access(p_course_id uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'paid',         public.subscription_course_is_paid(p_course_id),
    'has_access',   public.subscription_access_ok(public.auth_student_id(), p_course_id),
    'status',       s.status,
    'access_until', s.access_until,
    'tariff_id',    s.tariff_id
  )
  from (select 1) one
  left join public.student_subscriptions s
         on s.student_id = public.auth_student_id() and s.course_id = p_course_id;
$$;

-- Отмена / возобновление автопродления. Включить можно только при
-- сохранённой карте; доступ до конца оплаченного периода сохраняется.
create function public.subscription_set_auto_renew(p_subscription_id uuid, p_on boolean)
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
  end if;
  insert into public.subscription_log (subscription_id, actor, event)
  values (v_sub.id, auth.uid(), case when p_on then 'auto_renew_on' else 'auto_renew_off' end);
  return jsonb_build_object('auto_renew', p_on);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 13. Админка владельца
-- ─────────────────────────────────────────────────────────────────────────

create function public.admin_subscriptions(p_status text default null)
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
             'id',                 s.id,
             'student_id',         s.student_id,
             'profile_id',         st.profile_id,
             'full_name',          pr.full_name,
             'email',              pr.email,
             'course_id',          s.course_id,
             'course_title',       c.title,
             'tariff_title',       t.title,
             'status',             s.status,
             'source',             s.source,
             'has_access',         s.status in ('trial','active','past_due') and s.access_until > now(),
             'current_period_end', s.current_period_end,
             'access_until',       s.access_until,
             'auto_renew',         s.auto_renew,
             'next_charge_at',     s.next_charge_at,
             'charge_attempts',    s.charge_attempts,
             'last_charge_error',  s.last_charge_error,
             'enrolled',           exists (select 1 from public.group_students gs
                                             join public.groups g on g.id = gs.group_id
                                            where gs.student_id = s.student_id and g.course_id = s.course_id),
             'paid_total_rub',     coalesce((select sum(p.amount_rub) from public.subscription_payments p
                                             where p.subscription_id = s.id and p.status = 'succeeded'), 0),
             'created_at',         s.created_at
           ) order by s.created_at desc), '[]'::jsonb)
      from public.student_subscriptions s
      join public.students st on st.id = s.student_id
      join public.profiles pr on pr.id = st.profile_id
      join public.courses c on c.id = s.course_id
      join public.subscription_tariffs t on t.id = s.tariff_id
     where p_status is null or s.status = p_status
  );
end $$;

-- Ручное продление на N дней (подарок, компенсация, перенос оплаты).
create function public.admin_subscription_extend(p_subscription_id uuid, p_days int, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.student_subscriptions%rowtype;
  v_end timestamptz;
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'Дней: от 1 до 366' using errcode = '22023';
  end if;
  select * into v_sub from public.student_subscriptions where id = p_subscription_id for update;
  if not found then
    raise exception 'Подписка не найдена' using errcode = 'P0002';
  end if;
  v_end := greatest(now(), coalesce(case when v_sub.status in ('trial','active','past_due')
                                         then v_sub.access_until end, now()))
           + make_interval(days => p_days);
  update public.student_subscriptions
     set status = 'active', current_period_end = v_end, access_until = v_end,
         next_charge_at = case when auto_renew then v_end else null end,
         charge_attempts = 0, last_charge_error = null, cancelled_at = null
   where id = v_sub.id;
  insert into public.subscription_log (subscription_id, actor, event, details)
  values (v_sub.id, auth.uid(), 'admin_extend',
          jsonb_build_object('days', p_days, 'until', v_end, 'reason', p_reason));
  perform public._subscription_enroll(v_sub.id);
  return jsonb_build_object('access_until', v_end);
end $$;

-- Ручная отмена: доступ закрывается сразу, автопродление выключается.
create function public.admin_subscription_cancel(p_subscription_id uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  update public.student_subscriptions
     set status = 'cancelled', auto_renew = false, next_charge_at = null,
         access_until = now(), cancelled_at = now()
   where id = p_subscription_id;
  if not found then
    raise exception 'Подписка не найдена' using errcode = 'P0002';
  end if;
  insert into public.subscription_log (subscription_id, actor, event, details)
  values (p_subscription_id, auth.uid(), 'admin_cancel', jsonb_build_object('reason', p_reason));
  return jsonb_build_object('status', 'cancelled');
end $$;

-- Бесплатная выдача: ученик, которого владелец сам кладёт в платный поток.
create function public.admin_subscription_grant(p_student_id uuid, p_tariff_id uuid, p_days int, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tariff public.subscription_tariffs%rowtype;
  v_sub    uuid;
  v_end    timestamptz;
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'Дней: от 1 до 366' using errcode = '22023';
  end if;
  select * into v_tariff from public.subscription_tariffs where id = p_tariff_id;
  if not found then
    raise exception 'Тариф не найден' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.students s where s.id = p_student_id) then
    raise exception 'Ученик не найден' using errcode = 'P0002';
  end if;
  v_end := now() + make_interval(days => p_days);
  insert into public.student_subscriptions
    (student_id, course_id, tariff_id, status, source, current_period_end, access_until)
  values (p_student_id, v_tariff.course_id, v_tariff.id, 'active', 'manual', v_end, v_end)
  on conflict (student_id, course_id) do update
     set status = 'active', source = 'manual', tariff_id = excluded.tariff_id,
         current_period_end = greatest(coalesce(student_subscriptions.access_until, now()), now())
                              + make_interval(days => p_days),
         access_until = greatest(coalesce(student_subscriptions.access_until, now()), now())
                        + make_interval(days => p_days),
         cancelled_at = null
  returning id, access_until into v_sub, v_end;
  insert into public.subscription_log (subscription_id, actor, event, details)
  values (v_sub, auth.uid(), 'admin_grant', jsonb_build_object('days', p_days, 'until', v_end, 'reason', p_reason));
  perform public._subscription_enroll(v_sub);
  return jsonb_build_object('subscription_id', v_sub, 'access_until', v_end);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 14. Права на функции. По умолчанию в этой базе новые функции postgres
--     исполняет authenticated, поэтому служебные закрываются явно.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public._subscription_enroll(uuid)',
    'public._subscription_notify(uuid, text, text, text)',
    'public._subscription_students_row(uuid)',
    'public._subscription_renewal_failed(uuid, text)',
    'public.subscription_tariff_guard()',
    'public.subscription_checkout_begin(uuid, uuid, boolean, boolean, boolean, boolean, text)',
    'public.subscription_payment_attach(uuid, text, text, text)',
    'public.subscription_apply_payment(text, uuid, text, numeric, text, boolean, text, text, timestamptz)',
    'public.subscription_apply_refund(text, text)',
    'public.subscription_renewal_due(int)',
    'public.subscription_renewal_begin(uuid)',
    'public.subscription_payment_failed(uuid, text)',
    'public.subscription_expire_tick()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;

  foreach f in array array[
    'public.my_subscriptions()',
    'public.my_course_access(uuid)',
    'public.subscription_set_auto_renew(uuid, boolean)',
    'public.subscription_start_trial(uuid, boolean, boolean, boolean)',
    'public.admin_subscriptions(text)',
    'public.admin_subscription_extend(uuid, int, text)',
    'public.admin_subscription_cancel(uuid, text)',
    'public.admin_subscription_grant(uuid, uuid, int, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  execute 'revoke all on function public.subscription_tariffs_public() from public';
  execute 'grant execute on function public.subscription_tariffs_public() to anon, authenticated, service_role';
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 15. Расписание: статусы по истечении срока. Автосписание (edge-функция
--     subscription-renew) ставится отдельной миграцией этапа 3, после
--     деплоя функции.
-- ─────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'subscription-expire') then
    perform cron.schedule('subscription-expire', '*/10 * * * *', 'select public.subscription_expire_tick()');
  end if;
end $$;
