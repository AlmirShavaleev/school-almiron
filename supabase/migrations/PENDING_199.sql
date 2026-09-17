-- НЕ ПРИМЕНЕНО. §199 (board/051) — таблица проверки преподавателя.
-- Применяет оркестратор через MCP apply_migration, после чего файл
-- переименовывается по фактической версии из schema_migrations (MIGRATIONS.md).
--
-- ============================================================
-- Таблица проверки: вторая, своя — не слепок ИИ (2026-09-17)
-- ============================================================
-- Слова владельца: «таблица, которую он создаёт, не редактируется; нужна она,
-- наверное, как отдельная сущность (таблица), в которую вписываются
-- комментарии, если есть ошибки, и которые можно менять как выпадающее окно».
--
-- Почему НЕ правим `topic_homework_ai_jobs.tasks`: там ответ модели, слепок
-- того, что она увидела (§180). Он нужен как есть — по нему сравниваются
-- версии ИИ-проверки и считается счётчик выдумок (`dropped_findings`).
-- Отредактированный слепок перестаёт быть измерением.
--
-- Почему строки висят на ПОПЫТКЕ, а не на задаче ИИ: это вердикт человека, и
-- он не должен исчезать при повторной ИИ-проверке — «Проверить заново» в
-- панели заводит новую строку `topic_homework_ai_jobs` (§180), старая
-- остаётся, и привязка к job означала бы, что таблица преподавателя пропала
-- вместе со сменой черновика.
--
-- Что из этого следует для прав (и это главное в миграции):
--   * персонал курса читает и пишет — тот же круг, что может ставить вердикт
--     (`topic_homework_attempt_can_review` → … → `course_is_staff`, CLAUDE.md:
--     никаких ручных копий условий);
--   * ученик читает свои строки ТОЛЬКО после того, как по попытке есть
--     вердикт. До вердикта таблица — черновик преподавателя, и показывать её
--     нельзя. Правило живёт в политике, а не в клиенте: клиент забывают.

create table if not exists public.topic_homework_review_tasks (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.topic_homework_attempts(id) on delete cascade,

  -- Номер задания «как в работе»: бывает «4», «№ 7», «12a» — поэтому text.
  no text not null check (length(btrim(no)) between 1 and 16),

  -- Те же четыре значения, что у строки ИИ (`findings.ts`, §180): по ним
  -- считается балл, и расходиться словарям нельзя.
  verdict text not null default 'unchecked'
    check (verdict in ('correct', 'wrong', 'partial', 'unchecked')),

  -- ИИ читает почерк с ошибками — это то место, где преподаватель его
  -- исправляет, поэтому оба ответа правятся руками.
  student_answer text check (student_answer is null or length(student_answer) <= 500),
  expected_answer text check (expected_answer is null or length(expected_answer) <= 500),

  -- Заметка преподавателя. Она же уезжает ученику в разбор работы — отсюда
  -- запас по длине и отсутствие «служебного» варианта: второго поля, которое
  -- ученик не видит, здесь быть не должно, иначе преподаватель гадает, что
  -- именно он пишет.
  note text check (note is null or length(note) <= 2000),

  position integer not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),

  -- Одна строка на задание: две строки «№ 4» — это уже не таблица, а спор.
  constraint topic_homework_review_tasks_attempt_no_key unique (attempt_id, no)
);

create index if not exists topic_homework_review_tasks_attempt_idx
  on public.topic_homework_review_tasks (attempt_id, position, no);

comment on table public.topic_homework_review_tasks is
  'Таблица проверки по заданиям, которую правит преподаватель, — РЕЗУЛЬТАТ проверки. Рождается копией таблицы ИИ (topic_homework_ai_jobs.tasks, §180) через topic_homework_review_tasks_seed, дальше живёт сама. Слепок ИИ неприкосновенен: он нужен для сравнения версий проверки и счётчика выдумок. Ученик видит свои строки только после вердикта (есть строка в topic_homework_reviews).';

comment on column public.topic_homework_review_tasks.note is
  'Заметка преподавателя по заданию. Видна ученику в разборе работы — второго, «внутреннего» поля здесь нет намеренно.';

-- ── Кто поставил строку и когда ──────────────────────────────────────
-- Триггером, а не полями из клиента: `updated_by` — это ответ на вопрос «кто
-- это написал», и принимать его на веру от того, кто пишет, бессмысленно.
create or replace function public.topic_homework_review_tasks_touch()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists topic_homework_review_tasks_touch_trg
  on public.topic_homework_review_tasks;
create trigger topic_homework_review_tasks_touch_trg
  before insert or update on public.topic_homework_review_tasks
  for each row execute function public.topic_homework_review_tasks_touch();

-- ── Права ────────────────────────────────────────────────────────────

-- Есть ли по попытке вердикт. Отдельная definer-функция, а не подзапрос в
-- политике: подзапрос к `topic_homework_reviews` внутри политики сам пойдёт
-- через RLS этой таблицы, и правило «ученик видит после вердикта» стало бы
-- зависеть от двух политик сразу. Здесь оно одно и читается целиком.
create or replace function public.topic_homework_attempt_has_verdict(p_attempt_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_homework_reviews r where r.attempt_id = p_attempt_id
  );
$$;

comment on function public.topic_homework_attempt_has_verdict(uuid) is
  'Есть ли по попытке вынесенный вердикт (строка topic_homework_reviews). Нужна политике topic_homework_review_tasks_student_select: до вердикта таблица проверки — черновик преподавателя.';

alter table public.topic_homework_review_tasks enable row level security;

grant select, insert, update, delete on public.topic_homework_review_tasks to authenticated;

drop policy if exists topic_homework_review_tasks_staff_all on public.topic_homework_review_tasks;
create policy topic_homework_review_tasks_staff_all on public.topic_homework_review_tasks
  for all to authenticated
  using      (public.topic_homework_attempt_can_review(attempt_id))
  with check (public.topic_homework_attempt_can_review(attempt_id));

-- Ученик — только чтение, только свои строки и только после вердикта.
drop policy if exists topic_homework_review_tasks_student_select on public.topic_homework_review_tasks;
create policy topic_homework_review_tasks_student_select on public.topic_homework_review_tasks
  for select to authenticated
  using (
    public.topic_homework_attempt_is_own(attempt_id)
    and public.topic_homework_attempt_has_verdict(attempt_id)
  );

grant execute on function public.topic_homework_attempt_has_verdict(uuid) to authenticated;

-- ── Первое заполнение: копия таблицы ИИ ──────────────────────────────
-- Идемпотентна: строки уже есть — не трогаем и возвращаем 0. Иначе повторный
-- вызов (панель зовёт её при открытии работы) затирал бы правки преподавателя
-- слепком модели — ровно то, от чего эта таблица и заведена.
--
-- Источник — ПОСЛЕДНЯЯ завершённая проверка попытки: у перепроверенной работы
-- «последняя» и есть та, которую преподаватель сейчас видит в панели.
-- Вердикты и тексты берутся из jsonb как есть, но проверяются: слепок пришёл
-- от модели, и кривая строка не должна ронять заполнение целиком (неизвестный
-- вердикт → 'unchecked', как в `findings.ts`; строка без номера — мимо).
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
      (rn * 10)::integer                                       as position
    from src
  )
  insert into topic_homework_review_tasks
    (attempt_id, no, verdict, student_answer, expected_answer, note, position)
  select p_attempt_id, no, verdict,
         nullif(student_answer, ''), nullif(expected_answer, ''), nullif(note, ''),
         position
    from rows_to_add
   where no <> '' and length(no) <= 16
  on conflict (attempt_id, no) do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end $$;

comment on function public.topic_homework_review_tasks_seed(uuid) is
  'Заполняет таблицу проверки копией таблицы последней завершённой ИИ-проверки попытки. Идемпотентна: если строки уже есть, возвращает 0 и ничего не меняет — правки преподавателя слепком модели не затираются.';

revoke all on function public.topic_homework_review_tasks_seed(uuid) from public, anon;
grant execute on function public.topic_homework_review_tasks_seed(uuid) to authenticated;
