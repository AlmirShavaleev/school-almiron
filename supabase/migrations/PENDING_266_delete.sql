-- §266, остаток: удаление задачи автопроверки. Не применено: apply_migration с DELETE в теле функции зависает
-- (ждёт подтверждения). Применить оркестратором при владельце; до этого кнопка «Удалить задачу» в редакторе вернёт ошибку.

create or replace function public.topic_autocheck_delete(p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_topic   uuid := public.topic_autocheck_task_topic(p_task_id);
  v_answers integer;
  v_kept    integer := 0;
  v_copy    record;
begin
  if v_topic is null or not public.topic_material_can_manage(v_topic) then
    raise exception 'Нет прав на эту задачу' using errcode = '42501';
  end if;
  select count(*)::int into v_answers from topic_autocheck_answers where task_id = p_task_id;
  if v_answers > 0 then
    raise exception 'По задаче уже есть ответы учеников (%) — удалить её нельзя: изменились бы их оценки', v_answers
      using errcode = 'check_violation';
  end if;
  for v_copy in select c.id, c.topic_id from topic_autocheck_tasks c where c.source_task_id = p_task_id loop
    if exists (select 1 from topic_autocheck_answers a where a.task_id = v_copy.id) then
      v_kept := v_kept + 1;
    else
      delete from topic_autocheck_tasks where id = v_copy.id;
      perform public._topic_autocheck_regrade(v_copy.topic_id);
    end if;
  end loop;
  delete from topic_autocheck_tasks where id = p_task_id;
  perform public._topic_autocheck_regrade(v_topic);
  return jsonb_build_object('deleted', true, 'kept_in_copies', v_kept);
end $$;

revoke all on function public.topic_autocheck_delete(uuid) from public, anon;
grant execute on function public.topic_autocheck_delete(uuid) to authenticated;
grant delete on table public.topic_autocheck_tasks to service_role;
