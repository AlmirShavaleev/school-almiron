-- §264, часть 2/2. Применено оркестратором 04.10 (MCP apply_migration, версия 20261004090450) после деплоя edge-функций student-reminders v1 и process-notification-queue v31; применённый текст — без строк-комментариев, comment on и хвостовых комментариев.
-- ══ 5. Задание pg_cron ══════════════════════════════════════════════════════════════════════════════
-- Как 20260808193515_cron_jobs_snapshot: секрет — из vault по имени 'cron_secret' (в тексте команды его нет),
-- URL — домен проекта. Уже есть задание с таким именем — не трогаем (повторный прогон ничего не меняет).
-- Расписание */5 — как у очереди: напоминание на ближайшие 5 минут ставится со scheduled_for = момент
-- (LOOKAHEAD_MS в модуле), и очередь отправляет его в свой первый такт после момента.
do $mig$
begin
  if to_regclass('cron.job') is not null
     and not exists (select 1 from cron.job where jobname = 'student-reminders') then
    perform cron.schedule(
      'student-reminders',
      '*/5 * * * *',
      $cron$
    SELECT net.http_post(
      url     := 'https://kthfozyfruorwjhvvsbw.supabase.co/functions/v1/student-reminders',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
      ),
      body    := '{}'::jsonb
    );
  $cron$
    );
  end if;
end
$mig$;
