-- Telegram-уведомления цикла ДЗ: «ученик сдал» персоналу и «работа проверена»
-- ученику (+ ссылки), плюс ссылка на тему в «новом ДЗ».
--
-- Решения владельца (2026-07-28): о сдаче узнаёт ВЕСЬ персонал курса
-- (владелец, преподаватели групп, кураторы — тот же круг, что видит очередь
-- проверки); ученику в сообщение кладём вердикт, балл и комментарий целиком
-- (обрезает воркер), не только ссылку.
--
-- Архитектура: topic_homework_submit_attempt / topic_homework_review_attempt —
-- SECURITY INVOKER, их права держит RLS, и менять это нельзя (definer дал бы
-- сдавать чужие попытки). Писать в notification_queue ученику RLS не даёт,
-- поэтому постановка в очередь вынесена в узкие SECURITY DEFINER помощники,
-- которые сами проверяют право звонящего на РОВНО ЭТО событие:
--   - сдача: попытка принадлежит auth.uid();
--   - вердикт: review написан auth.uid().
-- Спамить чужими событиями через прямой вызов помощника нельзя.
--
-- Сбой постановки в очередь НЕ откатывает сдачу/вердикт (exception → warning):
-- само действие важнее доставки уведомления — тот же принцип, что в публикации.
--
-- Прогнано на локальном Postgres 16 с заглушками, 6 поведенческих тестов
-- ролями: рассылка персоналу (2 получателя, препод без TG — мимо), дедуп,
-- отказ чужому звонящему, вердикт с баллом/ссылкой, ссылка в «новом ДЗ»,
-- сдача выживает при сломанной очереди (warning, не ошибка).

-- ── 1. «Ученик сдал ДЗ» → персоналу курса ────────────────────────────────────

create or replace function public.topic_homework_enqueue_submitted(p_attempt_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v      record;
  v_course_id uuid;
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
           'course_title', (select c.title from courses c where c.id = v_course_id),
           'attempt_number', v.attempt_number,
           'link', '/homework-queue'
         ),
         'pending'::notification_queue_status,
         now()
    from (
      -- Тот же круг, что course_is_staff, но множеством: владелец курса,
      -- преподаватели и кураторы групп, кураторы курса (m2m).
      select c.owner_id as profile_id from courses c where c.id = v_course_id
      union
      select t2.profile_id from groups g join teachers t2 on t2.id = g.teacher_id
       where g.course_id = v_course_id
      union
      select cu.profile_id from groups g join curators cu on cu.id = g.curator_id
       where g.course_id = v_course_id
      union
      select cc.profile_id from course_curators cc where cc.course_id = v_course_id
    ) staff
    join telegram_connections tc on tc.profile_id = staff.profile_id and tc.is_enabled
   where staff.profile_id is not null
  on conflict (deduplication_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function public.topic_homework_enqueue_submitted(uuid) is
  'Ставит персоналу курса телеграм-уведомление «ученик сдал ДЗ» (ссылка на /homework-queue). Вызывается из topic_homework_submit_attempt; звонящий должен быть автором попытки.';

-- ── 2. «Работа проверена» → ученику ─────────────────────────────────────────

create or replace function public.topic_homework_enqueue_reviewed(p_review_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  v_course_id uuid;
  v_group_id uuid;
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
  -- Группа нужна только для ссылки на тему; у «курс = группа» она одна.
  select g.id into v_group_id
    from groups g join group_students gs on gs.group_id = g.id
   where g.course_id = v_course_id and gs.student_id = v.student_id
   limit 1;

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
           'course_title', (select c.title from courses c where c.id = v_course_id),
           'decision', v.decision,
           'score', v.score,
           'max_score', case v.grade_scale when 'five' then 5 when 'hundred' then 100 else null end,
           'comment', v.comment,
           'link', case when v_group_id is not null
                        then '/my-course/' || v_group_id || '/topic/' || v.topic_id
                        else null end
         ),
         'pending'::notification_queue_status,
         now()
    from telegram_connections tc
   where tc.profile_id = v.student_profile and tc.is_enabled
  on conflict (deduplication_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function public.topic_homework_enqueue_reviewed(uuid) is
  'Ставит ученику телеграм-уведомление о вердикте (вердикт/балл/комментарий + ссылка на тему). Вызывается из topic_homework_review_attempt; звонящий — автор review.';

-- ── 3. Врезка в существующие RPC (invoker, права держит RLS) ────────────────

create or replace function public.topic_homework_submit_attempt(p_attempt_id uuid)
returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update topic_homework_attempts
     set status = 'submitted', submitted_at = now()
   where id = p_attempt_id
     and status = 'draft';

  if not found then
    raise exception 'Попытка не найдена, уже сдана или нет прав';
  end if;

  -- Уведомление — best effort: его сбой не должен откатить сдачу.
  begin
    perform public.topic_homework_enqueue_submitted(p_attempt_id);
  exception when others then
    raise warning 'topic_homework_enqueue_submitted(%): %', p_attempt_id, sqlerrm;
  end;
end $$;

create or replace function public.topic_homework_review_attempt(
  p_attempt_id uuid,
  p_decision   public.topic_homework_review_decision,
  p_comment    text default null,
  p_score      integer default null
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_scale text;
  v_max integer;
  v_review uuid;
begin
  select h.grade_scale into v_scale
    from topic_homework_attempts a
    join topic_homework h on h.id = a.homework_id
   where a.id = p_attempt_id;

  if p_decision = 'accepted' and v_scale is not null then
    v_max := case v_scale when 'five' then 5 else 100 end;
    if p_score is null then
      raise exception 'У этого ДЗ есть шкала баллов — укажите балл (0–%)', v_max
        using errcode = 'check_violation';
    end if;
    if p_score < 0 or p_score > v_max then
      raise exception 'Балл должен быть от 0 до %', v_max using errcode = 'check_violation';
    end if;
  else
    -- возврат на доработку или ДЗ без баллов — балла быть не должно
    p_score := null;
  end if;

  insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score)
  values (p_attempt_id, auth.uid(), p_decision, p_comment, p_score)
  returning id into v_review;

  update topic_homework_attempts
     set status = p_decision::text::public.topic_homework_attempt_status
   where id = p_attempt_id
     and status = 'submitted';

  if not found then
    raise exception 'Попытка не в статусе «сдано»';
  end if;

  -- Уведомление — best effort: его сбой не должен откатить вердикт.
  begin
    perform public.topic_homework_enqueue_reviewed(v_review);
  exception when others then
    raise warning 'topic_homework_enqueue_reviewed(%): %', v_review, sqlerrm;
  end;

  return v_review;
end $$;

comment on function public.topic_homework_review_attempt(uuid, public.topic_homework_review_decision, text, integer) is
  'Вердикт преподавателя (+ балл по шкале ДЗ при принятии). Только человек: reviewer_id = auth.uid(). Ставит ученику Telegram-уведомление (best effort).';

-- ── 4. «Новое ДЗ»: ссылка на тему в payload ─────────────────────────────────

create or replace function public.topic_homework_notify_students(p_homework_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hw record;
  v_course_id uuid;
  v_course_title text;
  v_topic_title text;
  v_count integer;
begin
  if not public.topic_homework_can_manage(p_homework_id) then
    raise exception 'Нет прав на это ДЗ' using errcode = 'insufficient_privilege';
  end if;

  select h.*, t.title as topic_title into v_hw
    from topic_homework h join topics t on t.id = h.topic_id
   where h.id = p_homework_id;
  if not found then
    raise exception 'ДЗ не найдено';
  end if;
  if not v_hw.is_published then
    raise exception 'Сначала опубликуйте ДЗ' using errcode = 'check_violation';
  end if;

  v_course_id := public.course_of_topic(v_hw.topic_id);
  select c.title into v_course_title from courses c where c.id = v_course_id;
  v_topic_title := v_hw.topic_title;

  insert into notification_queue
    (profile_id, channel, event_type, entity_type, entity_id,
     deduplication_key, payload, status, scheduled_for)
  -- distinct on (profile): ученик в двух группах курса получает одну ссылку.
  select distinct on (s.profile_id) s.profile_id,
         'telegram',
         'new_homework',
         'topic_homework',
         p_homework_id,
         'topic_homework:' || p_homework_id || ':' || s.profile_id,
         jsonb_build_object(
           'title', v_topic_title || ' — ' || v_hw.title,
           'course_title', v_course_title,
           'due_date', coalesce(to_char(v_hw.due_at, 'DD.MM.YYYY'), 'не указан'),
           'link', '/my-course/' || g.id || '/topic/' || v_hw.topic_id
         ),
         'pending'::notification_queue_status,
         now()
    from group_students gs
    join groups g on g.id = gs.group_id and g.course_id = v_course_id
    join students s on s.id = gs.student_id and s.profile_id is not null
    join telegram_connections tc on tc.profile_id = s.profile_id and tc.is_enabled
  on conflict (deduplication_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ── 5. Гранты: helpers — только authenticated ───────────────────────────────

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('topic_homework_enqueue_submitted', 'topic_homework_enqueue_reviewed')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
