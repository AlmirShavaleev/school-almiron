-- §290-A (часть 1) — путь ученика «с улицы»: анкета, витрина «Курсы»,
-- «подписка заканчивается завтра», функция доступа к банку задач.
-- ТОЛЬКО ДОБАВЛЕНИЕ: новые таблицы и функции, новый cron, расширение списка
-- видов письма (subscription_mail_outbox.kind: + 'ending_soon'; старые строки
-- проверку проходят). Существующие функции и политики не меняются —
-- catalog_access_ok() подключает часть 2 (PENDING_290_b_demo_catalog.sql).
--
-- Решения владельца (письма 12.10, «§290 план принят»):
--   • анкета: класс 9/10/11, экзамен (пока только ЕГЭ), предмет (физика /
--     математика), желаемый балл; показывается только ученику без школьной
--     группы; целевой балл пишется и в student_subject_targets;
--   • витрина — из таблицы: карточка на курс; у математики курсов пока нет —
--     карточки «Скоро» без оплаты, «Сообщить о запуске»; потом заглушка
--     подменяется настоящим курсом без кода (course_id + status = 'live');
--   • за день до конца пробного/подписки — письмо и Telegram.
--
-- ПОРЯДОК: до применения задеплоить subscription-renew и
-- process-notification-queue из ветки podpiska (там вид письма 'ending_soon'
-- и событие 'subscription_ending'), иначе первое письмо уйдёт с чужим текстом.

-- ─────────────────────────────────────────────────────────────────────────
-- 0. Кто «школьник»: в группе курса без тарифов (или действующий
--    student_courses такого курса). Одно определение — анкета и банк задач.
-- ─────────────────────────────────────────────────────────────────────────

create function public._profile_is_school_student(p_profile_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
           select 1 from public.students s
             join public.group_students gs on gs.student_id = s.id
             join public.groups g on g.id = gs.group_id
            where s.profile_id = p_profile_id
              and not exists (select 1 from public.subscription_tariffs t where t.course_id = g.course_id))
      or exists (
           select 1 from public.students s
             join public.student_courses sc on sc.student_id = s.id
            where s.profile_id = p_profile_id
              and sc.status in ('active', 'trial')
              and (sc.expires_at is null or sc.expires_at > now())
              and not exists (select 1 from public.subscription_tariffs t where t.course_id = sc.course_id));
$$;

revoke all on function public._profile_is_school_student(uuid) from public, anon, authenticated;
grant execute on function public._profile_is_school_student(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Анкета
-- ─────────────────────────────────────────────────────────────────────────

create table public.student_onboarding (
  profile_id        uuid primary key references public.profiles(id) on delete cascade,
  grade             smallint not null check (grade in (9, 10, 11)),
  exam              text not null default 'ege' check (exam in ('ege')),
  subject           text not null check (subject in ('physics', 'math')),
  target_score      smallint not null check (target_score between 0 and 100),
  months_to_exam    smallint check (months_to_exam between 1 and 36),
  hours_per_week    smallint check (hours_per_week between 1 and 40),
  diagnostic_status text not null default 'none'
                    check (diagnostic_status in ('none', 'in_progress', 'done', 'skipped')),
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.student_onboarding enable row level security;
create policy student_onboarding_read on public.student_onboarding
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin_or_owner()));
revoke all on public.student_onboarding from anon, authenticated;
grant select on public.student_onboarding to authenticated;

-- Состояние анкеты текущего пользователя. needed — показывать ли /start.
create function public.onboarding_state()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with me as (
    select p.id, p.role::text as role from public.profiles p where p.id = auth.uid()
  )
  select jsonb_build_object(
           'needed', coalesce(me.role = 'student', false)
                     and o.completed_at is null
                     and not public._profile_is_school_student(me.id),
           'completed', o.completed_at is not null,
           'grade', o.grade,
           'exam', o.exam,
           'subject', o.subject,
           'target_score', o.target_score,
           'months_to_exam', o.months_to_exam,
           'hours_per_week', o.hours_per_week,
           'diagnostic_status', coalesce(o.diagnostic_status, 'none'))
    from me
    left join public.student_onboarding o on o.profile_id = me.id;
$$;

create function public.onboarding_save(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid := auth.uid();
  v_role    text;
  v_student uuid;
  v_grade   int;
  v_exam    text;
  v_subject text;
  v_target  int;
  v_months  int;
  v_hours   int;
begin
  if v_profile is null then
    raise exception 'Требуется вход' using errcode = '42501';
  end if;
  select pr.role::text into v_role from public.profiles pr where pr.id = v_profile;
  if v_role is distinct from 'student' then
    raise exception 'Анкету заполняет ученик' using errcode = '42501', hint = 'NOT_STUDENT';
  end if;

  begin
    v_grade   := (p ->> 'grade')::int;
    v_exam    := coalesce(nullif(btrim(p ->> 'exam'), ''), 'ege');
    v_subject := p ->> 'subject';
    v_target  := (p ->> 'target_score')::int;
    v_months  := nullif(p ->> 'months_to_exam', '')::int;
    v_hours   := nullif(p ->> 'hours_per_week', '')::int;
  exception when others then
    raise exception 'Проверьте поля анкеты' using errcode = 'P0001', hint = 'BAD_INPUT';
  end;
  if v_grade is null or v_grade not in (9, 10, 11)
     or v_exam <> 'ege'
     or v_subject is null or v_subject not in ('physics', 'math')
     or v_target is null or v_target not between 0 and 100
     or (v_months is not null and v_months not between 1 and 36)
     or (v_hours is not null and v_hours not between 1 and 40) then
    raise exception 'Проверьте поля анкеты' using errcode = 'P0001', hint = 'BAD_INPUT';
  end if;

  insert into public.student_onboarding
    (profile_id, grade, exam, subject, target_score, months_to_exam, hours_per_week, completed_at)
  values (v_profile, v_grade, v_exam, v_subject, v_target, v_months, v_hours, now())
  on conflict (profile_id) do update
     set grade = excluded.grade, exam = excluded.exam, subject = excluded.subject,
         target_score = excluded.target_score, months_to_exam = excluded.months_to_exam,
         hours_per_week = excluded.hours_per_week,
         completed_at = coalesce(public.student_onboarding.completed_at, now()),
         updated_at = now();

  -- Целевой балл — туда же, где его видят главная и прогноз. Цель, которую
  -- поставил преподаватель, анкета не перетирает.
  v_student := public._subscription_students_row(v_profile);
  insert into public.student_subject_targets (student_id, subject, exam_type, target_score, updated_by)
  values (v_student, v_subject::public.subject_type, 'ege'::public.exam_type, v_target, v_profile)
  on conflict (student_id, subject, exam_type) do update
     set target_score = excluded.target_score, updated_by = excluded.updated_by, updated_at = now()
   where public.student_subject_targets.updated_by is null
      or public.student_subject_targets.updated_by = v_profile;

  return public.onboarding_state();
end $$;

-- «Пройти позже»: диагностика висит задачей на главной. Остальные статусы
-- ставят RPC диагностики (§289).
create function public.onboarding_skip_diagnostic()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.student_onboarding
     set diagnostic_status = 'skipped', updated_at = now()
   where profile_id = auth.uid() and diagnostic_status in ('none', 'in_progress');
  return public.onboarding_state();
end $$;

revoke all on function public.onboarding_state() from public, anon;
revoke all on function public.onboarding_save(jsonb) from public, anon;
revoke all on function public.onboarding_skip_diagnostic() from public, anon;
grant execute on function public.onboarding_state() to authenticated, service_role;
grant execute on function public.onboarding_save(jsonb) to authenticated, service_role;
grant execute on function public.onboarding_skip_diagnostic() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Витрина «Курсы»
-- ─────────────────────────────────────────────────────────────────────────

create table public.course_showcase (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title       text not null,
  subtitle    text,
  description text,
  includes    text[] not null default '{}',
  subject     text check (subject in ('physics', 'math')),
  course_id   uuid references public.courses(id) on delete set null,
  status      text not null default 'soon' check (status in ('live', 'soon')),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint course_showcase_live_has_course check (status = 'soon' or course_id is not null)
);

alter table public.course_showcase enable row level security;
create policy course_showcase_read on public.course_showcase
  for select to authenticated using (is_active or (select public.is_admin_or_owner()));
create policy course_showcase_admin on public.course_showcase
  for all to authenticated
  using ((select public.is_admin_or_owner())) with check ((select public.is_admin_or_owner()));
revoke all on public.course_showcase from anon, authenticated;
grant select, insert, update, delete on public.course_showcase to authenticated;

-- «Сообщить о запуске» для карточек «Скоро».
create table public.course_showcase_waitlist (
  showcase_id uuid not null references public.course_showcase(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (showcase_id, profile_id)
);
alter table public.course_showcase_waitlist enable row level security;
create policy course_showcase_waitlist_read on public.course_showcase_waitlist
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_admin_or_owner()));
revoke all on public.course_showcase_waitlist from anon, authenticated;
grant select on public.course_showcase_waitlist to authenticated;

-- Карточки витрины для текущего пользователя. Пока подписка не открыта ему
-- (режим тестировщиков) — пусто. Карточка 'live' без действующих тарифов
-- показывается как «Скоро». Цена года и «−N %» — из тарифов, не из текста.
create function public.courses_showcase()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with me as (
    select s.id as student_id from public.students s where s.profile_id = auth.uid()
  ),
  cards as (
    select cs.*,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', t.id, 'title', t.title, 'price_rub', t.price_rub,
                     'period_months', t.period_months, 'trial_days', t.trial_days)
                   order by t.period_months, t.price_rub), '[]'::jsonb)
              from public.subscription_tariffs t
             where t.course_id = cs.course_id and t.is_active) as tariffs,
           (select min(t.price_rub) from public.subscription_tariffs t
             where t.course_id = cs.course_id and t.is_active and t.period_months = 1) as month_price,
           (select min(t.price_rub) from public.subscription_tariffs t
             where t.course_id = cs.course_id and t.is_active and t.period_months = 12) as year_price,
           (select max(t.trial_days) from public.subscription_tariffs t
             where t.course_id = cs.course_id and t.is_active) as trial_days
      from public.course_showcase cs
     where cs.is_active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'slug', c.slug, 'title', c.title, 'subtitle', c.subtitle,
           'description', c.description, 'includes', to_jsonb(c.includes), 'subject', c.subject,
           'course_id', c.course_id,
           'status', case when c.status = 'live' and jsonb_array_length(c.tariffs) > 0 then 'live' else 'soon' end,
           'tariffs', c.tariffs,
           'month_price', c.month_price,
           'year_price', c.year_price,
           'year_discount_pct', case when c.month_price > 0 and c.year_price is not null
                                     then round(100 - c.year_price * 100 / (c.month_price * 12))::int end,
           'trial_days', coalesce(c.trial_days, 0),
           'my_status', ss.status,
           'my_access_until', ss.access_until,
           'has_access', coalesce(ss.status in ('trial', 'active', 'past_due') and ss.access_until > now(), false),
           'trial_available', coalesce(c.trial_days, 0) > 0
                              and (ss.id is null or (ss.trial_used_at is null and ss.status = 'pending')),
           'notify_requested', exists (select 1 from public.course_showcase_waitlist w
                                        where w.showcase_id = c.id and w.profile_id = auth.uid()))
         order by c.sort_order, c.title), '[]'::jsonb)
    from cards c
    left join lateral (
      select s.* from public.student_subscriptions s
       where s.course_id = c.course_id and s.student_id = (select me.student_id from me)
    ) ss on true
   where public.subscription_enabled_for(auth.uid());
$$;

create function public.course_showcase_notify(p_showcase_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Требуется вход' using errcode = '42501';
  end if;
  if not exists (select 1 from public.course_showcase cs where cs.id = p_showcase_id and cs.is_active) then
    raise exception 'Курс не найден' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;
  insert into public.course_showcase_waitlist (showcase_id, profile_id)
  values (p_showcase_id, auth.uid())
  on conflict do nothing;
  return true;
end $$;

revoke all on function public.courses_showcase() from public, anon;
revoke all on function public.course_showcase_notify(uuid) from public, anon;
grant execute on function public.courses_showcase() to authenticated, service_role;
grant execute on function public.course_showcase_notify(uuid) to authenticated, service_role;

-- Карточки по решению владельца: физика — нынешний тестовый подписочный курс
-- (переименование курса — перед запуском, отдельно); математика — две
-- заглушки «Скоро». Курса может не быть (тестовая база) — тогда 'soon'.
insert into public.course_showcase (slug, title, subtitle, includes, subject, course_id, status, sort_order)
select 'physics-ege', 'Физика ЕГЭ', 'Подготовка к ЕГЭ по физике с нуля до высокого балла',
       array['Видеоуроки по всем темам кодификатора', 'Домашние задания с автопроверкой',
             'Проверка второй части', 'Банк задач ЕГЭ'],
       'physics', c.id, case when c.id is null then 'soon' else 'live' end, 10
  from (select (select id from public.courses where id = '943ad457-ad68-49b2-8fa6-8df1319c8d6e') as id) c
on conflict (slug) do nothing;

insert into public.course_showcase (slug, title, subtitle, subject, status, sort_order) values
  ('math-ege-part1', 'Математика ЕГЭ. 1 часть + джентльменский набор', 'Скоро', 'math', 'soon', 20),
  ('math-ege-part2', 'Математика ЕГЭ. 2 часть', 'Скоро', 'math', 'soon', 30)
on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Банк задач: кому положено (подключается в части 2)
--    Пока подписка профилю не открыта (режим тестировщиков / флаг выключен) —
--    как сейчас, открыт. Иначе: персонал, школьник, ученик с действующей
--    подпиской или пробным периодом.
-- ─────────────────────────────────────────────────────────────────────────

create function public.catalog_access_ok()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
           not public.subscription_enabled_for(auth.uid())
        or coalesce((select p.role::text <> 'student' from public.profiles p where p.id = auth.uid()), false)
        or public._profile_is_school_student(auth.uid())
        or exists (select 1 from public.students s
                     join public.student_subscriptions ss on ss.student_id = s.id
                    where s.profile_id = auth.uid()
                      and ss.status in ('trial', 'active', 'past_due')
                      and ss.access_until > now()));
$$;

revoke all on function public.catalog_access_ok() from public, anon;
grant execute on function public.catalog_access_ok() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. «Подписка заканчивается завтра»: письмо, уведомление, Telegram.
--    Не шлём, если будет автопродление (деньги спишутся сами). Один раз на
--    дату окончания (продление или новый период — новое напоминание).
-- ─────────────────────────────────────────────────────────────────────────

alter table public.subscription_mail_outbox drop constraint subscription_mail_outbox_kind_check;
alter table public.subscription_mail_outbox add constraint subscription_mail_outbox_kind_check
  check (kind in ('charge_failed', 'expired', 'auto_renew_off', 'ending_soon'));

create function public.subscription_ending_soon_tick()
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r     record;
  v_key text;
  v_n   int := 0;
begin
  for r in
    select s.id, s.status, s.access_until, st.profile_id, c.title as course_title
      from public.student_subscriptions s
      join public.students st on st.id = s.student_id
      join public.courses c on c.id = s.course_id
     where s.status in ('trial', 'active', 'past_due')
       and s.access_until > now()
       and s.access_until <= now() + interval '24 hours'
       and not (s.auto_renew and s.next_charge_at is not null)
  loop
    v_key := 'ending_soon:' || to_char(r.access_until at time zone 'UTC', 'YYYYMMDDHH24MI');
    continue when exists (select 1 from public.subscription_mail_outbox o
                           where o.dedup_key = r.id || ':' || v_key);
    begin
      perform public._subscription_mail_enqueue(r.id, 'ending_soon', v_key);
      perform public._subscription_notify(r.id,
        case when r.status = 'trial' then 'Пробный период заканчивается завтра'
             else 'Подписка заканчивается завтра' end,
        'Курс «' || r.course_title || '» открыт до '
          || to_char(r.access_until at time zone 'Europe/Moscow', 'DD.MM HH24:MI')
          || ' (МСК). Оформите подписку, чтобы продолжить без перерыва.',
        v_key);
      insert into public.notification_queue
        (profile_id, channel, event_type, entity_type, entity_id, deduplication_key, payload, status, attempts, scheduled_for)
      select r.profile_id, 'telegram', 'subscription_ending', 'subscription', r.id,
             'subscription_ending:' || r.id || ':' || v_key,
             jsonb_build_object('course_title', r.course_title, 'trial', r.status = 'trial',
                                'access_until', r.access_until, 'link', '/my-subscription'),
             'pending', 0, now()
       where exists (select 1 from public.telegram_connections tc
                      where tc.profile_id = r.profile_id and tc.is_enabled
                        and tc.disconnected_at is null and tc.telegram_chat_id is not null)
      on conflict (deduplication_key) do nothing;
      v_n := v_n + 1;
    exception when others then
      insert into public.subscription_log (subscription_id, event, details)
      values (r.id, 'ending_soon_failed', jsonb_build_object('message', sqlerrm));
    end;
  end loop;
  return v_n;
end $$;

revoke all on function public.subscription_ending_soon_tick() from public, anon, authenticated;
grant execute on function public.subscription_ending_soon_tick() to service_role;

select cron.schedule('subscription-ending-soon', '23 * * * *', 'select public.subscription_ending_soon_tick()');
