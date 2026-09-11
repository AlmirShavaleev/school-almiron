-- Присутствие в школе через отметки в таблице, а не через канал Realtime.
--
-- ПОЧЕМУ НЕ КАНАЛ. Первая версия (§148) делала присутствие на Supabase
-- Presence: все вошедшие отмечались в канале `school-presence`, читать его
-- разрешалось только админу. На превью это не заработало, и логи Realtime
-- сказали почему:
--
--   Unauthorized: You do not have permissions to read from this Channel
--   topic: school-presence
--
-- Чтобы ОТМЕТИТЬСЯ в канале, клиенту нужно право ЧИТАТЬ его: подписка
-- проверяется на входе, и ученик до track() не доходил вовсе — браузер лишь
-- повторял попытку каждые 7–10 секунд. Запасной ход «разрешить вошедшему
-- видеть свою строку» тоже не работает: RLS на канале решает про ТЕМУ
-- целиком, отдельных записей присутствия там нет и фильтровать нечего.
--
-- Открыть чтение канала всем вошедшим владелец не захотел: тогда любой ученик
-- через инструменты браузера увидел бы список тех, кто сейчас онлайн — пусть
-- идентификаторами и ролями, без имён.
--
-- Отсюда нынешнее устройство: ученик ПИШЕТ свою отметку, список ЧИТАЕТ только
-- админ. Утечки нет вовсе, потому что читать нечего.

-- ── Таблица отметок ────────────────────────────────────────────────────────
--
-- Одна строка на человека, перезапись, никакой истории: запрет на историю
-- перемещений из вводной никуда не делся, и выполнен он конструкцией — строка
-- ровно одна и она затирается, накапливать нечего.
--
-- Что здесь НЕ хранится: ни адреса страницы, ни идентификатора темы. «На каком
-- экране находится ребёнок» владелец запретил показывать, и этого нет в
-- данных, а не спрятано на экране.
create table if not exists public.school_presence (
  profile_id uuid        primary key references public.profiles(id) on delete cascade,
  role       text        not null default '',
  seen_at    timestamptz not null default now()
);

comment on table public.school_presence is
  'Кто сейчас на платформе: одна строка на человека, перезаписывается при '
  'каждой отметке. Истории нет по построению. Пишет school_presence_touch() '
  'за себя, читает school_presence_online() только админу. Ни страниц, ни тем '
  'здесь нет — только факт присутствия.';

-- Прямого доступа нет НИ У КОГО: RLS без единой политики, гранты сняты.
-- Работают только definer-функции ниже — то же устройство, что у app_visits
-- (§107). Это сильнее, чем политика «читать может админ»: у ученика нет пути
-- к списку вовсе, а не есть путь, закрытый проверкой.
alter table public.school_presence enable row level security;
revoke all on table public.school_presence from anon, authenticated;

-- ── Отметка «я здесь» ──────────────────────────────────────────────────────
--
-- Роль берётся ИЗ ПРОФИЛЯ, а не из аргумента: иначе клиент мог бы назваться
-- кем угодно, и список онлайн врал бы ролями.
create or replace function public.school_presence_touch()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  -- Только своя строка: profile_id берётся из auth.uid() и аргументом не
  -- задаётся в принципе.
  insert into public.school_presence (profile_id, role, seen_at)
  select p.id, coalesce(p.role, ''), now()
    from public.profiles p
   where p.id = auth.uid()
  on conflict (profile_id) do update
    set seen_at = excluded.seen_at,
        role    = excluded.role;
end;
$$;

revoke all on function public.school_presence_touch() from public, anon;
grant execute on function public.school_presence_touch() to authenticated;

comment on function public.school_presence_touch() is
  'Отметка «я на платформе» за себя: profile_id — всегда auth.uid(), роль — '
  'из profiles, а не из аргумента. Вызывается раз в 20 секунд при видимой '
  'вкладке.';

-- ── Список онлайн ──────────────────────────────────────────────────────────
--
-- Окно свежести — 45 секунд при отметке раз в 20: закрыл вкладку — пропал за
-- 45 секунд, и один потерянный удар не выкидывает человека из списка. Во
-- вводной стояло «в течение полуминуты»; честная цифра теперь 45 секунд, и
-- экран так и подписан.
--
-- Имён здесь нет намеренно: отдаём profile_id и роль, имя подставляет экран из
-- уже загруженного списка профилей. Правило то же, что было у канала, и
-- менять его из-за смены механизма незачем.
create or replace function public.school_presence_online(p_seconds integer default 45)
returns table (
  profile_id uuid,
  role       text,
  seen_at    timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_window integer := greatest(5, least(coalesce(p_seconds, 45), 600));
begin
  if not public.is_admin_or_owner() then
    raise exception 'ONLY_ADMIN_SEES_SCHOOL_STATS' using errcode = 'P0001';
  end if;

  return query
  select sp.profile_id, sp.role, sp.seen_at
    from public.school_presence sp
   where sp.seen_at > now() - make_interval(secs => v_window)
   order by sp.seen_at desc;
end;
$$;

revoke all on function public.school_presence_online(integer) from public, anon;
grant execute on function public.school_presence_online(integer) to authenticated;

comment on function public.school_presence_online(integer) is
  'Кто отмечался за последние p_seconds секунд (по умолчанию 45). Только '
  'админу и владельцу. Имён не отдаёт — profile_id и роль, имя подставляет '
  'экран.';
