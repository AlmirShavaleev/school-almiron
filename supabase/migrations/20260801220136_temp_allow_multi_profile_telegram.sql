-- ВРЕМЕННАЯ правка для тестирования (§41).
-- Снимает требование «один Telegram — один профиль», чтобы владелец мог
-- проверять роли (ученик / преподаватель / админ) с одного ТГ-аккаунта.
-- Откат описан в PROJECT_STATE.md §41.
--
-- UNIQUE (profile_id) НЕ трогаем: у одного профиля по-прежнему один Telegram.
-- Все читающие запросы (send-telegram-test, process-notification-queue,
-- lesson-reminder-scheduler, SettingsPage) ходят по profile_id, поэтому
-- дубли chat_id их не задевают.

alter table public.telegram_connections
  drop constraint if exists telegram_connections_chat_id_key;

-- UNIQUE давал индекс; поиск по chat_id остаётся в telegram-bot-webhook,
-- поэтому обычный индекс сохраняем.
create index if not exists telegram_connections_chat_id_idx
  on public.telegram_connections (telegram_chat_id);

comment on column public.telegram_connections.telegram_chat_id is
  'ВРЕМЕННО без UNIQUE (§41): один Telegram можно привязать к нескольким профилям для тестирования одним аккаунтом. Перед продом вернуть UNIQUE.';
