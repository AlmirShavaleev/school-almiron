-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260730225142
--   name    = topic_homework_ai_revoke_client_writes
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- Второй замок на таблицах ИИ-проверки.
--
-- В схеме public у Supabase стоят умолчания, раздающие роли authenticated
-- полный набор прав на новые таблицы. Из-за этого сразу после
-- 20260730225053 (topic_homework_ai_check_jobs) у клиента формально был
-- INSERT/UPDATE/DELETE на обеих таблицах.
--
-- Фактически запись не проходила: RLS включён, а политик на запись нет —
-- проверено под ролью authenticated, прямая вставка падает с
-- 42501 «new row violates row-level security policy». То есть дыры не было.
--
-- Но защита в один слой здесь неуместна. В этих таблицах лежит черновик
-- оценки: клиент, сумевший в них написать, подделал бы предложение ИИ, а
-- ученик, сумевший прочитать, увидел бы балл раньше преподавателя. Одна
-- неаккуратная политика в будущем — и грант из умолчаний окажется
-- единственным, что стояло на пути. Снимаем его явно: писать может только
-- service role (Edge Function) и SECURITY DEFINER-функции.
--
-- После применения проверено: у authenticated INSERT/UPDATE = false,
-- SELECT = true; у anon SELECT = false.

revoke insert, update, delete, truncate
  on public.topic_homework_ai_jobs from authenticated, anon;

revoke insert, update, delete, truncate
  on public.topic_homework_ai_findings from authenticated, anon;

-- Чтение оставляем: его сужает RLS до персонала курса.
revoke all on public.topic_homework_ai_jobs from anon;
revoke all on public.topic_homework_ai_findings from anon;

grant select on public.topic_homework_ai_jobs to authenticated;
grant select on public.topic_homework_ai_findings to authenticated;
