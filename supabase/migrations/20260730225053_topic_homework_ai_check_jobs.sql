-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260730225053
--   name    = topic_homework_ai_check_jobs
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- ============================================================
-- ИИ-проверка ДЗ: очередь задач и находки (2026-07-30)
-- ============================================================
-- Владелец: «сделай так, чтобы ИИ автоматически могла проверить работу и
-- выставить баллы». Из четырёх развилок он выбрал:
--   1) ИИ готовит ЧЕРНОВИК для преподавателя, а не ставит вердикт сам;
--   2) эталона в базе нет — ИИ читает файл задания и работу ученика и
--      разбирает решение сам;
--   3) провайдер зарубежный, напрямую;
--   4) на выходе — рамки + балл + текст.
--
-- Отсюда главное архитектурное правило этой таблицы:
-- ИИ НЕ ПИШЕТ В topic_homework_reviews. Никогда. Вердикт и балл ученику
-- ставит человек, у reviews reviewer_id → profiles, и это остаётся правдой.
-- Ровно это было записано ещё в миграции 20260726073913: «AI никогда не
-- пишет сюда — его место в будущей topic_homework_ai_jobs(attempt_id),
-- которая лишь предлагает результат». Вот эта таблица.
--
-- Почему не переиспользована готовая схема homework_ai_jobs из
-- 20260723082631_homework_v2_ai_foundation: она смотрит внешними ключами на
-- homework_attempts (контур Homework V2, 0 строк, скрыт из меню). Живой
-- трафик идёт через topic_homework_attempts. Как чертёж та схема
-- пригодилась, переиспользовать её нельзя.
--
-- Почему находки лежат ОТДЕЛЬНО, а не в annotation_sets:
--   * annotation_sets.author_id NOT NULL → profiles: у ИИ нет профиля, и
--     заводить служебный — значит смешать его пометки с человеческими;
--   * страница там пишется целиком одним JSON, так что ИИ и преподаватель,
--     работая с одной страницей, затрут друг друга (эта проблема известна,
--     §30.2);
--   * статуса «предложено, не подтверждено» у annotation_sets нет.
-- Поэтому ИИ пишет в свою таблицу, а преподаватель, нажав «принять»,
-- переносит рамки к себе — и дальше они неотличимы от нарисованных рукой.
-- Это и есть «предложение», а не «правка».
--
-- Координаты — те же нормализованные [0,1], что и у annotation_sets.data
-- (SubmissionReviewer, Region.rect). Gemini отдаёт box_2d в шкале 0..1000,
-- пересчёт делает Edge Function, в базу приходит уже общий формат.
--
-- Форма схемы проверена на локальном Postgres 16 (9 проб): второй активной
-- задачи по одной попытке не создать, после завершения повторный прогон
-- разрешён, рамка за краем страницы и вырожденная рамка отклоняются,
-- рамка ровно по краю принимается, пустой комментарий и чужая категория
-- отклоняются, удаление задачи уносит находки.

create table if not exists public.topic_homework_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.topic_homework_attempts(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),

  -- Чем проверяли. Нужно, чтобы потом честно сравнить качество моделей и
  -- посчитать деньги, а не гадать, какой прогон чем сделан.
  provider text,
  model text,

  -- Итог разбора.
  readable boolean,                      -- смог ли ИИ вообще прочитать работу
  suggested_score integer check (suggested_score is null or suggested_score >= 0),
  confidence text check (confidence is null or confidence in ('high', 'medium', 'low')),
  summary text check (summary is null or length(summary) <= 8000),

  -- Служебное.
  attempts integer not null default 0,
  last_error text,
  input_tokens integer,
  output_tokens integer,
  requested_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,               -- преподаватель забрал черновик себе
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- Одна активная задача на попытку: два параллельных прогона — это двойная
-- оплата и гонка на запись результата. Индекс частичный, поэтому завершённых
-- прогонов по одной попытке может быть сколько угодно (перепроверка).
create unique index if not exists topic_homework_ai_jobs_one_active
  on public.topic_homework_ai_jobs (attempt_id)
  where status in ('pending', 'processing');

create index if not exists topic_homework_ai_jobs_attempt_idx
  on public.topic_homework_ai_jobs (attempt_id, created_at desc);

comment on table public.topic_homework_ai_jobs is
  'Прогон ИИ-проверки одной попытки ДЗ. Результат — ПРЕДЛОЖЕНИЕ преподавателю; вердикт и балл ученику по-прежнему ставит человек через topic_homework_review_attempt.';

create table if not exists public.topic_homework_ai_findings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.topic_homework_ai_jobs(id) on delete cascade,
  file_id uuid not null references public.topic_homework_attempt_files(id) on delete cascade,
  page integer not null default 1 check (page >= 1),

  -- Нормализованная рамка, как в annotation_sets.data.objects[].rect.
  rect_x double precision not null check (rect_x >= 0 and rect_x <= 1),
  rect_y double precision not null check (rect_y >= 0 and rect_y <= 1),
  rect_w double precision not null check (rect_w > 0 and rect_w <= 1),
  rect_h double precision not null check (rect_h > 0 and rect_h <= 1),

  -- Те же категории, что у человека (SubmissionReviewer.CATEGORIES) —
  -- иначе принятая рамка выглядела бы чужеродно.
  category text not null check (category in ('comment', 'calc', 'logic', 'format', 'praise')),
  text text not null check (length(btrim(text)) between 1 and 2000),
  position integer not null default 0,

  -- Допуск 1e-4 — модель отдаёт целые в шкале 0..1000, и рамка ровно
  -- по краю страницы после деления даёт 1.0 с точностью до float.
  constraint ai_finding_rect_inside_page
    check (rect_x + rect_w <= 1.0001 and rect_y + rect_h <= 1.0001)
);

create index if not exists topic_homework_ai_findings_job_idx
  on public.topic_homework_ai_findings (job_id, file_id, page, position);

comment on table public.topic_homework_ai_findings is
  'Рамки, предложенные ИИ. Координаты нормализованы [0,1] — тот же формат, что у annotation_sets. Пока преподаватель их не принял, ученик их не видит.';

-- ── Права ────────────────────────────────────────────────────────────
-- Читает тот же круг, что может проверять работу: цепочка
-- topic_homework_attempt_can_review → topic_homework_can_manage →
-- topic_material_can_manage → course_is_staff. Правило CLAUDE.md соблюдено:
-- ни одной ручной копии условий.
--
-- Политик на запись НЕТ СОВСЕМ, и это сознательно: писать сюда может только
-- service role (Edge Function) и SECURITY DEFINER-функции ниже. Ученик не
-- должен иметь возможности ни увидеть черновик, ни тем более его подправить.

alter table public.topic_homework_ai_jobs enable row level security;
alter table public.topic_homework_ai_findings enable row level security;

drop policy if exists topic_homework_ai_jobs_select_staff on public.topic_homework_ai_jobs;
create policy topic_homework_ai_jobs_select_staff on public.topic_homework_ai_jobs
  for select to authenticated
  using (public.topic_homework_attempt_can_review(attempt_id));

drop policy if exists topic_homework_ai_findings_select_staff on public.topic_homework_ai_findings;
create policy topic_homework_ai_findings_select_staff on public.topic_homework_ai_findings
  for select to authenticated
  using (exists (
    select 1 from public.topic_homework_ai_jobs j
     where j.id = job_id
       and public.topic_homework_attempt_can_review(j.attempt_id)
  ));

grant select on public.topic_homework_ai_jobs to authenticated;
grant select on public.topic_homework_ai_findings to authenticated;

-- ── Постановка задачи ────────────────────────────────────────────────
-- Идемпотентна: если активный прогон по этой попытке уже есть, возвращает
-- его id, а не заводит второй. Двойное нажатие кнопки — это деньги.

create or replace function public.topic_homework_ai_request_check(p_attempt_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_job_id uuid;
  v_status text;
begin
  if not public.topic_homework_attempt_can_review(p_attempt_id) then
    raise exception 'Нет прав на проверку этой работы';
  end if;

  select id into v_job_id
    from topic_homework_ai_jobs
   where attempt_id = p_attempt_id
     and status in ('pending', 'processing')
   limit 1;

  if v_job_id is not null then
    return v_job_id;
  end if;

  select status into v_status
    from topic_homework_attempts
   where id = p_attempt_id;

  if v_status is null then
    raise exception 'Работа не найдена';
  end if;
  if v_status = 'draft' then
    raise exception 'Работа ещё не сдана — проверять нечего';
  end if;

  insert into topic_homework_ai_jobs (attempt_id, requested_by)
  values (p_attempt_id, auth.uid())
  returning id into v_job_id;

  return v_job_id;
end $$;

comment on function public.topic_homework_ai_request_check(uuid) is
  'Ставит задачу ИИ-проверки попытки. Идемпотентна: при уже активном прогоне возвращает его id, а не заводит второй (двойное нажатие = двойная оплата).';

grant execute on function public.topic_homework_ai_request_check(uuid) to authenticated;

-- Преподаватель забрал черновик себе. Отдельная функция, а не UPDATE-политика:
-- разрешать клиенту менять строку задачи целиком незачем, ему нужна ровно
-- одна отметка.
create or replace function public.topic_homework_ai_mark_accepted(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update topic_homework_ai_jobs j
     set accepted_at = now()
   where j.id = p_job_id
     and public.topic_homework_attempt_can_review(j.attempt_id);

  if not found then
    raise exception 'Задача не найдена или нет прав';
  end if;
end $$;

grant execute on function public.topic_homework_ai_mark_accepted(uuid) to authenticated;

-- ── Захват задач воркером ────────────────────────────────────────────
-- По образцу claim_notification_queue: атомарный захват пачки с
-- FOR UPDATE SKIP LOCKED и реанимацией зависших. Сейчас проверка
-- запускается кнопкой преподавателя и обрабатывается сразу, но воркер уже
-- есть — чтобы включить фоновой режим, останется добавить только триггер
-- на сдачу и расписание pg_cron.

create or replace function public.claim_topic_homework_ai_jobs(batch_size integer default 5)
returns setof public.topic_homework_ai_jobs
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Прогон, зависший дольше 10 минут, считаем оборванным: вызов модели
  -- столько не живёт, а строка в processing блокирует перепроверку.
  update topic_homework_ai_jobs
     set status = 'pending', started_at = null
   where status = 'processing'
     and started_at < now() - interval '10 minutes';

  return query
  update topic_homework_ai_jobs
     set status = 'processing', started_at = now(), attempts = attempts + 1
   where id in (
     select id from topic_homework_ai_jobs
      where status = 'pending'
        and attempts < 3
      order by created_at
      limit batch_size
      for update skip locked
   )
  returning *;
end $$;

comment on function public.claim_topic_homework_ai_jobs(integer) is
  'Атомарный захват пачки задач ИИ-проверки воркером (service role). Реанимирует прогоны, зависшие в processing дольше 10 минут.';

revoke all on function public.claim_topic_homework_ai_jobs(integer) from public, anon, authenticated;
