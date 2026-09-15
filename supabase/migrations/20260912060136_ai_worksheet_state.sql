-- §149.1. След в базе, что условие ДЗ (рабочий лист) дошло до модели — по
-- образцу reference_state/reference_chars (§137). Только добавляющее: старый
-- код на проде колонок не знает и продолжает работать.
alter table public.topic_homework_ai_jobs
  add column if not exists worksheet_state text
    check (worksheet_state in ('used', 'missing', 'failed')),
  add column if not exists worksheet_chars integer;

comment on column public.topic_homework_ai_jobs.worksheet_state is
  'Дошло ли условие ДЗ (рабочий лист worksheet_homework) до модели: used — подставлен, missing — у темы нет листа, failed — разбор PDF не удался. NULL — проверка старее §149.1.';
comment on column public.topic_homework_ai_jobs.worksheet_chars is
  'Сколько символов рабочего листа ушло в промпт (потолок WORKSHEET_CHAR_LIMIT).';
