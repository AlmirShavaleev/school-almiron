-- Сторож для задач ИИ-проверки, зависших в pending/processing.
--
-- Проверка сегодня идёт синхронно: преподаватель жмёт кнопку, edge-функция
-- считает в том же запросе. Если воркер убивают по лимиту CPU (ответ 546),
-- писать `failed` уже некому — строка остаётся в processing навсегда. Это не
-- только вечный спиннер: на таблице висит частичный уникальный индекс
-- topic_homework_ai_jobs_one_active (attempt_id where status in
-- ('pending','processing')), поэтому мёртвая строка ФИЗИЧЕСКИ не даёт создать
-- новую задачу на ту же работу. См. PROJECT_STATE §48.6.
--
-- Порог 5 минут: самый долгий успешный прогон на проде — 16.5 с, потолок
-- edge-функции по стене — 400 с. Всё, что висит дольше пяти минут, мертво.
--
-- Задачи с attempts между 1 и 2 не трогаем: их ведёт фоновый воркер
-- (claim_topic_homework_ai_jobs), у него свой возврат в pending через 10 минут
-- и свой лимит в три попытки. Сегодня воркер не запущен и все задачи приходят
-- с attempts = 0, но если его включат, два сторожа не должны драться за одну
-- строку. attempts >= 3 — воркер сдался сам, такую добиваем.
--
-- Права: функция чинит только те работы, которые вызывающий и так может
-- проверять. Ученик, позвавший её, не закроет ничего.

create or replace function public.topic_homework_ai_expire_stale_jobs(
  p_attempt_ids uuid[] default null
) returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_count integer;
begin
  with stale as (
    update topic_homework_ai_jobs j
       set status = 'failed',
           completed_at = now(),
           -- Настоящую причину, если она успела записаться, не затираем:
           -- текст сторожа беднее того, что положила бы сама функция.
           last_error = coalesce(
             j.last_error,
             'Проверка оборвалась, результата не будет: воркер убит по лимиту ресурсов либо запрос не дошёл. Строку закрыл сторож, проверку можно запустить заново.'
           )
     where j.status in ('pending', 'processing')
       and coalesce(j.started_at, j.created_at) < now() - interval '5 minutes'
       and (j.attempts = 0 or j.attempts >= 3)
       and (p_attempt_ids is null or j.attempt_id = any (p_attempt_ids))
       and public.topic_homework_attempt_can_review(j.attempt_id)
    returning 1
  )
  select count(*) into v_count from stale;
  return v_count;
end $function$;

grant execute on function public.topic_homework_ai_expire_stale_jobs(uuid[]) to authenticated;

-- Заявка на проверку: зависшую строку сначала хороним, потом ищем живую.
-- Иначе кнопка «проверить заново» молча возвращает идентификатор мёртвой
-- задачи, а вставить новую мешает уникальный индекс.
create or replace function public.topic_homework_ai_request_check(p_attempt_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job_id uuid;
  v_status text;
begin
  if not public.topic_homework_attempt_can_review(p_attempt_id) then
    raise exception 'Нет прав на проверку этой работы';
  end if;

  perform public.topic_homework_ai_expire_stale_jobs(array[p_attempt_id]);

  select id into v_job_id
    from topic_homework_ai_jobs
   where attempt_id = p_attempt_id
     and status in ('pending', 'processing')
   limit 1;

  if v_job_id is not null then
    return v_job_id;
  end if;

  select status into v_status
    from topic_homework_attempts
   where id = p_attempt_id;

  if v_status is null then
    raise exception 'Работа не найдена';
  end if;
  if v_status = 'draft' then
    raise exception 'Работа ещё не сдана — проверять нечего';
  end if;

  insert into topic_homework_ai_jobs (attempt_id, requested_by)
  values (p_attempt_id, auth.uid())
  returning id into v_job_id;

  return v_job_id;
end $function$;
