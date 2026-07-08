# Telegram-уведомления — настройка (Фаза 1)

> ⚠️ Никогда не коммить реальные значения секретов в этот файл, в SQL-миграции или в код.
> Здесь только плейсхолдеры.

## 1. Создать бота

1. Открыть [@BotFather](https://t.me/BotFather) → `/newbot`.
2. Получить **bot token** (вида `1234567890:AA...`) и **username** (например `almiron_school_bot`).

## 2. Сгенерировать webhook secret

Любая случайная строка (1–256 символов, `A-Z a-z 0-9 _ -`):

```bash
openssl rand -hex 32
```

## 3. Задать секреты в Supabase (Dashboard → Project Settings → Edge Functions → Secrets)

Либо через CLI (значения подставить свои, не коммитить):

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN="<bot_token_от_BotFather>" \
  TELEGRAM_BOT_USERNAME="<username_без_@>" \
  TELEGRAM_WEBHOOK_SECRET="<случайная_строка_из_шага_2>" \
  APP_URL="https://<домен_приложения>" \
  --project-ref kthfozyfruorwjhvvsbw
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` уже доступны функциям автоматически — задавать не нужно.

## 4. Установить webhook с secret_token

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://kthfozyfruorwjhvvsbw.supabase.co/functions/v1/telegram-bot-webhook",
    "secret_token": "<тот_же_TELEGRAM_WEBHOOK_SECRET>"
  }'
```

Telegram будет присылать `secret_token` в заголовке `X-Telegram-Bot-Api-Secret-Token`.
Функция отклоняет любой запрос без верного значения (HTTP 401, fail-closed).

Проверить установку:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

## 5. Проверка потока (Фаза 1)

1. Кабинет → **Настройки → Уведомления → «Подключить Telegram»**.
2. Открыть полученную ссылку `https://t.me/<bot>?start=<token>` → **Start**.
3. В кабинете без перезагрузки появится «Telegram подключён».
4. Кнопка **«Отправить тест»** → в Telegram приходит тестовое сообщение.
5. **«Отключить»** → уведомления больше не отправляются.

---

## Развёрнутые функции (Фаза 1)

| Функция | verify_jwt | Назначение |
|---|---|---|
| `generate-telegram-link` | ✅ true | Создаёт одноразовую ссылку (15 мин, hash в БД) |
| `telegram-bot-webhook` | ❌ false | Принимает `/start`, защищён secret-заголовком |
| `disconnect-telegram` | ✅ true | Отключает Telegram |
| `send-telegram-test` | ✅ true | Отправляет тестовое сообщение |

## НЕ развёрнуто (Фаза 2/3 — позже)

- `process-notification-queue` — воркер очереди
- `lesson-reminder-scheduler` — напоминания за час

### Планировщик для Фазы 2 (без service role key в SQL!)

Service role key **нельзя** хранить в cron-определении, миграции или коде.
Безопасные варианты:

- **Supabase Dashboard → Edge Functions → Schedules** — встроенный планировщик, секрет берётся из окружения функции.
- **pg_cron + Vault**: хранить ключ в `vault.secrets`, читать через `vault.decrypted_secrets` внутри cron-задачи, не записывая ключ в текст задачи.

Пример (только Фаза 2, ключ из Vault — не из текста):

```sql
-- ключ заранее положен в Vault: select vault.create_secret('<key>', 'edge_cron_key');
select cron.schedule('process-notification-queue', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://kthfozyfruorwjhvvsbw.supabase.co/functions/v1/process-notification-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_cron_key'),
      'Content-Type',  'application/json'
    )
  );
$$);
```
