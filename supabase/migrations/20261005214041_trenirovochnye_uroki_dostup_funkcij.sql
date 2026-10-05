-- Применено оркестратором 05.10.2026 через MCP apply_migration (§266, часть «trenirovochnye_uroki_dostup_funkcij»). Версия совпадает с schema_migrations.

revoke all on function public.autocheck_number_of(text)                          from public, anon;
revoke all on function public.autocheck_digits_of(text)                          from public, anon;
revoke all on function public.autocheck_sorted_chars(text)                       from public, anon;
revoke all on function public.autocheck_answer_correct(text, numeric, numeric, text, boolean, text) from public, anon;
revoke all on function public.topic_autocheck_task_topic(uuid)                    from public, anon;
revoke all on function public.topic_autocheck_task_can_manage(uuid)               from public, anon;
revoke all on function public.topic_autocheck_task_closed(uuid, uuid)             from public, anon, authenticated;
revoke all on function public._topic_autocheck_student_of(uuid, uuid)             from public, anon, authenticated;
revoke all on function public.topic_autocheck_object_visible(text)                from public, anon;
revoke all on function public.topic_homework_autocheck_guard()                    from public, anon, authenticated;
revoke all on function public.topic_homework_attempts_autocheck_guard()           from public, anon, authenticated;
revoke all on function public.topic_homework_reviews_autocheck_guard()            from public, anon, authenticated;
revoke all on function public._topic_autocheck_ensure_homework(uuid)              from public, anon, authenticated;
revoke all on function public._topic_autocheck_finish(uuid, uuid)                 from public, anon, authenticated;
revoke all on function public._topic_autocheck_regrade(uuid)                      from public, anon, authenticated;
revoke all on function public.topic_autocheck_state(uuid)                         from public, anon;
revoke all on function public.topic_autocheck_check(uuid, text)                   from public, anon;
revoke all on function public.topic_autocheck_results(uuid)                       from public, anon;
revoke all on function public.topic_autocheck_import(uuid, jsonb)                 from public, anon;
revoke all on function public.topic_autocheck_reorder(uuid, uuid[])               from public, anon;
revoke all on function public.trg_topic_lesson_format_sync()                      from public, anon, authenticated;

grant execute on function public.autocheck_number_of(text)                        to authenticated;
grant execute on function public.autocheck_digits_of(text)                        to authenticated;
grant execute on function public.autocheck_sorted_chars(text)                     to authenticated;
grant execute on function public.autocheck_answer_correct(text, numeric, numeric, text, boolean, text) to authenticated;
grant execute on function public.topic_autocheck_task_topic(uuid)                 to authenticated;
grant execute on function public.topic_autocheck_task_can_manage(uuid)            to authenticated;
grant execute on function public.topic_autocheck_object_visible(text)             to authenticated;
grant execute on function public.topic_autocheck_state(uuid)                      to authenticated;
grant execute on function public.topic_autocheck_check(uuid, text)                to authenticated;
grant execute on function public.topic_autocheck_results(uuid)                    to authenticated;
grant execute on function public.topic_autocheck_import(uuid, jsonb)              to authenticated;
grant execute on function public.topic_autocheck_reorder(uuid, uuid[])            to authenticated;

grant execute on function public.topic_autocheck_import(uuid, jsonb) to service_role;
grant select, insert, update on table public.topic_autocheck_tasks to service_role;
grant select on table public.topic_autocheck_answers to service_role;
