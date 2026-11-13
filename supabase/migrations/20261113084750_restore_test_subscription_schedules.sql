-- Approved schedule: hourly renewal; expiration daily at midnight Moscow.
-- pg_cron timezone on this project is GMT (Moscow is UTC+3).
do $migration$
begin
  if current_setting('cron.timezone', true) not in ('GMT','UTC','Etc/UTC') then
    raise exception 'Expected UTC cron timezone; review Moscow schedule';
  end if;
  if not exists(select 1 from vault.secrets where name='cron_secret') then
    raise exception 'Missing cron_secret';
  end if;
  perform cron.schedule('subscription-expire', '0 21 * * *',
    'select public.subscription_expire_tick()');
  perform cron.schedule('subscription-renew', '7 * * * *', $job$
    select net.http_post(
      url := 'https://kthfozyfruorwjhvvsbw.supabase.co/functions/v1/subscription-renew',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'X-Cron-Secret',(select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$);
end
$migration$;
