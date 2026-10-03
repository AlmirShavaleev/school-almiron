-- §263. Добавка к цепочке §241 (../razdel_241/run.sh: слепок §221 + 05_slice_240 + НАСТОЯЩИЕ файлы миграций
-- ДЗ темы, гейта, файлов, синхронизации, §198, §199, §234, §240 и слепок пробников 05_mock_slice_241).
-- СТРОГО по миграциям репозитория: ниже — каждая колонка, которую читают PENDING_263, 262a и пробы, и файл,
-- где она есть. Базовые таблицы каталога и вариантов созданы до истории миграций (create table в
-- supabase/migrations нет) — для них указан файл, который колонку уже читает/пишет на проде.
--
--  таблица.колонка                                  │ где в миграциях репозитория
--  ─────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────
--  catalog_sections.id, subject, exam_type,          │ 20260930193358_catalog_my_overview_all_viewers (sec: s.id, s.subject,
--     exam_number, position, is_published, title     │   s.exam_type, s.exam_number, s.position, s.is_published); title — 20261002153604
--  catalog_tasks.id, section_id, is_published        │ 20260812214715_variant_task_eligibility_depends_on_exam_part
--  catalog_tasks.exam_part, answer_html, partial_type│ 20260812214715 (variant_task_eligible(ct.exam_part, ct.answer_html, ct.partial_type))
--  catalog_tasks.statement_html, solution_html       │ 20260912201835_topic_tasks_rpcs_for_lesson_practice (topic_tasks_for_student)
--  catalog_tasks.subject, exam_type                  │ _legacy/008_catalog_multisubject
--  catalog_tasks.solution_plan_html,                 │ 20260802233144_variant_student_items_hide_task_number_until_submit
--     grade_criteria_html, external_id, has_answer,  │   (get_variant_items_for_student: ct.solution_plan_html, ct.grade_criteria_html,
--     has_solution, max_points                       │   ct.external_id, ct.has_answer, ct.has_solution, ct.max_points);
--                                                    │   external_id — bigint: функция отдаёт его как task_ext_id bigint, а
--                                                    │   RETURN QUERY строг к типам (с integer она падала бы и на проде)
--  test_variant_assignments.variant_id, group_id,    │ 20260803084948_attach_test_variants_to_course_topics (insert в attach_variant_to_topic:
--     student_id, status, show_answers_after_submit, │   variant_id, assigned_by, student_id, group_id, topic_id, due_at, max_attempts,
--     show_solutions_after_submit                    │   allow_retry, show_answers_after_submit, show_solutions_after_submit, status);
--                                                    │   тип boolean NOT NULL — src/types/database.ts (Row: boolean). Default на проде
--                                                    │   НЕ известен из репозитория: здесь false — худший случай (так выдавала
--                                                    │   AssignVariantPage), PENDING_263 ставит true.
--  test_variant_student_assignments.variant_id,status│ 20260802233144 (tvsa.variant_id, tvsa.status in ('submitted','completed'))
--  test_variant_answers.solution_shown_at            │ 20260912201800_topic_task_answer_attempts_and_self_check
--  topic_tests.id; topic_test_items.test_id, task_id;│ 20260726130727_topic_tests (create table); topic_test_attempt_status — там же
--     topic_test_attempts.test_id, student_id, status│
--  catalog_task_attempts, catalog_task_reveals       │ 20261002174213 (применяется в run.sh настоящим файлом)
--
-- RLS catalog_tasks — как на проде (§52/§262): одна политика catalog_tasks_select_auth, права — все.
-- Функции (ДОСЛОВНО, последние редакции):
--   mock_exam_is_staff        — 20260925201156_mock_exam_templates_and_task_scores
--   catalog_reveal_answer     — 20261002174335_catalog_practice_evidence_check_reveal (catalog_check_answer оттуда же
--                               тянет прогноз/зоны §255 — здесь не накатывается; её запись — вставка в
--                               catalog_task_attempts — проверяется сторожем напрямую, тем же insert)
--   проверка ответов (normalize_variant_answer … score_auto_answer, strip_html_simple-заменитель) — блок из
--   ../katalog_prognoz_256/05_slice_256.sql (там же источники по файлам), нужен 20261002174213.

create type public.topic_test_attempt_status as enum ('in_progress', 'completed');

create table public.catalog_sections (
  id uuid primary key default gen_random_uuid(),
  title text, subject text, exam_type text, exam_number smallint, position integer not null default 0,
  is_published boolean not null default true
);
create table public.catalog_tasks (
  id uuid primary key default gen_random_uuid(),
  section_id uuid references public.catalog_sections(id),
  is_published boolean not null default true,
  statement_html text, answer_html text, solution_html text,
  solution_plan_html text, grade_criteria_html text,
  partial_type text, exam_part smallint, subject text, exam_type text,
  external_id bigint not null default 0,
  has_answer boolean not null default false, has_solution boolean not null default false,
  max_points smallint
);
alter table public.catalog_tasks enable row level security;
grant all on table public.catalog_tasks to anon, authenticated;
create policy catalog_tasks_select_auth on public.catalog_tasks
  for select using (auth.uid() is not null and is_published);
grant select on public.catalog_sections to authenticated;

alter table public.test_variant_assignments
  add column variant_id uuid references public.test_variants(id),
  add column group_id uuid references public.groups(id),
  add column student_id uuid references public.students(id),
  add column status text not null default 'assigned',
  add column show_answers_after_submit boolean not null default false,
  add column show_solutions_after_submit boolean not null default false;
alter table public.test_variant_student_assignments
  add column variant_id uuid references public.test_variants(id),
  add column status text not null default 'not_started';
alter table public.test_variant_answers add column solution_shown_at timestamptz;

create table public.topic_tests (id uuid primary key default gen_random_uuid(), title text);
create table public.topic_test_items (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.topic_tests(id) on delete cascade,
  task_id uuid references public.catalog_tasks(id) on delete set null
);
create table public.topic_test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.topic_tests(id) on delete cascade,
  student_id uuid not null references public.students(id),
  status public.topic_test_attempt_status not null default 'in_progress'
);

-- ── 20260925201156 (дословно) ───────────────────────────────────────────────
create or replace function public.mock_exam_is_staff(p_mock_exam_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.mock_exams me
      join public.groups g on g.id = me.group_id
     where me.id = p_mock_exam_id
       and public.course_is_staff(g.course_id)
  );
$$;
revoke all on function public.mock_exam_is_staff(uuid) from public, anon;
grant execute on function public.mock_exam_is_staff(uuid) to authenticated;

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

-- ── 20261002174335 (дословно): catalog_reveal_answer ───────────────────────────
create or replace function public.catalog_reveal_answer(p_task_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_task   record;
  v_solved boolean;
begin
  if v_uid is null then
    raise exception 'catalog_reveal_answer: нужен вход' using errcode = '42501';
  end if;
  select ct.id, ct.answer_html, ct.solution_html into v_task
    from public.catalog_tasks ct
    join public.catalog_sections cs on cs.id = ct.section_id
   where ct.id = p_task_id and ct.is_published and cs.is_published;
  if not found then
    raise exception 'NOT_FOUND: задача не найдена' using errcode = 'P0002';
  end if;

  v_solved := exists (select 1 from public.catalog_task_attempts a
                       where a.profile_id = v_uid and a.task_id = p_task_id and a.verdict = 'correct');
  insert into public.catalog_task_reveals (profile_id, task_id) values (v_uid, p_task_id)
  on conflict (profile_id, task_id) do nothing;

  return jsonb_build_object(
    'answer_html', v_task.answer_html,
    -- Решена до раскрытия — уже засчитана, раскрытие ничего не отнимает.
    'solved_before', v_solved
  );
end;
$$;

comment on function public.catalog_reveal_answer(uuid) is
  '§256. Отметить, что ученик открыл ответ (или решение) задачи каталога: дальнейшие попытки — revealed_before, в прогноз и баллы не идут. Возвращает ответ. Решённую задачу раскрытие не трогает.';

revoke all on function public.catalog_reveal_answer(uuid) from public, anon;
grant execute on function public.catalog_reveal_answer(uuid) to authenticated;

