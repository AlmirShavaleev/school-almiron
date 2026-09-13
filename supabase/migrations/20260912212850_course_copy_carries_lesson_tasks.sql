-- Копия курса везёт задачи к уроку (§164).
--
-- Рабочий приём владельца — «заполнил курс-шаблон, скопировал класс» — для
-- задач не работал: копирование переносит материалы, ДЗ и тесты из банка, а
-- набор задач к уроку не переносила ни одна миграция. Задачи, прикреплённые в
-- шаблоне, в копии класса просто не появлялись.
--
-- Копия получает СВОЙ набор, а не ссылку на шаблонный: иначе правка шаблона
-- задним числом меняла бы задачи во всех классах, скопированных раньше.
-- Так же копируется и весь остальной контент темы.
--
-- Выдач не создаётся ни одной — ни группам, ни ученикам, — и потому в момент
-- копирования никому ничего не уходит. В классе строка выдачи заведётся сама
-- при первом обращении ученика к задачам темы (`ensure_topic_task_rows`).

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
  -- Копия курса делается на новый год со сдвигом дат; тема, рождённая true,
  -- сдвиг бы проигнорировала. Правило НИКОГДА не расширяет доступ: true → null
  -- даёт либо то же самое (даты нет), либо уже (дата в будущем).
  update topics tgt
     set is_open = nullif(src.is_open, true)
    from topics src
   where tgt.id = p_target_topic_id
     and src.id = p_source_topic_id;

  -- Пути НЕ пересобираются: копия ссылается на тот же объект (§101). Раньше
  -- здесь строился путь вида «id новой темы / uuid-имя», и клиент физически
  -- перезаливал каждый файл — копия «Физики ЕГЭ» стоила 584 МБ побайтно
  -- одинаковых данных. Права больше не выводятся из первой папки пути:
  -- политика чтения спрашивает ссылающиеся строки (topic_material_object_visible).
  for v_row in
    select * from topic_material_items
     where topic_id = p_source_topic_id
     order by position, created_at
  loop
    insert into topic_material_items (
      topic_id, kind, title, content, url, storage_path,
      file_name, mime_type, size_bytes, position, is_visible, section,
      created_by
    ) values (
      p_target_topic_id, v_row.kind, v_row.title, v_row.content,
      v_row.url, v_row.storage_path, v_row.file_name, v_row.mime_type, v_row.size_bytes,
      v_row.position, v_row.is_visible, v_row.section, auth.uid()
    );
  end loop;

  select id into v_hw_id from topic_homework where topic_id = p_source_topic_id;
  if v_hw_id is not null then
    insert into topic_homework (topic_id, title, instructions, is_published, created_by, due_at, grade_scale)
    select p_target_topic_id, title, instructions, false, auth.uid(),
           public.course_copy_shift_date(due_at, p_mode, p_shift_days), grade_scale
      from topic_homework where id = v_hw_id
    returning id into v_new_hw_id;

    for v_row in
      select * from topic_homework_files where homework_id = v_hw_id order by position
    loop
      insert into topic_homework_files (homework_id, storage_path, original_filename, mime_type, size_bytes, position)
      values (v_new_hw_id, v_row.storage_path, v_row.original_filename, v_row.mime_type, v_row.size_bytes, v_row.position);
    end loop;
  end if;

  insert into topic_test_assignments (test_id, topic_id, assigned_by)
  select test_id, p_target_topic_id, auth.uid()
    from topic_test_assignments where topic_id = p_source_topic_id;

  -- Задачи к уроку. Условие про целевую тему — на случай повторного прогона:
  -- набор у темы один (частичный уникальный индекс), второй класть некуда.
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

comment on function public.course_copy_topic_content(uuid, uuid, text, integer) is
  'Переносит содержимое темы в копию: материалы, ДЗ, тест из банка и задачи к уроку. Выдач не создаёт. §164';
