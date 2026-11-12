create or replace function public._dispatch_admin_payment_notifications()
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
  body:='{}'::jsonb,timeout_milliseconds:=60000
 ) into v_request;
 return v_request;
end $$;
revoke all on function public._dispatch_admin_payment_notifications() from public,anon,authenticated;

