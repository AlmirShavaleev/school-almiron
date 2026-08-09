-- §101. Копия курса и копия темы больше не дублируют объекты хранилища.
--
-- Обе ветки копирования (курс целиком и одна тема) сходятся здесь, поэтому
-- правка одна: строка копии получает ТОТ ЖЕ storage_path, а список файлов на
-- дублирование возвращается пустым — фаза 2 на клиенте становится пустой.
create or replace function public.course_copy_topic_content(
  p_source_topic_id uuid,
  p_target_topic_id uuid,
  p_mode text,
  p_shift_days integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_hw_id uuid;
  v_new_hw_id uuid;
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

  -- Дублировать нечего: фаза копирования файлов на клиенте остаётся пустой.
  return '[]'::jsonb;
end
$$;

comment on function public.course_copy_topic_content(uuid, uuid, text, integer) is
  'Наполнение темы при копировании. Файлы НЕ дублируются: строка копии '
  'ссылается на тот же объект хранилища, счёт ссылок — storage_path_refs (§101).';

-- ── Удаление курса не должно выбивать файлы у тех, кто на них ссылается ─────
create or replace function public.course_delete_execute(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c courses%rowtype;
  v_files jsonb;
  v_students int;
  v_transactions int;
begin
  if auth.uid() is null then raise exception 'Требуется вход в аккаунт' using errcode='insufficient_privilege'; end if;

  select * into v_c from courses where id = p_course_id;
  if not found then raise exception 'Курс не найден'; end if;

  if not (public.auth_is_course_owner(p_course_id) or public.course_is_admin()) then
    raise exception 'Удалить курс может только его владелец' using errcode='insufficient_privilege';
  end if;

  if v_c.is_active and not v_c.is_draft then
    raise exception 'Сначала уберите курс в архив: удалять можно только архивные курсы и черновики'
      using errcode='check_violation';
  end if;

  select count(*) into v_students from student_courses where course_id = p_course_id;
  if v_students > 0 then
    raise exception 'На курсе % ученик(ов). Сначала отчислите их, потом удаляйте курс', v_students
      using errcode='foreign_key_violation';
  end if;

  select count(*) into v_transactions
    from transactions tr join lessons l on l.id = tr.lesson_id where l.course_id = p_course_id;
  if v_transactions > 0 then
    raise exception 'За уроками курса числится % денежных операц(ий). Удалять такой курс нельзя', v_transactions
      using errcode='check_violation';
  end if;

  v_files := public.course_storage_files(p_course_id);

  perform set_config('app.course_delete', 'on', true);

  delete from homeworks h
   using topics t join modules m on m.id = t.module_id
   where h.topic_id = t.id and m.course_id = p_course_id;

  delete from lessons where course_id = p_course_id;
  delete from groups  where course_id = p_course_id;

  delete from courses where id = p_course_id;

  -- Список на удаление фильтруется ПОСЛЕ удаления строк курса: то, на что ещё
  -- кто-то ссылается, принадлежит шаблону или другой копии. Считать до удаления
  -- нельзя — там ссылается сам удаляемый курс, и не осталось бы ничего (§101).
  select coalesce(jsonb_agg(f), '[]'::jsonb)
    into v_files
    from jsonb_array_elements(v_files) f
   where public.storage_path_refs(f->>'bucket', f->>'path') = 0;

  return jsonb_build_object('course_id', p_course_id, 'title', v_c.title, 'files', v_files);
end
$$;

grant execute on function public.course_delete_execute(uuid) to authenticated;
