-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260730125856
--   name    = topic_homework_in_app_notifications
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- Проверено на проде сквозным прогоном: вызов помощника от имени реального
-- ученика создал ученику курса строку в notifications («Новая работа на
-- проверку», ссылка /homework-queue, read=false); повторный вызов вернул 0 и
-- второй строки не создал (идемпотентность по dedup_key).
-- ============================================================
-- In-app уведомления цикла ДЗ (2026-07-30)
-- ============================================================
-- Симптом от владельца: «ученик сдал ДЗ — визуально нигде не видно у учителя,
-- что появилась новая работа на проверку» и «аналогично не появилось у ученика,
-- что проверено».
--
-- Причина: события цикла ДЗ (20260728131304_topic_hw_telegram_events) писались
-- ТОЛЬКО в notification_queue, канал telegram, да ещё и через
-- `join telegram_connections tc ... and tc.is_enabled` — то есть получателю
-- без подключённого Telegram не доставалось НИЧЕГО. Таблица notifications
-- (колокольчик в сайдбаре со счётчиком непрочитанных) при этом не заполнялась
-- вовсе. Проверено на проде: у единственного получателя того самого события
-- (владелец «Тестового курса») telegram не подключён → отправлено 0 сообщений.
--
-- Фикс: те же два помощника дополнительно пишут строку в notifications —
-- без telegram-гейта, всем получателям. Telegram-ветка не тронута.
--
-- Права не меняются: помощники и раньше были SECURITY DEFINER и сами проверяют,
-- что звонящий имеет право породить РОВНО ЭТО событие (сдача — попытка его,
-- вердикт — review его). Ученик не может через них разослать себе или другим
-- произвольное уведомление.

-- ── 1. Идемпотентность in-app уведомлений ──
-- Тот же ключ, что у telegram-ветки, чтобы повторный вызов не плодил дубли.
alter table public.notifications add column if not exists dedup_key text;

-- Индекс ПЛОСКИЙ, а не partial: `on conflict (dedup_key)` с partial-индексом
-- потребовал бы повторять предикат индекса в самом запросе. NULL-ы по
-- умолчанию различны, поэтому уже существующие строки (dedup_key is null)
-- друг другу не мешают.
create unique index if not exists notifications_dedup_key_uq
  on public.notifications(dedup_key);

comment on column public.notifications.dedup_key is
  'Ключ идемпотентности для автоматических уведомлений. NULL — созданное вручную/старое.';

-- ── 1b. Получатели «событий курса» одним местом ──
-- Раньше этот UNION был вписан прямо в telegram-вставку; теперь он нужен дважды
-- (очередь + колокольчик), поэтому вынесен, чтобы два списка получателей не
-- разъехались. Множество — то же, что пускает course_is_staff.
create or replace function public._topic_homework_course_staff(p_course_id uuid)
returns table (profile_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.owner_id from courses c where c.id = p_course_id
  union
  select t.profile_id from groups g join teachers t on t.id = g.teacher_id
   where g.course_id = p_course_id
  union
  select cu.profile_id from groups g join curators cu on cu.id = g.curator_id
   where g.course_id = p_course_id
  union
  select cc.profile_id from course_curators cc where cc.course_id = p_course_id
$$;

comment on function public._topic_homework_course_staff(uuid) is
  'Профили персонала курса (владелец, преподаватели и кураторы групп, кураторы курса) — получатели событий цикла ДЗ. Внутренний помощник, снаружи не вызывается.';

revoke all on function public._topic_homework_course_staff(uuid) from public, anon, authenticated;
grant execute on function public._topic_homework_course_staff(uuid) to service_role;

-- ── 2. «Ученик сдал ДЗ» → персоналу курса (telegram + колокольчик) ──
create or replace function public.topic_homework_enqueue_submitted(p_attempt_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v      record;
  v_course_id uuid;
  v_course_title text;
  v_count integer;
begin
  select a.id, a.attempt_number, a.status, h.id as homework_id, h.title as hw_title,
         t.id as topic_id, t.title as topic_title, s.profile_id as student_profile,
         p.full_name as student_name
    into v
    from topic_homework_attempts a
    join topic_homework h on h.id = a.homework_id
    join topics t on t.id = h.topic_id
    join students s on s.id = a.student_id
    join profiles p on p.id = s.profile_id
   where a.id = p_attempt_id;

  if not found then return 0; end if;
  -- Право: только сам сдавший ученик может породить это событие.
  if v.student_profile is distinct from auth.uid() then
    raise exception 'Нет прав' using errcode = 'insufficient_privilege';
  end if;
  if v.status <> 'submitted' then return 0; end if;

  v_course_id := public.course_of_topic(v.topic_id);
  select c.title into v_course_title from courses c where c.id = v_course_id;

  insert into notification_queue
    (profile_id, channel, event_type, entity_type, entity_id,
     deduplication_key, payload, status, scheduled_for)
  select distinct staff.profile_id,
         'telegram',
         'topic_homework_submitted',
         'topic_homework_attempt',
         p_attempt_id,
         'topic_hw_submitted:' || p_attempt_id || ':' || staff.profile_id,
         jsonb_build_object(
           'student_name', v.student_name,
           'title', v.topic_title || ' — ' || v.hw_title,
           'course_title', v_course_title,
           'attempt_number', v.attempt_number,
           'link', '/homework-queue'
         ),
         'pending'::notification_queue_status,
         now()
    from public._topic_homework_course_staff(v_course_id) staff
    join telegram_connections tc on tc.profile_id = staff.profile_id and tc.is_enabled
   where staff.profile_id is not null
  on conflict (deduplication_key) do nothing;

  -- Считаем ДО in-app вставки: row_count берётся от последнего запроса, а
  -- возвращаемое значение по контракту — число поставленных telegram-сообщений.
  get diagnostics v_count = row_count;

  -- Колокольчик: без telegram-гейта, всем сотрудникам курса.
  insert into notifications (user_id, title, message, type, link, dedup_key)
  select distinct staff.profile_id,
         'Новая работа на проверку',
         v.student_name || ' сдал(а) работу: ' || v.topic_title || ' — ' || v.hw_title
           || case when v.attempt_number > 1
                   then ' (попытка №' || v.attempt_number || ')' else '' end,
         'info',
         '/homework-queue',
         'topic_hw_submitted:' || p_attempt_id || ':' || staff.profile_id
    from public._topic_homework_course_staff(v_course_id) staff
   where staff.profile_id is not null
  on conflict (dedup_key) do nothing;

  return v_count;
end $$;

comment on function public.topic_homework_enqueue_submitted(uuid) is
  'Уведомляет персонал курса о сдаче ДЗ: telegram (кому подключён) + строка в notifications (всем). Вызывается из topic_homework_submit_attempt; звонящий должен быть автором попытки. Возвращает число поставленных telegram-сообщений.';

-- ── 3. «Работа проверена» → ученику (telegram + колокольчик) ──
create or replace function public.topic_homework_enqueue_reviewed(p_review_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  v_course_id uuid;
  v_course_title text;
  v_group_id uuid;
  v_link text;
  v_max_score integer;
  v_count integer;
begin
  select r.id, r.decision, r.score, r.comment, r.reviewer_id,
         h.title as hw_title, h.grade_scale,
         t.id as topic_id, t.title as topic_title,
         s.id as student_id, s.profile_id as student_profile
    into v
    from topic_homework_reviews r
    join topic_homework_attempts a on a.id = r.attempt_id
    join topic_homework h on h.id = a.homework_id
    join topics t on t.id = h.topic_id
    join students s on s.id = a.student_id
   where r.id = p_review_id;

  if not found then return 0; end if;
  -- Право: только автор вердикта может породить это событие.
  if v.reviewer_id is distinct from auth.uid() then
    raise exception 'Нет прав' using errcode = 'insufficient_privilege';
  end if;
  if v.student_profile is null then return 0; end if;

  v_course_id := public.course_of_topic(v.topic_id);
  select c.title into v_course_title from courses c where c.id = v_course_id;
  -- Группа нужна только для ссылки на тему; у «курс = группа» она одна.
  select g.id into v_group_id
    from groups g join group_students gs on gs.group_id = g.id
   where g.course_id = v_course_id and gs.student_id = v.student_id
   limit 1;

  v_link := case when v_group_id is not null
                 then '/my-course/' || v_group_id || '/topic/' || v.topic_id
                 else '/my-homework' end;
  v_max_score := case v.grade_scale when 'five' then 5 when 'hundred' then 100 else null end;

  insert into notification_queue
    (profile_id, channel, event_type, entity_type, entity_id,
     deduplication_key, payload, status, scheduled_for)
  select v.student_profile,
         'telegram',
         'topic_homework_reviewed',
         'topic_homework_review',
         p_review_id,
         'topic_hw_reviewed:' || p_review_id,
         jsonb_build_object(
           'title', v.topic_title || ' — ' || v.hw_title,
           'course_title', v_course_title,
           'decision', v.decision,
           'score', v.score,
           'max_score', v_max_score,
           'comment', v.comment,
           'link', case when v_group_id is not null then v_link else null end
         ),
         'pending'::notification_queue_status,
         now()
    from telegram_connections tc
   where tc.profile_id = v.student_profile and tc.is_enabled
  on conflict (deduplication_key) do nothing;

  get diagnostics v_count = row_count;

  -- Колокольчик ученику: вердикт, балл и комментарий сразу в тексте, чтобы
  -- было видно суть, не открывая тему.
  insert into notifications (user_id, title, message, type, link, dedup_key)
  values (
    v.student_profile,
    case when v.decision = 'accepted' then 'Работа принята'
         else 'Работа возвращена на доработку' end,
    v.topic_title || ' — ' || v.hw_title
      || case when v.decision = 'accepted' and v.score is not null and v_max_score is not null
              then '. Оценка: ' || v.score || '/' || v_max_score
              when v.decision = 'accepted' and v.score is not null
              then '. Балл: ' || v.score
              else '' end
      || case when coalesce(btrim(v.comment), '') <> ''
              then '. ' || btrim(v.comment) else '' end,
    case when v.decision = 'accepted' then 'success' else 'warning' end,
    v_link,
    'topic_hw_reviewed:' || p_review_id
  )
  on conflict (dedup_key) do nothing;

  return v_count;
end $$;

comment on function public.topic_homework_enqueue_reviewed(uuid) is
  'Уведомляет ученика о вердикте: telegram (если подключён) + строка в notifications (всегда), с вердиктом/баллом/комментарием и ссылкой на тему. Вызывается из topic_homework_review_attempt; звонящий — автор review. Возвращает число поставленных telegram-сообщений.';
