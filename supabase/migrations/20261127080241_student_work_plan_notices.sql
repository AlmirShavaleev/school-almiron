-- Personal-plan notices use the plan's common deadline in Moscow time.
set local lock_timeout = '3s';
set local statement_timeout = '45s';

alter table public.student_work_plans add column completion_notified_at timestamptz;

update public.student_work_plans p
   set completion_notified_at = n.created_at
  from public.notifications n
 where n.dedup_key = 'work-plan:' || p.id || ':completed';

update public.notification_queue
   set status = 'cancelled'
 where event_type = 'student_work_plan' and status = 'pending'
   and payload ->> 'kind' in ('today', 'overdue', 'weekly');

create or replace function public._work_plan_notice(
  p_plan uuid, p_event text, p_key text, p_title text, p_message text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan public.student_work_plans;
  v_now timestamptz := now();
  v_local timestamp := v_now at time zone 'Europe/Moscow';
  v_send_at timestamptz;
begin
  if p_event not in ('published', 'updated', 'deadline', 'completed') then return; end if;

  if p_event = 'completed' then
    -- Record the event in the same transaction as both notification inserts.
    update public.student_work_plans
       set completion_notified_at = v_now
     where id = p_plan and notify and status in ('published', 'completed') and completion_notified_at is null
    returning * into v_plan;
  else
    select * into v_plan from public.student_work_plans
     where id = p_plan and notify and status = 'published';
  end if;
  if not found then return; end if;

  v_send_at := case
    when v_local::time >= time '22:00' then (v_local::date + 1 + time '08:00') at time zone 'Europe/Moscow'
    when v_local::time < time '08:00' then (v_local::date + time '08:00') at time zone 'Europe/Moscow'
    else v_now end;

  with student as (
    select s.profile_id, pr.full_name
      from public.students s join public.profiles pr on pr.id = s.profile_id
     where s.id = v_plan.student_id and s.is_active
  ), recipients as (
    select s.profile_id, '/my-work-plan/' || p_plan as link, p_message as message,
           'work-plan:' || p_plan || ':' || p_key as dedup_key
      from student s
    union all
    select pr.id, '/student-work-plans/' || p_plan,
           coalesce(nullif(trim(s.full_name), ''), 'Ученик') || ' · ' || p_message,
           'work-plan:' || p_plan || ':' || p_key || ':staff'
      from public.profiles pr cross join student s
     where p_event = 'completed' and pr.id = v_plan.created_by and pr.id <> s.profile_id
       and (pr.role::text in ('admin', 'owner') or (
         pr.role::text in ('teacher', 'curator')
         and cardinality(v_plan.course_ids) > 0
         and not exists (
           select 1 from unnest(v_plan.course_ids) c(id)
           where not exists (
             select 1 from public._topic_homework_course_staff(c.id) staff where staff.profile_id = pr.id
           )
         )
         and exists (
           select 1 from unnest(v_plan.course_ids) c(id)
           where public._work_plan_group(v_plan.student_id, c.id) is not null
         )
       ))
  ), allowed as materialized (
    select r.*, n.telegram
      from recipients r left join public.notification_prefs n on n.user_id = r.profile_id
     where n.homework is distinct from false
       and (p_event <> 'deadline' or n.remind_hw_due_tomorrow is distinct from false)
  ), bell as (
    insert into public.notifications (user_id, title, message, type, link, dedup_key)
    select profile_id, p_title, message, 'info', link, dedup_key from allowed
    on conflict (dedup_key) do nothing
  )
  insert into public.notification_queue
    (profile_id, channel, event_type, entity_type, entity_id, deduplication_key, payload, status, scheduled_for)
  select r.profile_id, 'telegram', 'student_work_plan', 'student_work_plan', p_plan, r.dedup_key,
         jsonb_build_object('kind', p_event, 'title', p_title, 'message', r.message, 'link', r.link),
         'pending', v_send_at
    from allowed r
   where r.telegram is distinct from false
     and exists (select 1 from public.telegram_connections t where t.profile_id = r.profile_id
                 and t.is_enabled and t.disconnected_at is null and t.telegram_chat_id is not null)
  on conflict (deduplication_key) do nothing;
end
$$;

create function public._work_plan_check_notices(p_now timestamptz)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Moscow';
  v_today date := v_local::date;
  v_plans uuid[];
  v_plan record;
  v_event text;
  v_title text;
  v_key text;
  v_message text;
begin
  select array_agg(p.id) into v_plans from public.student_work_plans p
   where p.notify and p.status = 'published' and p.completion_notified_at is null
     and p.starts_on <= v_today and p.effective_until >= v_today - 1;
  if v_plans is null then return; end if;

  for v_plan in
    with items as (
      select r.plan_id, i.required, r.completed_at,
             bool_or(i.required) over (partition by r.plan_id) as has_required
        from public._work_plan_progress(v_plans, v_today) r
        join public.student_work_plan_items i on i.id = r.item_id
    ), progress as (
      select plan_id, count(*) as total,
             count(*) filter (where completed_at <= p_now) as done,
             max(completed_at) filter (where completed_at <= p_now) as last_done
        from items where required or not has_required group by plan_id
    )
    select p.id, p.title, p.effective_until, p.revision,
           coalesce(g.total, 0) as total, coalesce(g.done, 0) as done, g.last_done
      from public.student_work_plans p left join progress g on g.plan_id = p.id
     where p.id = any(v_plans)
  loop
    if v_plan.total > 0 and v_plan.done = v_plan.total
       and (v_plan.last_done at time zone 'Europe/Moscow')::date <= v_plan.effective_until then
      v_event := 'completed';
      v_title := 'План работы выполнен';
      v_key := 'completed';
      v_message := v_plan.title || ' · выполнено ' || v_plan.done || ' из ' || v_plan.total;
    elsif v_today > v_plan.effective_until then
      v_event := 'completed';
      v_title := 'Срок плана работы закончился';
      v_key := 'completed';
      v_message := v_plan.title || ' · выполнено ' || v_plan.done || ' из ' || v_plan.total;
    elsif v_today = v_plan.effective_until - 1 and v_local::time >= time '09:00' and v_plan.done < v_plan.total
       and not exists (select 1 from public.notifications n where
                      n.dedup_key = 'work-plan:' || v_plan.id || ':deadline:' || v_plan.effective_until) then
      v_event := 'deadline';
      v_title := 'Завтра заканчивается срок плана';
      v_key := 'deadline:' || v_plan.effective_until;
      v_message := v_plan.title || ' · осталось ' || (v_plan.total - v_plan.done) || ' из ' || v_plan.total;
    else
      continue;
    end if;

    -- The save RPC uses the same lock. Skip an edit in progress or a stale revision.
    if not pg_try_advisory_xact_lock(hashtextextended(v_plan.id::text, 1126)) then continue; end if;
    if not exists (select 1 from public.student_work_plans p where p.id = v_plan.id and p.notify
                   and p.status = 'published' and p.completion_notified_at is null and p.revision = v_plan.revision) then
      continue;
    end if;
    perform public._work_plan_notice(v_plan.id, v_event, v_key, v_title, v_message);
  end loop;
end
$$;

revoke all on function public._work_plan_check_notices(timestamptz) from public, anon, authenticated;

create or replace function public._work_plan_notices_daily()
returns void language sql security definer set search_path = public, pg_temp as $$
  select public._work_plan_check_notices(now())
$$;

do $migration$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('student-work-plan-notices', '*/15 * * * *', 'select public._work_plan_notices_daily()');
  end if;
end
$migration$;
