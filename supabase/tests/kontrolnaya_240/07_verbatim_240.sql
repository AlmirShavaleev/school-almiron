-- §240. Последние определения, которые нельзя накатить настоящим файлом целиком
-- (файлы тянут рассылки и таблицы уведомлений, которых в слепке нет).
--
-- topic_homework_submit_attempt — ДОСЛОВНО из 20260802230510 (последнее
-- определение; 20260802232517 и 20260803170433 меняют только хелпер
-- уведомления). Хелпер уведомления здесь — заглушка: пишет вызов в
-- probe_notify, а для попытки с именем файла 'boom' падает — так видно, что
-- сбой уведомления не откатывает сдачу.

create or replace function public.notify_homework_submitted(p_attempt_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
begin
  if exists (select 1 from topic_homework_attempt_files f
              where f.attempt_id = p_attempt_id and f.file_name = 'boom') then
    raise exception 'заглушка уведомления: сбой';
  end if;
  insert into probe_notify (attempt_id, caller) values (p_attempt_id, auth.uid());
end $function$;
grant execute on function public.notify_homework_submitted(uuid) to authenticated;

create or replace function public.topic_homework_enqueue_reviewed(p_review_id uuid)
  returns void language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$ begin null; end $function$;

create or replace function public.topic_homework_submit_attempt(p_attempt_id uuid)
  returns void
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $function$
begin
  update topic_homework_attempts
     set status = 'submitted', submitted_at = now()
   where id = p_attempt_id
     and status = 'draft';

  if not found then
    raise exception 'Попытка не найдена, уже сдана или нет прав';
  end if;

  -- Дальше только оповещение. Его сбой не должен отменять сдачу: работа уже
  -- принята системой, откатывать её из-за неотправленного сообщения хуже,
  -- чем промолчать. Молчать полностью тоже нельзя — причина уходит в
  -- notification_dispatch_errors внутри хелпера, здесь остаётся последний
  -- рубеж на случай, если не удался сам вызов.
  begin
    perform public.notify_homework_submitted(p_attempt_id);
  exception when others then
    raise warning 'Уведомление о сдаче % не создано: % — %', p_attempt_id, sqlstate, sqlerrm;
  end;
end $function$;

-- Сдвиг дат при копировании — ДОСЛОВНО из 20260801154048 (нужен
-- course_copy_topic_content в пробе копирования темы).
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
