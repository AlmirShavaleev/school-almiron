-- ============================================================
-- Удаление курса упиралось в два сторожевых триггера.
--
-- `topic_homework_attempts_guard` не даёт удалить сданную попытку, а
-- `topic_test_assignments_delete_guard` — открепить тест, по которому уже
-- писали. Оба правила верные: поштучно такое удалять нельзя, иначе работа
-- ученика исчезает по случайному клику. Но при удалении курса целиком они
-- срабатывали внутри каскада и роняли всю операцию — причём с текстом про
-- «открепить», из которого невозможно понять, что происходит.
--
-- Ключ: транзакционная настройка `app.course_delete`. Её выставляет только
-- `course_delete_execute`, и только на свою транзакцию (`set_config(..., true)`).
-- Оба сторожа при поднятом флаге пропускают удаление.
--
-- Это правило бизнес-логики, а не граница безопасности: от чужих данных
-- защищает RLS, и она никуда не девается. Флаг лишь отличает «удаляю одну
-- попытку» от «сношу курс, и меня об этом уже спросили с числами на экране».
-- ============================================================

create or replace function public.topic_homework_attempts_guard()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
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

    if old.status in ('accepted', 'returned_for_revision')
       and new.status is distinct from old.status then
      raise exception 'Проверенную попытку изменить нельзя'
        using errcode = 'check_violation';
    end if;

    if old.status = 'draft' and new.status = 'submitted' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Курс сносят целиком и осознанно — см. шапку миграции.
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

create or replace function public.topic_test_assignments_delete_guard()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if coalesce(current_setting('app.course_delete', true), '') = 'on' then
    return old;
  end if;
  if exists (select 1 from topic_test_attempts at where at.assignment_id = old.id) then
    raise exception 'По привязке уже есть попытки учеников — открепить нельзя'
      using errcode = 'check_violation';
  end if;
  return old;
end $$;

-- Флаг поднимается в самой операции удаления, и там же в предпросмотр
-- добавлены попытки по тестам: они тоже исчезнут, и молчать об этом нельзя.
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

  -- Действует до конца транзакции и только в ней.
  perform set_config('app.course_delete', 'on', true);

  delete from homeworks h
   using topics t join modules m on m.id = t.module_id
   where h.topic_id = t.id and m.course_id = p_course_id;

  delete from lessons where course_id = p_course_id;
  delete from groups  where course_id = p_course_id;

  delete from courses where id = p_course_id;

  return jsonb_build_object('course_id', p_course_id, 'title', v_c.title, 'files', v_files);
end $$;

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
      'test_attempts', (select count(*) from topic_test_attempts ta
                          join topic_test_assignments sa on sa.id = ta.assignment_id
                          join topics t on t.id = sa.topic_id join modules m on m.id = t.module_id
                         where m.course_id = p_course_id),
      'groups',   (select count(*) from groups where course_id = p_course_id),
      'lessons',  (select count(*) from lessons where course_id = p_course_id),
      'files',    jsonb_array_length(public.course_storage_files(p_course_id))
    )
  );
end $$;

grant execute on function public.course_delete_preview(uuid) to authenticated;
grant execute on function public.course_delete_execute(uuid) to authenticated;
