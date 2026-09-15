-- §180 (board/033). ИИ-проверка v17: таблица по заданиям и счётчик отброшенных
-- находок в topic_homework_ai_jobs. НЕ ПРИМЕНЕНО: оркестратор применяет через
-- MCP apply_migration и переименовывает файл по фактической версии из
-- schema_migrations. Применять ДО деплоя функции v17: с §180 функция
-- проверяет результат записи и при неизвестном столбце честно падает в
-- failed («Не удалось сохранить результат проверки») вместо вечного
-- processing. Только добавляющее: старый код на проде колонок не знает и
-- продолжает работать.
alter table public.topic_homework_ai_jobs
  add column if not exists tasks jsonb,
  add column if not exists dropped_findings integer;

comment on column public.topic_homework_ai_jobs.tasks is
  'Таблица по заданиям из ответа модели (v17, §180): [{no, verdict correct|wrong|partial|unchecked, student_answer, expected_answer, note}]. Балл suggested_score считается кодом из неё: (correct + 0,5·partial) / (всего − unchecked) → шкала курса. NULL — проверка старее v17.';
comment on column public.topic_homework_ai_jobs.dropped_findings is
  'Сколько находок модели код отбросил (v17, §180): самопротиворечия «X, а не X» и строки с равными ответами, находки по верным заданиям, лимиты praise/format, потолок MAX_FINDINGS, негодные рамки. Растёт — модель выдумывает; см. ИИ_ПРОВЕРКА_КАЧЕСТВО.md.';
