-- §214. Пятый вердикт «не решено» (unsolved) рядом с «не сверено» (unchecked).
-- Проверка РАСШИРЯЕТСЯ: все существующие строки проходят, старый код
-- продолжает писать прежние четыре значения. Ни одной строки не меняем.
alter table public.topic_homework_review_tasks
  drop constraint topic_homework_review_tasks_verdict_check;

alter table public.topic_homework_review_tasks
  add constraint topic_homework_review_tasks_verdict_check
  check (verdict = any (array['correct'::text, 'wrong'::text, 'partial'::text, 'unchecked'::text, 'unsolved'::text]));