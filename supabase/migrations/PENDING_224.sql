-- §224. Пробник: кто пишет прямо сейчас, раздел «Пробники», уведомление о начале
-- (карточка board/073).
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration, после чего
-- файл переименовывается в <version>_<name>.sql точно по записи в
-- supabase_migrations.schema_migrations (MIGRATIONS.md).
--
-- Только добавляющая: две новые колонки у mock_exam_sheets, три новые функции
-- (mock_exam_ping, mock_exam_live, mock_exam_schedule_notifications) и
-- триггер на mock_exams. Две существующие функции пересозданы с той же
-- сигнатурой и теми же правами:
--   * my_mock_exams — снят фильтр module_id is not null (раздел «Пробники»
--     теперь свой у каждой группы, не строка modules); has_work считается по
--     содержимому бланка; добавлены score/max_score — только когда результат
--     уже виден ученику (то же условие, что у notified);
--   * grade_mock_exam_part1 — не проверяет бланк, в котором НИЧЕГО нет (ни
--     ответа, ни фото, ни сдачи). До §224 такой строки не было вовсе: бланк
--     появлялся с первым ответом. Теперь её создаёт пинг при первом заходе, и
--     без этой оговорки «открыл и ушёл» получал бы ноль за первую часть и итог
--     в таблице. Смысл функции для преподавателя прежний.
-- Колонки mock_exams.module_id / module_position НЕ удаляются — просто больше
-- не читаются экраном.
--
-- Политики не менялись. Ученику по-прежнему нечего писать в таблицы напрямую.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Присутствие: когда открыл и когда последний раз был на странице
-- ──────────────────────────────────────────────────────────────────────────

alter table public.mock_exam_sheets
  add column if not exists opened_at    timestamptz,
  add column if not exists last_seen_at timestamptz;

comment on column public.mock_exam_sheets.opened_at is
  '§224. Первый заход ученика на страницу идущего пробника (mock_exam_ping). null у бланков, заведённых до §224 или без пинга.';
comment on column public.mock_exam_sheets.last_seen_at is
  '§224. Последний пинг со страницы пробника (раз в 30 с, пока вкладка видима). «Онлайн» = не старше 75 с при открытом окне — считает mock_exam_live.';

-- Пинг со страницы пробника. Только ученик группы и только внутри окна
-- (starts_at <= now() < ends_at); вне окна — ничего не пишет (no-op, не
-- ошибка: вкладка, открытая заранее или оставленная после конца, не должна
-- сыпать ошибками). После сдачи — можно: обновляется только last_seen_at,
-- бланк (answers, submitted_at, updated_at) не трогается никогда.
--
-- Первый заход создаёт строку бланка: ответы — пустые поля по числу заданий
-- первой части (как у save_mock_exam_answer: иначе answers[5] = … у пустого
-- массива дало бы массив с нижней границей 5), opened_at = now().
-- Частота ограничена базой: чаще раза в 10 с — no-op, чтобы вкладка-зомби
-- не писала в таблицу каждую секунду.
create or replace function public.mock_exam_ping(p_mock_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid;
  v_w       record;
  v_part1   int;
  v_now     timestamptz := now();
  v_n       int;
begin
  v_student := public.mock_exam_my_student_id(p_mock_exam_id);
  if v_student is null then
    raise exception 'Этот пробник не ваш' using errcode = '42501';
  end if;
  select * into v_w from public.mock_exam_window(p_mock_exam_id);
  if v_w.starts_at is null or v_now < v_w.starts_at or v_now >= v_w.ends_at then
    return jsonb_build_object('pinged', false, 'reason', 'closed', 'server_now', v_now);
  end if;
  select t.part1_last into v_part1
    from public.mock_exams me join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;

  insert into public.mock_exam_sheets as sh
         (mock_exam_id, student_id, answers, opened_at, last_seen_at)
  values (p_mock_exam_id, v_student, array_fill(null::text, array[coalesce(v_part1, 0)]), v_now, v_now)
  on conflict (mock_exam_id, student_id) do update
     set opened_at    = coalesce(sh.opened_at, excluded.opened_at),
         last_seen_at = excluded.last_seen_at
   where sh.last_seen_at is null
      or sh.last_seen_at < excluded.last_seen_at - interval '10 seconds';
  get diagnostics v_n = row_count;
  return jsonb_build_object('pinged', v_n > 0, 'server_now', v_now);
end;
$$;

comment on function public.mock_exam_ping(uuid) is
  '§224. Ученик на странице идущего пробника: первый заход создаёт бланк (opened_at), дальше — last_seen_at не чаще раза в 10 с. Вне окна — no-op. Бланк (ответы, сдачу) не трогает.';

revoke all on function public.mock_exam_ping(uuid) from public, anon;
grant execute on function public.mock_exam_ping(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Монитор для преподавателя
-- ──────────────────────────────────────────────────────────────────────────
-- Только персонал курса группы (mock_exam_is_staff → course_is_staff).
-- «Онлайн» считает база по своему now(), не браузер. Ключа и самих ответов
-- здесь нет — только число заполненных полей.
create or replace function public.mock_exam_live(p_mock_exam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam record;
  v_w    record;
  v_now  timestamptz := now();
  v_open boolean;
begin
  if not public.mock_exam_is_staff(p_mock_exam_id) then
    raise exception 'Нет доступа к этому пробнику' using errcode = '42501';
  end if;
  select me.id, me.title, me.group_id, t.part1_last
    into v_exam
    from public.mock_exams me
    left join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  select * into v_w from public.mock_exam_window(p_mock_exam_id);
  v_open := v_w.starts_at is not null and v_now >= v_w.starts_at and v_now < v_w.ends_at;

  return jsonb_build_object(
    'id',           v_exam.id,
    'title',        v_exam.title,
    'group_id',     v_exam.group_id,
    'starts_at',    v_w.starts_at,
    'ends_at',      v_w.ends_at,
    'photos_until', v_w.photos_until,
    'server_now',   v_now,
    'part1_last',   v_exam.part1_last,
    'students',     (
      select coalesce(jsonb_agg(jsonb_build_object(
               'student_id',   s.id,
               'name',         coalesce(nullif(btrim(p.full_name), ''), '—'),
               'has_sheet',    sh.student_id is not null,
               'opened_at',    coalesce(sh.opened_at, sh.created_at),
               'last_seen_at', sh.last_seen_at,
               'online',       v_open and sh.last_seen_at is not null
                                 and sh.last_seen_at >= v_now - interval '75 seconds',
               'answered',     coalesce((select count(*) from unnest(sh.answers) a
                                          where nullif(btrim(a), '') is not null), 0),
               'submitted_at', sh.submitted_at,
               'photos',       (select count(*) from public.mock_exam_photos ph
                                 where ph.mock_exam_id = p_mock_exam_id and ph.student_id = s.id)
             ) order by p.full_name), '[]'::jsonb)
        from public.group_students gs
        join public.students s on s.id = gs.student_id
        left join public.profiles p on p.id = s.profile_id
        left join public.mock_exam_sheets sh on sh.mock_exam_id = p_mock_exam_id and sh.student_id = s.id
       where gs.group_id = v_exam.group_id
    )
  );
end;
$$;

comment on function public.mock_exam_live(uuid) is
  '§224. Монитор идущего пробника: окно, server_now и по каждому ученику группы — открыл, последний пинг, онлайн (75 с, окно открыто), сколько полей бланка заполнено, сдал, сколько фото. Только персонал курса. Ключа и ответов нет.';

revoke all on function public.mock_exam_live(uuid) from public, anon;
grant execute on function public.mock_exam_live(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Раздел «Пробники» у ученика
-- ──────────────────────────────────────────────────────────────────────────
-- Раздел рисуется из этого списка; в modules ничего не создаётся. В разделе —
-- всё, у чего задано время (starts_at), независимо от module_id.
-- has_work — по содержимому: с §224 строка бланка появляется уже при первом
-- заходе (пинг), и «открыл и ушёл» не должно читаться как «на проверке».
-- score / max_score — только когда результат уже виден ученику: отправлен и
-- окно закрылось (то же условие, что у notified и my_mock_exam_result).
create or replace function public.my_mock_exams(p_group_id uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              me.id,
           'title',           me.title,
           'module_id',       me.module_id,
           'module_position', me.module_position,
           'starts_at',       w.starts_at,
           'ends_at',         w.ends_at,
           'photos_until',    w.photos_until,
           'duration_minutes', me.duration_minutes,
           'submitted_at',    sh.submitted_at,
           'has_work',        sh.submitted_at is not null
                              or exists (select 1 from unnest(sh.answers) a where nullif(btrim(a), '') is not null)
                              or exists (select 1 from public.mock_exam_photos ph
                                          where ph.mock_exam_id = me.id and ph.student_id = s.id),
           'notified',        r.notified_at is not null and now() >= w.ends_at,
           'score',           case when r.notified_at is not null and now() >= w.ends_at then r.score end,
           'max_score',       case when r.notified_at is not null and now() >= w.ends_at then me.max_score end,
           'server_now',      now()
         ) order by me.starts_at), '[]'::jsonb)
    from public.mock_exams me
    join public.group_students gs on gs.group_id = me.group_id
    join public.students s on s.id = gs.student_id and s.profile_id = auth.uid()
    cross join lateral public.mock_exam_window(me.id) w
    left join public.mock_exam_sheets sh on sh.mock_exam_id = me.id and sh.student_id = s.id
    left join public.mock_exam_results r on r.mock_exam_id = me.id and r.student_id = s.id
   where me.group_id = p_group_id
     and me.starts_at is not null;
$$;

revoke all on function public.my_mock_exams(uuid) from public, anon;
grant execute on function public.my_mock_exams(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Проверка по ключу не трогает пустой бланк
-- ──────────────────────────────────────────────────────────────────────────
-- Текст — дословно §221 (20260926051556), одна правка в условии цикла:
-- бланк берётся, если он сдан, или окно кончилось И в бланке что-то есть
-- (ответ или фото). Строка, созданная одним пингом, не проверяется.
create or replace function public.grade_mock_exam_part1(p_mock_exam_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam     record;
  v_ends_at  timestamptz;
  v_key      text[];
  v_n        int;
  v_sheet    record;
  v_cur_p    smallint[];
  v_cur_a    smallint[];
  v_pts      jsonb;
  v_auto     jsonb;
  v_rows     jsonb := '[]'::jsonb;
  v_autos    jsonb := '[]'::jsonb;
  v_changed  boolean;
  v_verdict  boolean;
  v_a        int;
  v_p        int;
  v_students int := 0;
  v_cells    int := 0;
  i          int;
  x          jsonb;
begin
  if not public.mock_exam_can_manage(p_mock_exam_id) then
    raise exception 'Нет доступа к результатам этого пробника' using errcode = '42501';
  end if;
  select me.group_id, me.starts_at, t.max_points, t.part1_last
    into v_exam
    from public.mock_exams me
    join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  if not found or v_exam.starts_at is null then
    return jsonb_build_object('graded_students', 0, 'changed_cells', 0, 'skipped', 'no_window');
  end if;
  select k.answers into v_key from public.mock_exam_answer_keys k where k.mock_exam_id = p_mock_exam_id;
  if v_key is null then
    return jsonb_build_object('graded_students', 0, 'changed_cells', 0, 'skipped', 'no_key');
  end if;
  select w.ends_at into v_ends_at from public.mock_exam_window(p_mock_exam_id) w;
  v_n := array_length(v_exam.max_points, 1);

  perform pg_advisory_xact_lock(hashtextextended('save_mock_exam_grid:' || p_mock_exam_id::text, 0));

  for v_sheet in
    select sh.student_id, sh.answers
      from public.mock_exam_sheets sh
      join public.group_students gs on gs.group_id = v_exam.group_id and gs.student_id = sh.student_id
     where sh.mock_exam_id = p_mock_exam_id
       and (sh.submitted_at is not null
            or (now() >= v_ends_at
                and (exists (select 1 from unnest(sh.answers) a where nullif(btrim(a), '') is not null)
                     or exists (select 1 from public.mock_exam_photos ph
                                 where ph.mock_exam_id = p_mock_exam_id and ph.student_id = sh.student_id))))
     order by sh.student_id
  loop
    v_cur_p := array_fill(null::smallint, array[v_n]);
    v_cur_a := array_fill(null::smallint, array[v_n]);
    for x in
      select jsonb_build_object('t', sc.task_number, 'p', sc.points, 'a', sc.auto_points)
        from public.mock_exam_task_scores sc
       where sc.mock_exam_id = p_mock_exam_id and sc.student_id = v_sheet.student_id
         and sc.task_number between 1 and v_n
    loop
      v_cur_p[(x->>'t')::int] := (x->>'p')::smallint;
      v_cur_a[(x->>'t')::int] := (x->>'a')::smallint;
    end loop;

    v_pts := '[]'::jsonb;
    v_auto := '[]'::jsonb;
    v_changed := false;
    for i in 1..v_n loop
      v_p := v_cur_p[i];
      if i <= v_exam.part1_last and nullif(btrim(coalesce(v_key[i], '')), '') is not null then
        v_verdict := public.variant_answer_verdict(
          public.normalize_variant_answer(v_key[i]),
          public.normalize_variant_answer(coalesce(v_sheet.answers[i], '')));
        if v_verdict is not null and (v_cur_p[i] is null or v_cur_p[i] = v_cur_a[i]) then
          v_a := case when v_verdict then v_exam.max_points[i] else 0 end;
          if v_cur_p[i] is distinct from v_a or v_cur_a[i] is distinct from v_a then
            v_changed := true;
            v_cells := v_cells + 1;
          end if;
          v_p := v_a;
          v_auto := v_auto || jsonb_build_array(jsonb_build_object('t', i, 'a', v_a));
        end if;
      end if;
      v_pts := v_pts || jsonb_build_array(to_jsonb(v_p));
    end loop;

    v_students := v_students + 1;
    if v_changed then
      v_rows  := v_rows || jsonb_build_array(jsonb_build_object('student_id', v_sheet.student_id, 'points', v_pts));
      v_autos := v_autos || jsonb_build_array(jsonb_build_object('student_id', v_sheet.student_id, 'cells', v_auto));
    end if;
  end loop;

  if jsonb_array_length(v_rows) > 0 then
    perform public.save_mock_exam_grid(p_mock_exam_id, v_rows);
    update public.mock_exam_task_scores sc
       set auto_points = (c->>'a')::smallint,
           updated_by  = auth.uid()
      from jsonb_array_elements(v_autos) s,
           jsonb_array_elements(s->'cells') c
     where sc.mock_exam_id = p_mock_exam_id
       and sc.student_id   = (s->>'student_id')::uuid
       and sc.task_number  = (c->>'t')::int
       and sc.auto_points is distinct from (c->>'a')::smallint;
  end if;

  return jsonb_build_object('graded_students', v_students, 'changed_cells', v_cells);
end;
$$;

comment on function public.grade_mock_exam_part1(uuid) is
  '§221, §224. Проверить первую часть законченных бланков по ключу (normalize_variant_answer + variant_answer_verdict) и записать в таблицу §218 через save_mock_exam_grid. Трогает только пустые и «авто»-клетки. Бланк без единого ответа и фото, не сданный, не проверяет (§224: его создаёт пинг). Под правами вызывающего.';

revoke all on function public.grade_mock_exam_part1(uuid) from public, anon;
grant execute on function public.grade_mock_exam_part1(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Telegram ученикам: «через час — пробник» и «пробник начался»
-- ──────────────────────────────────────────────────────────────────────────
-- Через notification_queue: scheduled_for — очередь сама ждёт до момента
-- (claim_notification_queue берёт только scheduled_for <= now()).
-- Колокольчика нет: у notifications нет отложенной доставки, а раздел
-- «Пробники» и так показывает идущий пробник.
--
-- Строка ставится КАЖДОМУ ученику группы с профилем, а не только тем, у кого
-- Telegram подключён сейчас: пробник назначают за дни, и подключивший бота
-- в эти дни должен получить напоминание. Кто к моменту отправки не подключён
-- или выключил «Домашние задания» — строку гасит process-notification-queue
-- (status = cancelled), как любую другую.
--
-- Ключ дедупликации: событие, пробник, начало (эпоха), профиль. Перенос даёт
-- новый ключ — новые строки. При любой правке окна, группы или названия все
-- ещё не ушедшие (pending) строки пробника гасятся, затем ставятся заново по
-- текущим данным; строка с тем же ключом (правка названия, перенос туда и
-- обратно) не дублируется, а оживает с новым текстом — только если она была
-- погашена, отправленную не трогаем. Прошедшие моменты не ставятся: перенос
-- «в прошлое» не шлёт «начался» задним числом. «Через час» — только если до
-- начала больше часа.
create or replace function public.mock_exam_schedule_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam    public.mock_exams;
  v_now     timestamptz := now();
  v_ends    timestamptz;
  v_until   timestamptz;
  v_epoch   bigint;
  v_payload jsonb;
begin
  if tg_op = 'UPDATE'
     and (old.starts_at, old.duration_minutes, old.group_id, old.title, old.photo_grace_minutes)
         is not distinct from (new.starts_at, new.duration_minutes, new.group_id, new.title, new.photo_grace_minutes) then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    update public.notification_queue q
       set status = 'cancelled'
     where q.entity_type = 'mock_exam'
       and q.entity_id = old.id
       and q.event_type in ('mock_exam_soon', 'mock_exam_started')
       and q.status = 'pending';
  end if;
  if tg_op = 'DELETE' then
    return null;
  end if;

  v_exam := new;
  if v_exam.starts_at is null or v_exam.group_id is null or v_exam.starts_at <= v_now then
    return null;
  end if;

  v_ends  := v_exam.starts_at + make_interval(mins => v_exam.duration_minutes);
  v_until := v_ends + make_interval(mins => v_exam.photo_grace_minutes);
  v_epoch := floor(extract(epoch from v_exam.starts_at))::bigint;
  v_payload := jsonb_build_object(
    'title',        v_exam.title,
    'exam_id',      v_exam.id,
    'group_id',     v_exam.group_id,
    'starts_at',    v_exam.starts_at,
    'ends_at',      v_ends,
    'photos_until', v_until,
    'link',         '/my-course/' || v_exam.group_id || '/mock/' || v_exam.id,
    'button_text',  'Открыть пробник'
  );

  insert into public.notification_queue as q
         (profile_id, channel, event_type, entity_type, entity_id,
          deduplication_key, payload, status, scheduled_for)
  select s.profile_id, 'telegram', ev.event_type, 'mock_exam', v_exam.id,
         ev.event_type || ':' || v_exam.id || ':' || v_epoch || ':' || s.profile_id,
         v_payload, 'pending'::public.notification_queue_status, ev.at
    from public.group_students gs
    join public.students s on s.id = gs.student_id and s.profile_id is not null
    cross join (values ('mock_exam_soon',    v_exam.starts_at - interval '1 hour'),
                       ('mock_exam_started', v_exam.starts_at)) as ev(event_type, at)
   where gs.group_id = v_exam.group_id
     and ev.at > v_now
  on conflict (deduplication_key) do update
     set payload       = excluded.payload,
         scheduled_for = excluded.scheduled_for,
         status        = 'pending',
         attempts      = 0
   where q.status = 'cancelled';

  return null;
end;
$$;

comment on function public.mock_exam_schedule_notifications() is
  '§224. Триггер mock_exams: ставит ученикам группы Telegram «через час — пробник» (starts_at − 1 ч) и «пробник начался» (starts_at) в notification_queue; при переносе, смене группы, названия, длительности, снятии времени и удалении гасит ещё не ушедшие. Прошедшие моменты не ставит.';

alter function public.mock_exam_schedule_notifications() owner to postgres;
revoke all on function public.mock_exam_schedule_notifications() from public, anon, authenticated;

drop trigger if exists mock_exams_schedule_notifications on public.mock_exams;
create trigger mock_exams_schedule_notifications
  after insert or update of starts_at, duration_minutes, photo_grace_minutes, group_id, title or delete
  on public.mock_exams
  for each row execute function public.mock_exam_schedule_notifications();

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Пробы — выполнять ОТДЕЛЬНО, в откатываемом блоке, под authenticated
-- ──────────────────────────────────────────────────────────────────────────
-- Прогонялись на локальном Postgres 16 со слепком схемы
-- (supabase/tests/mock_exam_live_224/). НА ПРОДЕ НЕ ПРОГОНЯЛИСЬ.
--
-- Пробники, которые после §224 впервые станут видны ученикам (время задано,
-- раздела нет) — проверить ДО применения:
--   select me.id, me.title, g.name as group_name, me.starts_at, me.module_id
--     from public.mock_exams me join public.groups g on g.id = me.group_id
--    where me.starts_at is not null and me.module_id is null
--    order by me.starts_at;
