-- ============================================================
-- Копирование материалов роняло всю операцию на курсах, где
-- материалы вообще есть.
--
-- `topic_material_items.source_topic_material_id` ссылается не на
-- соседнюю строку той же таблицы, а на СТАРУЮ таблицу `topic_materials`:
-- это след июльского переезда, «из какой легаси-записи материал перенесён».
-- Копия подставляла туда id исходного элемента `topic_material_items` —
-- внешний ключ такого не принимал:
--   violates foreign key constraint
--   "topic_material_items_source_topic_material_id_fkey"
--
-- Протащить значение из оригинала тоже нельзя: на колонке висит
-- UNIQUE-индекс `topic_material_items_source_uniq` — он и был защитой от
-- повторного переноса легаси-материалов. Две строки с одним источником
-- поссорились бы на нём.
--
-- Правильное значение — NULL: копия не перенесена из легаси-записи, она
-- сделана с другого элемента. Родословную копии никто не спрашивает.
--
-- Заодно обнуляется `lesson_id`. Он указывал на занятие ИСХОДНОГО курса —
-- в копии эта ссылка ведёт в чужой курс. Колонка осталась от прежнего имени
-- таблицы (`course_lesson_materials`), материалы давно живут на теме.
--
-- Почему не поймали раньше: проверяли на курсе без материалов. В нём этот
-- цикл просто не выполнялся ни разу.
-- ============================================================

create or replace function public.course_copy_topic_content(
  p_source_topic_id uuid,
  p_target_topic_id uuid,
  p_mode text,
  p_shift_days integer
) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_files jsonb := '[]'::jsonb;
  v_row record;
  v_new_path text;
  v_hw_id uuid;
  v_new_hw_id uuid;
begin
  -- 1. Материалы темы: конспект, теория, задачи, решение, видео, ссылки.
  --    Скрытые (is_visible = false) тоже — это заготовки преподавателя,
  --    терять их при копировании курса было бы обидно.
  for v_row in
    select * from topic_material_items
     where topic_id = p_source_topic_id
     order by position, created_at
  loop
    v_new_path := null;
    if v_row.storage_path is not null then
      -- Первый сегмент — id новой темы, иначе RLS не пустит (см. шапку).
      v_new_path := p_target_topic_id::text || '/' ||
                    gen_random_uuid()::text || '-' ||
                    regexp_replace(v_row.storage_path, '^.*/', '');
      v_files := v_files || jsonb_build_object(
        'bucket', 'topic-materials',
        'from', v_row.storage_path,
        'to', v_new_path
      );
    end if;

    -- source_topic_material_id и lesson_id намеренно не переносятся, см. шапку.
    insert into topic_material_items (
      topic_id, kind, title, content, url, storage_path,
      file_name, mime_type, size_bytes, position, is_visible, section,
      created_by
    ) values (
      p_target_topic_id, v_row.kind, v_row.title, v_row.content,
      v_row.url, v_new_path, v_row.file_name, v_row.mime_type, v_row.size_bytes,
      v_row.position, v_row.is_visible, v_row.section, auth.uid()
    );
  end loop;

  -- 2. Домашнее задание темы вместе с файлами задания.
  --    Публикацию сбрасываем: копия не должна автоматически стать видимой
  --    ученикам нового курса до того, как её посмотрели.
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
      v_new_path := p_target_topic_id::text || '/' ||
                    gen_random_uuid()::text || '-' ||
                    regexp_replace(v_row.storage_path, '^.*/', '');
      v_files := v_files || jsonb_build_object(
        'bucket', 'topic-homework',
        'from', v_row.storage_path,
        'to', v_new_path
      );
      insert into topic_homework_files (homework_id, storage_path, original_filename, mime_type, size_bytes, position)
      values (v_new_hw_id, v_new_path, v_row.original_filename, v_row.mime_type, v_row.size_bytes, v_row.position);
    end loop;
  end if;

  -- 3. Привязки тестов. Сам тест остаётся ОДИН в банке — копируется только
  --    привязка к теме, иначе банк за год зарастёт дублями одного теста.
  insert into topic_test_assignments (test_id, topic_id, assigned_by)
  select test_id, p_target_topic_id, auth.uid()
    from topic_test_assignments where topic_id = p_source_topic_id;

  return v_files;
end $$;

revoke all on function public.course_copy_topic_content(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.course_copy_topic_content(uuid, uuid, text, integer) to service_role;
