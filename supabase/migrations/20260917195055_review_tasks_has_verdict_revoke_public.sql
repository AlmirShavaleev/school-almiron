-- §199.2 — снять execute с PUBLIC/anon у definer-функции проверки вердикта.
-- ПРИМЕНЕНО оркестратором 17.09.2026, версия 20260917195055
-- (supabase_migrations.schema_migrations, MIGRATIONS.md).
--
-- В миграции §199 (20260917194018) у `topic_homework_attempt_has_verdict`
-- не было `revoke all … from public, anon`, как у соседей
-- (`topic_homework_attempt_can_review`, `…_is_own`,
-- `topic_homework_review_tasks_seed`). Функция security definer, значит
-- анонимный клиент мог по любому uuid узнать, вынесен ли по попытке
-- вердикт. Утечка небольшая, но правило одно для всех definer-функций
-- этого контура: выполняет только `authenticated`.

revoke all on function public.topic_homework_attempt_has_verdict(uuid) from public, anon;
grant execute on function public.topic_homework_attempt_has_verdict(uuid) to authenticated;
