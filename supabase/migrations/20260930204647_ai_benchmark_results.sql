-- §247. Замер ИИ-проверки на других моделях: результаты, отчёт, список работ.
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration; после применения
-- файл переименовать по версии из supabase_migrations.schema_migrations (MIGRATIONS.md).
-- Только добавляет: новая таблица и четыре новые функции, существующее не меняется.
-- Идемпотентна (if not exists / create or replace) — повторное применение ничего не ломает.
--
-- Зачем. Владелец хочет знать, станет ли проверка заметно точнее на другой модели
-- (сначала google/gemini-3.8-flash против нынешней Qwen). Edge-функция
-- check-homework-ai в режиме замера (тело { benchmark: true, … }, заголовок
-- X-Cron-Secret) прогоняет ту же работу тем же промптом другой моделью и кладёт
-- результат СЮДА — не в topic_homework_ai_jobs / _findings / _review_tasks:
-- ни ученик, ни преподаватель замера не видят. Правда — таблица проверки
-- преподавателя (topic_homework_review_tasks) у работ с итоговым вердиктом.
--
-- Права. Таблица и все функции закрыты от anon и authenticated целиком: RLS
-- включена, политик нет, привилегий нет. Пишет edge-функция сервисным ключом,
-- читает оркестратор (service_role / postgres). Пробы — supabase/tests/ai_benchmark_247.

-- ── Результаты замера ────────────────────────────────────────────────
create table if not exists public.ai_benchmark_results (
  id uuid primary key default gen_random_uuid(),
  -- Метка прогона, которую выбирает оркестратор («2026-10-01-a»): отчёт — по ней.
  run_id text not null check (length(btrim(run_id)) between 1 and 100),
  attempt_id uuid not null references public.topic_homework_attempts(id) on delete cascade,
  model text not null check (length(model) between 1 and 200),
  -- ok — модель ответила и ответ разобран; error — нет (причина в error).
  status text not null check (status in ('ok', 'error')),
  -- Таблица по заданиям ПОСЛЕ фильтра findings.ts (как topic_homework_ai_jobs.tasks
  -- в бою) + seeded_verdict: во что строка легла бы в таблицу преподавателя (§238).
  tasks jsonb,
  -- Балл так же, как в бою: код из таблицы; null — работа прочитана не целиком.
  suggested_score int,
  readable boolean,
  input_tokens int,
  output_tokens int,
  -- usage.cost OpenRouter, доллары; null — поставщик не сообщил.
  cost_usd numeric,
  -- Время запроса к модели, мс (не всей функции — то в meta.total_ms).
  latency_ms int,
  error text,
  -- Диагностика сверх постановки: finish_reason, токены рассуждения, какая модель
  -- ответила на самом деле, страниц отправлено/пропущено, эталон/условие, потолок.
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Повтор той же работы той же моделью в том же прогоне перезаписывает строку
  -- (upsert по этому ключу из edge-функции).
  constraint ai_benchmark_results_run_attempt_model_key unique (run_id, attempt_id, model)
);

-- Для каскадного удаления попытки: уникальный ключ начинается с run_id.
create index if not exists ai_benchmark_results_attempt_idx
  on public.ai_benchmark_results (attempt_id);

comment on table public.ai_benchmark_results is
  '§247. Замер ИИ-проверки на других моделях: строка на (прогон, работа, модель). Пишет check-homework-ai в режиме benchmark сервисным ключом; читает оркестратор (ai_benchmark_report). Ученику и преподавателю закрыта: RLS без политик, привилегии anon/authenticated отозваны.';

alter table public.ai_benchmark_results enable row level security;
revoke all on table public.ai_benchmark_results from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_benchmark_results to service_role;

-- ── Номер задания для сопоставления ──────────────────────────────────
-- Дословно как интерфейс сопоставляет строку таблицы преподавателя со строкой
-- ИИ: noteTaskKey (src/lib/reviewNotes.ts) = normalizeTaskNo
-- (src/lib/aiHomeworkCheck.ts) = toLowerCase + удаление /[\s№.]/g. \s в JS —
-- это ещё и неразрывные/тонкие пробелы и BOM, поэтому они перечислены явно:
-- [[:space:]] Postgres их не покрывает. «№ 4», «4.», «4 » — одно задание.
create or replace function public.ai_benchmark_task_key(p_no text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(regexp_replace(coalesce(p_no, ''),
    U&'[[:space:]\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF\2116.]', '', 'g'));
$$;

comment on function public.ai_benchmark_task_key(text) is
  '§247. Ключ номера задания — как noteTaskKey/normalizeTaskNo на клиенте (нижний регистр, без пробельных символов JS \s, «№» и точек).';

-- ── Балл по пятибалльной ─────────────────────────────────────────────
-- Пятибалльная — как есть; стобалльная — школьными порогами fiveFromRatio
-- (check-homework-ai/findings.ts): 5 от 90, 4 от 70, 3 от 50, иначе 2.
create or replace function public.ai_benchmark_five(p_score int, p_scale text)
returns int
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
           when p_score is null then null
           when p_scale = 'five' then p_score
           when p_scale = 'hundred' then
             case when p_score >= 90 then 5 when p_score >= 70 then 4 when p_score >= 50 then 3 else 2 end
           else null
         end;
$$;

comment on function public.ai_benchmark_five(int, text) is
  '§247. Балл ДЗ в пятибалльную: five — как есть, hundred — порогами fiveFromRatio (90/70/50).';

-- ── Отчёт по прогону ─────────────────────────────────────────────────
-- Строка на модель. В счёт идут только работы с ИТОГОВЫМ вердиктом учителя:
-- попытка accepted / returned_for_revision и хотя бы одна строка
-- topic_homework_review_tasks (она и есть правда).
--
-- Задания. Сопоставление — как в интерфейсе (ReviewTaskTable, §238): идём по
-- строкам преподавателя, к каждой ищем строку ИИ с тем же ключом
-- ai_benchmark_task_key; у ИИ при двух строках с одним ключом берётся первая.
-- Строки преподавателя «не сверено» (unchecked) не считаются — правды в них
-- нет; «не решено» (unsolved, §214) приравнено к «неверно» (в балл обе — 0,
-- а у ИИ пятого вердикта нет). Строки ИИ без пары у преподавателя не считаются.
--   task_pairs          — пар (строка преподавателя + строка ИИ);
--   task_matched        — вердикт ИИ = вердикт преподавателя;
--   task_matched_seeded — то же по seeded_verdict: как строка легла бы в таблицу
--                         (§238: «частично» при совпавшем ответе → «верно»);
--   task_dangerous      — ИИ «верно», преподаватель «неверно»/«частично»/«не решено»;
--   task_stricter       — ИИ строже: неверно < частично < верно (unchecked ИИ не в счёт);
--   task_ai_unchecked   — ИИ не сверила задание, которое преподаватель проверил;
--   teacher_tasks_missed — у преподавателя задание есть, в таблице ИИ его нет.
-- Работы (works_compared — удачный читаемый прогон работы, где у преподавателя
-- есть хотя бы одна строка не «не сверено»):
--   works_all_matched   — все пары совпали и ни одного пропущенного задания;
--   works_no_dangerous  — ни одного опасного задания.
-- Оценка — по пятибалльной (ai_benchmark_five) против ПОСЛЕДНЕЙ строки
-- topic_homework_reviews с баллом; работы без балла (возврат, ДЗ без шкалы) и
-- прогоны без балла ИИ (часть страниц не прочитана) не считаются.
-- Токены, стоимость, время — средние по всем строкам модели, где они есть
-- (у ошибки после ответа модели они тоже есть — это тоже цена).
create or replace function public.ai_benchmark_report(p_run_id text)
returns table (
  model text,
  works bigint,
  works_ok bigint,
  works_error bigint,
  works_unreadable bigint,
  works_compared bigint,
  task_pairs bigint,
  task_matched bigint,
  task_match_pct numeric,
  task_matched_seeded bigint,
  task_match_seeded_pct numeric,
  task_dangerous bigint,
  task_stricter bigint,
  task_ai_unchecked bigint,
  teacher_tasks_missed bigint,
  works_all_matched bigint,
  works_all_matched_pct numeric,
  works_no_dangerous bigint,
  works_no_dangerous_pct numeric,
  grade_pairs bigint,
  grade_matched bigint,
  grade_match_pct numeric,
  grade_off_2plus bigint,
  avg_input_tokens numeric,
  avg_output_tokens numeric,
  avg_cost_usd numeric,
  total_cost_usd numeric,
  avg_latency_ms numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with res as (
    select b.*
      from ai_benchmark_results b
      join topic_homework_attempts a on a.id = b.attempt_id
     where b.run_id = p_run_id
       and a.status::text in ('accepted', 'returned_for_revision')
       and exists (select 1 from topic_homework_review_tasks t where t.attempt_id = b.attempt_id)
  ), teacher as (
    select t.attempt_id,
           ai_benchmark_task_key(t.no) as key,
           case when t.verdict = 'unsolved' then 'wrong' else t.verdict end as verdict
      from topic_homework_review_tasks t
     where t.attempt_id in (select r.attempt_id from res r)
       and t.verdict <> 'unchecked'
  ), ai as (
    select distinct on (r.id, ai_benchmark_task_key(x.e->>'no'))
           r.id as res_id,
           ai_benchmark_task_key(x.e->>'no') as key,
           case when x.e->>'verdict' in ('correct', 'partial', 'wrong', 'unchecked')
                then x.e->>'verdict' else 'unchecked' end as verdict,
           case when coalesce(x.e->>'seeded_verdict', x.e->>'verdict') in ('correct', 'partial', 'wrong', 'unchecked')
                then coalesce(x.e->>'seeded_verdict', x.e->>'verdict') else 'unchecked' end as seeded
      from res r
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(r.tasks) = 'array' then r.tasks else '[]'::jsonb end
      ) with ordinality as x(e, ord)
     where r.status = 'ok'
       and jsonb_typeof(x.e) = 'object'
       and ai_benchmark_task_key(x.e->>'no') <> ''
     order by r.id, ai_benchmark_task_key(x.e->>'no'), x.ord
  ), pairs as (
    select r.id as res_id, t.verdict as tv, a.verdict as av, a.seeded as sv
      from res r
      join teacher t on t.attempt_id = r.attempt_id
      left join ai a on a.res_id = r.id and a.key = t.key
     where r.status = 'ok'
       and r.readable is not false
  ), per_work as (
    select p.res_id,
           count(*) filter (where p.av is not null) as pairs,
           count(*) filter (where p.av is null) as missed,
           count(*) filter (where p.av = p.tv) as matched,
           count(*) filter (where p.sv = p.tv) as matched_seeded,
           count(*) filter (where p.av = 'correct' and p.tv in ('partial', 'wrong')) as dangerous,
           count(*) filter (where p.av in ('correct', 'partial', 'wrong')
             and (case p.av when 'correct' then 2 when 'partial' then 1 else 0 end)
               < (case p.tv when 'correct' then 2 when 'partial' then 1 else 0 end)) as stricter,
           count(*) filter (where p.av = 'unchecked') as ai_unchecked
      from pairs p
     group by p.res_id
  ), grade as (
    select r.id as res_id,
           ai_benchmark_five(r.suggested_score, h.grade_scale) as ai5,
           ai_benchmark_five(lr.score, h.grade_scale) as t5
      from res r
      join topic_homework_attempts a on a.id = r.attempt_id
      join topic_homework h on h.id = a.homework_id
      cross join lateral (
        select rv.score
          from topic_homework_reviews rv
         where rv.attempt_id = r.attempt_id
         order by rv.created_at desc, rv.id desc
         limit 1
      ) lr
     where r.status = 'ok'
       and r.suggested_score is not null
       and lr.score is not null
       and h.grade_scale in ('five', 'hundred')
  )
  select r.model,
         count(*)::bigint,
         count(*) filter (where r.status = 'ok')::bigint,
         count(*) filter (where r.status = 'error')::bigint,
         count(*) filter (where r.status = 'ok' and r.readable = false)::bigint,
         count(pw.res_id)::bigint,
         coalesce(sum(pw.pairs), 0)::bigint,
         coalesce(sum(pw.matched), 0)::bigint,
         round(100.0 * sum(pw.matched) / nullif(sum(pw.pairs), 0), 1),
         coalesce(sum(pw.matched_seeded), 0)::bigint,
         round(100.0 * sum(pw.matched_seeded) / nullif(sum(pw.pairs), 0), 1),
         coalesce(sum(pw.dangerous), 0)::bigint,
         coalesce(sum(pw.stricter), 0)::bigint,
         coalesce(sum(pw.ai_unchecked), 0)::bigint,
         coalesce(sum(pw.missed), 0)::bigint,
         count(*) filter (where pw.res_id is not null and pw.missed = 0 and pw.matched = pw.pairs)::bigint,
         round(100.0 * count(*) filter (where pw.res_id is not null and pw.missed = 0 and pw.matched = pw.pairs)
               / nullif(count(pw.res_id), 0), 1),
         count(*) filter (where pw.res_id is not null and pw.dangerous = 0)::bigint,
         round(100.0 * count(*) filter (where pw.res_id is not null and pw.dangerous = 0)
               / nullif(count(pw.res_id), 0), 1),
         count(g.res_id)::bigint,
         count(*) filter (where g.ai5 = g.t5)::bigint,
         round(100.0 * count(*) filter (where g.ai5 = g.t5) / nullif(count(g.res_id), 0), 1),
         count(*) filter (where abs(g.ai5 - g.t5) >= 2)::bigint,
         round(avg(r.input_tokens), 1),
         round(avg(r.output_tokens), 1),
         round(avg(r.cost_usd), 6),
         sum(r.cost_usd),
         round(avg(r.latency_ms), 1)
    from res r
    left join per_work pw on pw.res_id = r.id
    left join grade g on g.res_id = r.id
   group by r.model
   order by r.model;
$$;

comment on function public.ai_benchmark_report(text) is
  '§247. Отчёт замера по прогону: строка на модель — совпадение вердиктов по заданиям с таблицей преподавателя (сырой и после правила заполнения §238), опасные («ИИ верно — учитель нет»), строже учителя, пропущенные задания, работы целиком, оценка по пятибалльной, токены/стоимость/время. Только работы с итоговым вердиктом (accepted/returned_for_revision) и строками review_tasks. Только service_role/postgres.';

-- ── Работы для замера ────────────────────────────────────────────────
-- Попытки с итоговым вердиктом учителя, хотя бы одной строкой таблицы
-- проверки и хотя бы одним файлом; по дате сдачи. review_tasks_checked —
-- сколько строк не «не сверено»: у работы, где их ноль, сравнивать не с чем.
create or replace function public.ai_benchmark_candidates()
returns table (
  attempt_id uuid,
  submitted_at timestamptz,
  status text,
  homework_id uuid,
  homework_title text,
  grade_scale text,
  teacher_score int,
  review_tasks bigint,
  review_tasks_checked bigint,
  files bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id,
         a.submitted_at,
         a.status::text,
         h.id,
         h.title,
         h.grade_scale,
         (select rv.score
            from topic_homework_reviews rv
           where rv.attempt_id = a.id
           order by rv.created_at desc, rv.id desc
           limit 1),
         rt.total,
         rt.checked,
         f.files
    from topic_homework_attempts a
    join topic_homework h on h.id = a.homework_id
    cross join lateral (
      select count(*) as total, count(*) filter (where t.verdict <> 'unchecked') as checked
        from topic_homework_review_tasks t
       where t.attempt_id = a.id
    ) rt
    cross join lateral (
      select count(*) as files from topic_homework_attempt_files af where af.attempt_id = a.id
    ) f
   where a.status::text in ('accepted', 'returned_for_revision')
     and rt.total > 0
     and f.files > 0
   order by a.submitted_at nulls last, a.id;
$$;

comment on function public.ai_benchmark_candidates() is
  '§247. Работы для замера ИИ-проверки: итоговый вердикт учителя (accepted/returned_for_revision), есть строки topic_homework_review_tasks и файлы; по дате сдачи. Только service_role/postgres.';

revoke all on function public.ai_benchmark_task_key(text) from public, anon, authenticated;
revoke all on function public.ai_benchmark_five(int, text) from public, anon, authenticated;
revoke all on function public.ai_benchmark_report(text) from public, anon, authenticated;
revoke all on function public.ai_benchmark_candidates() from public, anon, authenticated;
grant execute on function public.ai_benchmark_task_key(text) to service_role;
grant execute on function public.ai_benchmark_five(int, text) to service_role;
grant execute on function public.ai_benchmark_report(text) to service_role;
grant execute on function public.ai_benchmark_candidates() to service_role;
