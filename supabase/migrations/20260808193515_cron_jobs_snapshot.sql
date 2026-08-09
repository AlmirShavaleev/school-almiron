-- Снимок двух заданий pg_cron, которые исторически заводились вне миграций
-- (на проде это jobid 3 и 4). До этого файла их определения не существовало
-- нигде, кроме самой базы: при переносе или пересоздании проекта восстановить
-- расписание было бы нечем. Обнаружено при инвентаризации переезда 2026-08-08.
--
-- Миграция СОЗНАТЕЛЬНО идемпотентна и на действующем проде НИЧЕГО не меняет:
-- задания с такими именами уже есть, ветка не выполняется. Смысл файла —
-- воспроизводимость на чистой базе, а не правка работающей.
--
-- Почему не cron.schedule без проверки: он перезаписывает задание по имени,
-- то есть на проде переопределил бы работающий воркер очереди уведомлений
-- ради нулевого эффекта. Цена ошибки в тексте команды тут — молчащие
-- уведомления, поэтому существующие задания не трогаем вовсе.
--
-- Секрет в команде не хранится: берётся из vault по имени 'cron_secret'.
-- URL функций привязан к домену проекта — при переезде на другой инстанс
-- обе строки надо переписать (см. ПЕРЕЕЗД_ПЛАН.md §7.6).

do $mig$
begin
  if not exists (select 1 from cron.job where jobname = 'process-notification-queue') then
    perform cron.schedule(
      'process-notification-queue',
      '*/5 * * * *',
      $cron$
    SELECT net.http_post(
      url     := 'https://kthfozyfruorwjhvvsbw.supabase.co/functions/v1/process-notification-queue',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
      ),
      body    := '{}'::jsonb
    );
  $cron$
    );
  end if;

  if not exists (select 1 from cron.job where jobname = 'lesson-reminder-scheduler') then
    perform cron.schedule(
      'lesson-reminder-scheduler',
      '*/5 * * * *',
      $cron$
    SELECT net.http_post(
      url     := 'https://kthfozyfruorwjhvvsbw.supabase.co/functions/v1/lesson-reminder-scheduler',
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
