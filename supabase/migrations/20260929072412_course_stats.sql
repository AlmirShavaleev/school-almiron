-- §242. Статистика курса у учителя: сводка за период, по темам, по ученикам,
-- разбивка темы по ученикам.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration, после чего
-- файл переименовывается в <version>_<name>.sql точно по записи в
-- supabase_migrations.schema_migrations (MIGRATIONS.md).
--
-- Только добавление: один индекс и новые функции. Ничего существующего не
-- меняется. Повторное применение безопасно (create or replace / if not exists).
--
-- ── Кто видит ──────────────────────────────────────────────────────────────
-- Четыре публичные функции — security definer (считают по чужим строкам:
-- просмотры, видео и работы всех учеников класса), поэтому права проверяются
-- руками и ПЕРВЫМ делом, одной формулировкой проекта — course_is_staff
-- (CLAUDE.md: своих копий «персонал ли» не писать). Ученику, чужому учителю,
-- анониму — 42501. Внутренние помощники (course_stats_*_internal) без
-- проверки прав, поэтому execute у них отнят у всех, кроме владельца: их
-- зовут только эти четыре функции.
--
-- ── Определения (одни и те же во всех четырёх функциях) ────────────────────
-- * Ученики курса — group_students групп курса (один курс = одна группа).
-- * День — по Москве, как пишутся material_views / video_watch_daily (§107, §204).
-- * «Занимался в курсе» в день D: открыл материал темы курса (material_views),
--   смотрел видео темы курса (video_watch_daily) или начал/сдал работу по ДЗ
--   темы курса (created_at / submitted_at попытки). Вход в приложение
--   (app_visits) НЕ считается. Работы по времени (контрольная/проверочная) тут
--   считаются: написать контрольную — занятие курсом.
-- * «Открыли файлов» — строки material_views (не чаще раза в день на материал).
-- * Доступные ученику файлы — материалы kind = 'file' (только их открытие и
--   пишет record_material_view), которые ему показала бы политика
--   topic_material_items_student_select. Её условия зависят от auth.uid(), а
--   считаем мы за каждого ученика, поэтому здесь её ДОСЛОВНАЯ развёртка по
--   ученику: те же помощники (topic_open_now, topic_is_timed,
--   topic_homework_condition_open, topic_subtopic_is_hidden), а гейт решения
--   topic_solution_unlocked — его же тело с учеником вместо auth_student_id().
--   Пробы (supabase/tests/stat_242) сверяют число с тем, что RLS отдаёт
--   самому ученику. Меняется политика — меняется и эта развёртка.
-- * «Досмотрел видео» — max_position ≥ 0.9·duration_seconds хотя бы в один день;
--   «начал» — просмотр есть, но меньше. Тему «досмотрел», если досмотрены все
--   её видимые видео.
-- * ДЗ — только темы-уроки: работы по времени (kind check/control) — в разделе
--   §241. Сдача — попытка не draft с submitted_at в периоде. Принято / вернули
--   — по последнему вердикту попытки. «Ждут» — status = 'submitted' сейчас
--   (очередь, без периода). Средний — балл принятых попыток (одна на ДЗ).
-- * Период: '7d' — сегодня и 6 дней до; '30d' — 30 дней; 'all' — без начала.
--   «Прошлый такой же период» — столько же дней перед ним (для 'all' нет).

-- ── 0. Индекс ──────────────────────────────────────────────────────────────
-- Выборки идут «темы курса × дни периода». У material_views есть только
-- (topic_id) и первичный ключ по (profile_id, …); у video_watch_daily
-- (item_id, day) уже есть (20260917230035) — второй не нужен.
create index if not exists material_views_topic_day_idx
  on public.material_views (topic_id, viewed_on);

-- ── 1. Границы периода ─────────────────────────────────────────────────────
create or replace function public.course_stats_bounds_internal(p_period text)
returns table (d_from date, d_to date, prev_from date, prev_to date)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
begin
  if p_period = '7d' then
    return query select v_today - 6, v_today, v_today - 13, v_today - 7;
  elsif p_period = '30d' then
    return query select v_today - 29, v_today, v_today - 59, v_today - 30;
  elsif p_period = 'all' then
    return query select null::date, v_today, null::date, null::date;
  else
    raise exception 'Период — 7d, 30d или all' using errcode = '22023';
  end if;
end;
$$;

-- ── 2. Ученики курса ───────────────────────────────────────────────────────
create or replace function public.course_stats_roster_internal(p_course_id uuid)
returns table (student_id uuid, profile_id uuid, full_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (s.id) s.id, s.profile_id, coalesce(nullif(btrim(p.full_name), ''), 'Без имени')
    from public.group_students gs
    join public.groups g   on g.id = gs.group_id
    join public.students s on s.id = gs.student_id
    left join public.profiles p on p.id = s.profile_id
   where g.course_id = p_course_id
   order by s.id;
$$;

-- ── 3. Дни занятий ─────────────────────────────────────────────────────────
create or replace function public.course_stats_activity_internal(p_course_id uuid)
returns table (student_id uuid, day date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with roster as (
    select * from public.course_stats_roster_internal(p_course_id)
  ),
  ct as (
    select t.id from public.topics t join public.modules m on m.id = t.module_id
     where m.course_id = p_course_id
  )
  select r.student_id, mv.viewed_on
    from roster r
    join public.material_views mv on mv.profile_id = r.profile_id
   where mv.topic_id in (select id from ct)
  union
  select r.student_id, v.day
    from roster r
    join public.video_watch_daily v on v.student_id = r.profile_id
    join public.topic_material_items i on i.id = v.item_id
   where i.topic_id in (select id from ct)
     and v.seconds > 0
  union
  select a.student_id, (a.created_at at time zone 'Europe/Moscow')::date
    from public.topic_homework_attempts a
    join public.topic_homework h on h.id = a.homework_id
    join roster r on r.student_id = a.student_id
   where h.topic_id in (select id from ct)
  union
  select a.student_id, (a.submitted_at at time zone 'Europe/Moscow')::date
    from public.topic_homework_attempts a
    join public.topic_homework h on h.id = a.homework_id
    join roster r on r.student_id = a.student_id
   where h.topic_id in (select id from ct)
     and a.submitted_at is not null;
$$;

-- ── 4. Файлы, доступные ученику ────────────────────────────────────────────
-- Развёртка topic_material_items_student_select (последняя редакция —
-- 20260928122420_kontrolnaya_timed_work) по ученику r.student_id:
--   is_visible
--   and course_student_can_see_topic(topic_id)   -- ученик группы курса: доступ к
--                                                -- курсу есть, остаётся topic_open_now
--   and (section is distinct from 'solution'  or track = 'training' or <решение открыто>)
--   and (section is distinct from 'criteria'  or track = 'training' or <решение открыто>)
--   and (section is distinct from 'worksheet_homework' or track = 'training'
--        or topic_condition_visible(topic_id))  -- тело: not topic_is_timed or
--                                                -- exists ДЗ с topic_homework_condition_open(h, ученик)
--   and (track <> 'training' or not topic_subtopic_is_hidden(topic_id, subtopic_code))
-- <решение открыто> — тело topic_solution_unlocked (20260805220729): у темы нет
-- ДЗ или у ученика есть принятая попытка.
create or replace function public.course_stats_files_internal(p_course_id uuid)
returns table (student_id uuid, item_id uuid, topic_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with roster as (
    select * from public.course_stats_roster_internal(p_course_id)
  ),
  items as (
    select i.id, i.topic_id, i.section, i.track, i.subtopic_code
      from public.topic_material_items i
      join public.topics t  on t.id = i.topic_id
      join public.modules m on m.id = t.module_id
     where m.course_id = p_course_id
       and i.kind = 'file'
       and i.is_visible
       and public.topic_open_now(t.is_open, t.available_from)
  )
  select r.student_id, i.id, i.topic_id
    from roster r
    cross join items i
   where (i.section is distinct from 'solution'
          or i.track = 'training'
          or not exists (select 1 from public.topic_homework h where h.topic_id = i.topic_id)
          or exists (select 1 from public.topic_homework_attempts a
                       join public.topic_homework h on h.id = a.homework_id
                      where h.topic_id = i.topic_id and a.student_id = r.student_id and a.status = 'accepted'))
     and (i.section is distinct from 'criteria'
          or i.track = 'training'
          or not exists (select 1 from public.topic_homework h where h.topic_id = i.topic_id)
          or exists (select 1 from public.topic_homework_attempts a
                       join public.topic_homework h on h.id = a.homework_id
                      where h.topic_id = i.topic_id and a.student_id = r.student_id and a.status = 'accepted'))
     and (i.section is distinct from 'worksheet_homework'
          or i.track = 'training'
          or not public.topic_is_timed(i.topic_id)
          or exists (select 1 from public.topic_homework h
                      where h.topic_id = i.topic_id
                        and public.topic_homework_condition_open(h.id, r.student_id)))
     and (i.track <> 'training'
          or not public.topic_subtopic_is_hidden(i.topic_id, i.subtopic_code));
$$;

-- ── 5. Сдачи ДЗ тем-уроков с последним вердиктом ───────────────────────────
create or replace function public.course_stats_attempts_internal(p_course_id uuid)
returns table (
  attempt_id uuid, student_id uuid, topic_id uuid, homework_id uuid, grade_scale text,
  status text, attempt_number int, created_day date, submitted_at timestamptz, submitted_day date,
  decision text, score int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.student_id, h.topic_id, h.id, h.grade_scale,
         a.status::text, a.attempt_number,
         (a.created_at at time zone 'Europe/Moscow')::date,
         a.submitted_at,
         (a.submitted_at at time zone 'Europe/Moscow')::date,
         rv.decision, rv.score
    from public.topic_homework_attempts a
    join public.topic_homework h on h.id = a.homework_id
    join public.topics t  on t.id = h.topic_id
    join public.modules m on m.id = t.module_id
    join public.course_stats_roster_internal(p_course_id) r on r.student_id = a.student_id
    left join lateral (
      select x.decision::text as decision, x.score
        from public.topic_homework_reviews x
       where x.attempt_id = a.id
       order by x.created_at desc
       limit 1
    ) rv on true
   where m.course_id = p_course_id
     and t.kind not in ('check', 'control');
$$;

revoke all on function public.course_stats_bounds_internal(text)      from public, anon, authenticated;
revoke all on function public.course_stats_roster_internal(uuid)      from public, anon, authenticated;
revoke all on function public.course_stats_activity_internal(uuid)    from public, anon, authenticated;
revoke all on function public.course_stats_files_internal(uuid)       from public, anon, authenticated;
revoke all on function public.course_stats_attempts_internal(uuid)    from public, anon, authenticated;

-- ── 6. Сводка курса за период ──────────────────────────────────────────────
create or replace function public.course_stats_summary(p_course_id uuid, p_period text default '7d')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  b        record;
  v_result jsonb;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = '42501';
  end if;
  select * into b from public.course_stats_bounds_internal(p_period);

  with
  roster as (select * from public.course_stats_roster_internal(p_course_id)),
  ct as (
    select t.id from public.topics t join public.modules m on m.id = t.module_id
     where m.course_id = p_course_id
  ),
  act as (select * from public.course_stats_activity_internal(p_course_id)),
  views as (
    select mv.viewed_on
      from public.material_views mv
      join roster r on r.profile_id = mv.profile_id
     where mv.topic_id in (select id from ct)
  ),
  video as (
    select v.student_id, v.item_id, v.day, v.seconds,
           (v.duration_seconds > 0 and v.max_position >= 0.9 * v.duration_seconds) as done
      from public.video_watch_daily v
      join roster r on r.profile_id = v.student_id
      join public.topic_material_items i on i.id = v.item_id
     where i.topic_id in (select id from ct)
  ),
  att as (select * from public.course_stats_attempts_internal(p_course_id)),
  subm as (
    select * from att
     where status <> 'draft' and submitted_at is not null
       and (b.d_from is null or submitted_day >= b.d_from) and submitted_day <= b.d_to
  ),
  -- Опубликованные ДЗ тем-уроков, открытых ученикам: без них «не сдали за
  -- 14 дней» — не упрёк, а просто пустой курс.
  open_hw as (
    select 1
      from public.topic_homework h
      join public.topics t on t.id = h.topic_id
     where t.id in (select id from ct)
       and h.is_published
       and t.kind not in ('check', 'control')
       and public.topic_open_now(t.is_open, t.available_from)
     limit 1
  ),
  last_day as (
    select r.student_id, r.full_name, max(a.day) as last_day
      from roster r left join act a on a.student_id = r.student_id
     group by r.student_id, r.full_name
  )
  select jsonb_build_object(
    'period',     p_period,
    'from',       b.d_from,
    'to',         b.d_to,
    'prev_from',  b.prev_from,
    'prev_to',    b.prev_to,
    'in_class',   (select count(*) from roster),
    'active',     (select count(distinct student_id) from act
                    where (b.d_from is null or day >= b.d_from) and day <= b.d_to),
    'views',      (select count(*) from views
                    where (b.d_from is null or viewed_on >= b.d_from) and viewed_on <= b.d_to),
    'views_prev', case when b.prev_from is null then null else
                    (select count(*) from views where viewed_on between b.prev_from and b.prev_to) end,
    'video_seconds', (select coalesce(sum(seconds), 0) from video
                       where (b.d_from is null or day >= b.d_from) and day <= b.d_to),
    'video_done',    (select count(*) from (select distinct student_id, item_id from video
                       where done and (b.d_from is null or day >= b.d_from) and day <= b.d_to) x),
    'submitted',  (select count(*) from subm),
    'accepted',   (select count(*) from subm where decision = 'accepted'),
    'returned',   (select count(*) from subm where decision = 'returned_for_revision'),
    'pending',    (select count(*) from att where status = 'submitted'),
    'pending_oldest_at', (select min(submitted_at) from att where status = 'submitted'),
    'avg_five',          (select round(avg(score), 2) from subm
                           where decision = 'accepted' and score is not null and grade_scale = 'five'),
    'avg_five_count',    (select count(*) from subm
                           where decision = 'accepted' and score is not null and grade_scale = 'five'),
    'avg_hundred',       (select round(avg(score), 1) from subm
                           where decision = 'accepted' and score is not null and grade_scale = 'hundred'),
    'avg_hundred_count', (select count(*) from subm
                           where decision = 'accepted' and score is not null and grade_scale = 'hundred'),
    -- 30 дней активности всегда, независимо от периода.
    'days', (
      select jsonb_agg(jsonb_build_object('day', d.day, 'active', coalesce(c.n, 0)) order by d.day)
        from (select (b.d_to - k) as day from generate_series(0, 29) k) d
        left join (select day, count(distinct student_id)::int as n from act group by day) c on c.day = d.day
    ),
    -- Не заходили 7 дней и больше (включая «ни разу»): сначала дольше всех.
    'quiet', coalesce((
      select jsonb_agg(jsonb_build_object('student_id', student_id, 'full_name', full_name, 'last_day', last_day)
                       order by last_day nulls first, full_name)
        from last_day where last_day is null or last_day < b.d_to - 6
    ), '[]'::jsonb),
    -- Не сдали ни одного ДЗ за 14 дней — только если сдавать было что.
    'no_hw_14', case when not exists (select 1 from open_hw) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('student_id', r.student_id, 'full_name', r.full_name) order by r.full_name)
        from roster r
       where not exists (select 1 from att a
                          where a.student_id = r.student_id and a.status <> 'draft'
                            and a.submitted_day between b.d_to - 13 and b.d_to)
    ), '[]'::jsonb) end
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.course_stats_summary(uuid, text) is
  '§242. Статистика курса для персонала (course_is_staff): за период 7d/30d/all — сколько учеников занимались, открытия файлов (и прошлый такой же период), видео, сдачи ДЗ тем-уроков с последним вердиктом, очередь, средний; активность по дням за 30 дней; кто не заходил 7 дней, кто не сдал ДЗ за 14 дней.';

-- ── 7. По темам ────────────────────────────────────────────────────────────
create or replace function public.course_stats_topics(p_course_id uuid, p_period text default '7d')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  b        record;
  v_result jsonb;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = '42501';
  end if;
  select * into b from public.course_stats_bounds_internal(p_period);

  with
  roster as (select * from public.course_stats_roster_internal(p_course_id)),
  ct as (
    select t.id, t.kind from public.topics t join public.modules m on m.id = t.module_id
     where m.course_id = p_course_id
  ),
  opened as (
    select mv.topic_id, count(distinct r.student_id)::int as n
      from public.material_views mv
      join roster r on r.profile_id = mv.profile_id
     where mv.topic_id in (select id from ct)
       and (b.d_from is null or mv.viewed_on >= b.d_from) and mv.viewed_on <= b.d_to
     group by mv.topic_id
  ),
  vids as (
    select i.topic_id, i.id as item_id
      from public.topic_material_items i
     where i.topic_id in (select id from ct) and i.kind = 'video' and i.is_visible
  ),
  vcount as (select topic_id, count(*)::int as n from vids group by topic_id),
  vstud as (
    select vd.topic_id, r.student_id,
           count(distinct vd.item_id) filter (where w.duration_seconds > 0 and w.max_position >= 0.9 * w.duration_seconds) as done_items
      from public.video_watch_daily w
      join vids vd on vd.item_id = w.item_id
      join roster r on r.profile_id = w.student_id
     where (b.d_from is null or w.day >= b.d_from) and w.day <= b.d_to
     group by vd.topic_id, r.student_id
  ),
  vtopic as (
    select s.topic_id,
           count(*) filter (where s.done_items >= c.n)::int as done,
           count(*) filter (where s.done_items <  c.n)::int as started
      from vstud s join vcount c on c.topic_id = s.topic_id
     group by s.topic_id
  ),
  att as (select * from public.course_stats_attempts_internal(p_course_id)),
  hw as (
    select a.topic_id,
           count(distinct a.student_id) filter (where a.status <> 'draft' and a.submitted_at is not null
             and (b.d_from is null or a.submitted_day >= b.d_from) and a.submitted_day <= b.d_to)::int as submitted,
           round(avg(a.score) filter (where a.decision = 'accepted' and a.score is not null
             and (b.d_from is null or a.submitted_day >= b.d_from) and a.submitted_day <= b.d_to), 2) as avg_score,
           count(*) filter (where a.status = 'submitted')::int as pending
      from att a group by a.topic_id
  )
  select jsonb_build_object(
    'period',   p_period,
    'from',     b.d_from,
    'to',       b.d_to,
    'in_class', (select count(*) from roster),
    'topics', coalesce(jsonb_agg(jsonb_build_object(
      'topic_id',      t.id,
      'timed',         t.kind in ('check', 'control'),
      'opened',        coalesce(o.n, 0),
      'videos',        coalesce(vc.n, 0),
      'video_done',    coalesce(vt.done, 0),
      'video_started', coalesce(vt.started, 0),
      'hw',            h.id is not null and h.is_published and t.kind not in ('check', 'control'),
      'grade_scale',   h.grade_scale,
      'submitted',     coalesce(hs.submitted, 0),
      'avg_score',     hs.avg_score,
      'pending',       coalesce(hs.pending, 0)
    )), '[]'::jsonb)
  ) into v_result
    from ct t
    left join public.topic_homework h on h.topic_id = t.id
    left join opened o  on o.topic_id  = t.id
    left join vcount vc on vc.topic_id = t.id
    left join vtopic vt on vt.topic_id = t.id
    left join hw hs     on hs.topic_id = t.id;

  return v_result;
end;
$$;

comment on function public.course_stats_topics(uuid, text) is
  '§242. Статистика курса по темам для персонала (course_is_staff): за период — сколько учеников открывали материалы темы, досмотрели/начали её видео, сдали ДЗ, средний балл принятых; сколько работ ждут проверки сейчас. Работы по времени (check/control) без ДЗ-статистики (hw = false, timed = true).';

-- ── 8. Тема по ученикам (раскрытие строки) ─────────────────────────────────
create or replace function public.course_stats_topic_students(p_course_id uuid, p_topic_id uuid, p_period text default '7d')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  b        record;
  v_videos int;
  v_result jsonb;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = '42501';
  end if;
  if public.course_of_topic(p_topic_id) is distinct from p_course_id then
    raise exception 'Тема не из этого курса' using errcode = '22023';
  end if;
  select * into b from public.course_stats_bounds_internal(p_period);
  select count(*)::int into v_videos
    from public.topic_material_items i
   where i.topic_id = p_topic_id and i.kind = 'video' and i.is_visible;

  with
  roster as (select * from public.course_stats_roster_internal(p_course_id)),
  att as (
    select * from public.course_stats_attempts_internal(p_course_id) a
     where a.topic_id = p_topic_id
       and (b.d_from is null
            or (a.submitted_day is not null and a.submitted_day >= b.d_from)
            or (a.status = 'draft' and a.created_day >= b.d_from))
  ),
  last_att as (
    select distinct on (student_id) * from att order by student_id, attempt_number desc
  ),
  vid as (
    select r.student_id,
           count(distinct w.item_id) filter (where w.duration_seconds > 0 and w.max_position >= 0.9 * w.duration_seconds) as done_items,
           count(*) as rows
      from public.video_watch_daily w
      join public.topic_material_items i on i.id = w.item_id
                                        and i.topic_id = p_topic_id and i.kind = 'video' and i.is_visible
      join roster r on r.profile_id = w.student_id
     where (b.d_from is null or w.day >= b.d_from) and w.day <= b.d_to
     group by r.student_id
  )
  select jsonb_build_object(
    'topic_id', p_topic_id,
    'period',   p_period,
    'videos',   v_videos,
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'student_id', r.student_id,
      'full_name',  r.full_name,
      'opened', exists (select 1 from public.material_views mv
                         where mv.profile_id = r.profile_id and mv.topic_id = p_topic_id
                           and (b.d_from is null or mv.viewed_on >= b.d_from) and mv.viewed_on <= b.d_to),
      'video', case when v_videos = 0 then null
                    when coalesce(v.done_items, 0) >= v_videos then 'done'
                    when coalesce(v.rows, 0) > 0 then 'started'
                    else 'none' end,
      'hw_status', case when la.attempt_id is null then null
                        when la.status = 'draft' then 'draft'
                        when la.decision = 'accepted' then 'accepted'
                        when la.decision = 'returned_for_revision' then 'returned'
                        else 'submitted' end,
      'score',      case when la.decision = 'accepted' then la.score end,
      'grade_scale', la.grade_scale
    ) order by r.full_name), '[]'::jsonb)
  ) into v_result
    from roster r
    left join last_att la on la.student_id = r.student_id
    left join vid v on v.student_id = r.student_id;

  return v_result;
end;
$$;

comment on function public.course_stats_topic_students(uuid, uuid, text) is
  '§242. Одна тема курса по ученикам для персонала (course_is_staff): за период — открывал ли материалы, видео (done/started/none, null — у темы нет видео), последняя попытка ДЗ (draft/submitted/accepted/returned) и балл принятой.';

-- ── 9. По ученикам (таблица класса) ────────────────────────────────────────
create or replace function public.course_stats_students(p_course_id uuid, p_period text default '7d')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  b        record;
  v_result jsonb;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = '42501';
  end if;
  select * into b from public.course_stats_bounds_internal(p_period);

  with
  roster as (select * from public.course_stats_roster_internal(p_course_id)),
  ct as (
    select t.id from public.topics t join public.modules m on m.id = t.module_id
     where m.course_id = p_course_id
  ),
  act as (select * from public.course_stats_activity_internal(p_course_id)),
  act_s as (
    select student_id, max(day) as last_day,
           count(*) filter (where (b.d_from is null or day >= b.d_from) and day <= b.d_to)::int as days
      from act group by student_id
  ),
  files as (select * from public.course_stats_files_internal(p_course_id)),
  files_s as (
    select f.student_id, count(*)::int as total,
           count(*) filter (where exists (select 1 from public.material_views mv
                                           join roster r on r.profile_id = mv.profile_id
                                          where r.student_id = f.student_id and mv.item_id = f.item_id))::int as opened
      from files f group by f.student_id
  ),
  video_s as (
    select r.student_id, sum(w.seconds)::int as seconds
      from public.video_watch_daily w
      join roster r on r.profile_id = w.student_id
      join public.topic_material_items i on i.id = w.item_id
     where i.topic_id in (select id from ct)
       and (b.d_from is null or w.day >= b.d_from) and w.day <= b.d_to
     group by r.student_id
  ),
  att as (select * from public.course_stats_attempts_internal(p_course_id)),
  att_s as (
    select student_id,
           count(*) filter (where status <> 'draft' and submitted_day between b.d_to - 6  and b.d_to)::int as hw7,
           count(*) filter (where status <> 'draft' and submitted_day between b.d_to - 29 and b.d_to)::int as hw30,
           round(avg(score) filter (where decision = 'accepted' and score is not null and grade_scale = 'five'
             and (b.d_from is null or submitted_day >= b.d_from) and submitted_day <= b.d_to), 2) as avg_five,
           round(avg(score) filter (where decision = 'accepted' and score is not null and grade_scale = 'hundred'
             and (b.d_from is null or submitted_day >= b.d_from) and submitted_day <= b.d_to), 1) as avg_hundred
      from att group by student_id
  ),
  -- Открытые темы-уроки с опубликованным ДЗ: знаменатель «ДЗ всего» и «Долги».
  hw_topics as (
    select t.id as topic_id, h.id as homework_id, h.due_at
      from public.topics t
      join public.topic_homework h on h.topic_id = t.id
     where t.id in (select id from ct)
       and h.is_published
       and t.kind not in ('check', 'control')
       and public.topic_open_now(t.is_open, t.available_from)
  ),
  hw_s as (
    select r.student_id,
           count(*)::int as total,
           count(*) filter (where exists (select 1 from att a where a.homework_id = ht.homework_id
                                              and a.student_id = r.student_id and a.status <> 'draft'))::int as done,
           count(*) filter (where ht.due_at is not null and ht.due_at < b.d_to
                              and not exists (select 1 from att a where a.homework_id = ht.homework_id
                                                 and a.student_id = r.student_id and a.status <> 'draft'))::int as debts
      from roster r cross join hw_topics ht
     group by r.student_id
  ),
  -- Последний пробник групп курса, по которому уже есть итог хоть у кого-то.
  mock as (
    select me.id, me.title, me.max_score
      from public.mock_exams me
      join public.groups g on g.id = me.group_id and g.course_id = p_course_id
     where coalesce(me.starts_at, me.date) <= now()
       and exists (select 1 from public.mock_exam_results mr where mr.mock_exam_id = me.id and mr.score is not null)
     order by coalesce(me.starts_at, me.date) desc
     limit 1
  )
  select jsonb_build_object(
    'period',   p_period,
    'from',     b.d_from,
    'to',       b.d_to,
    'in_class', (select count(*) from roster),
    'mock', (select jsonb_build_object('id', id, 'title', title, 'max_score', max_score) from mock),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'student_id',    r.student_id,
      'full_name',     r.full_name,
      'last_day',      a.last_day,
      'days',          coalesce(a.days, 0),
      'files_opened',  coalesce(f.opened, 0),
      'files_total',   coalesce(f.total, 0),
      'video_seconds', coalesce(v.seconds, 0),
      'hw7',           coalesce(s.hw7, 0),
      'hw30',          coalesce(s.hw30, 0),
      'hw_done',       coalesce(h.done, 0),
      'hw_total',      coalesce(h.total, 0),
      'avg_five',      s.avg_five,
      'avg_hundred',   s.avg_hundred,
      'debts',         coalesce(h.debts, 0),
      'mock_score',    (select mr.score from public.mock_exam_results mr, mock
                         where mr.mock_exam_id = mock.id and mr.student_id = r.student_id)
    ) order by a.last_day nulls first, r.full_name), '[]'::jsonb)
  ) into v_result
    from roster r
    left join act_s   a on a.student_id = r.student_id
    left join files_s f on f.student_id = r.student_id
    left join video_s v on v.student_id = r.student_id
    left join att_s   s on s.student_id = r.student_id
    left join hw_s    h on h.student_id = r.student_id;

  return v_result;
end;
$$;

comment on function public.course_stats_students(uuid, text) is
  '§242. Таблица класса для персонала (course_is_staff): последний день занятий, дней занятий за период, файлов открыто из доступных (всё время), видео за период, сдач ДЗ за 7 и 30 дней, ДЗ сдано из открытых тем с ДЗ, средний за период, долги (срок прошёл, сдачи нет), вторичный балл последнего пробника с итогом.';

revoke all on function public.course_stats_summary(uuid, text)                from public, anon;
revoke all on function public.course_stats_topics(uuid, text)                 from public, anon;
revoke all on function public.course_stats_topic_students(uuid, uuid, text)   from public, anon;
revoke all on function public.course_stats_students(uuid, text)               from public, anon;
grant execute on function public.course_stats_summary(uuid, text)              to authenticated;
grant execute on function public.course_stats_topics(uuid, text)               to authenticated;
grant execute on function public.course_stats_topic_students(uuid, uuid, text) to authenticated;
grant execute on function public.course_stats_students(uuid, text)             to authenticated;
