-- §265, пересчёт, часть A. Применено оркестратором 04.10 (MCP apply_migration, версия 20261004112036).
-- Шаги 2–4 из PENDING_265_backfill агента: урок без шкалы → 100-балльная (1327 ДЗ, оценки не тронуты), проверочная/
-- контрольная без шкалы → 5-балльная (0 ДЗ), grade_scale NOT NULL. Синхронизация каркаса на время пересчёта выключена,
-- чтобы правка каркасных строк не гоняла синхронизацию во все классы; триггер шкалы §265 оставлен включённым (null → по типу).
-- Шаг 1 (урок/5-балльная → 100, оценки ×20) — в PENDING_265_backfill_b.sql: ждёт решения владельца по баллам школы.

alter table public.topic_homework disable trigger template_sync_homework_write;

update public.topic_homework h
   set grade_scale = 'hundred'
  from public.topics t
 where t.id = h.topic_id
   and t.kind = 'lesson'
   and h.grade_scale is null;

update public.topic_homework h
   set grade_scale = 'five'
  from public.topics t
 where t.id = h.topic_id
   and t.kind in ('check', 'control')
   and h.grade_scale is null;

alter table public.topic_homework enable trigger template_sync_homework_write;

alter table public.topic_homework alter column grade_scale set not null;
