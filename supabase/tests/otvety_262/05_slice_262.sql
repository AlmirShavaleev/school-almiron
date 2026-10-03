-- §262. Добавка к слепкам §254 (../glavnaya_254/00_slice_254.sql), §255 (../prognoz_255/05_slice_255.sql) и §256
-- (../katalog_prognoz_256/05_slice_256.sql). СТРОГО по миграциям репозитория: ниже — каждая колонка, которую читают
-- PENDING_262a/262b и пробы, и файл, где она есть. Базовые таблицы каталога созданы до истории миграций
-- (create table в supabase/migrations нет) — для них указан файл, который колонку уже читает на проде.
--
--  таблица.колонка                                  │ где в миграциях репозитория
--  ─────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────
--  catalog_tasks.id, section_id, is_published,      │ слепки §255/§256 (20261002174335 catalog_check_answer:
--     statement_html, answer_html, solution_html,   │   ct.answer_html, ct.partial_type, ct.exam_part;
--     partial_type, exam_part, subject, exam_type   │   catalog_reveal_answer: ct.solution_html)
--  catalog_tasks.solution_plan_html,                │ 20260802233144_variant_student_items_hide_task_number_until_submit
--     grade_criteria_html, external_id,             │   (get_variant_items_for_student: ct.solution_plan_html,
--     has_answer, has_solution, max_points          │   ct.grade_criteria_html, ct.external_id, ct.has_answer,
--                                                   │   ct.has_solution, ct.max_points)
--  catalog_tasks.difficulty, position               │ 20260803101106 (variant_task_level(…, ct.difficulty, …));
--                                                   │   position — 20260812214715 (generate_variant_tasks: ct.position)
--  test_variant_student_assignments.variant_id,     │ 20260802233144 (get_variant_items_for_student: tvsa.variant_id,
--     status                                        │   tvsa.status IN ('submitted','completed'))
--  test_variant_assignments.variant_id, topic_id    │ слепок §254; 20260912212817 (topic_tasks_for_student: tva.topic_id,
--                                                   │   tva.variant_id, tvsa.assignment_id, tvsa.status <> 'cancelled')
--  test_variant_answers.solution_shown_at           │ 20260912201800_topic_task_answer_attempts_and_self_check (add column)
--  topic_test_attempts.test_id, student_id, status  │ слепок §254 (20260726130727); topic_test_items.task_id — слепок §255
--  profiles.role                                    │ слепок §254; правило staff — 20260726142040 (topic_test_bank_is_staff)
--  catalog_task_attempts, catalog_task_reveals      │ 20261002174213 (применяется в run.sh)
--
-- RLS catalog_tasks — как на проде (PROJECT_STATE.md §52, проверено под ролью ученика): одна политика
-- catalog_tasks_select_auth = auth.uid() IS NOT NULL AND is_published, без роли; права — как у Supabase (ВСЕ
-- anon/authenticated на таблицу). Поэтому проба «до 262b ученик читает answer_html» показывает настоящую дыру.
--
-- Invoker-функции, которые 262b переводит в definer, — применяются в run.sh КАК ЕСТЬ файлами миграций
-- (20260912213207 catalog_tasks_attach_preview, 20260915082230 preview_task_verdict,
-- 20260812214736 variant_section_available_counts); variant_task_eligible, которую зовёт последняя, — ниже
-- ДОСЛОВНО из 20260812214715.

alter table public.catalog_tasks
  add column solution_plan_html text,
  add column grade_criteria_html text,
  add column external_id integer not null default 0,
  add column has_answer boolean not null default false,
  add column has_solution boolean not null default false,
  add column max_points smallint,
  add column difficulty text,
  add column position integer not null default 0;

alter table public.test_variant_student_assignments
  add column variant_id uuid references public.test_variants(id),
  add column status text not null default 'not_started';
alter table public.test_variant_answers add column solution_shown_at timestamptz;

-- ── права и RLS catalog_tasks как на проде ────────────────────────────────
grant all on table public.catalog_tasks to anon, authenticated;
create policy catalog_tasks_select_auth on public.catalog_tasks
  for select using (auth.uid() is not null and is_published);

-- ── 20260812214715 (дословно) ──────────────────────────────────────────────
create or replace function public.variant_task_eligible(
  p_exam_part          smallint,
  p_answer_html        text,
  p_partial_type       text,
  p_grade_criteria_html text,
  p_max_points         smallint
) returns boolean
language sql
immutable
set search_path to ''
as $$
  select case
    when p_exam_part = 2 then
      p_grade_criteria_html is not null
      and btrim(p_grade_criteria_html) <> ''
      and coalesce(p_max_points, 0) > 0
    else
      public.variant_answer_is_auto_checkable(p_answer_html, p_partial_type)
  end;
$$;
