-- §156. Кнопка «Очистить пометки» на работе: одна RPC считает и удаляет.
--
-- Поштучного удаления находок ИИ не существует: клиенту на
-- topic_homework_ai_findings оставлен только select (revoke client writes,
-- §32), а «удаление» в интерфейсе — правка регионов annotation_sets после
-- переноса черновика. Поэтому путь — RPC, security definer, право — то же,
-- что у вердикта (topic_homework_attempt_can_review); ученик и посторонний
-- преподаватель получают исключение.
--
-- p_dry_run = true по умолчанию: вызов без аргумента ТОЛЬКО считает — для
-- числа в подтверждении и для неактивной кнопки при нуле. p_dry_run = false
-- удаляет все находки ИИ по всем задачам попытки и все наборы аннотаций
-- попытки (чьи бы они ни были — преподаватель, куратор, владелец) в одной
-- транзакции. Сами задачи topic_homework_ai_jobs (балл, summary) не трогаются:
-- владелец просил снять пометки с листа, а не стереть историю проверки.

create or replace function public.topic_homework_clear_marks(
  p_attempt_id uuid,
  p_dry_run boolean default true
)
returns table (ai_findings integer, teacher_regions integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_findings integer;
  v_regions  integer;
begin
  if p_attempt_id is null or not public.topic_homework_attempt_can_review(p_attempt_id) then
    raise exception 'Нет прав на проверку этой работы' using errcode = '42501';
  end if;

  select count(*)::integer into v_findings
    from public.topic_homework_ai_findings f
    join public.topic_homework_ai_jobs j on j.id = f.job_id
   where j.attempt_id = p_attempt_id;

  select coalesce(sum(
           case when jsonb_typeof(s.data -> 'objects') = 'array'
                then jsonb_array_length(s.data -> 'objects') else 0 end
         ), 0)::integer into v_regions
    from public.annotation_sets s
   where s.attempt_id = p_attempt_id;

  if not p_dry_run then
    delete from public.topic_homework_ai_findings f
     using public.topic_homework_ai_jobs j
     where j.id = f.job_id and j.attempt_id = p_attempt_id;

    delete from public.annotation_sets s
     where s.attempt_id = p_attempt_id;
  end if;

  return query select v_findings, v_regions;
end $$;

comment on function public.topic_homework_clear_marks(uuid, boolean) is
  '§156. Считает (p_dry_run = true, по умолчанию) или удаляет (false) все пометки на работе: находки ИИ по всем задачам попытки и наборы аннотаций всех проверяющих. Разбор ИИ (jobs) не трогает. Право — topic_homework_attempt_can_review.';

revoke all on function public.topic_homework_clear_marks(uuid, boolean) from public, anon;
grant execute on function public.topic_homework_clear_marks(uuid, boolean) to authenticated;
