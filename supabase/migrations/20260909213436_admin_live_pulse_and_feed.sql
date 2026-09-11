-- Числа и лента живой панели «Сейчас».
--
-- Две definer-функции по образцу §107: отдают ГОТОВЫЕ значения, а не таблицы,
-- проверку роли делают в теле, отказ бросают явной ошибкой. Пустой результат
-- вместо отказа неотличим от «в школе ничего не происходит» (уроки §47/§54).
--
-- Ничего из §107 не дублируют. «Работ ждут проверки» и «сдано сегодня» панель
-- берёт из admin_school_stats(), который на странице уже загружен; заново эти
-- числа здесь не считаются.

-- ── Числа и графики ────────────────────────────────────────────────────────
create or replace function public.admin_live_pulse()
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

    -- График заходов по дням за 14 дней. Ряд строится от generate_series, а не
    -- от найденных строк: день без заходов обязан прийти нулём, иначе на
    -- графике он просто исчезнет и провал будет выглядеть как отсутствие
    -- данных (прямое требование вводной — не рисовать красоту поверх пустоты).
    'visits_daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::text, 'people', c) order by d), '[]'::jsonb)
      from (
        select d::date as d,
               (select count(distinct v.profile_id) from public.app_visits v where v.visited_on = d::date) as c
        from generate_series(v_today - 13, v_today, interval '1 day') d
      ) s
    ),

    -- График сдач по дням за 14 дней, теми же правилами.
    'submits_daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::text, 'count', c) order by d), '[]'::jsonb)
      from (
        select d::date as d,
               (select count(*) from public.topic_homework_attempts a
                 where a.submitted_at is not null
                   and (a.submitted_at at time zone 'Europe/Moscow')::date = d::date) as c
        from generate_series(v_today - 13, v_today, interval '1 day') d
      ) s
    ),

    -- Неделя к неделе: две семидневки рядом. Границы по суткам Москвы, чтобы
    -- «эта неделя» совпадала с той, которую видит владелец.
    'week', jsonb_build_object(
      'visits_this', (select count(*) from public.app_visits where visited_on > v_today - 7),
      'visits_prev', (select count(*) from public.app_visits
                       where visited_on > v_today - 14 and visited_on <= v_today - 7),
      'submits_this', (select count(*) from public.topic_homework_attempts
                        where submitted_at is not null
                          and (submitted_at at time zone 'Europe/Moscow')::date > v_today - 7),
      'submits_prev', (select count(*) from public.topic_homework_attempts
                        where submitted_at is not null
                          and (submitted_at at time zone 'Europe/Moscow')::date > v_today - 14
                          and (submitted_at at time zone 'Europe/Moscow')::date <= v_today - 7)
    ),

    -- Когда школа учится — ТОЛЬКО по учебным событиям за 30 дней.
    --
    -- Не по заходам: в app_visits времени суток нет вовсе (одна строка на
    -- человека в сутки), и рисовать оттуда «часы активности» значило бы
    -- красиво соврать. Учебные события — сдача работы, разбор преподавателя,
    -- отметка темы пройденной — время имеют настоящее.
    --
    -- Час считается по Москве. Все 24 часа возвращаются всегда, включая
    -- нулевые: ночная тишина — это тоже ответ, а пропуск часа сдвинул бы
    -- соседние столбики и исказил форму дня.
    'hourly', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'events', c) order by h), '[]'::jsonb)
      from (
        select h,
               (select count(*) from (
                  select a.submitted_at as at from public.topic_homework_attempts a
                   where a.submitted_at is not null and a.submitted_at > now() - interval '30 days'
                  union all
                  select r.created_at from public.topic_homework_reviews r
                   where r.created_at > now() - interval '30 days'
                  union all
                  select m.marked_at from public.topic_section_marks m
                   where m.marked_at > now() - interval '30 days'
                ) e
                where extract(hour from (e.at at time zone 'Europe/Moscow')) = h) as c
        from generate_series(0, 23) h
      ) s
    ),

    -- Охват: сколько зачисленных учеников заходили за 7 дней.
    -- Знаменатель — ученики с членством в группе, а не все строки students:
    -- незачисленному заходить некуда, и он занижал бы долю без причины.
    'reach', jsonb_build_object(
      'active_7d', (
        select count(distinct s.id)
          from public.students s
          join public.app_visits v on v.profile_id = s.profile_id
         where v.visited_on > v_today - 7
           and exists (select 1 from public.group_students gs where gs.student_id = s.id)
      ),
      'enrolled', (
        select count(distinct gs.student_id) from public.group_students gs
      )
    ),

    -- Средняя частота заходов на активного ученика за 7 дней.
    --
    -- Считается в ДНЯХ С ЗАХОДОМ, а не в заходах: app_visits хранит максимум
    -- одну строку на человека в сутки, и «пять заходов за день» в ней
    -- неотличимы от одного. Экран так и подписывает.
    'visit_days_per_student', (
      select case when count(distinct s.id) = 0 then 0
                  else round(count(*)::numeric / count(distinct s.id), 1) end
        from public.students s
        join public.app_visits v on v.profile_id = s.profile_id
       where v.visited_on > v_today - 7
    ),

    -- Новые ученики за неделю — СПИСКОМ ИМЁН, а не числом: число ни к чему не
    -- побуждает, имя — да (решение владельца по трём спискам панели).
    'new_students', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'student_id', s.id, 'profile_id', p.id,
               'full_name', p.full_name, 'created_at', s.created_at
             ) order by s.created_at desc), '[]'::jsonb)
        from public.students s
        join public.profiles p on p.id = s.profile_id
       where s.created_at > now() - interval '7 days'
    ),

    -- Без привязанного Telegram — тоже списком имён.
    -- «Привязан» = есть строка со снятым disconnected_at и включённой
    -- доставкой: отключённая привязка не считается живой.
    'no_telegram', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'student_id', s.id, 'profile_id', p.id, 'full_name', p.full_name
             ) order by p.full_name), '[]'::jsonb)
        from public.students s
        join public.profiles p on p.id = s.profile_id
       where s.is_active
         and not exists (
           select 1 from public.telegram_connections tc
            where tc.profile_id = s.profile_id
              and tc.disconnected_at is null
              and coalesce(tc.is_enabled, true)
         )
    )

  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_live_pulse() from public, anon;
grant execute on function public.admin_live_pulse() to authenticated;

comment on function public.admin_live_pulse() is
  'Числа и графики живой панели «Сейчас». Ряды по дням и часам возвращаются '
  'вместе с нулевыми точками — пропуск дня на графике неотличим от отсутствия '
  'данных. Часы считаются по учебным событиям, а не по заходам: в app_visits '
  'времени суток нет.';

-- ── Лента событий ──────────────────────────────────────────────────────────
--
-- Четыре учебных события в одном списке. Это то, что персонал и так видит на
-- своих экранах, — не слежка за перемещениями: ни адреса страницы, ни того,
-- «где человек сейчас», здесь нет.
--
-- Почему лента приходит отсюда, а не из тел realtime-сообщений: сырая строка
-- не знает ни имени человека, ни названия темы, а «сдал работу» у нас вообще
-- UPDATE черновика, а не INSERT. Подписка служит сигналом «что-то
-- произошло», список перезапрашивается этой функцией.
create or replace function public.admin_live_feed(p_limit integer default 20)
returns table (
  kind       text,
  at         timestamptz,
  actor_name text,
  detail     text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_admin_or_owner() then
    raise exception 'ONLY_ADMIN_SEES_SCHOOL_STATS' using errcode = 'P0001';
  end if;

  return query
  with events as (
    -- Сдал работу
    select 'submitted'::text as kind,
           a.submitted_at    as at,
           p.full_name       as actor_name,
           t.title           as detail
      from public.topic_homework_attempts a
      join public.students s  on s.id = a.student_id
      join public.profiles p  on p.id = s.profile_id
      join public.topic_homework h on h.id = a.homework_id
      join public.topics t    on t.id = h.topic_id
     where a.submitted_at is not null

    union all

    -- Преподаватель разобрал работу
    select 'reviewed',
           r.created_at,
           p.full_name,
           t.title
      from public.topic_homework_reviews r
      join public.profiles p  on p.id = r.reviewer_id
      join public.topic_homework_attempts a on a.id = r.attempt_id
      join public.topic_homework h on h.id = a.homework_id
      join public.topics t    on t.id = h.topic_id

    union all

    -- Ученик отметил тему пройденной
    select 'marked',
           m.marked_at,
           p.full_name,
           t.title
      from public.topic_section_marks m
      join public.students s on s.id = m.student_id
      join public.profiles p on p.id = s.profile_id
      join public.topics t   on t.id = m.topic_id

    union all

    -- Зачислен в курс
    select 'enrolled',
           gs.joined_at,
           p.full_name,
           coalesce(c.title, g.name)
      from public.group_students gs
      join public.students s on s.id = gs.student_id
      join public.profiles p on p.id = s.profile_id
      join public.groups g   on g.id = gs.group_id
      left join public.courses c on c.id = g.course_id
  )
  select e.kind, e.at, e.actor_name, e.detail
    from events e
   where e.at is not null
   order by e.at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

revoke all on function public.admin_live_feed(integer) from public, anon;
grant execute on function public.admin_live_feed(integer) to authenticated;

comment on function public.admin_live_feed(integer) is
  'Последние учебные события школы для ленты панели «Сейчас»: сдача, разбор, '
  'отметка темы, зачисление. Ни адресов страниц, ни сведений о том, где '
  'человек находится сейчас, — только то, что персонал видит и так.';
