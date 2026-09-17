-- §204 (board/055). ПРИМЕНЕНО оркестратором 17.09.2026, версия 20260917230035
-- (supabase_migrations.schema_migrations, MIGRATIONS.md).
--
-- Блок проб под ролями, лежавший в конце файла, вынесен из миграции: он не
-- применялся и применяться не должен. Его дословный вывод — в разделе §204
-- PROJECT_STATE. Порядок проверок в video_watch_add исправлен следующей
-- миграцией 20260917230444 (§204.1) — пробы нашли дефект сразу после
-- применения.
--
-- Запись просмотра видео учеником: дневные итоги + единственный вход на запись.
--
-- Зачем сейчас. Владельцу нужен отчёт «сколько минут ученик смотрел видео», а
-- такой записи в базе нет нигде. Данные копятся только со дня, когда их начали
-- писать, поэтому запись идёт вперёд отчёта: каждый день без этой таблицы —
-- день, которого в первом отчёте не будет.
--
-- Почему по дням, а не одним итогом. Весит столько же, но отвечает и на
-- «сколько всего», и на «занимался ли на этой неделе»; второе в разговоре с
-- родителем важнее первого. Посекундной истории просмотров здесь нет и не
-- будет: это слежка за подростком, которая отчёту ничего не добавляет.
--
-- День считается по Москве — тем же счётом, что визиты (§78) и просмотры
-- материалов (§107). При счёте по UTC вечерний просмотр уезжает в завтра, и
-- «занимался вчера» врёт на самой частой половине суток.

-- ── 1. Таблица ──────────────────────────────────────────────────────────────

create table if not exists public.video_watch_daily (
  student_id       uuid        not null references public.profiles(id) on delete cascade,
  item_id          uuid        not null references public.topic_material_items(id) on delete cascade,
  day              date        not null,
  -- Прибавляется, не перезаписывается: за день бывает несколько заходов.
  seconds          integer     not null default 0,
  -- Докуда дошёл, только вверх: по нему считается отметка «просмотрено».
  max_position     integer     not null default 0,
  -- Последняя известная длительность ролика. Плеер сообщает её сам; до первого
  -- сообщения null — «не знаем», а не ноль.
  duration_seconds integer,
  updated_at       timestamptz not null default now(),
  primary key (student_id, item_id, day)
);

comment on table public.video_watch_daily is
  '§204. Сколько секунд ученик смотрел видео темы, по суткам (Москва). '
  'Пишется ТОЛЬКО video_watch_add(); прямых insert/update у authenticated нет. '
  'Просмотры персонала курса сюда не попадают (решение владельца: собственная '
  'проверка материала не должна становиться статистикой ученика). '
  'Посекундной истории нет намеренно.';

comment on column public.video_watch_daily.seconds is
  'Засчитанные секунды просмотра за сутки. Клиент считает минимум из «прошло по '
  'часам» и «продвинулась позиция», поэтому перемотка вперёд минут не даёт.';
comment on column public.video_watch_daily.max_position is
  'Максимальная достигнутая позиция в ролике, секунды. Только вверх.';

create index if not exists video_watch_daily_item_day_idx
  on public.video_watch_daily (item_id, day);
create index if not exists video_watch_daily_student_day_idx
  on public.video_watch_daily (student_id, day);

alter table public.video_watch_daily enable row level security;

-- Прямой записи нет вовсе: единственный вход — RPC ниже. Иначе клиент мог бы
-- проставить себе любые минуты, и цифра в отчёте перестала бы что-то значить.
revoke all on table public.video_watch_daily from anon, authenticated;
grant select on table public.video_watch_daily to authenticated;

-- ── 2. Кто из персонала видит строки материала ──────────────────────────────
--
-- Одна формулировка на политику чтения и на «просмотры персонала не считаются»
-- в RPC — чтобы они не разъехались (CLAUDE.md: §21/§29 родились ровно из копий
-- условий прав). Своих условий здесь нет, только вызов двух существующих
-- функций:
--   auth_is_staff_of_topic  — владелец курса, преподаватель и куратор группы;
--   topic_material_can_manage (= course_is_staff) — плюс платформенный админ и
--   куратор курса (course_curators), которых первая функция не знает.
-- Карточка называла только первую; вторая добавлена сознательно, потому что
-- иначе просмотр куратора курса или админа платформы посчитался бы ученическим.
create or replace function public.video_watch_item_is_staff(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
      from public.topic_material_items i
     where i.id = p_item_id
       and (public.auth_is_staff_of_topic(i.topic_id)
            or public.topic_material_can_manage(i.topic_id))
  );
$function$;

comment on function public.video_watch_item_is_staff(uuid) is
  '§204. Персонал ли текущий пользователь по теме этого материала. Композиция '
  'auth_is_staff_of_topic и topic_material_can_manage — своих условий прав нет.';

revoke all on function public.video_watch_item_is_staff(uuid) from public, anon;
grant execute on function public.video_watch_item_is_staff(uuid) to authenticated;

-- ── 3. Кто что видит ────────────────────────────────────────────────────────

drop policy if exists video_watch_daily_student_select on public.video_watch_daily;
create policy video_watch_daily_student_select on public.video_watch_daily
  for select to authenticated
  using (student_id = auth.uid());

drop policy if exists video_watch_daily_staff_select on public.video_watch_daily;
create policy video_watch_daily_staff_select on public.video_watch_daily
  for select to authenticated
  using (public.video_watch_item_is_staff(item_id));

-- ── 4. Единственный вход на запись ──────────────────────────────────────────
--
-- Порядок проверок важен: отказ «чужой курс» должен быть отказом, а «это
-- персонал» — молчаливым выходом. Преподаватель смотрит своё видео законно,
-- просто это не статистика ученика; ошибка в интерфейсе здесь была бы враньём.
create or replace function public.video_watch_add(
  p_item_id  uuid,
  p_seconds  integer,
  p_position integer,
  p_duration integer default null
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_topic uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  -- 1. Клиенту верить нельзя. Отправка раз в ~30 с — значит, честная порция
  --    никогда не больше 30 секунд. Кривая отправка не должна давать три часа
  --    просмотра, поэтому выходим МОЛЧА: это не ошибка пользователя.
  if p_seconds is null or p_seconds < 1 or p_seconds > 30 then
    return;
  end if;

  -- 2. Материал существует, это видео и оно показывается.
  select i.topic_id into v_topic
    from public.topic_material_items i
   where i.id = p_item_id
     and i.kind = 'video'
     and i.is_visible;

  if v_topic is null then
    raise exception 'MATERIAL_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 3. Считать просмотры чужого курса нечего.
  if not public.course_student_can_see_topic(v_topic) then
    raise exception 'TOPIC_NOT_VISIBLE' using errcode = 'P0001';
  end if;

  -- 4. Решение владельца: просмотры персонала не считаются. Именно молча.
  if public.video_watch_item_is_staff(p_item_id) then
    return;
  end if;

  insert into public.video_watch_daily as w
        (student_id, item_id, day, seconds, max_position, duration_seconds, updated_at)
  select auth.uid(), p_item_id, (now() at time zone 'Europe/Moscow')::date,
         p_seconds, greatest(coalesce(p_position, 0), 0), nullif(greatest(coalesce(p_duration, 0), 0), 0), now()
   where exists (select 1 from public.profiles p where p.id = auth.uid())
  on conflict (student_id, item_id, day) do update
     set seconds          = w.seconds + excluded.seconds,
         max_position     = greatest(w.max_position, excluded.max_position),
         duration_seconds = coalesce(excluded.duration_seconds, w.duration_seconds),
         updated_at       = now();
end;
$function$;

comment on function public.video_watch_add(uuid, integer, integer, integer) is
  '§204. Прибавить засчитанные секунды просмотра видео. Единственный вход на '
  'запись в video_watch_daily. Порция вне 1..30 и просмотр персонала — молча '
  'без записи; чужой курс — отказ TOPIC_NOT_VISIBLE.';

revoke all on function public.video_watch_add(uuid, integer, integer, integer) from public, anon;
grant execute on function public.video_watch_add(uuid, integer, integer, integer) to authenticated;
