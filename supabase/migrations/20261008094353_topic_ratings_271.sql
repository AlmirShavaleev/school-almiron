-- §271. Ученик оценивает урок (тему курса) от 1 до 10 звёзд; персонал видит сводку «Оценки уроков» и находит
-- непонятные уроки, которые стоит переработать.
-- ПРИМЕНЕНО 08.10 через MCP (версия 20261008094353). Только добавляющая: новая таблица и три новые функции, существующее не меняется.
-- Повторный прогон — без ошибок (if not exists / create or replace).
--
-- Где живёт. `topic_ratings` — одна строка на пару «тема × ученик» (unique), оценку можно менять сколько угодно
-- (upsert: rating и updated_at обновляются, created_at — когда оценили впервые). Текста нет — только число.
--
-- Кто пишет. Только `rate_topic` (definer). Ученик — `auth_student_id()` (строка `students` вызывающего; у персонала
-- и в предпросмотре её нет → 42501). Доступ к теме — тот же помощник, что у ленты задач ученика (`answer_topic_task`):
-- `course_student_can_see_topic` = доступ к курсу (`course_student_has_access`: группа курса или активная/пробная
-- запись `student_courses`) и тема уже открыта (`topic_open_now`). Чужой курс или закрытая тема → 42501.
-- Оценка вне 1..10 → 22023 (до проверки доступа: ошибку ввода видно сразу).
--
-- Кто читает. Ученик — только свою оценку через `my_topic_rating`. Персонал — только сводку через
-- `topic_ratings_summary(course_id)`: число оценок, среднее, распределение по 1..10 и дата последней. Без имён учеников —
-- сводка анонимная. Доступ — `course_is_staff` (админ платформы, владелец курса, преподаватель и кураторы курса),
-- иначе 42501.
--
-- Таблица закрыта целиком: RLS включена, политик нет, прав у anon/authenticated нет — только definer-функции
-- (как `school_presence`, §148).
--
-- Порядок выкладки: миграция → фронт (без миграции блок «Оцените урок» и страница «Оценки уроков» показывают ошибку
-- загрузки, остальное на странице темы работает).

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Таблица
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.topic_ratings (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references public.topics(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  rating      smallint not null check (rating between 1 and 10),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (topic_id, student_id)
);

create index if not exists topic_ratings_topic_id_idx on public.topic_ratings (topic_id);
-- Удаление ученика каскадом ищет его строки — без индекса это полный проход.
create index if not exists topic_ratings_student_id_idx on public.topic_ratings (student_id);

alter table public.topic_ratings enable row level security;
revoke all on table public.topic_ratings from public, anon, authenticated;

comment on table public.topic_ratings is
  '§271. Оценка урока (темы курса) учеником: 1–10 звёзд, одна строка на пару тема × ученик, менять можно. Закрыта целиком: пишет rate_topic, читают my_topic_rating (своя) и topic_ratings_summary (персонал, без имён).';
comment on column public.topic_ratings.rating is '§271. Оценка 1..10.';
comment on column public.topic_ratings.created_at is '§271. Когда ученик оценил урок впервые.';
comment on column public.topic_ratings.updated_at is '§271. Когда оценка последний раз поставлена или изменена.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Поставить / изменить оценку
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.rate_topic(p_topic_id uuid, p_rating int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
  v_rating  smallint;
  v_at      timestamptz;
begin
  if p_rating is null or p_rating < 1 or p_rating > 10 then
    raise exception 'Оценка — целое число от 1 до 10' using errcode = '22023';
  end if;

  v_student := public.auth_student_id();
  if v_student is null then
    raise exception 'Оценку урока ставит ученик' using errcode = '42501';
  end if;

  -- Тот же помощник, что у ленты задач ученика: доступ к курсу темы и тема открыта.
  if p_topic_id is null or not public.course_student_can_see_topic(p_topic_id) then
    raise exception 'Нет доступа к этому уроку' using errcode = '42501';
  end if;

  insert into public.topic_ratings as r (topic_id, student_id, rating)
  values (p_topic_id, v_student, p_rating::smallint)
  on conflict (topic_id, student_id) do update
    set rating     = excluded.rating,
        updated_at = now()
  returning r.rating, r.updated_at into v_rating, v_at;

  return jsonb_build_object('rating', v_rating, 'updated_at', v_at);
end;
$$;

comment on function public.rate_topic(uuid, int) is
  '§271. Ученик ставит или меняет оценку урока 1..10 (upsert). Доступ — course_student_can_see_topic, иначе 42501; не ученик — 42501; оценка вне 1..10 — 22023. Возвращает {rating, updated_at}.';

revoke all on function public.rate_topic(uuid, int) from public, anon;
grant execute on function public.rate_topic(uuid, int) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Своя оценка
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.my_topic_rating(p_topic_id uuid)
returns smallint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.rating
    from public.topic_ratings r
   where r.topic_id = p_topic_id
     and r.student_id = public.auth_student_id();
$$;

comment on function public.my_topic_rating(uuid) is
  '§271. Оценка урока вызывающим учеником (1..10) или null — ещё не оценивал / не ученик. Только своя строка.';

revoke all on function public.my_topic_rating(uuid) from public, anon;
grant execute on function public.my_topic_rating(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Сводка по курсу для персонала
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.topic_ratings_summary(p_course_id uuid)
returns table (topic_id uuid, ratings int, avg_rating numeric, dist int[], last_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет доступа к оценкам уроков этого курса' using errcode = '42501';
  end if;

  return query
  select r.topic_id,
         count(*)::int,
         round(avg(r.rating)::numeric, 2),
         -- Распределение: dist[n] — сколько учеников поставили n звёзд (1..10).
         array[
           count(*) filter (where r.rating = 1),  count(*) filter (where r.rating = 2),
           count(*) filter (where r.rating = 3),  count(*) filter (where r.rating = 4),
           count(*) filter (where r.rating = 5),  count(*) filter (where r.rating = 6),
           count(*) filter (where r.rating = 7),  count(*) filter (where r.rating = 8),
           count(*) filter (where r.rating = 9),  count(*) filter (where r.rating = 10)
         ]::int[],
         max(r.updated_at)
    from public.topic_ratings r
    join public.topics  t on t.id = r.topic_id
    join public.modules m on m.id = t.module_id
   where m.course_id = p_course_id
   group by r.topic_id;
end;
$$;

comment on function public.topic_ratings_summary(uuid) is
  '§271. Сводка оценок уроков курса для персонала (course_is_staff, иначе 42501): по каждой оценённой теме — число оценок, среднее (2 знака), распределение dist[1..10] и дата последней оценки. Без имён учеников.';

revoke all on function public.topic_ratings_summary(uuid) from public, anon;
grant execute on function public.topic_ratings_summary(uuid) to authenticated;
