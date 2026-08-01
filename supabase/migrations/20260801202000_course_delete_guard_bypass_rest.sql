-- ============================================================
-- Остальные сторожа на пути каскада.
--
-- Удаление курса разбирало дерево снизу вверх и упиралось в триггеры по
-- одному: сначала «Сданную попытку удалить нельзя», потом «открепить нельзя»,
-- потом «Завершённую попытку удалить нельзя», потом «История проверок
-- неизменяема». Каждое правило по отдельности верное — они защищают работу
-- ученика от случайного клика. Но удаление курса целиком не случайно: перед
-- ним показывают, сколько именно работ исчезнет.
--
-- Ключ один на всех — транзакционная настройка `app.course_delete`. Поднимает
-- её только `course_delete_execute` и только на свою транзакцию.
-- Границей безопасности остаётся RLS, она не трогается: флаг лишь отличает
-- «удаляю одну попытку» от «сношу курс осознанно».
-- ============================================================

create or replace function public.topic_test_attempts_guard()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if tg_op = 'UPDATE' then
    if new.test_id is distinct from old.test_id
       or new.student_id is distinct from old.student_id then
      raise exception 'Привязку попытки менять нельзя' using errcode = 'check_violation';
    end if;
    if old.status = 'completed' then
      raise exception 'Завершённую попытку изменить нельзя' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.course_delete', true), '') = 'on' then
      return old;
    end if;
    if old.status = 'completed' then
      raise exception 'Завершённую попытку удалить нельзя' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  return new;
end $$;

create or replace function public.topic_test_answers_guard()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_status public.topic_test_attempt_status;
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.course_delete', true), '') = 'on' then
    return old;
  end if;
  select a.status into v_status
    from topic_test_attempts a
   where a.id = coalesce(new.attempt_id, old.attempt_id);
  if v_status is null then
    raise exception 'Попытка не найдена' using errcode = 'foreign_key_violation';
  end if;
  if v_status = 'completed' and not coalesce(current_setting('app.topic_test_grading', true), '') = 'on' then
    raise exception 'Ответы завершённой попытки изменять нельзя' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.topic_homework_attempt_files_guard()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_status public.topic_homework_attempt_status;
  v_attempt uuid := coalesce(new.attempt_id, old.attempt_id);
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.course_delete', true), '') = 'on' then
    return old;
  end if;
  select a.status into v_status from topic_homework_attempts a where a.id = v_attempt;
  if v_status is null then
    raise exception 'Попытка не найдена' using errcode = 'foreign_key_violation';
  end if;
  if v_status <> 'draft' then
    raise exception 'Файлы сданной попытки изменять нельзя'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.topic_homework_reviews_immutable()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.course_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception 'История проверок неизменяема' using errcode = 'check_violation';
end $$;
