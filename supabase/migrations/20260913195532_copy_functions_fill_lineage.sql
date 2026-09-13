-- Копирование сразу заводит линейку (§172).
--
-- Иначе класс, скопированный завтра, снова окажется снимком: линейка есть
-- только у семи нынешних копий, заполненных задним числом. Проставляем её при
-- любом копировании, не только из каркаса — связь от любого источника
-- безвредна, а синхронизация смотрит только на `courses.is_template`.

create or replace function public.course_copy_stage(
  p_source_course_id uuid,
  p_title text default null::text,
  p_mode text default 'clear'::text,
  p_shift_days integer default 0
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid := auth.uid();
  v_src courses%rowtype;
  v_new_course uuid;
  v_module record;
  v_topic record;
  v_new_module uuid;
  v_new_topic uuid;
  v_files jsonb := '[]'::jsonb;
  v_job uuid;
begin
  if v_me is null then raise exception 'Требуется вход в аккаунт' using errcode='insufficient_privilege'; end if;
  if p_mode not in ('clear','keep','shift') then raise exception 'Неизвестный режим дат' using errcode='check_violation'; end if;

  select * into v_src from courses where id = p_source_course_id;
  if not found then raise exception 'Курс не найден'; end if;

  -- Копировать курс целиком может владелец курса или админ платформы.
  -- Преподавателю чужого курса это не по чину: копия создаётся на него же
  -- владельцем, а значит меняет состав владельцев в школе.
  if not (public.auth_is_course_owner(p_source_course_id) or public.course_is_admin()) then
    raise exception 'Копировать курс может только его владелец' using errcode='insufficient_privilege';
  end if;

  insert into courses (
    title, subject, exam_type, description, price, duration_weeks,
    is_active, is_draft, owner_id,
    start_date, end_date, enrollment_open_until,
    is_template, copied_from_course_id
  ) values (
    coalesce(nullif(btrim(p_title), ''), v_src.title || ' (копия)'),
    v_src.subject, v_src.exam_type, v_src.description, v_src.price, v_src.duration_weeks,
    -- Черновик и неактивен: недоделанная копия не должна всплыть у учеников.
    false, true, v_me,
    public.course_copy_shift_date(v_src.start_date, p_mode, p_shift_days),
    public.course_copy_shift_date(v_src.end_date, p_mode, p_shift_days),
    public.course_copy_shift_date(v_src.enrollment_open_until, p_mode, p_shift_days),
    false, p_source_course_id
  ) returning id into v_new_course;

  for v_module in select * from modules where course_id = p_source_course_id order by order_index loop
    -- Линейка (§172): модуль копии знает свой источник.
    insert into modules (course_id, title, order_index, source_module_id)
    values (v_new_course, v_module.title, v_module.order_index, v_module.id)
    returning id into v_new_module;

    for v_topic in select * from topics where module_id = v_module.id order by order_index loop
      insert into topics (module_id, title, order_index, max_score, available_from, source_topic_id)
      values (v_new_module, v_topic.title, v_topic.order_index, v_topic.max_score,
              public.course_copy_shift_date(v_topic.available_from, p_mode, p_shift_days),
              v_topic.id)
      returning id into v_new_topic;

      v_files := v_files || public.course_copy_topic_content(v_topic.id, v_new_topic, p_mode, p_shift_days);
    end loop;
  end loop;

  insert into course_copy_jobs (requested_by, source_course_id, target_course_id, kind, files)
  values (v_me, p_source_course_id, v_new_course, 'course', v_files)
  returning id into v_job;

  return jsonb_build_object('job_id', v_job, 'course_id', v_new_course, 'files', v_files);
end
$function$;

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
      created_by, source_item_id
    ) values (
      p_target_topic_id, v_row.kind, v_row.title, v_row.content,
      v_row.url, v_row.storage_path, v_row.file_name, v_row.mime_type, v_row.size_bytes,
      v_row.position, v_row.is_visible, v_row.section, auth.uid(), v_row.id
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

create or replace function public.topic_copy_stage(
  p_source_topic_id uuid,
  p_target_module_id uuid,
  p_mode text default 'clear'::text,
  p_shift_days integer default 0
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid := auth.uid();
  v_src topics%rowtype;
  v_target_course uuid;
  v_new_topic uuid;
  v_files jsonb;
  v_job uuid;
begin
  if v_me is null then raise exception 'Требуется вход в аккаунт' using errcode='insufficient_privilege'; end if;
  if p_mode not in ('clear','keep','shift') then raise exception 'Неизвестный режим дат' using errcode='check_violation'; end if;

  select * into v_src from topics where id = p_source_topic_id;
  if not found then raise exception 'Тема не найдена'; end if;

  select course_id into v_target_course from modules where id = p_target_module_id;
  if v_target_course is null then raise exception 'Модуль-приёмник не найден'; end if;

  -- Права проверяем с ОБЕИХ сторон: читать исходную тему и добавлять в
  -- целевой курс. Одной проверки мало — иначе можно было бы утащить чужой
  -- материал в свой курс или, наоборот, засорить чужой своим.
  if not public.topic_material_can_manage(p_source_topic_id) then
    raise exception 'Нет прав на исходную тему' using errcode='insufficient_privilege';
  end if;
  if not public.course_is_teacher_staff(v_target_course) then
    raise exception 'Нет прав добавлять темы в курс-приёмник' using errcode='insufficient_privilege';
  end if;

  insert into topics (module_id, title, order_index, max_score, available_from, source_topic_id)
  values (
    p_target_module_id, v_src.title,
    (select coalesce(max(t.order_index), -1) + 1 from topics t where t.module_id = p_target_module_id),
    v_src.max_score,
    public.course_copy_shift_date(v_src.available_from, p_mode, p_shift_days),
    p_source_topic_id
  ) returning id into v_new_topic;

  v_files := public.course_copy_topic_content(p_source_topic_id, v_new_topic, p_mode, p_shift_days);

  insert into course_copy_jobs (requested_by, source_topic_id, target_course_id, target_topic_id, kind, files)
  values (v_me, p_source_topic_id, v_target_course, v_new_topic, 'topic', v_files)
  returning id into v_job;

  return jsonb_build_object('job_id', v_job, 'topic_id', v_new_topic, 'course_id', v_target_course, 'files', v_files);
end
$function$;
