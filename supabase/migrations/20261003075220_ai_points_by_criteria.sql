-- §260 — ИИ ставит баллы по критериям учителя; сумму и оценку считает сайт.
-- Применено оркестратором 03.10 (MCP apply_migration, версия 20261003075220); применённый текст — без строк-комментариев и comment on.
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration, после чего файл
-- переименовывается по фактической версии из schema_migrations (MIGRATIONS.md).
--
-- Только добавляющее: новые столбцы (старые строки — NULL), CHECK на новых
-- столбцах и новая версия `topic_homework_review_tasks_seed` с той же
-- сигнатурой, тем же владельцем прав и теми же грантами. Ничего не удаляется.
--
-- ПОРЯДОК: сначала эта миграция, потом деплой функции check-homework-ai и
-- сборка сайта. Функция пишет новые столбцы ТОЛЬКО у работ с критериями
-- (у обычного ДЗ запись та же, что до §260), но проверочная с критериями без
-- миграции упадёт на записи результата («Не удалось сохранить результат
-- проверки: column … does not exist») — задача уйдёт в failed с этой причиной.

-- ── 1. Проверка ИИ: сумма баллов, максимум, таблица перевода, способ оценки ──
-- По образцу 20260915111443_ai_jobs_tasks_and_dropped_findings.sql: слепок
-- модели и то, что из него посчитал КОД. Баллы по заданиям лежат в `tasks`
-- (у строк появляются ключи points / max_points), здесь — итог.
alter table public.topic_homework_ai_jobs
  add column if not exists points_total numeric
    check (points_total is null or points_total >= 0),
  add column if not exists points_max numeric
    check (points_max is null or points_max >= 0),
  add column if not exists grade_table jsonb
    check (grade_table is null or jsonb_typeof(grade_table) = 'array'),
  add column if not exists grading text
    check (grading is null or grading in ('criteria', 'ratio', 'criteria_mismatch'));

comment on column public.topic_homework_ai_jobs.points_total is
  '§260. Сумма баллов по критериям учителя (Σ tasks[].points по сверенным заданиям). Считает код функции, не модель. NULL — у работы нет критериев с баллами или проверка старее §260.';
comment on column public.topic_homework_ai_jobs.points_max is
  '§260. Сумма максимумов по заданиям (Σ tasks[].max_points). Сверяется с «максимум N баллов» из критериев.';
comment on column public.topic_homework_ai_jobs.grade_table is
  '§260. Таблица перевода суммы баллов в оценку, переписанная моделью из критериев: [{min, max, grade}] по возрастанию min. NULL — в критериях её нет.';
comment on column public.topic_homework_ai_jobs.grading is
  '§260. Как получен suggested_score: criteria — по таблице перевода из критериев (сверка сошлась); ratio — баллы есть, таблицы нет, доля баллов → пороги 90/70/50 %; criteria_mismatch — сумма максимумов ≠ максимуму из критериев или таблица с дырой/пересечением, оценка не выводится (suggested_score NULL). NULL — баллов по критериям нет (обычное ДЗ): балл прежний, по доле верных заданий.';

-- ── 2. Таблица преподавателя: балл за задание и максимум ─────────────────
-- Правки учителя ± сохраняются туда же, куда и вердикт строки (§199): это
-- результат проверки, и ученик видит именно его. Максимум приходит из критериев
-- при заполнении и руками не правится; балл — правится.
alter table public.topic_homework_review_tasks
  add column if not exists points numeric
    check (points is null or points >= 0),
  add column if not exists max_points numeric
    check (max_points is null or max_points > 0);

-- Балл не больше максимума и не бывает без максимума. Ограничение таблицы
-- добавляем идемпотентно: у `add constraint` нет `if not exists`.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'topic_homework_review_tasks_points_le_max'
       and conrelid = 'public.topic_homework_review_tasks'::regclass
  ) then
    alter table public.topic_homework_review_tasks
      add constraint topic_homework_review_tasks_points_le_max
      check (points is null or (max_points is not null and points <= max_points));
  end if;
end $$;

comment on column public.topic_homework_review_tasks.points is
  '§260. Балл за задание по критериям учителя. Правится кнопками ± в таблице проверки (вердикт строки при этом выводится из балла на клиенте). NULL при max_points — задание не сверено.';
comment on column public.topic_homework_review_tasks.max_points is
  '§260. Максимум за задание по критериям — из проверки ИИ при заполнении таблицы. NULL — у задания баллов нет (обычное ДЗ, строка добавлена руками, таблица старее §260).';

-- ── 3. Первое заполнение таблицы — теперь и с баллами ────────────────────
-- Та же функция §199 (20260917194018): права, идемпотентность, источник —
-- последняя завершённая проверка. Добавлено одно: points / max_points из
-- строки слепка. Берутся только числа (jsonb number), неотрицательные, балл —
-- не больше максимума; всё прочее — NULL, как у кривого вердикта: слепок
-- пришёл от модели и уронить заполнение не должен.
create or replace function public.topic_homework_review_tasks_seed(p_attempt_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tasks jsonb;
  v_created integer := 0;
begin
  if not public.topic_homework_attempt_can_review(p_attempt_id) then
    raise exception 'Нет прав на проверку этой работы';
  end if;

  if exists (
    select 1 from topic_homework_review_tasks t where t.attempt_id = p_attempt_id
  ) then
    return 0;
  end if;

  select j.tasks into v_tasks
    from topic_homework_ai_jobs j
   where j.attempt_id = p_attempt_id
     and j.status = 'done'
     and j.tasks is not null
   order by j.completed_at desc nulls last, j.created_at desc
   limit 1;

  if v_tasks is null or jsonb_typeof(v_tasks) <> 'array' then
    return 0;
  end if;

  with src as (
    select row_number() over () as rn, elem
      from jsonb_array_elements(v_tasks) as elem
     where jsonb_typeof(elem) = 'object'
  ), rows_to_add as (
    select
      btrim(coalesce(elem->>'no', ''))                        as no,
      case
        when coalesce(elem->>'verdict', '') in ('correct', 'wrong', 'partial', 'unchecked')
          then elem->>'verdict'
        else 'unchecked'
      end                                                     as verdict,
      left(btrim(coalesce(elem->>'student_answer', '')), 500)  as student_answer,
      left(btrim(coalesce(elem->>'expected_answer', '')), 500) as expected_answer,
      left(btrim(coalesce(elem->>'note', '')), 2000)           as note,
      (rn * 10)::integer                                       as position,
      case
        when jsonb_typeof(elem->'max_points') = 'number' and (elem->>'max_points')::numeric > 0
          then (elem->>'max_points')::numeric
      end                                                     as max_points,
      case
        when jsonb_typeof(elem->'points') = 'number' and (elem->>'points')::numeric >= 0
          then (elem->>'points')::numeric
      end                                                     as points_raw
    from src
  )
  insert into topic_homework_review_tasks
    (attempt_id, no, verdict, student_answer, expected_answer, note, position, points, max_points)
  select p_attempt_id, no, verdict,
         nullif(student_answer, ''), nullif(expected_answer, ''), nullif(note, ''),
         position,
         -- least() пропускает NULL: без явной проверки «балла нет» стало бы максимумом.
         case when max_points is not null and points_raw is not null then least(points_raw, max_points) end,
         max_points
    from rows_to_add
   where no <> '' and length(no) <= 16
  on conflict (attempt_id, no) do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end $$;

comment on function public.topic_homework_review_tasks_seed(uuid) is
  'Заполняет таблицу проверки копией таблицы последней завершённой ИИ-проверки попытки (§260: вместе с баллами по критериям points/max_points). Идемпотентна: если строки уже есть, возвращает 0 и ничего не меняет — правки преподавателя слепком модели не затираются.';

revoke all on function public.topic_homework_review_tasks_seed(uuid) from public, anon;
grant execute on function public.topic_homework_review_tasks_seed(uuid) to authenticated;
