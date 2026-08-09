-- Статистика школы: учёт просмотров материалов и четыре среза для дашборда.
-- Решения владельца 2026-08-08, продолжение §78.
--
-- Сужение везде одно и то же — `course_is_staff(course_id)`. Она уже знает про
-- платформенного админа, владельца курса, преподавателя группы, куратора
-- группы и куратора курса. Заводить здесь пятую формулировку «мой ли это
-- курс» нельзя: ровно рассинхрон таких копий породил §21 и §29.

-- ── 1. Просмотры материалов ─────────────────────────────────────────────────
-- Одна запись на (человек, материал, сутки) — как в app_visits (§78). Прокрутки
-- и наведения не пишем: объём на пустом месте, вопросов из вводной они не
-- отвечают.
create table if not exists public.material_views (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_id    uuid not null references public.topic_material_items(id) on delete cascade,
  topic_id   uuid not null references public.topics(id) on delete cascade,
  viewed_on  date not null,
  primary key (profile_id, item_id, viewed_on)
);

comment on table public.material_views is
  'Посуточная отметка «человек открыл материал». Пишется только '
  'record_material_view(), читается только аналитическими RPC. Без времени '
  'внутри дня, без IP, без событий прокрутки — это счётчик охвата, а не '
  'слежка за поведением ребёнка.';

create index if not exists material_views_topic_idx on public.material_views (topic_id);
create index if not exists material_views_item_idx  on public.material_views (item_id);

alter table public.material_views enable row level security;
revoke all on table public.material_views from anon, authenticated;

-- ── 2. Запись просмотра ─────────────────────────────────────────────────────
-- День по Москве — тем же счётом, что визиты (§78), иначе вечерние просмотры
-- уезжают в завтра.
create or replace function public.record_material_view(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_topic uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select i.topic_id into v_topic
    from public.topic_material_items i
   where i.id = p_item_id;

  if v_topic is null then
    raise exception 'MATERIAL_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Право видеть материал проверяем ЗДЕСЬ, а не доверяем клиенту: функция
  -- definer, и без проверки любой вошедший смог бы наотмечать просмотры чужих
  -- тем и испортить охват.
  if not (public.course_student_can_see_topic(v_topic) or public.topic_material_can_manage(v_topic)) then
    raise exception 'TOPIC_NOT_VISIBLE' using errcode = 'P0001';
  end if;

  insert into public.material_views (profile_id, item_id, topic_id, viewed_on)
  select auth.uid(), p_item_id, v_topic, (now() at time zone 'Europe/Moscow')::date
   where exists (select 1 from public.profiles p where p.id = auth.uid())
  on conflict (profile_id, item_id, viewed_on) do nothing;
end;
$$;

revoke all on function public.record_material_view(uuid) from public, anon;
grant execute on function public.record_material_view(uuid) to authenticated;

-- ── 3. Общий отбор «мои курсы» ──────────────────────────────────────────────
-- Отдельной функцией, чтобы четыре среза ниже не повторяли один и тот же
-- запрос. Пустой результат означает «этот человек не персонал ни одного
-- курса» — срезы на это отвечают ошибкой, а не молчанием (урок §47).
create or replace function public.my_staff_course_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.id from public.courses c where public.course_is_staff(c.id);
$$;

grant execute on function public.my_staff_course_ids() to authenticated;

-- Тела четырёх срезов заданы в следующей миграции
-- (20260808220959): здесь они были созданы с обращением `select id from
-- my_staff_course_ids()`, что неверно для `setof uuid`. Итоговый вид — там.
