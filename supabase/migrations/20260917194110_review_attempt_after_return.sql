-- §198. Принять работу, уже отправленную на доработку, без новой сдачи.
-- ПРИМЕНЕНО оркестратором 17.09.2026, версия 20260917194110
-- (supabase_migrations.schema_migrations, MIGRATIONS.md).
--
-- Что меняется:
--   1. topic_homework_attempts_guard — разрешён ОДИН новый переход терминального
--      статуса: returned_for_revision → accepted, и только изнутри
--      topic_homework_review_attempt (по транзакционному флагу). Прямой UPDATE
--      по-прежнему запрещён: статус не должен меняться без строки в истории.
--   2. topic_homework_review_attempt — заменяющая версия (не вторая копия):
--      исходные статусы submitted И returned_for_revision, пересмотр только
--      последней попытки, новая строка в topic_homework_reviews.
--
-- Что НЕ меняется:
--   * права (topic_homework_attempt_can_review, RLS, гранты) — кто мог
--     проверять, тот и пересматривает;
--   * append-only topic_homework_reviews и триггер
--     topic_homework_reviews_immutable;
--   * переход accepted → returned_for_revision остаётся запрещённым (у ученика
--     уже виден балл, тема могла закрыться через topic_done_events) — отдельный
--     вопрос владельцу;
--   * уведомление ученику — та же topic_homework_enqueue_reviewed, у неё
--     dedup-ключ по id вердикта, поэтому второй вердикт даёт второе
--     уведомление, а не тишину.

-- ── 1. Сторож попыток: один разрешённый пересмотр ───────────────────────────
-- Текст взят из базы (pg_get_functiondef на 2026-09-17) и изменён только в
-- ветке терминальных статусов. Ветка DELETE с флагом app.course_delete —
-- из миграции 20260801201500, её сохраняем как есть.
create or replace function public.topic_homework_attempts_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_next integer;
begin
  if tg_op = 'INSERT' then
    if exists (
      select 1 from topic_homework_attempts a
       where a.homework_id = new.homework_id
         and a.student_id  = new.student_id
         and a.status = 'accepted'
    ) then
      raise exception 'Работа уже принята, новые попытки запрещены'
        using errcode = 'check_violation';
    end if;

    select coalesce(max(a.attempt_number), 0) + 1 into v_next
      from topic_homework_attempts a
     where a.homework_id = new.homework_id and a.student_id = new.student_id;
    new.attempt_number := v_next;

    new.status := 'draft';
    new.submitted_at := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.homework_id is distinct from old.homework_id
       or new.student_id is distinct from old.student_id
       or new.attempt_number is distinct from old.attempt_number then
      raise exception 'Привязку и номер попытки менять нельзя'
        using errcode = 'check_violation';
    end if;

    -- Терминальные статусы неизменяемы. Единственное исключение (§198):
    -- возвращённую работу можно принять как есть — но лишь изнутри
    -- topic_homework_review_attempt, которая перед UPDATE кладёт id попытки в
    -- транзакционный флаг и в той же транзакции пишет строку вердикта.
    -- Флаг именно с id, а не 'on': иначе одна разрешённая правка открывала бы
    -- дорогу остальным строкам той же транзакции.
    if old.status in ('accepted', 'returned_for_revision')
       and new.status is distinct from old.status then
      if not (old.status = 'returned_for_revision'
              and new.status = 'accepted'
              and coalesce(current_setting('app.topic_homework_revise', true), '') = old.id::text) then
        raise exception 'Проверенную попытку изменить нельзя'
          using errcode = 'check_violation';
      end if;
    end if;

    if old.status = 'draft' and new.status = 'submitted' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.course_delete', true), '') = 'on' then
      return old;
    end if;
    if old.status <> 'draft' then
      raise exception 'Сданную попытку удалить нельзя'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  return null;
end $$;

-- ── 2. Вердикт: сданная работа и пересмотр возвращённой ─────────────────────
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
  v_status public.topic_homework_attempt_status;
  v_homework uuid;
  v_student uuid;
  v_number integer;
  v_newer_number integer;
  v_newer_status public.topic_homework_attempt_status;
begin
  -- Право не новое: та же проверка, что у пометок и ИИ-разбора. Спрашиваем её
  -- явно только ради внятного отказа — настоящую защиту держат RLS-политики
  -- (insert в topic_homework_reviews и update попытки) ниже.
  if not public.topic_homework_attempt_can_review(p_attempt_id) then
    raise exception 'Нет прав на проверку этой работы'
      using errcode = 'insufficient_privilege';
  end if;

  select a.status, a.homework_id, a.student_id, a.attempt_number, h.grade_scale
    into v_status, v_homework, v_student, v_number, v_scale
    from topic_homework_attempts a
    join topic_homework h on h.id = a.homework_id
   where a.id = p_attempt_id;

  if v_status is null then
    raise exception 'Попытка не найдена' using errcode = 'no_data_found';
  end if;

  -- Вердикт ставится сданной работе; возвращённую можно пересмотреть и принять
  -- как есть (§198): преподаватель вернул, потом разобрался в почерке или
  -- ученик объяснил решение на занятии. Принятую не трогаем — у ученика уже
  -- виден балл.
  if v_status = 'accepted' then
    raise exception 'Работа уже принята — вердикт не меняется';
  end if;
  if v_status not in ('submitted', 'returned_for_revision') then
    raise exception 'Попытка не в статусе «сдано»';
  end if;

  -- Пересматривать можно только ПОСЛЕДНЮЮ попытку. Иначе преподаватель примет
  -- старую версию работы, а на проверке будет висеть новая.
  select a.attempt_number, a.status into v_newer_number, v_newer_status
    from topic_homework_attempts a
   where a.homework_id = v_homework
     and a.student_id  = v_student
     and a.attempt_number > v_number
   order by a.attempt_number desc
   limit 1;

  if v_newer_number is not null then
    if v_newer_status = 'draft' then
      raise exception 'Ученик уже начал новую попытку (№%) — старую принимать нельзя', v_newer_number
        using errcode = 'check_violation';
    end if;
    raise exception 'Ученик уже сдал работу заново — открывайте последнюю попытку (№%)', v_newer_number
      using errcode = 'check_violation';
  end if;

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

  -- История append-only: пересмотр добавляет ВТОРУЮ строку, «вернул, потом
  -- принял» остаётся видно целиком.
  insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score)
  values (p_attempt_id, auth.uid(), p_decision, p_comment, p_score)
  returning id into v_review;

  -- Флаг для сторожа: он пускает returned_for_revision → accepted только для
  -- этой попытки и только до конца транзакции.
  perform set_config('app.topic_homework_revise', p_attempt_id::text, true);

  update topic_homework_attempts
     set status = p_decision::text::public.topic_homework_attempt_status
   where id = p_attempt_id
     and status in ('submitted', 'returned_for_revision');

  if not found then
    -- Сюда попадаем только гонкой: пока мы считали балл, работу принял
    -- кто-то другой (accepted из набора исключён). Текст узнаёт клиент —
    -- isAlreadyReviewedError в src/lib/homeworkQueue.ts.
    raise exception 'Работа уже принята другим проверяющим';
  end if;

  perform set_config('app.topic_homework_revise', '', true);

  -- Уведомление — best effort: его сбой не должен откатить вердикт.
  begin
    perform public.topic_homework_enqueue_reviewed(v_review);
  exception when others then
    raise warning 'topic_homework_enqueue_reviewed(%): %', v_review, sqlerrm;
  end;

  return v_review;
end $$;

comment on function public.topic_homework_review_attempt(uuid, public.topic_homework_review_decision, text, integer) is
  '§198. Вердикт преподавателя (+ балл по шкале ДЗ при принятии). Исходные статусы: submitted и returned_for_revision (возвращённую работу можно принять как есть), только для ПОСЛЕДНЕЙ попытки ученика по этому ДЗ. accepted не пересматривается. Каждый вердикт — новая строка topic_homework_reviews. Только человек: reviewer_id = auth.uid(). Уведомление ученику — best effort.';

comment on function public.topic_homework_attempts_guard() is
  '§198. Сторож попыток: номер и статус ведёт база. Терминальные статусы неизменяемы, кроме одного перехода returned_for_revision → accepted изнутри topic_homework_review_attempt (транзакционный флаг app.topic_homework_revise = id попытки).';

-- Гранты не трогаем: execute на topic_homework_review_attempt(uuid,
-- topic_homework_review_decision, text, integer) выдан authenticated ещё в
-- 20260726203833, подпись не менялась.
