-- ============================================================
-- ДЗ темы: дедлайн, баллы, оповещение в Telegram
-- ============================================================
-- СТАТУС: ПРИМЕНЕНО 2026-07-26 через одобренный MCP-процесс.
--   version = 20260726203833
--   name    = topic_homework_deadline_grades_notify
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- Решения владельца (2026-07-26, вечер):
--   * дедлайн НЕ блокирует сдачу — только показывается и подсвечивает просрочку;
--   * шкала баллов выбирается у ДЗ: five (0–5) | hundred (0–100) | NULL (без баллов);
--   * балл выставляется при принятии работы (обязателен, если шкала задана);
--   * кнопка «Оповестить учеников»: очередь notification_queue -> Telegram,
--     только ученики курса с включённой привязкой; дедупликация ключом.
-- ============================================================

-- 1. Колонки
alter table public.topic_homework
  add column due_at date,
  add column grade_scale text check (grade_scale in ('five', 'hundred'));

comment on column public.topic_homework.due_at is
  'Дедлайн. НЕ блокирует сдачу — просрочка только подсвечивается (решение владельца).';
comment on column public.topic_homework.grade_scale is
  'Шкала баллов: five (0–5), hundred (0–100), NULL — без баллов.';

alter table public.topic_homework_reviews
  add column score integer check (score >= 0 and score <= 100);

comment on column public.topic_homework_reviews.score is
  'Балл при принятии по шкале ДЗ. NULL — ДЗ без баллов или возврат на доработку.';

-- 2. Review-RPC с баллом (сигнатура меняется — старую убираем, чтобы
--    PostgREST не путался в перегрузках)
drop function public.topic_homework_review_attempt(uuid, public.topic_homework_review_decision, text);

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

  return v_review;
end $$;

comment on function public.topic_homework_review_attempt(uuid, public.topic_homework_review_decision, text, integer) is
  'Вердикт преподавателя (+ балл по шкале ДЗ при принятии). Только человек: reviewer_id = auth.uid().';

-- 3. Оповещение учеников курса в Telegram
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
  select distinct s.profile_id,
         'telegram',
         'new_homework',
         'topic_homework',
         p_homework_id,
         'topic_homework:' || p_homework_id || ':' || s.profile_id,
         jsonb_build_object(
           'title', v_topic_title || ' — ' || v_hw.title,
           'course_title', v_course_title,
           'due_date', coalesce(to_char(v_hw.due_at, 'DD.MM.YYYY'), 'не указан')
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

comment on function public.topic_homework_notify_students(uuid) is
  'Ставит в notification_queue телеграм-оповещение «новое ДЗ» ученикам курса с включённой привязкой. Дедупликация: повторный вызов не спамит (вернёт 0).';

-- 4. Гранты
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('topic_homework_review_attempt', 'topic_homework_notify_students')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

grant execute on function public.topic_homework_review_attempt(uuid, public.topic_homework_review_decision, text, integer) to authenticated;
grant execute on function public.topic_homework_notify_students(uuid) to authenticated;
