-- ============================================================
-- Копирование курса и отдельной темы (решение владельца, 2026-08-01)
-- ============================================================
-- Зачем. Курс на следующий год пересобирался руками: модули, темы, конспекты,
-- задания. Копия делает НЕЗАВИСИМЫЙ дубликат: структура и всё наполнение тем
-- переезжают, люди — нет. Ученики, их работы, попытки, оценки и кураторы не
-- копируются; ссылка-приглашение у нового курса выпускается своя, старый код
-- на него не действует.
--
-- Почему три фазы, а не одна RPC. Файлы материалов лежат в Storage, и
-- скопировать объект изнутри Postgres нельзя — это делает клиент вызовом
-- storage copy. Поэтому: stage создаёт строки и возвращает список файлов,
-- клиент копирует объекты, finalize закрывает задание. Если копирование
-- сорвалось на середине — rollback сносит созданное, чтобы не оставлять
-- половину курса с ссылками на несуществующие файлы. Тот же приём уже
-- использован для копирования уроков из библиотеки (stage_lesson_copy).
--
-- КЛЮЧЕВОЕ ограничение путей. RLS на storage.objects разбирает ПЕРВЫЙ сегмент
-- пути как id темы: (storage.foldername(name))[1]. Значит новый путь обязан
-- начинаться с id НОВОЙ темы, иначе преподаватель не сможет ни записать
-- копию, ни потом её прочитать. Пути ниже строятся именно так.

-- ── Журнал заданий копирования ──────────────────────────────
create table public.course_copy_jobs (
  id               uuid primary key default gen_random_uuid(),
  requested_by     uuid not null references public.profiles(id) on delete restrict,
  source_course_id uuid references public.courses(id) on delete set null,
  source_topic_id  uuid references public.topics(id)  on delete set null,
  target_course_id uuid references public.courses(id) on delete cascade,
  target_topic_id  uuid references public.topics(id)  on delete cascade,
  -- Что именно создано: курс целиком или одна тема. Нужно rollback-у,
  -- чтобы знать, что сносить.
  kind             text not null check (kind in ('course', 'topic')),
  status           text not null default 'staged' check (status in ('staged', 'finalized', 'rolled_back')),
  files            jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.course_copy_jobs is
  'Задание копирования курса или темы. files — список объектов Storage, которые клиент должен скопировать между фазами stage и finalize.';

alter table public.course_copy_jobs enable row level security;
grant select on public.course_copy_jobs to authenticated;

-- Видит только тот, кто сам запросил копирование: чужие задания не его дело.
create policy course_copy_jobs_own_select on public.course_copy_jobs
  for select to authenticated
  using (requested_by = auth.uid());
-- Пишут только RPC ниже (security definer).

-- ── Сдвиг дат ───────────────────────────────────────────────
-- Три режима на все даты сразу: очистить, оставить как есть, сдвинуть.
-- Сдвиг — то, ради чего копию обычно и делают: курс на следующий год
-- уезжает целиком, сохраняя взаимный порядок тем и дедлайнов.
create or replace function public.course_copy_shift_date(
  p_date date, p_mode text, p_shift_days integer
) returns date
language sql immutable as $$
  select case
    when p_date is null then null
    when p_mode = 'clear' then null
    when p_mode = 'shift' then p_date + coalesce(p_shift_days, 0)
    else p_date
  end;
$$;

-- ── Копирование наполнения одной темы ───────────────────────
-- Общая часть для копии курса и копии отдельной темы. Возвращает список
-- файлов к копированию: [{bucket, from, to}].
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

    insert into topic_material_items (
      topic_id, lesson_id, kind, title, content, url, storage_path,
      file_name, mime_type, size_bytes, position, is_visible, section,
      created_by, source_topic_material_id
    ) values (
      p_target_topic_id, v_row.lesson_id, v_row.kind, v_row.title, v_row.content,
      v_row.url, v_new_path, v_row.file_name, v_row.mime_type, v_row.size_bytes,
      v_row.position, v_row.is_visible, v_row.section, auth.uid(), v_row.id
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

-- ── Фаза 1: копия курса ─────────────────────────────────────
create or replace function public.course_copy_stage(
  p_source_course_id uuid,
  p_title text default null,
  p_mode text default 'clear',
  p_shift_days integer default 0
) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
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
    start_date, end_date, enrollment_open_until
  ) values (
    coalesce(nullif(btrim(p_title), ''), v_src.title || ' (копия)'),
    v_src.subject, v_src.exam_type, v_src.description, v_src.price, v_src.duration_weeks,
    -- Черновик и неактивен: недоделанная копия не должна всплыть у учеников.
    false, true, v_me,
    public.course_copy_shift_date(v_src.start_date, p_mode, p_shift_days),
    public.course_copy_shift_date(v_src.end_date, p_mode, p_shift_days),
    public.course_copy_shift_date(v_src.enrollment_open_until, p_mode, p_shift_days)
  ) returning id into v_new_course;

  for v_module in select * from modules where course_id = p_source_course_id order by order_index loop
    insert into modules (course_id, title, order_index)
    values (v_new_course, v_module.title, v_module.order_index)
    returning id into v_new_module;

    for v_topic in select * from topics where module_id = v_module.id order by order_index loop
      insert into topics (module_id, title, order_index, max_score, available_from)
      values (v_new_module, v_topic.title, v_topic.order_index, v_topic.max_score,
              public.course_copy_shift_date(v_topic.available_from, p_mode, p_shift_days))
      returning id into v_new_topic;

      v_files := v_files || public.course_copy_topic_content(v_topic.id, v_new_topic, p_mode, p_shift_days);
    end loop;
  end loop;

  insert into course_copy_jobs (requested_by, source_course_id, target_course_id, kind, files)
  values (v_me, p_source_course_id, v_new_course, 'course', v_files)
  returning id into v_job;

  return jsonb_build_object('job_id', v_job, 'course_id', v_new_course, 'files', v_files);
end $$;

-- ── Фаза 1: копия одной темы в другой курс ──────────────────
create or replace function public.topic_copy_stage(
  p_source_topic_id uuid,
  p_target_module_id uuid,
  p_mode text default 'clear',
  p_shift_days integer default 0
) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
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
  if not public.course_is_staff(v_target_course) then
    raise exception 'Нет прав на курс-приёмник' using errcode='insufficient_privilege';
  end if;

  insert into topics (module_id, title, order_index, max_score, available_from)
  values (
    p_target_module_id, v_src.title,
    (select coalesce(max(t.order_index), -1) + 1 from topics t where t.module_id = p_target_module_id),
    v_src.max_score,
    public.course_copy_shift_date(v_src.available_from, p_mode, p_shift_days)
  ) returning id into v_new_topic;

  v_files := public.course_copy_topic_content(p_source_topic_id, v_new_topic, p_mode, p_shift_days);

  insert into course_copy_jobs (requested_by, source_topic_id, target_course_id, target_topic_id, kind, files)
  values (v_me, p_source_topic_id, v_target_course, v_new_topic, 'topic', v_files)
  returning id into v_job;

  return jsonb_build_object('job_id', v_job, 'topic_id', v_new_topic, 'course_id', v_target_course, 'files', v_files);
end $$;

-- ── Фаза 3: закрыть задание ─────────────────────────────────
create or replace function public.course_copy_finalize(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_job course_copy_jobs%rowtype;
begin
  select * into v_job from course_copy_jobs where id = p_job_id and requested_by = auth.uid();
  if not found then raise exception 'Задание копирования не найдено' using errcode='insufficient_privilege'; end if;
  if v_job.status <> 'staged' then raise exception 'Задание уже закрыто' using errcode='check_violation'; end if;

  update course_copy_jobs set status = 'finalized', updated_at = now() where id = p_job_id;
  return jsonb_build_object('job_id', p_job_id, 'status', 'finalized',
                            'course_id', v_job.target_course_id, 'topic_id', v_job.target_topic_id);
end $$;

-- ── Фаза 3': откат ──────────────────────────────────────────
-- Половина курса со ссылками на несуществующие файлы хуже, чем ничего:
-- преподаватель будет думать, что материалы есть, и обнаружит пустоту в
-- худший момент. Поэтому при сбое копирования файлов сносим созданное.
create or replace function public.course_copy_rollback(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_job course_copy_jobs%rowtype;
begin
  select * into v_job from course_copy_jobs where id = p_job_id and requested_by = auth.uid();
  if not found then raise exception 'Задание копирования не найдено' using errcode='insufficient_privilege'; end if;
  if v_job.status <> 'staged' then raise exception 'Задание уже закрыто' using errcode='check_violation'; end if;

  if v_job.kind = 'course' and v_job.target_course_id is not null then
    -- Копия всегда черновик без учеников, каскады доделают остальное.
    delete from courses where id = v_job.target_course_id;
  elsif v_job.kind = 'topic' and v_job.target_topic_id is not null then
    delete from topics where id = v_job.target_topic_id;
  end if;

  update course_copy_jobs set status = 'rolled_back', updated_at = now() where id = p_job_id;
  return jsonb_build_object('job_id', p_job_id, 'status', 'rolled_back');
end $$;

-- ── Гранты ──────────────────────────────────────────────────
revoke all on function public.course_copy_topic_content(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.course_copy_shift_date(date, text, integer)          from public, anon, authenticated;
grant execute on function public.course_copy_shift_date(date, text, integer)       to authenticated, service_role;

grant execute on function public.course_copy_stage(uuid, text, text, integer)      to authenticated;
grant execute on function public.topic_copy_stage(uuid, uuid, text, integer)       to authenticated;
grant execute on function public.course_copy_finalize(uuid)                        to authenticated;
grant execute on function public.course_copy_rollback(uuid)                        to authenticated;
