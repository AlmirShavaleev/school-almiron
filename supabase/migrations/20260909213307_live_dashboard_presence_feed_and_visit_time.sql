-- Живая панель «Сейчас»: присутствие, лента событий, время первого захода.
--
-- Три независимые вещи, объединённые тем, что все они — инфраструктура под
-- одну работу. Функции панели живут отдельной миграцией.

-- ── 1. Когда человек впервые зашёл в этот день ─────────────────────────────
--
-- ЧЕСТНО О ГРАНИЦАХ КОЛОНКИ. Первичный ключ таблицы — (profile_id,
-- visited_on), вставка идёт `on conflict do nothing`. Значит сюда ляжет время
-- ПЕРВОГО за сутки захода человека, и только оно: второй и десятый заход в тот
-- же день не запишутся вовсе.
--
-- Поэтому колонка НЕ годится для вопроса «когда школа реально учится» — это
-- «во сколько люди впервые открывают платформу». Распределение по часам на
-- панели строится по учебным событиям (сдачи, проверки, отметки тем), у
-- которых время есть по-настоящему. Колонка — задел на потом, и заполняться
-- она начинает с этой миграции: у 162 существующих строк её значение
-- останется пустым, задним числом время взять неоткуда.
alter table public.app_visits
  add column if not exists visited_at timestamptz;

comment on column public.app_visits.visited_at is
  'Время ПЕРВОГО за сутки захода. Второй и последующие заходы того же дня не '
  'пишутся (on conflict do nothing), поэтому распределения активности по '
  'часам отсюда не получить — только «во сколько человек начал день». '
  'Пустая у строк до 2026-09-10.';

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

  -- В auth есть записи без профиля (следы демо и e2e). Вставка по ним упёрлась
  -- бы в FK, поэтому пишем только тех, у кого профиль есть. Молча: это не
  -- ошибка вызывающего.
  insert into public.app_visits (profile_id, visited_on, visited_at)
  select auth.uid(), (now() at time zone 'Europe/Moscow')::date, now()
   where exists (select 1 from public.profiles p where p.id = auth.uid())
  on conflict (profile_id, visited_on) do nothing;
end;
$$;

revoke all on function public.record_app_visit() from public, anon;
grant execute on function public.record_app_visit() to authenticated;

-- ── 2. Публикация для ленты событий ────────────────────────────────────────
--
-- РОВНО ЧЕТЫРЕ таблицы, а не «все подряд»: это те четыре учебных события,
-- которые владелец выбрал для ленты. До этой миграции публикация
-- supabase_realtime была ПУСТА — ни одной таблицы, то есть ни один
-- postgres_changes в приложении не получал ничего. Подписчиков на эти таблицы
-- нет, выдачу режет та же RLS, что и обычные запросы, — прод не меняется.
--
-- Лента при этом НЕ строится из тел этих событий: подписка служит сигналом
-- «что-то произошло», а сам список перезапрашивается функцией
-- admin_live_feed(), которая делает join-ы и отдаёт готовые строки. Иначе
-- клиенту пришлось бы восстанавливать имена и названия тем из сырых строк, а
-- заодно и смысл события — «сдал» у нас это UPDATE черновика, а не INSERT.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

alter publication supabase_realtime add table public.topic_homework_attempts;
alter publication supabase_realtime add table public.topic_homework_reviews;
alter publication supabase_realtime add table public.topic_section_marks;
alter publication supabase_realtime add table public.group_students;

-- ── 3. Канал присутствия school-presence ───────────────────────────────────
--
-- По образцу hw-review:* (§31), но с ОДНИМ принципиальным отличием: там
-- читатель и писатель — одно лицо (персонал курса), а здесь они разные.
--
--   писать  — все вошедшие: ученик тоже онлайн, и без его track() панель
--             показала бы одних админов;
--   читать  — только админ и владелец: «кто сейчас на платформе» — это
--             сведения обо всей школе, включая детей.
--
-- В канал уходят ТОЛЬКО profile_id и роль. Имени там нет намеренно (решение
-- владельца): его подставляет экран из уже загруженного списка профилей. Ни
-- адреса страницы, ни идентификатора темы в канале нет и быть не должно —
-- показывать, на каком экране находится ребёнок, владелец запретил отдельно.
create policy school_presence_write on realtime.messages
  for insert to authenticated
  with check (
    (extension = any (array['presence'::text, 'broadcast'::text]))
    and realtime.topic() = 'school-presence'
  );

create policy school_presence_read on realtime.messages
  for select to authenticated
  using (
    (extension = any (array['presence'::text, 'broadcast'::text]))
    and realtime.topic() = 'school-presence'
    and public.is_admin_or_owner()
  );
