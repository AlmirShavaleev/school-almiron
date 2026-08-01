-- ============================================================
-- Удаление курса.
--
-- Курс — вершина большого дерева: модули → темы → материалы, домашние
-- задания, сданные работы, проверки, разметка ИИ. Каскады в схеме уже
-- расставлены, поэтому `delete from courses` физически сносит всё это одной
-- строкой. Именно поэтому кнопки удаления до сих пор не было: слишком легко
-- потерять то, чего не собирался терять.
--
-- Схема из двух шагов, как у копирования:
--   1. course_delete_preview  — только считает и ничего не трогает. Диалог
--      показывает точные числа: сколько тем, ДЗ, сданных работ и файлов
--      исчезнет. «Вы уверены?» без чисел — это не предупреждение.
--   2. course_delete_execute  — сносит курс и ВОЗВРАЩАЕТ список файлов в
--      хранилище. Удалить объект из Postgres нельзя, это делает клиент.
--
-- Порядок именно такой: сначала база, потом файлы. Наоборот было бы хуже —
-- при сбое на середине остался бы живой курс со ссылками в пустоту. Осиротевшие
-- файлы — это потраченное место (после июльской истории с квотой их чистим
-- сразу), а битые ссылки — это сломанный курс.
--
-- Два случая, когда удалять нельзя, и оба проверяются явно, до удаления:
--   • на курсе есть ученики — `student_courses` стоит на ON DELETE RESTRICT,
--     и без явной проверки преподаватель увидел бы сырое сообщение Postgres
--     про нарушение внешнего ключа;
--   • за уроками курса числятся денежные операции — их обнулять втихую нельзя.
-- ============================================================

-- ── Сбор файлов курса ───────────────────────────────────────
-- Материалы лежат в трёх бакетах: путь — единственный способ отличить
-- поколения (см. bucketForMaterialPath в src/lib/topicMaterialItems.ts).
create or replace function public.course_storage_files(p_course_id uuid)
returns jsonb
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object(
             'bucket',
             case
               when i.storage_path like t.id::text || '/%' then 'topic-materials'
               when i.storage_path like 'topics/%'         then 'course-materials'
               else 'course-lesson-materials'
             end,
             'path', i.storage_path) as x
      from topic_material_items i
      join topics t  on t.id = i.topic_id
      join modules m on m.id = t.module_id
     where m.course_id = p_course_id and i.storage_path is not null

    union all
    select jsonb_build_object('bucket', 'topic-homework', 'path', f.storage_path)
      from topic_homework_files f
      join topic_homework h on h.id = f.homework_id
      join topics t  on t.id = h.topic_id
      join modules m on m.id = t.module_id
     where m.course_id = p_course_id and f.storage_path is not null

    union all
    select jsonb_build_object('bucket', 'topic-homework-attempts', 'path', af.storage_path)
      from topic_homework_attempt_files af
      join topic_homework_attempts a on a.id = af.attempt_id
      join topic_homework h on h.id = a.homework_id
      join topics t  on t.id = h.topic_id
      join modules m on m.id = t.module_id
     where m.course_id = p_course_id and af.storage_path is not null
  ) s;
$$;

-- ── Шаг 1: что именно исчезнет ──────────────────────────────
create or replace function public.course_delete_preview(p_course_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_c courses%rowtype;
  v_students int;
  v_transactions int;
  v_blockers jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Требуется вход в аккаунт' using errcode='insufficient_privilege'; end if;

  select * into v_c from courses where id = p_course_id;
  if not found then raise exception 'Курс не найден'; end if;

  if not (public.auth_is_course_owner(p_course_id) or public.course_is_admin()) then
    raise exception 'Удалить курс может только его владелец' using errcode='insufficient_privilege';
  end if;

  select count(*) into v_students from student_courses where course_id = p_course_id;
  select count(*) into v_transactions
    from transactions tr join lessons l on l.id = tr.lesson_id where l.course_id = p_course_id;

  if v_students > 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'students', 'count', v_students);
  end if;
  if v_transactions > 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'transactions', 'count', v_transactions);
  end if;
  if v_c.is_active and not v_c.is_draft then
    v_blockers := v_blockers || jsonb_build_object('code', 'active', 'count', 1);
  end if;

  return jsonb_build_object(
    'course_id', v_c.id,
    'title', v_c.title,
    'blockers', v_blockers,
    'counts', jsonb_build_object(
      'modules',  (select count(*) from modules where course_id = p_course_id),
      'topics',   (select count(*) from topics t join modules m on m.id = t.module_id where m.course_id = p_course_id),
      'materials',(select count(*) from topic_material_items i join topics t on t.id = i.topic_id
                     join modules m on m.id = t.module_id where m.course_id = p_course_id),
      'homework', (select count(*) from topic_homework h join topics t on t.id = h.topic_id
                     join modules m on m.id = t.module_id where m.course_id = p_course_id),
      'attempts', (select count(*) from topic_homework_attempts a join topic_homework h on h.id = a.homework_id
                     join topics t on t.id = h.topic_id join modules m on m.id = t.module_id
                    where m.course_id = p_course_id),
      'groups',   (select count(*) from groups where course_id = p_course_id),
      'lessons',  (select count(*) from lessons where course_id = p_course_id),
      'files',    jsonb_array_length(public.course_storage_files(p_course_id))
    )
  );
end $$;

-- ── Шаг 2: снести и вернуть файлы на зачистку ───────────────
create or replace function public.course_delete_execute(p_course_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
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

  -- Действующий курс удалить нельзя: сначала архив или черновик. Лишний шаг
  -- стоит дёшево, а промах по рабочему курсу — нет.
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

  -- Список файлов собираем ДО удаления: после каскада собирать будет негде.
  v_files := public.course_storage_files(p_course_id);

  -- Легаси-таблица homeworks висит на темах через ON DELETE RESTRICT и одна
  -- способна заблокировать удаление. Контур мёртв (см. §35.3), сносим явно.
  delete from homeworks h
   using topics t join modules m on m.id = t.module_id
   where h.topic_id = t.id and m.course_id = p_course_id;

  -- Группы и уроки курса удаляем сами: внешние ключи у них ON DELETE SET NULL,
  -- то есть по умолчанию остались бы висеть без курса и мозолить глаза в
  -- списках. Ученики при этом никуда не деваются — исчезает только их
  -- членство в группе удаляемого курса.
  delete from lessons where course_id = p_course_id;
  delete from groups  where course_id = p_course_id;

  delete from courses where id = p_course_id;

  return jsonb_build_object('course_id', p_course_id, 'title', v_c.title, 'files', v_files);
end $$;

-- ── Гранты ──────────────────────────────────────────────────
revoke all on function public.course_storage_files(uuid) from public, anon, authenticated;
grant execute on function public.course_storage_files(uuid) to service_role;

grant execute on function public.course_delete_preview(uuid) to authenticated;
grant execute on function public.course_delete_execute(uuid) to authenticated;
