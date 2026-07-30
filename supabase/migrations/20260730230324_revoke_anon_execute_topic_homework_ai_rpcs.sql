-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260730230324
--   name    = revoke_anon_execute_topic_homework_ai_rpcs
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- Снимаем EXECUTE у anon с RPC ИИ-проверки.
--
-- CREATE FUNCTION в схеме public по умолчанию раздаёт EXECUTE роли PUBLIC,
-- а в неё входит anon. Советник Supabase справедливо отметил обе новые
-- функции как «может вызвать anon через /rest/v1/rpc/...».
--
-- Дыры нет: обе внутри спрашивают topic_homework_attempt_can_review, а у
-- анонима auth.uid() = NULL, поэтому course_is_staff вернёт false и функция
-- упадёт с «Нет прав». Но пускать неавторизованного до тела SECURITY
-- DEFINER-функции незачем — в проекте это уже решено миграцией
-- 20260703225050 (revoke_anon_execute_on_security_definer_functions),
-- держим ту же линию, чтобы список советника оставался чистым и в нём было
-- видно настоящие проблемы, а не привычный шум.
--
-- После применения проверено: у anon EXECUTE = false по всем трём функциям,
-- у authenticated = true.

revoke execute on function public.topic_homework_ai_request_check(uuid) from public, anon;
revoke execute on function public.topic_homework_ai_mark_accepted(uuid) from public, anon;

grant execute on function public.topic_homework_ai_request_check(uuid) to authenticated;
grant execute on function public.topic_homework_ai_mark_accepted(uuid) to authenticated;

-- Заодно проверяем соседа из этой же сессии: realtime_review_topic_course
-- вызывается из политики на realtime.messages, аноним её звать не должен.
revoke execute on function public.realtime_review_topic_course(text) from public, anon;
grant execute on function public.realtime_review_topic_course(text) to authenticated;
