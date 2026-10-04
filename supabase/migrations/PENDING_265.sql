-- §265 — Шкалы оценок: ДЗ к уроку — 100 баллов, проверочная и контрольная — 2–5.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration одной транзакцией, после чего файл
-- переименовывается в <version>_<name>.sql точно по записи в supabase_migrations.schema_migrations
-- (MIGRATIONS.md). Только добавляющая и повторяемая: create or replace function, триггеры через
-- create or replace trigger (Postgres 14+). Ни одного drop. Старые данные этот файл НЕ трогает — пересчёт в PENDING_265_backfill.sql
-- (применяется следом, после проб «что изменится»).
--
-- Решения владельца (04.10, макет maket_bally.html):
--   * ДЗ к уроку (topics.kind = 'lesson') по умолчанию 100-балльное, учитель может сменить на 5-балльную.
--     Пункта «без баллов» больше нет.
--   * Проверочная и контрольная (kind check / control) — всегда 5-балльные.
--   * 5-балльная оценка — только 2, 3, 4, 5. Ноль и единицу сервер не принимает.
--   * Пробники не трогаем (у них своя таблица, сюда не входят).
--
-- Что здесь:
--   1. topic_homework_default_scale(kind)    — НОВАЯ immutable: шкала по типу темы (lesson → hundred,
--      check/control → five). Одно место правила для триггеров и бэкфилла.
--   2. Триггер topic_homework_grade_scale_trg (BEFORE INSERT / UPDATE OF grade_scale, topic_id на
--      topic_homework): null → по типу темы; у проверочной и контрольной — всегда five. Сменить шкалу ДЗ,
--      у которого уже стоят оценки (score не null), нельзя: прямой правкой — понятная ошибка, из
--      синхронизации каркаса или смены типа темы (вложенный триггер) — шкала молча остаётся прежней.
--      Покрывает ВСЕ пути создания ДЗ: клиент (useTopicHomework.createHomework), копирование курса и темы
--      (course_copy_stage / topic_copy_stage → course_copy_topic_content: тип темы ставится ДО вставки ДЗ),
--      синхронизацию каркаса (template_sync_homework), импорт (scripts/import-lessons.mjs, service_role).
--      Автовыдача §243 ДЗ не создаёт — только выдаёт.
--   3. Триггер topics_kind_grade_scale_trg (AFTER UPDATE OF kind на topics): тип темы сменили
--      (урок ↔ проверочная/контрольная) — шкала её ДЗ переключается на шкалу нового типа, ТОЛЬКО если у ДЗ
--      нет оценок. Есть оценки — шкала остаётся как была: пересчитывать выставленные ученикам оценки
--      задним числом без учителя нельзя, а «86 из 5» хуже, чем 100-балльная проверочная.
--   4. Триггер topic_homework_reviews_scale_trg (BEFORE INSERT OR UPDATE на topic_homework_reviews):
--      у 5-балльной работы score ∈ 2..5, иначе ошибка с понятным текстом. score null допустим
--      («на доработку», старые «принято без балла»). 100-балльная — как раньше, CHECK 0..100 на колонке.
--   5. template_sync_homework — тело из 20260913195322 (§172) с одной правкой: шкала каркаса едет в класс
--      только в той транзакции, где её в каркасе ПОМЕНЯЛИ (флаг app.hw_scale_changed ставит триггер п. 2).
--      Раньше у каркаса шкала была пустой, и coalesce(каркас, класс) классную настройку не трогал; после
--      бэкфилла шкала у каркаса есть всегда, и любая правка материалов каркаса затирала бы выбор учителя
--      класса (5-балльная) стобалльной. Теперь не затирает.

-- ══ 1. Шкала по типу темы ═══════════════════════════════════════════════════════════════════════════
create or replace function public.topic_homework_default_scale(p_kind text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p_kind in ('check', 'control') then 'five' else 'hundred' end;
$$;

comment on function public.topic_homework_default_scale(text) is
  '§265. Шкала ДЗ по типу темы: проверочная и контрольная — five (оценка 2–5), урок — hundred (0–100).';

-- ══ 2. Шкала при создании и правке ДЗ ═══════════════════════════════════════════════════════════════
create or replace function public.topic_homework_grade_scale_fill()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind   text;
  v_target text;
begin
  select t.kind into v_kind from topics t where t.id = new.topic_id;

  -- Проверочная и контрольная — всегда пятибалльные; урок — что выбрал учитель, по умолчанию 100.
  v_target := case
    when v_kind in ('check', 'control') then 'five'
    else coalesce(new.grade_scale, public.topic_homework_default_scale(v_kind))
  end;

  if tg_op = 'UPDATE'
     and old.grade_scale is not null
     and v_target is distinct from old.grade_scale
     and exists (
       select 1
         from topic_homework_attempts a
         join topic_homework_reviews r on r.attempt_id = a.id
        where a.homework_id = new.id and r.score is not null)
  then
    -- Оценки уже выставлены по старой шкале. Из синхронизации каркаса и смены типа темы (вложенный
    -- триггер) — тихо оставляем как есть; прямой правкой учителя — объясняем, почему нельзя.
    if pg_trigger_depth() > 1 then
      new.grade_scale := old.grade_scale;
      return new;
    end if;
    raise exception 'По этой работе уже выставлены оценки — шкалу сменить нельзя'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and v_target is distinct from old.grade_scale then
    -- §265. Для template_sync_homework: шкалу этого ДЗ поменяли в этой транзакции — каркас вправе
    -- донести её до классов. Список, а не одно значение: одна команда может поменять несколько ДЗ.
    perform set_config('app.hw_scale_changed',
                       coalesce(current_setting('app.hw_scale_changed', true), '') || ',' || new.id::text,
                       true);
  end if;

  new.grade_scale := v_target;
  return new;
end $$;

comment on function public.topic_homework_grade_scale_fill() is
  '§265. BEFORE INSERT / UPDATE OF grade_scale, topic_id на topic_homework: null → по типу темы (урок — hundred), проверочная/контрольная — всегда five; при выставленных оценках шкала не меняется.';

create or replace trigger topic_homework_grade_scale_trg
  before insert or update of grade_scale, topic_id on public.topic_homework
  for each row execute function public.topic_homework_grade_scale_fill();

-- ══ 3. Сменили тип темы — шкала ДЗ следом (если оценок нет) ════════════════════════════════════════
create or replace function public.topics_kind_grade_scale()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update topic_homework h
     set grade_scale = public.topic_homework_default_scale(new.kind)
   where h.topic_id = new.id
     and h.grade_scale is distinct from public.topic_homework_default_scale(new.kind)
     and not exists (
       select 1
         from topic_homework_attempts a
         join topic_homework_reviews r on r.attempt_id = a.id
        where a.homework_id = h.id and r.score is not null);
  return null;
end $$;

comment on function public.topics_kind_grade_scale() is
  '§265. AFTER UPDATE OF kind на topics: шкала ДЗ темы переключается на шкалу нового типа, только если у ДЗ нет выставленных оценок.';

create or replace trigger topics_kind_grade_scale_trg
  after update of kind on public.topics
  for each row
  when (new.kind is distinct from old.kind)
  execute function public.topics_kind_grade_scale();

-- ══ 4. Оценка 5-балльной работы — только 2..5 ══════════════════════════════════════════════════════
create or replace function public.topic_homework_reviews_scale_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scale text;
begin
  if new.score is null then
    return new;
  end if;
  select h.grade_scale into v_scale
    from topic_homework_attempts a
    join topic_homework h on h.id = a.homework_id
   where a.id = new.attempt_id;
  if v_scale = 'five' and new.score not between 2 and 5 then
    raise exception 'У 5-балльной работы оценка — 2, 3, 4 или 5 (поставлено %)', new.score
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function public.topic_homework_reviews_scale_check() is
  '§265. BEFORE INSERT OR UPDATE на topic_homework_reviews: у 5-балльной работы оценка только 2–5; null допустим (на доработку).';

create or replace trigger topic_homework_reviews_scale_trg
  before insert or update on public.topic_homework_reviews
  for each row execute function public.topic_homework_reviews_scale_check();

-- ══ 5. Каркас → классы: шкалу переносим, только когда её в каркасе поменяли ═══════════════════════
-- Тело — 20260913195322 (§172), изменена одна строка UPDATE (grade_scale). Вставка нового ДЗ в класс
-- по-прежнему берёт шкалу каркаса — триггер п. 2 поправит её по типу темы класса.
create or replace function public.template_sync_homework(p_template_topic_id uuid, p_copy_topic_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_tpl_hw  record;
  v_copy_hw uuid;
  v_scale_changed boolean;
BEGIN
  SELECT h.id, h.title, h.instructions, h.grade_scale, h.created_by
    INTO v_tpl_hw FROM public.topic_homework h WHERE h.topic_id = p_template_topic_id;

  IF v_tpl_hw.id IS NULL THEN
    -- ДЗ убрали в каркасе. В классе убираем только нетронутое: за попытками
    -- стоит работа учеников.
    DELETE FROM public.topic_homework ch
     WHERE ch.topic_id = p_copy_topic_id
       AND ch.source_homework_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.topic_homework_attempts a WHERE a.homework_id = ch.id);

    IF EXISTS (
      SELECT 1 FROM public.topic_homework ch
       WHERE ch.topic_id = p_copy_topic_id AND ch.source_homework_id IS NOT NULL
    ) THEN
      INSERT INTO public.template_sync_issues (template_topic_id, copy_topic_id, kind, detail)
      VALUES (p_template_topic_id, p_copy_topic_id, 'delete_kept',
              'ДЗ убрано в каркасе, но по нему есть работы учеников — осталось в классе');
    END IF;
    RETURN;
  END IF;

  SELECT id INTO v_copy_hw FROM public.topic_homework
   WHERE topic_id = p_copy_topic_id AND source_homework_id = v_tpl_hw.id;

  IF v_copy_hw IS NULL THEN
    -- У темы одно ДЗ (unique(topic_id)). Если в классе уже есть своё, чужое
    -- место не занимаем: пишем расхождение, преподаватель решит сам.
    IF EXISTS (SELECT 1 FROM public.topic_homework WHERE topic_id = p_copy_topic_id) THEN
      INSERT INTO public.template_sync_issues (template_topic_id, copy_topic_id, kind, detail)
      VALUES (p_template_topic_id, p_copy_topic_id, 'hw_conflict',
              'В каркасе появилось ДЗ, а в классе уже есть своё — оставлено классное');
      RETURN;
    END IF;

    INSERT INTO public.topic_homework
      (topic_id, title, instructions, is_published, created_by, due_at, grade_scale, source_homework_id)
    VALUES
      (p_copy_topic_id, v_tpl_hw.title, v_tpl_hw.instructions, false,
       coalesce(auth.uid(), v_tpl_hw.created_by), NULL, v_tpl_hw.grade_scale, v_tpl_hw.id)
    RETURNING id INTO v_copy_hw;
  ELSE
    -- §265. Шкалу каркаса переносим только в той транзакции, где её в каркасе поменяли (флаг ставит
    -- topic_homework_grade_scale_fill). Правка материалов каркаса классную шкалу не трогает: учитель
    -- класса мог выбрать 5-балльную. Пустой шкалы у каркаса после §265 не бывает, coalesce — страховка.
    v_scale_changed := position(',' || v_tpl_hw.id::text
                                IN coalesce(current_setting('app.hw_scale_changed', true), '')) > 0;
    UPDATE public.topic_homework ch
       SET title = v_tpl_hw.title, instructions = v_tpl_hw.instructions,
           grade_scale = CASE WHEN v_scale_changed THEN coalesce(v_tpl_hw.grade_scale, ch.grade_scale)
                              ELSE ch.grade_scale END,
           updated_at = now()
     WHERE ch.id = v_copy_hw
       AND (ch.title, ch.instructions, ch.grade_scale)
           IS DISTINCT FROM (v_tpl_hw.title, v_tpl_hw.instructions,
                             CASE WHEN v_scale_changed THEN coalesce(v_tpl_hw.grade_scale, ch.grade_scale)
                                  ELSE ch.grade_scale END);
  END IF;

  DELETE FROM public.topic_homework_files cf
   WHERE cf.homework_id = v_copy_hw
     AND cf.source_file_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.topic_homework_files tf
                      WHERE tf.id = cf.source_file_id AND tf.homework_id = v_tpl_hw.id);

  UPDATE public.topic_homework_files cf
     SET storage_path = tf.storage_path, original_filename = tf.original_filename,
         mime_type = tf.mime_type, size_bytes = tf.size_bytes, position = tf.position
    FROM public.topic_homework_files tf
   WHERE tf.id = cf.source_file_id AND cf.homework_id = v_copy_hw
     AND (cf.storage_path, cf.original_filename, cf.mime_type, cf.size_bytes, cf.position)
         IS DISTINCT FROM (tf.storage_path, tf.original_filename, tf.mime_type, tf.size_bytes, tf.position);

  INSERT INTO public.topic_homework_files
    (homework_id, storage_path, original_filename, mime_type, size_bytes, position, source_file_id)
  SELECT v_copy_hw, tf.storage_path, tf.original_filename, tf.mime_type, tf.size_bytes, tf.position, tf.id
    FROM public.topic_homework_files tf
   WHERE tf.homework_id = v_tpl_hw.id
     AND NOT EXISTS (SELECT 1 FROM public.topic_homework_files cf
                      WHERE cf.homework_id = v_copy_hw AND cf.source_file_id = tf.id);
END;
$function$;

comment on column public.topic_homework.grade_scale is
  '§265: шкала оценки. hundred — 0..100 (по умолчанию у ДЗ к уроку), five — оценка 2..5 (всегда у проверочной и контрольной). Пустой после бэкфилла §265 не бывает (NOT NULL).';
