-- Задачи к уроку (§162): вердикт по каждой задаче сразу, попыток сколько
-- угодно, у задач без короткого ответа — самооценка после просмотра решения.
--
-- Модель ответов менять не пришлось, не хватало трёх признаков:
--
--   attempts_count    — владелец хочет видеть, с какой попытки решена задача.
--                       В таблице были только first_answered_at / last_changed_at,
--                       по ним число попыток не восстановить.
--   closed_by         — чем задача закрыта: вердиктом или самооценкой. В «решено
--                       N из M» и в «тема пройдена» они равны, но преподаватель
--                       обязан различать «решил» и «посмотрел решение и отметил».
--   solution_shown_at — факт показа разбора. Это не украшение: зелёную кнопку
--                       «Разобрал» нельзя нажать до просмотра решения, и
--                       проверить это можно только по отметке времени.
--
-- Всё добавляющее: существующий экзаменационный путь (submit_variant,
-- finalize_grading) колонок не знает и работает как прежде.

alter table public.test_variant_answers
  add column if not exists attempts_count    integer not null default 0,
  add column if not exists closed_by         text,
  add column if not exists solution_shown_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'test_variant_answers_closed_by_check'
  ) then
    alter table public.test_variant_answers
      add constraint test_variant_answers_closed_by_check
      check (closed_by is null or closed_by in ('auto', 'self'));
  end if;
end $$;

comment on column public.test_variant_answers.attempts_count is
  'Сколько раз ученик отвечал на задачу. Нужен, чтобы видеть, с какой попытки решено. §162';
comment on column public.test_variant_answers.closed_by is
  'Чем задача закрыта: auto — вердиктом, self — самооценкой после разбора. NULL — ещё открыта. §162';
comment on column public.test_variant_answers.solution_shown_at is
  'Когда ученику показали разбор. До этого самооценка невозможна. §162';
