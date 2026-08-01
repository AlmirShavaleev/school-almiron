-- Хвост к 20260801220136: индекс по telegram_chat_id уже существовал
-- (idx_telegram_connections_chat_id, из telegram_mvp_phase1), созданный
-- в прошлой миграции дубликат не нужен.
drop index if exists public.telegram_connections_chat_id_idx;
