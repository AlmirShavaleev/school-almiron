-- Дашборд школы: учёт визитов и агрегаты «только числа».
--
-- Почему своя таблица, а не auth.users.last_sign_in_at (решение владельца
-- 2026-08-04): сессии живут неделями на refresh-токене, last_sign_in_at при
-- этом не двигается — активный человек, не разлогинивавшийся месяц, выглядел
-- бы неактивным. На проде это видно: 3 «входа» за сутки и 12 за неделю из 54
-- записей auth при живой школе.
--
-- Что НЕ пишем: ни IP, ни user-agent, ни страницы. Одна строка на человека в
-- сутки, максимум. Первичный ключ (profile_id, visited_on) делает повтор
-- бесплатным — on conflict do nothing, а не проверка «уже писали?» в клиенте.

create table if not exists public.app_visits (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  visited_on date not null,
  primary key (profile_id, visited_on)
);

comment on table public.app_visits is
  'Посуточная отметка «человек заходил». Пишется только record_app_visit(), '
  'читается только admin_school_stats(). Без IP и без страниц — это счётчик '
  'активности, а не аналитика поведения.';

-- Прямого доступа нет ни у кого: таблицу закрывает RLS без единой политики,
-- работать с ней могут только definer-функции ниже.
alter table public.app_visits enable row level security;
revoke all on table public.app_visits from anon, authenticated;

-- ── Отметка визита ─────────────────────────────────────────────────────────
-- День считаем по Москве, а не по UTC: «сегодня» на дашборде должно совпадать
-- с сегодня у владельца, иначе вечерние визиты уезжают в завтра.
create or replace function public.record_app_visit()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  -- В auth есть записи без профиля (24 штуки на 04.08, следы демо и e2e).
  -- Вставка по ним упёрлась бы в FK, поэтому пишем только тех, у кого профиль
  -- есть. Молча: это не ошибка вызывающего.
  insert into public.app_visits (profile_id, visited_on)
  select auth.uid(), (now() at time zone 'Europe/Moscow')::date
   where exists (select 1 from public.profiles p where p.id = auth.uid())
  on conflict (profile_id, visited_on) do nothing;
end;
$$;

revoke all on function public.record_app_visit() from public, anon;
grant execute on function public.record_app_visit() to authenticated;

-- ── Агрегаты школы ─────────────────────────────────────────────────────────
-- Отдаём ЧИСЛА, а не таблицы: считать через раздачу прав на students/courses/
-- topic_homework_* клиенту нельзя, а под админской RLS цифры и так сходятся —
-- но тогда клиент тянул бы строки ради count. Проверка роли в теле, без
-- пустого exception-блока (урок §47: 42501 глотался и выглядел как «нет
-- данных»).
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

    'telegram_connected',
      (select count(*) from public.telegram_connections where is_enabled),

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
