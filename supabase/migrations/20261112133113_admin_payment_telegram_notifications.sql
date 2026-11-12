-- Dedicated outbox: only future successful payments, one row per payment and recipient.
create table public.admin_payment_notification_settings (
 id boolean primary key default true check(id),
 recipient_profile_id uuid not null references public.profiles(id),
 enabled boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.admin_payment_notification_settings enable row level security;
create policy admin_payment_notification_settings_read on public.admin_payment_notification_settings
 for select to authenticated using ((select public.is_admin_or_owner()));
grant select on public.admin_payment_notification_settings to authenticated;
grant all on public.admin_payment_notification_settings to service_role;
insert into public.admin_payment_notification_settings(recipient_profile_id)
 select p.id from public.profiles p where p.email='owner@almiron.ru' and p.role in ('admin','owner')
 and exists(select 1 from public.telegram_connections t where t.profile_id=p.id and t.is_enabled and t.disconnected_at is null);

create table public.admin_payment_notifications (
 id uuid primary key default gen_random_uuid(),
 payment_id uuid not null references public.subscription_payments(id),
 recipient_profile_id uuid not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','cancelled')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 locked_at timestamptz,
 sent_at timestamptz,
 last_error text,
 created_at timestamptz not null default now(),
 unique(payment_id,recipient_profile_id)
);
alter table public.admin_payment_notifications enable row level security;
create policy admin_payment_notifications_read on public.admin_payment_notifications
 for select to authenticated using ((select public.is_admin_or_owner()));
grant select on public.admin_payment_notifications to authenticated;
grant all on public.admin_payment_notifications to service_role;
create index admin_payment_notifications_pending on public.admin_payment_notifications(next_attempt_at)
 where status in ('pending','sending');

create function public.claim_admin_payment_notifications(p_limit int default 10)
returns table(id uuid,payment_id uuid,recipient_profile_id uuid,attempts int)
language sql security definer set search_path=public,pg_temp as $$
 with picked as (
  select q.id from public.admin_payment_notifications q
  join public.admin_payment_notification_settings cfg on cfg.id and cfg.enabled and cfg.recipient_profile_id=q.recipient_profile_id
  join public.profiles p on p.id=q.recipient_profile_id and p.role in ('admin','owner')
  where (q.status='pending' and q.next_attempt_at<=now()) or(q.status='sending' and q.locked_at<now()-interval '10 minutes')
  order by q.created_at for update of q skip locked limit greatest(1,least(p_limit,20))
 )
 update public.admin_payment_notifications q set status='sending',locked_at=now(),attempts=q.attempts+1
 from picked where q.id=picked.id returning q.id,q.payment_id,q.recipient_profile_id,q.attempts;
$$;
revoke all on function public.claim_admin_payment_notifications(int) from public,anon,authenticated;
grant execute on function public.claim_admin_payment_notifications(int) to service_role;

create function public._dispatch_admin_payment_notifications()
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare v_secret text; v_request bigint;
begin
 if not exists(select 1 from public.admin_payment_notifications q
  where (q.status='pending' and q.next_attempt_at<=now()) or(q.status='sending' and q.locked_at<now()-interval '10 minutes')) then return null; end if;
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='cron_secret' limit 1;
 if nullif(v_secret,'') is null then return null; end if;
 select net.http_post(
  url:='https://kthfozyfruorwjhvvsbw.supabase.co/functions/v1/admin-payment-notify',
  headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret',v_secret),
  body:='{}'::jsonb,timeout_milliseconds:=1000
 ) into v_request;
 return v_request;
end $$;
revoke all on function public._dispatch_admin_payment_notifications() from public,anon,authenticated;

create function public._queue_admin_payment_notification()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.admin_payment_notifications(payment_id,recipient_profile_id)
 select new.payment_id,cfg.recipient_profile_id from public.admin_payment_notification_settings cfg
 join public.profiles p on p.id=cfg.recipient_profile_id and p.role in ('admin','owner')
 where cfg.id and cfg.enabled
 on conflict(payment_id,recipient_profile_id) do nothing;
 perform public._dispatch_admin_payment_notifications();
 return new;
exception when others then
 insert into public.subscription_log(payment_id,subscription_id,event,details)
 values(new.payment_id,new.subscription_id,'admin_payment_notify_failed',jsonb_build_object('sqlstate',sqlstate));
 return new;
end $$;
revoke all on function public._queue_admin_payment_notification() from public,anon,authenticated;
create trigger admin_payment_succeeded_notify after insert on public.subscription_log
 for each row when(new.event='payment_succeeded' and new.payment_id is not null)
 execute function public._queue_admin_payment_notification();

-- Independent retry loop; does not process the school's other notification queues.
select cron.schedule('admin-payment-notifications','* * * * *','select public._dispatch_admin_payment_notifications();');

