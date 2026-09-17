-- §204.1 — порядок проверок в video_watch_add: персонал раньше видимости темы.
-- ПРИМЕНЕНО оркестратором 17.09.2026, версия 20260917230444
-- (supabase_migrations.schema_migrations, MIGRATIONS.md).
--
-- Дефект нашёлся пробами под ролями сразу после применения §204
-- (20260917230035). В той версии проверки шли так:
--   3) not course_student_can_see_topic(...) -> raise TOPIC_NOT_VISIBLE
--   4) video_watch_item_is_staff(...)        -> return (молча)
--
-- Но course_student_can_see_topic -> course_student_has_access смотрит только
-- group_students и student_courses через auth_student_id(). Персонал курса там
-- не числится, поэтому для преподавателя и владельца она даёт false, и шаг 3
-- срабатывает РАНЬШЕ шага 4. На проде это подтверждено напрямую: для владельца
-- course_student_can_see_topic = f, video_watch_item_is_staff = t.
--
-- Следствие было бы такое: преподаватель открывает собственное видео и его
-- плеер раз в ~30 секунд получает отказ TOPIC_NOT_VISIBLE. Это ровно то, от
-- чего предостерегал комментарий самой функции: «отказ „чужой курс“ должен
-- быть отказом, а „это персонал“ — молчаливым выходом; ошибка в интерфейсе
-- здесь была бы враньём».
--
-- Правка одна: проверка персонала поднята выше проверки видимости. Строк
-- персонала это по-прежнему не создаёт (выход всё равно return), а ложный
-- отказ уходит. Остальное тело функции не менялось.

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

  -- 3. Решение владельца: просмотры персонала не считаются. Именно молча, и
  --    именно ЗДЕСЬ, до проверки видимости: персонал не числится учеником
  --    курса, поэтому следующая проверка отказала бы ему первой (§204.1).
  if public.video_watch_item_is_staff(p_item_id) then
    return;
  end if;

  -- 4. Считать просмотры чужого курса нечего.
  if not public.course_student_can_see_topic(v_topic) then
    raise exception 'TOPIC_NOT_VISIBLE' using errcode = 'P0001';
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
  'без записи; чужой курс — отказ TOPIC_NOT_VISIBLE. §204.1: проверка персонала '
  'идёт РАНЬШЕ проверки видимости — персонал не числится учеником курса.';

revoke all on function public.video_watch_add(uuid, integer, integer, integer) from public, anon;
grant execute on function public.video_watch_add(uuid, integer, integer, integer) to authenticated;
