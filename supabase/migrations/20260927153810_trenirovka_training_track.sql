-- §234. Вкладка «Тренировка» в темах курса: задачник владельца по кодификатору.
--
-- ТОЛЬКО ДОБАВЛЯЮЩАЯ. Новые столбцы с умолчанием, новая таблица, новые
-- значения в CHECK; функции — `create or replace` с прежним телом плюс
-- фильтр/перенос трёх новых столбцов. Файл повторяем: второй прогон проходит
-- без ошибок (проверено локально, supabase/tests/trenirovka_234/run.sh).
--
-- Применять ОДНОЙ транзакцией (MCP apply_migration так и делает): CHECK на
-- section снимается и ставится заново, между ними окна быть не должно.
--
-- Решения владельца (задача §234), из которых следует всё ниже:
--  1. тренировка НЕ входит в «тема пройдена» — topic_done_events() смотрит
--     только track = 'ege' (клиентская пара — topicProgress — получает данные
--     уже без тренировки: все клиентские запросы фильтруют track = 'ege');
--  2. тренировочное ДЗ — самопроверка: в topic_homework* ничего не пишется,
--     ИИ-проверка берёт эталон только из track = 'ege' (правка edge-функции);
--  3. решения тренировки видны сразу: гейт «Решение ДЗ» (§95) их не касается —
--     и в политике на строку, и в видимости файла, и в topic_solution_state;
--  4. учитель скрывает подтему для своего класса — таблица
--     topic_subtopic_hidden. НЕ через is_visible: синхронизация каркаса
--     переносит is_visible из шаблона и затёрла бы классное скрытие.

-- ── 1. Материалы: дорожка и подтема ─────────────────────────────────────────

alter table public.topic_material_items
  add column if not exists track text not null default 'ege',
  add column if not exists subtopic_code text,
  add column if not exists subtopic_title text;

comment on column public.topic_material_items.track is
  'ege — материалы темы (банк ФИПИ, «Формат ЕГЭ»); training — задачник по кодификатору, вкладка «Тренировка». §234';
comment on column public.topic_material_items.subtopic_code is
  'Номер подтемы кодификатора (1.17, 2.15.1) — только у track = training. §234';

alter table public.topic_material_items drop constraint if exists topic_material_items_track_check;
alter table public.topic_material_items add constraint topic_material_items_track_check
  check (track = any (array['ege', 'training']::text[]));

alter table public.topic_material_items drop constraint if exists topic_material_items_training_subtopic_check;
alter table public.topic_material_items add constraint topic_material_items_training_subtopic_check
  check (track <> 'training' or subtopic_code is not null);

-- Рубрики: прежние семь плюс «ДЗ · список задач» — она есть только у
-- тренировки (у тем курса задание ДЗ живёт в topic_homework, §23.3).
alter table public.topic_material_items drop constraint if exists topic_material_items_section_check;
alter table public.topic_material_items add constraint topic_material_items_section_check
  check (section = any (array[
    'notes', 'theory', 'tasks',
    'task_solution',       -- Решение задач
    'worksheet_tasks',     -- Рабочий лист задач
    'worksheet_homework',  -- Рабочий лист ДЗ
    'solution',            -- Решение ДЗ (с гейтом, кроме тренировки)
    'homework_tasks'       -- ДЗ · список задач (только тренировка, §234)
  ]::text[]));

alter table public.topic_material_items drop constraint if exists topic_material_items_homework_tasks_training_check;
alter table public.topic_material_items add constraint topic_material_items_homework_tasks_training_check
  check (section is distinct from 'homework_tasks' or track = 'training');

create index if not exists topic_material_items_topic_track_idx
  on public.topic_material_items (topic_id, track);

-- ── 2. Скрытые подтемы — классное, в копии не переносится ───────────────────

create table if not exists public.topic_subtopic_hidden (
  topic_id      uuid not null references public.topics(id) on delete cascade,
  subtopic_code text not null,
  hidden_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (topic_id, subtopic_code)
);

comment on table public.topic_subtopic_hidden is
  'Подтемы тренировки, скрытые учителем для своего класса. Синхронизация каркаса эту таблицу не трогает. §234';

alter table public.topic_subtopic_hidden enable row level security;

-- Читают персонал курса и ученики курса (ученику нужно знать, что прятать;
-- материалы скрытой подтемы ему и так не отдаёт политика ниже).
drop policy if exists topic_subtopic_hidden_read on public.topic_subtopic_hidden;
create policy topic_subtopic_hidden_read on public.topic_subtopic_hidden
  for select to authenticated
  using (
    public.course_is_staff(public.course_of_topic(topic_id))
    or public.course_student_has_access(public.course_of_topic(topic_id))
  );

drop policy if exists topic_subtopic_hidden_insert on public.topic_subtopic_hidden;
create policy topic_subtopic_hidden_insert on public.topic_subtopic_hidden
  for insert to authenticated
  with check (
    public.course_is_staff(public.course_of_topic(topic_id))
    and hidden_by = auth.uid()
  );

drop policy if exists topic_subtopic_hidden_delete on public.topic_subtopic_hidden;
create policy topic_subtopic_hidden_delete on public.topic_subtopic_hidden
  for delete to authenticated
  using (public.course_is_staff(public.course_of_topic(topic_id)));

revoke all on public.topic_subtopic_hidden from anon;
grant select, insert, delete on public.topic_subtopic_hidden to authenticated;

-- Скрыта ли подтема. DEFINER — по той же причине, что topic_solution_unlocked:
-- в политике на строку материала подзапрос исполнялся бы под учеником.
create or replace function public.topic_subtopic_is_hidden(p_topic_id uuid, p_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from topic_subtopic_hidden h
     where h.topic_id = p_topic_id and h.subtopic_code = p_code
  );
$function$;

revoke all on function public.topic_subtopic_is_hidden(uuid, text) from public, anon;
grant execute on function public.topic_subtopic_is_hidden(uuid, text) to authenticated;

-- ── 3. Ученик: гейт решения не для тренировки, скрытые подтемы не видны ─────

drop policy if exists topic_material_items_student_select on public.topic_material_items;
create policy topic_material_items_student_select on public.topic_material_items
  for select to authenticated
  using (
    is_visible
    and public.course_student_can_see_topic(topic_id)
    and (section is distinct from 'solution'
         or track = 'training'
         or public.topic_solution_unlocked(topic_id))
    and (track <> 'training'
         or not public.topic_subtopic_is_hidden(topic_id, subtopic_code))
  );

-- Видимость файла (политика topic_material_files_read на storage.objects).
-- Тело — из 20260808181617, добавлено только `or i.track = 'training'` в гейт.
create or replace function public.topic_material_object_visible(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.topic_material_items i
     where i.storage_path = p_object_name
       and (
            public.topic_material_can_manage(i.topic_id)
         or (
              public.course_student_can_see_topic(i.topic_id)
              and (i.section is distinct from 'solution'
                   or i.track = 'training'
                   or public.topic_solution_unlocked(i.topic_id))
            )
       )
  );
$$;

-- Плашка «Решение пока закрыто» — только про решение ДЗ курса. Тело — из
-- 20260802000000, добавлено `and i.track = 'ege'`.
create or replace function public.topic_solution_state(p_topic_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'has_solution', exists (
      select 1 from topic_material_items i
       where i.topic_id = p_topic_id and i.section = 'solution' and i.is_visible
         and i.track = 'ege'
    ),
    'has_homework', exists (
      select 1 from topic_homework h where h.topic_id = p_topic_id
    ),
    'unlocked', public.topic_solution_unlocked(p_topic_id)
  );
$$;

-- ── 4. «Тема пройдена» — без тренировки (решение владельца №1) ──────────────
-- Тело — из 20260912212919, добавлено `and mi.track = 'ege'` в три проверки
-- «есть ли у темы группа». Без этого тема, где тренировка дала бы группу,
-- которой у курса нет (например «ДЗ» по рабочему листу тренировки), не
-- закрылась бы никогда. Клиентская пара (topicProgress) получает данные уже
-- без тренировки — все запросы материалов фильтруют track = 'ege'.

CREATE OR REPLACE FUNCTION public.topic_done_events()
 RETURNS TABLE(student_id uuid, topic_id uuid, done_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with task_totals as (
    select v.topic_id, count(tvi.id) as n
      from public.test_variants v
      join public.test_variant_items tvi on tvi.variant_id = v.id
     where v.topic_id is not null
     group by v.topic_id
  ),
  tg as (
    select t.id as topic_id,
      exists (
        select 1 from public.topic_material_items mi
         where mi.topic_id = t.id
           and (mi.kind = 'video' or mi.section in ('notes', 'theory'))
           and mi.track = 'ege'
      ) as has_theory,
      exists (
        select 1 from public.topic_material_items mi
         where mi.topic_id = t.id
           and mi.section in ('tasks', 'task_solution', 'worksheet_tasks')
           and mi.track = 'ege'
      ) as has_lesson,
      (
        exists (select 1 from public.topic_homework h where h.topic_id = t.id)
        or exists (
          select 1 from public.topic_material_items mi
           where mi.topic_id = t.id
             and mi.section in ('worksheet_homework', 'solution')
             and mi.track = 'ege'
        )
      ) as has_homework,
      coalesce((select tt.n from task_totals tt where tt.topic_id = t.id), 0) > 0 as has_tasks,
      coalesce((select tt.n from task_totals tt where tt.topic_id = t.id), 0) as tasks_total
    from public.topics t
  ),
  -- Кандидаты — те, кто хоть что-то сделал по теме. Принятой работой тоже:
  -- тема, у которой есть только группа ДЗ, отметок не имеет вовсе, и по одним
  -- отметкам такая пара потерялась бы. Задачи к уроку — тот же случай.
  cand as (
    select m.student_id, m.topic_id from public.topic_section_marks m
    union
    select a.student_id, h.topic_id
      from public.topic_homework_attempts a
      join public.topic_homework h on h.id = a.homework_id
     where a.status = 'accepted'
    union
    select tvsa.student_id, tva.topic_id
      from public.test_variant_answers ans
      join public.test_variant_student_assignments tvsa on tvsa.id = ans.student_assignment_id
      join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
     where tva.topic_id is not null
  ),
  ev as (
    select c.student_id, c.topic_id,
           tg.has_theory, tg.has_lesson, tg.has_homework, tg.has_tasks, tg.tasks_total,
           (select max(m.marked_at) from public.topic_section_marks m
             where m.student_id = c.student_id and m.topic_id = c.topic_id
               and m.group_key = 'theory') as theory_at,
           (select max(m.marked_at) from public.topic_section_marks m
             where m.student_id = c.student_id and m.topic_id = c.topic_id
               and m.group_key = 'lesson') as lesson_at,
           (select max(r.created_at) from public.topic_homework_reviews r
              join public.topic_homework_attempts a on a.id = r.attempt_id
              join public.topic_homework h on h.id = a.homework_id
             where a.student_id = c.student_id and h.topic_id = c.topic_id
               and a.status = 'accepted' and r.decision = 'accepted') as hw_at,
           -- Момент закрытия ПОСЛЕДНЕЙ задачи, и только если закрыты все.
           (select case
                     when count(*) filter (where ans.closed_by is not null) >= tg.tasks_total
                          and tg.tasks_total > 0
                     then max(ans.last_changed_at) filter (where ans.closed_by is not null)
                   end
              from public.test_variant_answers ans
              join public.test_variant_student_assignments tvsa on tvsa.id = ans.student_assignment_id
              join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
             where tva.topic_id = c.topic_id
               and tvsa.student_id = c.student_id) as tasks_at
      from cand c
      join tg on tg.topic_id = c.topic_id
  )
  select ev.student_id, ev.topic_id,
         -- День, когда тема стала пройденной, — момент ПОСЛЕДНЕГО из нужных
         -- событий. Ненужные группы обнуляются явно: случайная отметка по
         -- группе, которой у темы нет, не должна двигать дату вперёд.
         greatest(
           case when ev.has_theory   then ev.theory_at end,
           case when ev.has_lesson   then ev.lesson_at end,
           case when ev.has_homework then ev.hw_at     end,
           case when ev.has_tasks    then ev.tasks_at  end
         ) as done_at
    from ev
   where (ev.has_theory or ev.has_lesson or ev.has_homework or ev.has_tasks)
     and (not ev.has_theory   or ev.theory_at is not null)
     and (not ev.has_lesson   or ev.lesson_at is not null)
     and (not ev.has_homework or ev.hw_at     is not null)
     and (not ev.has_tasks    or ev.tasks_at  is not null);
$function$;

comment on function public.topic_done_events() is
  'Пары «ученик × пройденная тема» с датой. Задачи к уроку считаются по варианту-носителю темы. Тренировка (track = training) не считается. §152/§162/§164/§234';

-- ── 5. Каркас → классы: переносить дорожку и подтему ────────────────────────
-- Тело — из 20260913195011 (последнее определение, сверено оркестратором с
-- продом 27.09), добавлены track / subtopic_code / subtopic_title в UPDATE,
-- в сравнение IS DISTINCT FROM и в INSERT. Остальное не тронуто.

create or replace function public.template_sync_topic_apply(p_template_topic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_tpl        record;
  v_copy       record;
  v_tpl_var    record;
  v_copy_var   uuid;
  v_item       record;
  v_n          integer;
  v_copies     integer := 0;
  v_ins        integer := 0;
  v_upd        integer := 0;
  v_del        integer := 0;
  v_tasks_ins  integer := 0;
  v_tasks_del  integer := 0;
  v_kept       integer := 0;
  v_issues     integer := 0;
  v_maxpos     integer;
BEGIN
  SELECT t.id, t.title, t.order_index, t.max_score, m.course_id
    INTO v_tpl
    FROM public.topics t
    JOIN public.modules m ON m.id = t.module_id
   WHERE t.id = p_template_topic_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('copies', 0, 'skipped', 'no_topic');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.courses c WHERE c.id = v_tpl.course_id AND c.is_template) THEN
    RETURN jsonb_build_object('copies', 0, 'skipped', 'not_a_template');
  END IF;

  SELECT v.id, v.title, v.created_by INTO v_tpl_var
    FROM public.test_variants v WHERE v.topic_id = p_template_topic_id;

  FOR v_copy IN
    SELECT ct.id AS topic_id, cm.course_id
      FROM public.topics ct
      JOIN public.modules cm ON cm.id = ct.module_id
     WHERE ct.source_topic_id = p_template_topic_id
  LOOP
    v_copies := v_copies + 1;

    -- Прошлые расхождения по этой паре снимаем: плашка должна описывать
    -- сегодняшнее состояние, а не историю попыток.
    DELETE FROM public.template_sync_issues
     WHERE template_topic_id = p_template_topic_id AND copy_topic_id = v_copy.topic_id;

    -- 1. Сама тема: название, порядок, балл. Открытие и дата — классные.
    UPDATE public.topics
       SET title = v_tpl.title, order_index = v_tpl.order_index, max_score = v_tpl.max_score
     WHERE id = v_copy.topic_id
       AND (title, order_index, max_score) IS DISTINCT FROM (v_tpl.title, v_tpl.order_index, v_tpl.max_score);

    -- 2. Материалы. Сначала исчезнувшие в шаблоне.
    DELETE FROM public.topic_material_items ci
     WHERE ci.topic_id = v_copy.topic_id
       AND ci.source_item_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.topic_material_items ti
          WHERE ti.id = ci.source_item_id AND ti.topic_id = p_template_topic_id);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_del := v_del + v_n;

    UPDATE public.topic_material_items ci
       SET kind = ti.kind, title = ti.title, content = ti.content, url = ti.url,
           storage_path = ti.storage_path, file_name = ti.file_name,
           mime_type = ti.mime_type, size_bytes = ti.size_bytes,
           position = ti.position, is_visible = ti.is_visible, section = ti.section,
           track = ti.track, subtopic_code = ti.subtopic_code, subtopic_title = ti.subtopic_title,
           updated_at = now()
      FROM public.topic_material_items ti
     WHERE ti.id = ci.source_item_id
       AND ci.topic_id = v_copy.topic_id
       AND ti.topic_id = p_template_topic_id
       AND (ci.kind, ci.title, ci.content, ci.url, ci.storage_path, ci.file_name,
            ci.mime_type, ci.size_bytes, ci.position, ci.is_visible, ci.section,
            ci.track, ci.subtopic_code, ci.subtopic_title)
           IS DISTINCT FROM
           (ti.kind, ti.title, ti.content, ti.url, ti.storage_path, ti.file_name,
            ti.mime_type, ti.size_bytes, ti.position, ti.is_visible, ti.section,
            ti.track, ti.subtopic_code, ti.subtopic_title);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_upd := v_upd + v_n;

    -- Пути к файлам те же: копия ссылается на тот же объект (§101), никакой
    -- перезаливки — именно она когда-то стоила 584 МБ на один курс.
    INSERT INTO public.topic_material_items (
      topic_id, kind, title, content, url, storage_path, file_name, mime_type,
      size_bytes, position, is_visible, section, created_by, source_item_id,
      track, subtopic_code, subtopic_title)
    SELECT v_copy.topic_id, ti.kind, ti.title, ti.content, ti.url, ti.storage_path,
           ti.file_name, ti.mime_type, ti.size_bytes, ti.position, ti.is_visible,
           ti.section, coalesce(auth.uid(), ti.created_by), ti.id,
           ti.track, ti.subtopic_code, ti.subtopic_title
      FROM public.topic_material_items ti
     WHERE ti.topic_id = p_template_topic_id
       AND NOT EXISTS (
         SELECT 1 FROM public.topic_material_items ci
          WHERE ci.topic_id = v_copy.topic_id AND ci.source_item_id = ti.id);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_ins := v_ins + v_n;

    -- 3. Домашнее задание. `is_published` и `due_at` не переносятся: срок и
    --    публикация — решение класса, а не каркаса.
    PERFORM public.template_sync_homework(p_template_topic_id, v_copy.topic_id);

    -- 4. Задачи к уроку. Набор у темы один (§164), связь идёт через тему.
    IF v_tpl_var.id IS NOT NULL THEN
      SELECT id INTO v_copy_var FROM public.test_variants WHERE topic_id = v_copy.topic_id;

      IF v_copy_var IS NULL THEN
        INSERT INTO public.test_variants
          (title, subject, exam_type, status, created_by, settings, tasks_count, source_type, topic_id)
        SELECT v_tpl_var.title, c.subject, c.exam_type, 'ready',
               coalesce(auth.uid(), v_tpl_var.created_by), '{}'::jsonb, 0, 'teacher_assigned', v_copy.topic_id
          FROM public.courses c WHERE c.id = v_copy.course_id
        RETURNING id INTO v_copy_var;
      END IF;

      -- Убранное в шаблоне убираем и здесь — но не вместе с чужими ответами.
      FOR v_item IN
        SELECT ci.id, ci.task_id,
               (SELECT count(*) FROM public.test_variant_answers a WHERE a.variant_item_id = ci.id) AS answers
          FROM public.test_variant_items ci
         WHERE ci.variant_id = v_copy_var
           AND NOT EXISTS (
             SELECT 1 FROM public.test_variant_items ti
              WHERE ti.variant_id = v_tpl_var.id AND ti.task_id = ci.task_id)
      LOOP
        IF v_item.answers > 0 THEN
          v_kept := v_kept + 1;
          INSERT INTO public.template_sync_issues (template_topic_id, copy_topic_id, kind, detail)
          VALUES (p_template_topic_id, v_copy.topic_id, 'kept_with_answers',
                  format('Задача убрана из каркаса, но по ней уже есть ответы (%s) — осталась в классе', v_item.answers));
          v_issues := v_issues + 1;
        ELSE
          DELETE FROM public.test_variant_items WHERE id = v_item.id;
          v_tasks_del := v_tasks_del + 1;
        END IF;
      END LOOP;

      -- Позиции освобождаем целиком: (variant_id, position) уникальна, и
      -- переносить порядок «по месту» значит ловить конфликт на каждой второй.
      UPDATE public.test_variant_items SET position = -position - 1
       WHERE variant_id = v_copy_var;

      UPDATE public.test_variant_items ci
         SET position = ti.position, points = ti.points,
             grading_type = ti.grading_type, section_id = ti.section_id
        FROM public.test_variant_items ti
       WHERE ti.variant_id = v_tpl_var.id
         AND ci.variant_id = v_copy_var
         AND ci.task_id = ti.task_id;

      INSERT INTO public.test_variant_items (variant_id, task_id, position, section_id, points, grading_type)
      SELECT v_copy_var, ti.task_id, ti.position, ti.section_id, ti.points, ti.grading_type
        FROM public.test_variant_items ti
       WHERE ti.variant_id = v_tpl_var.id
         AND NOT EXISTS (
           SELECT 1 FROM public.test_variant_items ci
            WHERE ci.variant_id = v_copy_var AND ci.task_id = ti.task_id);
      GET DIAGNOSTICS v_n = ROW_COUNT; v_tasks_ins := v_tasks_ins + v_n;

      -- Оставшиеся в минусе — те, что удержали ответы. Ставим их в конец.
      SELECT coalesce(max(position), 0) INTO v_maxpos
        FROM public.test_variant_items WHERE variant_id = v_copy_var AND position >= 0;

      FOR v_item IN
        SELECT id FROM public.test_variant_items
         WHERE variant_id = v_copy_var AND position < 0 ORDER BY position DESC
      LOOP
        v_maxpos := v_maxpos + 1;
        UPDATE public.test_variant_items SET position = v_maxpos WHERE id = v_item.id;
      END LOOP;

      UPDATE public.test_variants
         SET tasks_count = (SELECT count(*) FROM public.test_variant_items WHERE variant_id = v_copy_var),
             updated_at = now()
       WHERE id = v_copy_var;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'copies', v_copies,
    'items_inserted', v_ins, 'items_updated', v_upd, 'items_deleted', v_del,
    'tasks_inserted', v_tasks_ins, 'tasks_deleted', v_tasks_del,
    'kept_with_answers', v_kept, 'issues', v_issues);
END;
$function$;

-- ── 6. Копирование курса/темы: те же три столбца ────────────────────────────
-- Тело — из 20260913195532. Без переноса копия класса получила бы строки
-- тренировки с track = 'ege' (умолчание), а «ДЗ · список задач» с 'ege'
-- отказала бы по CHECK — и копирование курса упало бы целиком.

create or replace function public.course_copy_topic_content(
  p_source_topic_id uuid,
  p_target_topic_id uuid,
  p_mode text,
  p_shift_days integer
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row record;
  v_hw_id uuid;
  v_new_hw_id uuid;
  v_variant_id uuid;
  v_new_variant_id uuid;
begin
  -- Перенос тумблера живёт здесь, а не в course_copy_stage и topic_copy_stage:
  -- обе зовут эту функцию сразу после вставки темы, и только тут есть оба
  -- идентификатора. Одно место — два пути копирования не разъедутся.
  --
  -- Правило: nullif(is_open, true) — false → false, true → null, null → null.
  update topics tgt
     set is_open = nullif(src.is_open, true)
    from topics src
   where tgt.id = p_target_topic_id
     and src.id = p_source_topic_id;

  -- Пути НЕ пересобираются: копия ссылается на тот же объект (§101).
  for v_row in
    select * from topic_material_items
     where topic_id = p_source_topic_id
     order by position, created_at
  loop
    insert into topic_material_items (
      topic_id, kind, title, content, url, storage_path,
      file_name, mime_type, size_bytes, position, is_visible, section,
      created_by, source_item_id, track, subtopic_code, subtopic_title
    ) values (
      p_target_topic_id, v_row.kind, v_row.title, v_row.content,
      v_row.url, v_row.storage_path, v_row.file_name, v_row.mime_type, v_row.size_bytes,
      v_row.position, v_row.is_visible, v_row.section, auth.uid(), v_row.id,
      v_row.track, v_row.subtopic_code, v_row.subtopic_title
    );
  end loop;

  select id into v_hw_id from topic_homework where topic_id = p_source_topic_id;
  if v_hw_id is not null then
    insert into topic_homework (topic_id, title, instructions, is_published, created_by, due_at, grade_scale, source_homework_id)
    select p_target_topic_id, title, instructions, false, auth.uid(),
           public.course_copy_shift_date(due_at, p_mode, p_shift_days), grade_scale, id
      from topic_homework where id = v_hw_id
    returning id into v_new_hw_id;

    for v_row in
      select * from topic_homework_files where homework_id = v_hw_id order by position
    loop
      insert into topic_homework_files (homework_id, storage_path, original_filename, mime_type, size_bytes, position, source_file_id)
      values (v_new_hw_id, v_row.storage_path, v_row.original_filename, v_row.mime_type, v_row.size_bytes, v_row.position, v_row.id);
    end loop;
  end if;

  insert into topic_test_assignments (test_id, topic_id, assigned_by)
  select test_id, p_target_topic_id, auth.uid()
    from topic_test_assignments where topic_id = p_source_topic_id;

  -- Задачи к уроку (§164). Своей линейки у набора нет: у темы он один, связь
  -- идёт через тему. Выдач не создаётся ни одной — в классе строка выдачи
  -- заведётся сама при первом обращении ученика.
  select id into v_variant_id from test_variants where topic_id = p_source_topic_id;

  if v_variant_id is not null
     and not exists (select 1 from test_variants where topic_id = p_target_topic_id)
  then
    insert into test_variants (
      title, description, subject, exam_type, status, created_by,
      settings, tasks_count, source_type, topic_id
    )
    select title, description, subject, exam_type, status, auth.uid(),
           settings, tasks_count, source_type, p_target_topic_id
      from test_variants where id = v_variant_id
    returning id into v_new_variant_id;

    insert into test_variant_items (
      variant_id, task_id, position, section_id, topic_id, points, grading_type
    )
    select v_new_variant_id, task_id, position, section_id, topic_id, points, grading_type
      from test_variant_items where variant_id = v_variant_id;
  end if;

  -- Дублировать нечего: фаза копирования файлов на клиенте остаётся пустой.
  return '[]'::jsonb;
end
$function$;

-- ── 7. Аналитика «неоткрытые материалы» — без тренировки ────────────────────
-- Тело — из 20260808220959, добавлено `where i.track = 'ege'`: 1 449 файлов
-- задачника в четырёх курсах заняли бы весь список «не открыто».

create or replace function public.school_unopened_materials(p_limit integer default 20)
returns table (
  topic_id     uuid,
  topic_title  text,
  course_title text,
  total_items  integer,
  unopened     integer,
  has_data     boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_has_data boolean := exists (select 1 from public.material_views);
begin
  if not exists (select 1 from public.my_staff_course_ids()) then
    raise exception 'NOT_STAFF_OF_ANY_COURSE' using errcode = 'P0001';
  end if;

  return query
  with mine as (select cid from public.my_staff_course_ids() as cid),
  items as (
    select i.id, t.id as tid, t.title as ttitle, c.title as ctitle
      from public.topic_material_items i
      join public.topics t  on t.id = i.topic_id
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
      join mine mm on mm.cid = c.id
     where i.track = 'ege'
  )
  select it.tid, it.ttitle, it.ctitle,
         count(*)::int,
         count(*) filter (
           where not exists (select 1 from public.material_views v where v.item_id = it.id)
         )::int,
         v_has_data
    from items it
   group by it.tid, it.ttitle, it.ctitle
  having count(*) filter (
           where not exists (select 1 from public.material_views v where v.item_id = it.id)
         ) > 0
   order by 5 desc
   limit p_limit;
end;
$fn$;
