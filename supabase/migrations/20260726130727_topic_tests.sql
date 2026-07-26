-- ============================================================
-- Тестирование на уровне темы (§3 + §9.4 PROJECT_STATE)
-- ============================================================
-- СТАТУС: ПРИМЕНЕНО 2026-07-26 через одобренный MCP-процесс.
--   version = 20260726130727
--   name    = topic_tests
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- Модель: тема -> ОДИН тест -> задания-снапшоты из каталога ->
--         одна попытка ученика -> автопроверка по эталону.
--
-- Продуктовая рамка (решения владельца, 2026-07-26):
--   * задания берутся ТОЛЬКО из каталога (catalog_tasks);
--   * проверка ТОЛЬКО автоматическая; ручной проверки нет;
--   * допускаются только задачи с текстовым эталоном
--     (has_answer и непустой ответ после strip тегов);
--   * баллы из каталога (max_points), частичные — score_auto_answer;
--   * часть 2 по ответу «всё или ничего» — осознанное упрощение;
--   * снапшот условия/ответа/типа/балла при добавлении — правки
--     каталога не меняют выставленные баллы задним числом;
--   * попытка одна; после завершения ученик видит баллы и эталоны.
--
-- Переиспользует хелперы доступа нового контура:
--   topic_material_can_manage(topic_id), course_student_can_see_topic(topic_id),
--   auth_student_id()
-- и функции проверки каталога (НЕ переписаны, вызываются как есть):
--   score_auto_answer, normalize_answer_digits, normalize_variant_answer.
-- ============================================================

-- ============================================================
-- 1. Типы
-- ============================================================
create type public.topic_test_attempt_status as enum (
  'in_progress',  -- ученик отвечает; ответы можно менять
  'completed'     -- сдано и проверено; всё неизменяемо
);

-- ============================================================
-- 2. Тест — один на тему
-- ============================================================
create table public.topic_tests (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid not null unique references public.topics(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 300),
  description  text check (length(description) <= 10000),
  is_published boolean not null default false,
  created_by   uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.topic_tests is
  'Тест темы. UNIQUE(topic_id) — ровно один тест на тему. Проверка только автоматическая.';

-- ============================================================
-- 3. Задания теста — снапшоты каталога
-- ============================================================
-- Снапшот делается в момент добавления (RPC topic_test_add_item).
-- task_id хранится для провенанса; при удалении задачи из каталога
-- снапшот остаётся жить (set null).
create table public.topic_test_items (
  id             uuid primary key default gen_random_uuid(),
  test_id        uuid not null references public.topic_tests(id) on delete cascade,
  task_id        uuid references public.catalog_tasks(id) on delete set null,
  position       integer not null default 0 check (position >= 0),

  -- снапшот
  statement_html text not null,
  answer_html    text not null,
  answer_text    text not null check (btrim(answer_text) <> ''),  -- эталон после strip тегов
  solution_html  text,
  partial_type   text check (partial_type in ('matching', 'multi_choice')),
  max_points     smallint not null check (max_points between 1 and 10),
  exam_part      smallint,
  assets         jsonb not null default '[]'::jsonb,  -- снапшот catalog_task_assets для resolveTaskHtml

  created_at     timestamptz not null default now(),

  -- одна и та же задача каталога не добавляется в тест дважды
  constraint topic_test_items_unique_task unique (test_id, task_id)
);

create index topic_test_items_test_idx on public.topic_test_items(test_id, position);

comment on table public.topic_test_items is
  'Задание теста — снапшот catalog_tasks на момент добавления. Правки каталога не меняют тест и выставленные баллы.';

-- ============================================================
-- 4. Попытки — одна на ученика
-- ============================================================
create table public.topic_test_attempts (
  id           uuid primary key default gen_random_uuid(),
  test_id      uuid not null references public.topic_tests(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  status       public.topic_test_attempt_status not null default 'in_progress',
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  total_points integer,   -- заполняются при завершении
  max_points   integer,

  -- одна попытка: пересдач нет (решение владельца)
  constraint topic_test_attempts_unique unique (test_id, student_id),
  constraint topic_test_attempts_completed_chk check (
    (status = 'in_progress' and completed_at is null and total_points is null and max_points is null)
    or (status = 'completed' and completed_at is not null and total_points is not null and max_points is not null)
  )
);

create index topic_test_attempts_student_idx on public.topic_test_attempts(student_id, started_at desc);
create index topic_test_attempts_test_idx on public.topic_test_attempts(test_id);

comment on table public.topic_test_attempts is
  'Попытка прохождения теста. UNIQUE(test_id, student_id) — попытка одна, пересдач нет.';

-- ============================================================
-- 5. Ответы
-- ============================================================
-- Пишутся ТОЛЬКО через RPC (security definer): ученик не может выставить
-- себе баллы прямой записью. awarded_points появляются при завершении.
create table public.topic_test_answers (
  id             uuid primary key default gen_random_uuid(),
  attempt_id     uuid not null references public.topic_test_attempts(id) on delete cascade,
  item_id        uuid not null references public.topic_test_items(id) on delete cascade,
  answer_text    text not null default '',
  awarded_points integer check (awarded_points >= 0),
  is_correct     boolean,
  updated_at     timestamptz not null default now(),

  constraint topic_test_answers_unique unique (attempt_id, item_id)
);

create index topic_test_answers_attempt_idx on public.topic_test_answers(attempt_id);

-- ============================================================
-- 6. Инварианты
-- ============================================================
create trigger topic_tests_touch_trg
  before update on public.topic_tests
  for each row execute function public.topic_homework_touch();

-- Задания нельзя менять, когда по тесту уже есть попытки: снапшоты и
-- выставленные баллы не переписываются задним числом.
create or replace function public.topic_test_items_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_test uuid := coalesce(new.test_id, old.test_id);
begin
  if exists (select 1 from topic_test_attempts a where a.test_id = v_test) then
    raise exception 'По тесту уже есть попытки — состав заданий изменить нельзя'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    -- снапшот неизменяем; двигать можно только position
    if new.test_id is distinct from old.test_id
       or new.task_id is distinct from old.task_id
       or new.statement_html is distinct from old.statement_html
       or new.answer_html   is distinct from old.answer_html
       or new.answer_text   is distinct from old.answer_text
       or new.solution_html is distinct from old.solution_html
       or new.partial_type  is distinct from old.partial_type
       or new.max_points    is distinct from old.max_points
       or new.exam_part     is distinct from old.exam_part
       or new.assets        is distinct from old.assets then
      raise exception 'Снапшот задания неизменяем, менять можно только порядок'
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger topic_test_items_guard_trg
  before insert or update or delete on public.topic_test_items
  for each row execute function public.topic_test_items_guard();

-- Завершённая попытка неизменяема и неудаляема.
create or replace function public.topic_test_attempts_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.test_id is distinct from old.test_id
       or new.student_id is distinct from old.student_id then
      raise exception 'Привязку попытки менять нельзя' using errcode = 'check_violation';
    end if;
    if old.status = 'completed' then
      raise exception 'Завершённую попытку изменить нельзя' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'completed' then
      raise exception 'Завершённую попытку удалить нельзя' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  return new;
end $$;

create trigger topic_test_attempts_guard_trg
  before update or delete on public.topic_test_attempts
  for each row execute function public.topic_test_attempts_guard();

-- Ответы завершённой попытки неизменяемы.
create or replace function public.topic_test_answers_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status public.topic_test_attempt_status;
begin
  select a.status into v_status
    from topic_test_attempts a
   where a.id = coalesce(new.attempt_id, old.attempt_id);
  if v_status is null then
    raise exception 'Попытка не найдена' using errcode = 'foreign_key_violation';
  end if;
  if v_status = 'completed' and not coalesce(current_setting('app.topic_test_grading', true), '') = 'on' then
    raise exception 'Ответы завершённой попытки изменять нельзя' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return coalesce(new, old);
end $$;

create trigger topic_test_answers_guard_trg
  before insert or update or delete on public.topic_test_answers
  for each row execute function public.topic_test_answers_guard();

-- ============================================================
-- 7. Хелперы
-- ============================================================
-- Эталон ответа: HTML каталога -> сравнимый текст.
create or replace function public.topic_test_strip_html(p_html text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
    replace(replace(replace(replace(replace(
      regexp_replace(coalesce(p_html, ''), '<[^>]*>', ' ', 'g'),
      '&nbsp;', ' '), '&minus;', '-'), '&ndash;', '-'), '&mdash;', '-'), '&amp;', '&'),
    '\s+', ' ', 'g'))
$$;

-- Балл за задание. Переиспользует функции каталога, не переписывает их.
--   matching / multi_choice -> частичный балл score_auto_answer (0..2);
--   обычный ответ с цифрами -> score_auto_answer (0/1), всё или ничего;
--   обычный ответ без цифр  -> normalize_variant_answer (score_auto_answer
--                              сравнивает только цифры и текст не различает).
create or replace function public.topic_test_score_item(
  p_student text, p_correct text, p_partial_type text, p_max_points integer
) returns integer language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_partial_type in ('matching', 'multi_choice') then
    return least(public.score_auto_answer(p_student, p_correct, p_partial_type), p_max_points);
  end if;
  if public.normalize_answer_digits(p_correct) <> '' then
    return case when public.score_auto_answer(p_student, p_correct, null) = 1
                then p_max_points else 0 end;
  end if;
  return case when public.normalize_variant_answer(coalesce(p_student, ''))
                   = public.normalize_variant_answer(p_correct)
               and btrim(coalesce(p_student, '')) <> ''
              then p_max_points else 0 end;
end $$;

create or replace function public.topic_test_can_manage(p_test_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.topic_material_can_manage(t.topic_id)
    from topic_tests t where t.id = p_test_id;
$$;

create or replace function public.topic_test_student_can_see(p_test_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_tests t
     where t.id = p_test_id
       and t.is_published
       and public.course_student_can_see_topic(t.topic_id)
  );
$$;

create or replace function public.topic_test_attempt_is_own(p_attempt_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_test_attempts a
     where a.id = p_attempt_id and a.student_id = public.auth_student_id()
  );
$$;

create or replace function public.topic_test_attempt_can_view(p_attempt_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_test_attempts a
     where a.id = p_attempt_id and public.topic_test_can_manage(a.test_id)
  );
$$;

-- ============================================================
-- 8. RLS
-- ============================================================
alter table public.topic_tests         enable row level security;
alter table public.topic_test_items    enable row level security;
alter table public.topic_test_attempts enable row level security;
alter table public.topic_test_answers  enable row level security;

grant select, insert, update, delete on public.topic_tests      to authenticated;
grant select, insert, update, delete on public.topic_test_items to authenticated;
grant select                         on public.topic_test_attempts to authenticated;
grant select                         on public.topic_test_answers  to authenticated;

-- ── тест ──
create policy topic_tests_staff_all on public.topic_tests
  for all to authenticated
  using      (public.topic_material_can_manage(topic_id))
  with check (public.topic_material_can_manage(topic_id) and created_by = auth.uid());

create policy topic_tests_student_select on public.topic_tests
  for select to authenticated
  using (is_published and public.course_student_can_see_topic(topic_id));

-- ── задания ──
-- Ученику прямого SELECT НЕТ: эталон ответа в этой же строке. Ученик
-- получает задания через RPC topic_test_student_items, которая отдаёт
-- эталон только после завершения попытки.
create policy topic_test_items_staff_all on public.topic_test_items
  for all to authenticated
  using      (public.topic_test_can_manage(test_id))
  with check (public.topic_test_can_manage(test_id));

-- ── попытки ──
-- Запись только через RPC (security definer): статус и баллы выставляет база.
create policy topic_test_attempts_select on public.topic_test_attempts
  for select to authenticated
  using (student_id = public.auth_student_id() or public.topic_test_can_manage(test_id));

-- ── ответы ──
create policy topic_test_answers_select on public.topic_test_answers
  for select to authenticated
  using (
    public.topic_test_attempt_is_own(attempt_id)
    or public.topic_test_attempt_can_view(attempt_id)
  );

-- ============================================================
-- 9. RPC
-- ============================================================

-- Добавить задание из каталога. Снапшот делает база, клиенту не доверяем.
create or replace function public.topic_test_add_item(p_test_id uuid, p_task_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_task record;
  v_answer_text text;
  v_assets jsonb;
  v_position integer;
  v_id uuid;
begin
  if not public.topic_test_can_manage(p_test_id) then
    raise exception 'Нет прав на редактирование теста' using errcode = 'insufficient_privilege';
  end if;

  select * into v_task from catalog_tasks where id = p_task_id and is_published;
  if not found then
    raise exception 'Задача каталога не найдена';
  end if;

  v_answer_text := public.topic_test_strip_html(v_task.answer_html);
  if not v_task.has_answer or v_answer_text = '' then
    raise exception 'У задачи нет текстового эталона ответа — автопроверка невозможна'
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'kind', a.kind, 'storage_path', a.storage_path,
           'alt', a.alt, 'position', a.position, 'tex_session_id', a.tex_session_id
         ) order by a.position), '[]'::jsonb)
    into v_assets
    from catalog_task_assets a where a.task_id = p_task_id;

  select coalesce(max(i.position), -1) + 1 into v_position
    from topic_test_items i where i.test_id = p_test_id;

  insert into topic_test_items (
    test_id, task_id, position, statement_html, answer_html, answer_text,
    solution_html, partial_type, max_points, exam_part, assets
  ) values (
    p_test_id, p_task_id, v_position, v_task.statement_html, v_task.answer_html,
    v_answer_text, v_task.solution_html, v_task.partial_type,
    coalesce(v_task.max_points, 1), v_task.exam_part, v_assets
  ) returning id into v_id;

  return v_id;
end $$;

-- Задания глазами ученика. Эталон/решение — только после завершения попытки.
create or replace function public.topic_test_student_items(p_test_id uuid)
returns table (
  id uuid, "position" integer, statement_html text, partial_type text,
  max_points smallint, exam_part smallint, assets jsonb,
  answer_html text, answer_text text, solution_html text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_done boolean;
begin
  if not public.topic_test_student_can_see(p_test_id) then
    if public.topic_test_can_manage(p_test_id) then
      v_done := true;  -- персоналу отдаём всё
    else
      raise exception 'Тест недоступен' using errcode = 'insufficient_privilege';
    end if;
  else
    select exists (
      select 1 from topic_test_attempts a
       where a.test_id = p_test_id
         and a.student_id = public.auth_student_id()
         and a.status = 'completed'
    ) or public.topic_test_can_manage(p_test_id) into v_done;
  end if;

  return query
    select i.id, i.position, i.statement_html, i.partial_type,
           i.max_points, i.exam_part, i.assets,
           case when v_done then i.answer_html   end,
           case when v_done then i.answer_text   end,
           case when v_done then i.solution_html end
      from topic_test_items i
     where i.test_id = p_test_id
     order by i.position, i.created_at;
end $$;

-- Начать попытку. Идемпотентна: вернёт существующую.
create or replace function public.topic_test_start_attempt(p_test_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid := public.auth_student_id();
  v_id uuid;
begin
  if v_student is null then
    raise exception 'Только ученик может начать тест' using errcode = 'insufficient_privilege';
  end if;
  if not public.topic_test_student_can_see(p_test_id) then
    raise exception 'Тест недоступен' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from topic_test_items i where i.test_id = p_test_id) then
    raise exception 'В тесте нет заданий';
  end if;

  select a.id into v_id
    from topic_test_attempts a
   where a.test_id = p_test_id and a.student_id = v_student;
  if v_id is not null then
    return v_id;
  end if;

  insert into topic_test_attempts (test_id, student_id)
  values (p_test_id, v_student)
  returning id into v_id;
  return v_id;
end $$;

-- Сохранить ответ (черновик, можно перезаписывать до сдачи).
create or replace function public.topic_test_save_answer(
  p_attempt_id uuid, p_item_id uuid, p_answer text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt record;
begin
  select * into v_attempt from topic_test_attempts a
   where a.id = p_attempt_id and a.student_id = public.auth_student_id();
  if not found then
    raise exception 'Попытка не найдена' using errcode = 'insufficient_privilege';
  end if;
  if v_attempt.status <> 'in_progress' then
    raise exception 'Тест уже завершён' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from topic_test_items i
     where i.id = p_item_id and i.test_id = v_attempt.test_id
  ) then
    raise exception 'Задание не из этого теста' using errcode = 'check_violation';
  end if;
  if length(coalesce(p_answer, '')) > 2000 then
    raise exception 'Ответ слишком длинный' using errcode = 'check_violation';
  end if;

  insert into topic_test_answers (attempt_id, item_id, answer_text)
  values (p_attempt_id, p_item_id, coalesce(p_answer, ''))
  on conflict (attempt_id, item_id)
  do update set answer_text = excluded.answer_text;
end $$;

-- Завершить попытку: автопроверка всех заданий одной транзакцией.
create or replace function public.topic_test_submit_attempt(p_attempt_id uuid)
returns table (total_points integer, max_points integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt record;
  v_total integer;
  v_max integer;
begin
  select * into v_attempt from topic_test_attempts a
   where a.id = p_attempt_id and a.student_id = public.auth_student_id()
   for update;
  if not found then
    raise exception 'Попытка не найдена' using errcode = 'insufficient_privilege';
  end if;
  if v_attempt.status <> 'in_progress' then
    raise exception 'Тест уже завершён' using errcode = 'check_violation';
  end if;

  -- Пустые ответы на незаполненные задания — 0 баллов, но строка есть:
  -- результат показывает все задания, а не только отвеченные.
  insert into topic_test_answers (attempt_id, item_id, answer_text)
  select p_attempt_id, i.id, ''
    from topic_test_items i
   where i.test_id = v_attempt.test_id
  on conflict (attempt_id, item_id) do nothing;

  -- Разрешаем триггеру-стражу запись баллов в рамках этой транзакции.
  perform set_config('app.topic_test_grading', 'on', true);

  update topic_test_answers ans
     set awarded_points = public.topic_test_score_item(
           ans.answer_text, i.answer_text, i.partial_type, i.max_points),
         is_correct = public.topic_test_score_item(
           ans.answer_text, i.answer_text, i.partial_type, i.max_points) = i.max_points
    from topic_test_items i
   where i.id = ans.item_id
     and ans.attempt_id = p_attempt_id;

  select coalesce(sum(ans.awarded_points), 0), coalesce(sum(i.max_points), 0)
    into v_total, v_max
    from topic_test_answers ans
    join topic_test_items i on i.id = ans.item_id
   where ans.attempt_id = p_attempt_id;

  update topic_test_attempts
     set status = 'completed', completed_at = now(),
         total_points = v_total, max_points = v_max
   where id = p_attempt_id;

  perform set_config('app.topic_test_grading', '', true);

  return query select v_total, v_max;
end $$;

comment on function public.topic_test_submit_attempt(uuid) is
  'Автопроверка по снапшоту эталона. Ручной проверки тестов нет (решение владельца).';

-- ============================================================
-- 10. Гранты: PUBLIC/anon закрыты
-- ============================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'topic\_test%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- нужны политикам
grant execute on function public.topic_test_can_manage(uuid)        to authenticated;
grant execute on function public.topic_test_student_can_see(uuid)   to authenticated;
grant execute on function public.topic_test_attempt_is_own(uuid)    to authenticated;
grant execute on function public.topic_test_attempt_can_view(uuid)  to authenticated;
-- нужны фронту
grant execute on function public.topic_test_add_item(uuid, uuid)          to authenticated;
grant execute on function public.topic_test_student_items(uuid)           to authenticated;
grant execute on function public.topic_test_start_attempt(uuid)           to authenticated;
grant execute on function public.topic_test_save_answer(uuid, uuid, text) to authenticated;
grant execute on function public.topic_test_submit_attempt(uuid)          to authenticated;
