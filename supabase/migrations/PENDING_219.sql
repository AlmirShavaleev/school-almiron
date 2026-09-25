-- §219. Пробник: уведомление ученику — кнопкой, а не при сохранении.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration, после чего
-- файл переименовывается в <version>_<name>.sql точно по записи в
-- supabase_migrations.schema_migrations (MIGRATIONS.md).
--
-- Только добавляющая: четыре новые колонки у mock_exam_results и одна новая
-- функция. Политики mock_exams / mock_exam_results НЕ тронуты (граница
-- карточки 071), save_mock_exam_grid (§218) НЕ тронута.
--
-- Зачем. До этой работы (§218) сохранение таблицы само рассылало «результат
-- пробника» тем, у кого итог изменился. Преподаватель сохраняет таблицу
-- много раз, пока проверяет, — и каждый промежуточный итог уходил ученику.
-- Владелец: «справа кнопка нужна — уведомить в ТГ. И одну кнопку внизу —
-- уведомить всех». Теперь сохранение — черновик, а рассылает только эта
-- функция, по нажатию.
--
-- ──────────────────────────────────────────────────────────────────────────
-- 1. Что и когда отправлено
-- ──────────────────────────────────────────────────────────────────────────
-- «Одному итогу — одно уведомление». Чтобы повторное «Уведомить всех» не
-- будило того, кому этот итог уже ушёл, база помнит, КАКОЙ итог отправлен:
-- тестовый и обе части — ровно то, что стоит в тексте уведомления. Совпал
-- с текущим — уже отправлено; разошёлся (правка таблицы, новая таблица
-- перевода шаблона) — можно отправить снова, и экран это показывает.
--
-- Первичный отдельно не храним: он равен сумме частей.

alter table public.mock_exam_results
  add column if not exists notified_at          timestamptz,
  add column if not exists notified_score       integer,
  add column if not exists notified_part1_score integer,
  add column if not exists notified_part2_score integer;

comment on column public.mock_exam_results.notified_at is
  '§219. Когда ученику отправлен результат (кнопка «Уведомить» / «Уведомить всех»). null — не отправлялся.';
comment on column public.mock_exam_results.notified_score is
  '§219. Какой итог (score) был в отправленном уведомлении. Разошёлся с score — итог изменился после отправки.';
comment on column public.mock_exam_results.notified_part1_score is
  '§219. Первая часть в отправленном уведомлении.';
comment on column public.mock_exam_results.notified_part2_score is
  '§219. Вторая часть в отправленном уведомлении.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Отправка
-- ──────────────────────────────────────────────────────────────────────────
-- notify_mock_exam_results(пробник, ученики | null)
--   p_student_ids = null — «Уведомить всех»: все ученики группы пробника с
--   сохранённым итогом, которым ЭТОТ итог ещё не отправлен;
--   p_student_ids = [один] — «Уведомить» в строке. Правило то же: уже
--   отправленный тот же итог второй раз не уходит и так.
--
-- Каждому — строка в notifications (колокольчик) и, если Telegram подключён,
-- строка в notification_queue с event_type = 'mock_exam_result'. Текст
-- карточки собирает process-notification-queue
-- (_shared/variant-telegram.ts, buildMockExamResultTelegramMessage), там же
-- учитывается notification_prefs (галочка «проверено», общий выключатель
-- telegram) — как у всех остальных событий. Здесь фильтр по подключению —
-- тем же join-ом, что в notify_homework_submitted (§47).
--
-- SECURITY DEFINER, потому что:
--   * telegram_connections преподавателю не видна (tc_select_own /
--     tc_select_admin) — клиентский join молча дал бы ноль строк (§47);
--   * notified_* должны писаться в той же транзакции, что и уведомления,
--     иначе «отправлено» на экране расходится с тем, что ушло.
-- Раз definer — право проверяет сама:
--   * персонал курса группы пробника — course_is_staff (правило проекта, не
--     своё);
--   * и тот, кто вправе записать итог: то же условие, что у существующей
--     mock_exam_results_manage (is_admin_or_owner() или роль teacher). Куратор
--     курса итоги не пишет и даже не читает — рассылать их ему тоже нечего.
--
-- В тексте — название пробника, итог, части. Баллов по заданиям и чужих
-- результатов нет: каждому уходит только его строка.
--
-- Родителям не шлём (карточка 071): подключение Telegram в системе — на
-- профиль ученика.
--
-- Возвращает { sent, telegram, already, no_result, no_profile, rows: [{student_id, notified_at}] }.

create or replace function public.notify_mock_exam_results(
  p_mock_exam_id uuid,
  p_student_ids  uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam        record;
  v_now         timestamptz := now();
  v_part1_max   int;
  v_part2_max   int;
  v_primary_max int;
  v_r           record;
  v_key         text;
  v_msg         text;
  v_sent        int := 0;
  v_telegram    int := 0;
  v_already     int := 0;
  v_no_profile  int := 0;
  v_no_result   int := 0;
  v_n           int;
  v_rows        jsonb := '[]'::jsonb;
begin
  select me.id, me.title, me.date, me.max_score, me.group_id, g.course_id,
         t.max_points, t.part1_last
    into v_exam
    from public.mock_exams me
    left join public.groups g on g.id = me.group_id
    left join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  if not found then
    raise exception 'Пробник не найден' using errcode = 'P0002';
  end if;
  if v_exam.group_id is null then
    raise exception 'У пробника нет группы — уведомлять некого' using errcode = '22023';
  end if;
  if not (public.course_is_staff(v_exam.course_id)
          and (public.is_admin_or_owner() or public.get_my_role() = 'teacher')) then
    raise exception 'Нет доступа к результатам этого пробника' using errcode = '42501';
  end if;

  -- Максимумы частей — из шаблона. У старого пробника без шаблона их нет, и
  -- в тексте будет «1 часть — 10» без «из».
  if v_exam.max_points is not null then
    select coalesce(sum(m) filter (where i <= v_exam.part1_last), 0)::int,
           coalesce(sum(m) filter (where i >  v_exam.part1_last), 0)::int,
           coalesce(sum(m), 0)::int
      into v_part1_max, v_part2_max, v_primary_max
      from unnest(v_exam.max_points) with ordinality as x(m, i);
  end if;

  -- Два нажатия подряд (или два преподавателя разом) идут по очереди: второе
  -- увидит notified_* первого и никого не разбудит повторно.
  perform pg_advisory_xact_lock(hashtextextended('notify_mock_exam_results:' || p_mock_exam_id::text, 0));

  -- Спросили про конкретных учеников, а итога у кого-то нет — отправлять
  -- нечего. Считаем, чтобы экран мог сказать это словами.
  if p_student_ids is not null then
    select count(*) into v_no_result
      from (select distinct unnest(p_student_ids) as sid) q
     where not exists (
       select 1 from public.mock_exam_results r
         join public.group_students gs on gs.group_id = v_exam.group_id and gs.student_id = r.student_id
        where r.mock_exam_id = p_mock_exam_id and r.student_id = q.sid);
  end if;

  for v_r in
    select r.id, r.student_id, r.score, r.part1_score, r.part2_score, r.primary_score,
           r.notified_at, r.notified_score, r.notified_part1_score, r.notified_part2_score,
           s.profile_id
      from public.mock_exam_results r
      join public.students s on s.id = r.student_id
      -- Только нынешняя группа пробника: ушедший из группы ученик в таблице
      -- не виден, и слать ему «из-под стола» нельзя.
      join public.group_students gs on gs.group_id = v_exam.group_id and gs.student_id = r.student_id
     where r.mock_exam_id = p_mock_exam_id
       and (p_student_ids is null or r.student_id = any (p_student_ids))
     order by r.student_id
       for update of r
  loop
    if v_r.notified_at is not null
       and (v_r.notified_score, v_r.notified_part1_score, v_r.notified_part2_score)
           is not distinct from (v_r.score, v_r.part1_score, v_r.part2_score) then
      v_already := v_already + 1;
      continue;
    end if;
    if v_r.profile_id is null then
      v_no_profile := v_no_profile + 1;
      continue;
    end if;

    -- Ключ уникален на каждую отправку: итог 72 → 70 → 72 — три разных
    -- отправки, и третья не должна утонуть в on conflict первой. Повтор
    -- одного и того же итога отсекает проверка выше, а не ключ.
    v_key := 'mock_exam_result:' || v_r.id || ':' || floor(extract(epoch from v_now) * 1000)::bigint;

    v_msg := '«' || v_exam.title || '» — ' || v_r.score
      || coalesce(' из ' || v_exam.max_score, '')
      || case when v_r.part1_score is not null or v_r.part2_score is not null then
           ' · 1 часть: ' || coalesce(v_r.part1_score::text, '—') || coalesce(' из ' || v_part1_max, '')
           || ', 2 часть: ' || coalesce(v_r.part2_score::text, '—') || coalesce(' из ' || v_part2_max, '')
         else '' end;

    insert into public.notifications (user_id, title, message, type, link, dedup_key)
    values (v_r.profile_id, '📊 Результат пробника', v_msg, 'info', null, v_key)
    on conflict (dedup_key) do nothing;

    insert into public.notification_queue
      (profile_id, channel, event_type, entity_type, entity_id,
       deduplication_key, payload, status, scheduled_for)
    select v_r.profile_id,
           'telegram',
           'mock_exam_result',
           'mock_exam_result',
           v_r.id,
           v_key,
           jsonb_build_object(
             'title',         v_exam.title,
             -- День пробника без времени: дата вводится днём ('YYYY-MM-DD'),
             -- в timestamptz ложится полночью UTC.
             'exam_date',     to_char(v_exam.date at time zone 'UTC', 'YYYY-MM-DD'),
             'score',         v_r.score,
             'max_score',     v_exam.max_score,
             'primary_score', v_r.primary_score,
             'primary_max',   v_primary_max,
             'part1_score',   v_r.part1_score,
             'part1_max',     v_part1_max,
             'part2_score',   v_r.part2_score,
             'part2_max',     v_part2_max
           ),
           'pending'::public.notification_queue_status,
           v_now
      from public.telegram_connections tc
     where tc.profile_id = v_r.profile_id
       and tc.is_enabled
       and tc.disconnected_at is null
       and tc.telegram_chat_id is not null
    on conflict (deduplication_key) do nothing;
    get diagnostics v_n = row_count;
    v_telegram := v_telegram + v_n;

    update public.mock_exam_results
       set notified_at          = v_now,
           notified_score       = v_r.score,
           notified_part1_score = v_r.part1_score,
           notified_part2_score = v_r.part2_score
     where id = v_r.id;

    v_sent := v_sent + 1;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('student_id', v_r.student_id, 'notified_at', v_now));
  end loop;

  return jsonb_build_object(
    'sent',       v_sent,
    'telegram',   v_telegram,
    'already',    v_already,
    'no_result',  v_no_result,
    'no_profile', v_no_profile,
    'rows',       v_rows
  );
end;
$$;

comment on function public.notify_mock_exam_results(uuid, uuid[]) is
  '§219. Отправить ученикам результат пробника: колокольчик + Telegram (event mock_exam_result), если подключён. null — всем, кому этот итог ещё не отправлен. Помнит отправленный итог в mock_exam_results.notified_*. Персонал курса группы + право записи итогов.';

alter function public.notify_mock_exam_results(uuid, uuid[]) owner to postgres;
revoke all on function public.notify_mock_exam_results(uuid, uuid[]) from public, anon;
grant execute on function public.notify_mock_exam_results(uuid, uuid[]) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Пробы прав — выполнять ОТДЕЛЬНО, в откатываемом блоке, под authenticated
-- ──────────────────────────────────────────────────────────────────────────
-- Прогонялись на локальном Postgres 16 со слепком схемы (редакции
-- course_is_staff, course_is_admin, is_admin_or_owner, get_my_role и политик
-- из supabase/migrations; notifications / notification_queue /
-- telegram_connections — по _legacy/006_telegram.sql и
-- 20260730125856). НА ПРОДЕ НЕ ПРОГОНЯЛИСЬ. Фактический вывод — в
-- PROJECT_STATE.md §219.
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', '{"sub":"<преподаватель группы>","role":"authenticated"}', true);
-- select public.notify_mock_exam_results('<пробник>', null);        -- sent = N
-- select public.notify_mock_exam_results('<пробник>', null);        -- sent = 0, already = N
-- select set_config('request.jwt.claims', '{"sub":"<чужой преподаватель>","role":"authenticated"}', true);
-- select public.notify_mock_exam_results('<пробник>', null);        -- ERROR 42501
-- select set_config('request.jwt.claims', '{"sub":"<ученик>","role":"authenticated"}', true);
-- select public.notify_mock_exam_results('<пробник>', null);        -- ERROR 42501
-- rollback;
