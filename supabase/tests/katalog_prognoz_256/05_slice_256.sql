-- §256. Добавка к слепкам §254 (../glavnaya_254/00_slice_254.sql) и §255 (../prognoz_255/05_slice_255.sql).
-- СТРОГО по миграциям репозитория (урок §255: выдуманная topic_tests.topic_id уронила функцию на проде).
-- Ниже — КАЖДАЯ колонка, которую читает или пишет PENDING_256.sql, и файл, где она есть.
-- Базовые таблицы каталога созданы до истории миграций репозитория (create table их в
-- supabase/migrations нет) — для них указан файл, который колонку уже читает/пишет на проде.
--
--  таблица.колонка                                  │ где в миграциях репозитория
--  ─────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────
--  catalog_tasks.id, section_id, is_published        │ 20260812214715_variant_task_eligibility_depends_on_exam_part (generate_variant_tasks)
--  catalog_tasks.exam_part, answer_html,             │ 20260812214715 (variant_task_eligible(ct.exam_part, ct.answer_html,
--     partial_type                                   │   ct.partial_type, …)); partial_type добавлена _legacy/021_physics_partial_autograding
--  catalog_tasks.statement_html, solution_html       │ 20260912201835_topic_tasks_rpcs_for_lesson_practice (topic_tasks_for_student)
--  catalog_tasks.subject, exam_type                  │ _legacy/008_catalog_multisubject (add column subject/exam_type)
--  catalog_sections.id, subject, exam_type,          │ 20260930193358_catalog_my_overview_all_viewers (sec: s.id, s.subject, s.exam_type,
--     exam_number, position, is_published            │   s.exam_number, s.position, s.is_published)
--  catalog_sections.title                            │ 20261002153604_exam_forecast_evidence_test_topic_via_assignment (titles: cs.title)
--  catalog_task_assets.id, task_id, kind,            │ 20260912201835 (topic_tasks_for_student: a.id, a.task_id, a.kind, a.storage_path,
--     storage_path, alt, position                    │   a.alt, a.position)
--  catalog_task_progress.user_id, task_id,           │ 20261002140734_student_home_activity (student_solved_task_days: p.user_id, p.task_id,
--     is_completed, completed_at, updated_at         │   p.is_completed, p.completed_at, p.updated_at)
--  test_variant_answers.student_assignment_id,       │ 20261002140734 (cat_raw: a.student_assignment_id, a.variant_item_id, a.is_correct,
--     variant_item_id, is_correct, submitted_at,     │   a.submitted_at, a.graded_at, a.last_changed_at, a.created_at)
--     graded_at, last_changed_at, created_at         │
--  test_variant_answers.attempts_count               │ 20260912201800_topic_task_answer_attempts_and_self_check (add column attempts_count)
--  test_variant_student_assignments.id, student_id,  │ 20261002140734 (cat_raw: sa.id, sa.student_id, sa.submitted_at)
--     submitted_at                                   │
--  test_variant_items.id, task_id                    │ 20261002140734 (cat_raw: i.id, i.task_id)
--  topic_homework_attempts.student_id, submitted_at  │ 20261002140734 / 20261002153604 (как в слепке §254)
--  topic_homework_review_tasks, topic_homework_reviews, topic_homework.topic_id, topics.ege_task_numbers,
--  modules.course_id, courses.subject/exam_type, topic_test_* (assignment_id → topic_test_assignments.topic_id),
--  mock_exam_task_scores, mock_exams.starts_at/date/subject/exam_type/template_id, mock_exam_templates.max_points
--                                                    │ 20261002153604 — БЕЗ изменений, как в слепке §255 (тема теста —
--                                                    │   через topic_test_assignments)
--  topic_test_attempts.student_id, status,           │ 20261002140734 (tests: att.student_id, att.status, att.completed_at)
--     completed_at                                   │
--  app_visits.profile_id, visited_on                 │ 20261002140734 (как в слепке §254)
--  students.id, profile_id; group_students.group_id,  │ 20261002153604 (my_subjects)
--     student_id; groups.id, course_id               │
--  student_subject_targets, student_exam_goals       │ 20261002153604 / 20261002152136 (как в слепке §255 + сама миграция)
--  profiles.id (FK новых таблиц)                     │ слепок §254
--
-- Функции, которые PENDING_256 вызывает (ДОСЛОВНО, последние редакции):
--   normalize_variant_answer          — 20260803163437_normalize_variant_answer_trim_after_collapsing_spaces
--   variant_answer_alternatives       — 20260803164236_variant_grading_accepts_equivalent_alternatives
--   variant_answer_required_set, variant_answer_student_set,
--   variant_answer_is_auto_checkable  — 20260803214142_variant_grading_verdict_function_and_semicolon_sets
--   variant_answer_value_error_pair, variant_answer_can_auto_check,
--   variant_answer_verdict            — 20260805223728_variant_grading_accepts_value_error_pairs
--   normalize_answer_digits, score_partial_multi_choice, score_partial_matching,
--   score_auto_answer                 — _legacy/021_physics_partial_autograding (submit_variant 20260803214142
--                                       вызывает score_auto_answer — на проде она есть)
--   strip_html_simple                 — ОПРЕДЕЛЕНИЯ В РЕПОЗИТОРИИ НЕТ (функция прода; сигнатура в src/types/database.ts
--                                       `strip_html_simple: { Args: { html: string } }`). Здесь — ЗАМЕНИТЕЛЬ по клиентскому
--                                       зеркалу src/utils/variantAnswerNormalize.ts (`<[^>]+>` → '' и trim). На проде
--                                       PENDING_256 вызывает настоящую — проверить пробой из списка для прода.
--   is_admin_or_owner, auth_is_staff_of_student — слепок §255.

-- ── недостающие колонки ──────────────────────────────────────────────────
alter table public.catalog_tasks
  add column statement_html text not null default '',
  add column answer_html text,
  add column solution_html text,
  add column partial_type text check (partial_type in ('multi_choice', 'matching') or partial_type is null),
  add column exam_part smallint,
  add column subject text not null default 'Математика',
  add column exam_type text not null default 'ЕГЭ';
create table public.catalog_task_assets (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.catalog_tasks(id),
  kind text not null default 'image', storage_path text not null, alt text, position int not null default 0
);
alter table public.test_variant_answers add column attempts_count integer not null default 0;

-- ── проверка ответов: дословно из миграций ────────────────────────────────
-- ЗАМЕНИТЕЛЬ (см. шапку): на проде своя strip_html_simple(html text).
create or replace function public.strip_html_simple(html text)
returns text language sql immutable as $$ select btrim(regexp_replace(coalesce(html, ''), '<[^>]+>', '', 'g')) $$;

-- 20260803163437
CREATE OR REPLACE FUNCTION public.normalize_variant_answer(raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT lower(
    btrim(
      regexp_replace(
        replace(raw, ',', '.'),
        '\s+', ' ', 'g'
      )
    )
  );
$function$;

-- 20260803164236
create or replace function public.variant_answer_alternatives(p_correct_norm text)
returns numeric[]
language sql
immutable
set search_path to ''
as $$
  select case
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?$'
      then array[p_correct_norm::numeric]
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?( +-?[0-9]+(\.[0-9]+)?)+$'
     and (
       select count(distinct (
         select string_agg(c, '' order by c)
         from regexp_split_to_table(replace(replace(el, '-', ''), '.', ''), '') c
       ))
       from regexp_split_to_table(p_correct_norm, ' +') el
     ) = 1
      then (select array_agg(el::numeric) from regexp_split_to_table(p_correct_norm, ' +') el)
    else null
  end;
$$;

-- 20260803214142
create or replace function public.variant_answer_required_set(p_correct_norm text)
returns numeric[]
language sql
immutable
set search_path to ''
as $$
  select case
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?( *; *-?[0-9]+(\.[0-9]+)?)+$'
      then (select array_agg(el::numeric order by el::numeric)
            from regexp_split_to_table(p_correct_norm, ' *; *') el)
    else null
  end;
$$;

create or replace function public.variant_answer_student_set(p_student_norm text)
returns numeric[]
language sql
immutable
set search_path to ''
as $$
  select case
    when p_student_norm ~ '^-?[0-9]+(\.[0-9]+)?$'
      then array[p_student_norm::numeric]
    when p_student_norm ~ '^-?[0-9]+(\.[0-9]+)?([ ;]+-?[0-9]+(\.[0-9]+)?)+$'
      then (select array_agg(el::numeric order by el::numeric)
            from regexp_split_to_table(p_student_norm, '[ ;]+') el)
    else null
  end;
$$;

-- 20260805223728
create or replace function public.variant_answer_value_error_pair(p_correct_norm text)
returns numeric[]
language sql
immutable
set search_path to ''
as $$
  with valid as (
    select left(p_correct_norm, i) lft, substr(p_correct_norm, i + 1) rgt
    from generate_series(1, coalesce(length(p_correct_norm), 0) - 1) i
    where left(p_correct_norm, i)       ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      and substr(p_correct_norm, i + 1) ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      and left(p_correct_norm, i)::numeric >= substr(p_correct_norm, i + 1)::numeric
  )
  select case
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?$' then null
    when count(*) = 1 then array[min(lft)::numeric, min(rgt)::numeric]
    else null
  end
  from valid;
$$;

create or replace function public.variant_answer_can_auto_check(p_correct_norm text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select p_correct_norm is not null
     and (public.variant_answer_alternatives(p_correct_norm)     is not null
       or public.variant_answer_required_set(p_correct_norm)     is not null
       or public.variant_answer_value_error_pair(p_correct_norm) is not null
       or p_correct_norm in ('да', 'нет'));
$$;

create or replace function public.variant_answer_verdict(
  p_correct_norm text,
  p_student_norm text
) returns boolean
language sql
immutable
set search_path to ''
as $$
  select case
    when public.variant_answer_alternatives(p_correct_norm) is not null then
      coalesce(
        p_student_norm ~ '^-?[0-9]+(\.[0-9]+)?$'
        and p_student_norm::numeric = any (public.variant_answer_alternatives(p_correct_norm)),
        false)
    when public.variant_answer_required_set(p_correct_norm) is not null then
      coalesce(
        public.variant_answer_student_set(p_student_norm)
          = public.variant_answer_required_set(p_correct_norm),
        false)
    when public.variant_answer_value_error_pair(p_correct_norm) is not null then
      coalesce(
        p_student_norm = p_correct_norm
        or (
          p_student_norm ~ '^[0-9]+(\.[0-9]+)?[ ;±]+[0-9]+(\.[0-9]+)?$'
          and (regexp_split_to_array(p_student_norm, '[ ;±]+'))[1]::numeric
              = (public.variant_answer_value_error_pair(p_correct_norm))[1]
          and (regexp_split_to_array(p_student_norm, '[ ;±]+'))[2]::numeric
              = (public.variant_answer_value_error_pair(p_correct_norm))[2]
        ),
        false)
    when p_correct_norm in ('да', 'нет') then
      (p_student_norm = p_correct_norm)
    else null
  end;
$$;

-- 20260803214142
create or replace function public.variant_answer_is_auto_checkable(
  p_answer_html  text,
  p_partial_type text
) returns boolean
language sql
immutable
set search_path to ''
as $$
  select case
    when p_answer_html is null or p_answer_html = '' then false
    when p_partial_type is not null then true
    else public.variant_answer_can_auto_check(
           public.normalize_variant_answer(public.strip_html_simple(p_answer_html)))
  end;
$$;

-- _legacy/021_physics_partial_autograding
create or replace function public.normalize_answer_digits(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(coalesce(p_value, ''), '\D', '', 'g')
$$;

create or replace function public.score_partial_multi_choice(
  p_student_raw text,
  p_correct_raw text
)
returns integer
language plpgsql
immutable
as $$
declare
  v_student text := public.normalize_answer_digits(p_student_raw);
  v_correct text := public.normalize_answer_digits(p_correct_raw);
  v_symdiff_count integer;
begin
  if v_student = '' or v_correct = '' then
    return 0;
  end if;

  with student_digits as (
    select ch, count(*) as cnt
    from regexp_split_to_table(v_student, '') ch
    where ch <> ''
    group by ch
  ),
  correct_digits as (
    select ch, count(*) as cnt
    from regexp_split_to_table(v_correct, '') ch
    where ch <> ''
    group by ch
  ),
  merged as (
    select
      coalesce(s.ch, c.ch) as ch,
      coalesce(s.cnt, 0) as student_cnt,
      coalesce(c.cnt, 0) as correct_cnt
    from student_digits s
    full join correct_digits c using (ch)
  )
  select coalesce(sum(abs(student_cnt - correct_cnt)), 0)
    into v_symdiff_count
  from merged;

  if v_symdiff_count = 0 then
    return 2;
  elsif v_symdiff_count = 1 then
    return 1;
  else
    return 0;
  end if;
end;
$$;

create or replace function public.score_partial_matching(
  p_student_raw text,
  p_correct_raw text
)
returns integer
language plpgsql
immutable
as $$
declare
  v_student text := public.normalize_answer_digits(p_student_raw);
  v_correct text := public.normalize_answer_digits(p_correct_raw);
  v_len_student integer := char_length(v_student);
  v_len_correct integer := char_length(v_correct);
  v_mismatches integer := 0;
  i integer;
begin
  if v_student = '' or v_correct = '' then
    return 0;
  end if;

  if v_len_student > v_len_correct then
    return 0;
  end if;

  for i in 1..v_len_correct loop
    if substr(v_student, i, 1) is distinct from substr(v_correct, i, 1) then
      v_mismatches := v_mismatches + 1;
    end if;
  end loop;

  if v_mismatches = 0 then
    return 2;
  elsif v_mismatches = 1 then
    return 1;
  else
    return 0;
  end if;
end;
$$;

create or replace function public.score_auto_answer(
  p_student_raw text,
  p_correct_raw text,
  p_partial_type text
)
returns integer
language plpgsql
immutable
as $$
begin
  case p_partial_type
    when 'multi_choice' then
      return public.score_partial_multi_choice(p_student_raw, p_correct_raw);
    when 'matching' then
      return public.score_partial_matching(p_student_raw, p_correct_raw);
    else
      if public.normalize_answer_digits(p_student_raw) = public.normalize_answer_digits(p_correct_raw)
         and public.normalize_answer_digits(p_correct_raw) <> '' then
        return 1;
      else
        return 0;
      end if;
  end case;
end;
$$;
