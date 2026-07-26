-- ============================================================
-- Банк тестов + привязки к темам
-- ============================================================
-- СТАТУС: ПРИМЕНЕНО 2026-07-26 через одобренный MCP-процесс.
--   version = 20260726142040
--   name    = topic_test_bank
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- Продуктовое решение владельца (2026-07-26, вечер):
--   * тест — самостоятельная сущность банка: составляется из каталога
--     на своей странице, имеет название, переиспользуется;
--   * к теме тест ПРИКРЕПЛЯЕТСЯ (одна привязка на тему);
--   * попытка ученика — НА ПРИВЯЗКУ: тот же тест в другой теме
--     проходится заново;
--   * ученик видит тест только через привязку к доступной теме,
--     is_published больше не участвует в видимости (легаси-флаг банка).
--
-- Данные на момент миграции: 1 тест без заданий, привязок/попыток нет —
-- перенос данных тривиален (insert into assignments из topic_id).
-- ============================================================

-- ============================================================
-- 1. Привязки тест -> тема
-- ============================================================
create table public.topic_test_assignments (
  id          uuid primary key default gen_random_uuid(),
  test_id     uuid not null references public.topic_tests(id) on delete cascade,
  topic_id    uuid not null unique references public.topics(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now()
);

comment on table public.topic_test_assignments is
  'Привязка теста банка к теме. UNIQUE(topic_id) — у темы один тест. Попытки учеников живут на привязке.';

create index topic_test_assignments_test_idx on public.topic_test_assignments(test_id);

-- перенос существующей привязки из topic_tests.topic_id
insert into public.topic_test_assignments (test_id, topic_id, assigned_by)
select t.id, t.topic_id, t.created_by
  from public.topic_tests t
 where t.topic_id is not null;

-- ============================================================
-- 2. topic_tests становится банком: topic_id уходит
-- ============================================================
drop policy topic_tests_staff_all      on public.topic_tests;
drop policy topic_tests_student_select on public.topic_tests;

alter table public.topic_tests drop column topic_id;

comment on table public.topic_tests is
  'Банк тестов. Составляется из каталога (снапшоты в topic_test_items), к темам прикрепляется через topic_test_assignments. is_published — легаси-флаг, в видимости не участвует.';

-- ============================================================
-- 3. Попытка на привязку
-- ============================================================
alter table public.topic_test_attempts
  add column assignment_id uuid references public.topic_test_assignments(id) on delete cascade;
-- таблица пуста (проверено) — сразу ужесточаем
alter table public.topic_test_attempts alter column assignment_id set not null;

alter table public.topic_test_attempts drop constraint topic_test_attempts_unique;
alter table public.topic_test_attempts
  add constraint topic_test_attempts_unique unique (assignment_id, student_id);

comment on table public.topic_test_attempts is
  'Попытка прохождения. UNIQUE(assignment_id, student_id) — одна попытка на привязку: тот же тест в другой теме проходится заново. test_id денормализован для заморозки состава заданий.';

-- ============================================================
-- 4. Хелперы доступа
-- ============================================================
-- Персонал банка: любой сотрудник школы видит банк; управляет тестом
-- его автор либо admin/owner.
create or replace function public.topic_test_bank_is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid() and p.role in ('teacher', 'curator', 'admin', 'owner')
  );
$$;

create or replace function public.topic_test_bank_can_manage(p_test_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_tests t, profiles p
     where t.id = p_test_id and p.id = auth.uid()
       and (t.created_by = p.id or p.role in ('admin', 'owner'))
  );
$$;

-- Ученик видит тест через привязку к доступной теме.
create or replace function public.topic_test_student_can_see_assignment(p_assignment_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_test_assignments a
     where a.id = p_assignment_id
       and public.course_student_can_see_topic(a.topic_id)
  );
$$;

-- Старые хелперы на новую семантику (их используют политики items/attempts/answers).
create or replace function public.topic_test_can_manage(p_test_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.topic_test_bank_can_manage(p_test_id);
$$;

-- «Видит ли ученик тест» — хотя бы одна доступная привязка.
create or replace function public.topic_test_student_can_see(p_test_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_test_assignments a
     where a.test_id = p_test_id
       and public.course_student_can_see_topic(a.topic_id)
  );
$$;

-- ============================================================
-- 5. RLS
-- ============================================================
alter table public.topic_test_assignments enable row level security;
grant select, insert, delete on public.topic_test_assignments to authenticated;

-- банк: персонал школы читает всё, автор/админ правит
create policy topic_tests_bank_staff_select on public.topic_tests
  for select to authenticated
  using (public.topic_test_bank_is_staff());

create policy topic_tests_bank_insert on public.topic_tests
  for insert to authenticated
  with check (public.topic_test_bank_is_staff() and created_by = auth.uid());

create policy topic_tests_bank_update on public.topic_tests
  for update to authenticated
  using      (public.topic_test_bank_can_manage(id))
  with check (public.topic_test_bank_can_manage(id));

create policy topic_tests_bank_delete on public.topic_tests
  for delete to authenticated
  using (public.topic_test_bank_can_manage(id));

-- ученику тест виден через привязку (название на странице темы)
create policy topic_tests_student_select on public.topic_tests
  for select to authenticated
  using (public.topic_test_student_can_see(id));

-- привязки: персоналом курса темы управляется, ученик видит доступные
create policy topic_test_assignments_staff_all on public.topic_test_assignments
  for all to authenticated
  using      (public.topic_material_can_manage(topic_id))
  with check (public.topic_material_can_manage(topic_id) and assigned_by = auth.uid());

create policy topic_test_assignments_student_select on public.topic_test_assignments
  for select to authenticated
  using (public.course_student_can_see_topic(topic_id));

-- items: политика topic_test_items_staff_all уже опирается на
-- topic_test_can_manage(test_id) — семантика подменена хелпером выше,
-- менять политику не нужно. Ученику прямого SELECT по-прежнему нет.

-- ============================================================
-- 6. RPC на привязках
-- ============================================================
drop function public.topic_test_student_items(uuid);
drop function public.topic_test_start_attempt(uuid);

-- Задания глазами ученика: по привязке. Эталоны — после завершения попытки
-- именно этой привязки. Персоналу отдаёт всё.
create or replace function public.topic_test_assignment_items(p_assignment_id uuid)
returns table (
  id uuid, "position" integer, statement_html text, partial_type text,
  max_points smallint, exam_part smallint, assets jsonb,
  answer_html text, answer_text text, solution_html text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_test uuid;
  v_done boolean;
begin
  select a.test_id into v_test from topic_test_assignments a where a.id = p_assignment_id;
  if v_test is null then
    raise exception 'Привязка не найдена';
  end if;

  if public.topic_test_bank_is_staff() then
    v_done := true;
  elsif public.topic_test_student_can_see_assignment(p_assignment_id) then
    select exists (
      select 1 from topic_test_attempts at
       where at.assignment_id = p_assignment_id
         and at.student_id = public.auth_student_id()
         and at.status = 'completed'
    ) into v_done;
  else
    raise exception 'Тест недоступен' using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.position, i.statement_html, i.partial_type,
           i.max_points, i.exam_part, i.assets,
           case when v_done then i.answer_html   end,
           case when v_done then i.answer_text   end,
           case when v_done then i.solution_html end
      from topic_test_items i
     where i.test_id = v_test
     order by i.position, i.created_at;
end $$;

-- Начать попытку по привязке. Идемпотентна.
create or replace function public.topic_test_start_attempt(p_assignment_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid := public.auth_student_id();
  v_test uuid;
  v_id uuid;
begin
  if v_student is null then
    raise exception 'Только ученик может начать тест' using errcode = 'insufficient_privilege';
  end if;
  if not public.topic_test_student_can_see_assignment(p_assignment_id) then
    raise exception 'Тест недоступен' using errcode = 'insufficient_privilege';
  end if;

  select a.test_id into v_test from topic_test_assignments a where a.id = p_assignment_id;
  if not exists (select 1 from topic_test_items i where i.test_id = v_test) then
    raise exception 'В тесте нет заданий';
  end if;

  select at.id into v_id
    from topic_test_attempts at
   where at.assignment_id = p_assignment_id and at.student_id = v_student;
  if v_id is not null then
    return v_id;
  end if;

  insert into topic_test_attempts (test_id, assignment_id, student_id)
  values (v_test, p_assignment_id, v_student)
  returning id into v_id;
  return v_id;
end $$;

-- topic_test_save_answer / topic_test_submit_attempt работают по attempt_id
-- и семантически не меняются (submit берёт задания по attempt.test_id).

-- Прикрепить тест из банка к теме нельзя без заданий — иначе ученик
-- упрётся в пустой тест. Держим инвариант триггером.
create or replace function public.topic_test_assignments_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from topic_test_items i where i.test_id = new.test_id) then
    raise exception 'В тесте нет заданий — прикреплять нечего' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger topic_test_assignments_guard_trg
  before insert on public.topic_test_assignments
  for each row execute function public.topic_test_assignments_guard();

-- Открепление при существующих попытках уничтожило бы результаты (cascade).
create or replace function public.topic_test_assignments_delete_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from topic_test_attempts at where at.assignment_id = old.id) then
    raise exception 'По привязке уже есть попытки учеников — открепить нельзя'
      using errcode = 'check_violation';
  end if;
  return old;
end $$;

create trigger topic_test_assignments_delete_guard_trg
  before delete on public.topic_test_assignments
  for each row execute function public.topic_test_assignments_delete_guard();

-- ============================================================
-- 7. Гранты
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
grant execute on function public.topic_test_can_manage(uuid)                     to authenticated;
grant execute on function public.topic_test_student_can_see(uuid)                to authenticated;
grant execute on function public.topic_test_attempt_is_own(uuid)                 to authenticated;
grant execute on function public.topic_test_attempt_can_view(uuid)               to authenticated;
grant execute on function public.topic_test_bank_is_staff()                      to authenticated;
grant execute on function public.topic_test_bank_can_manage(uuid)                to authenticated;
grant execute on function public.topic_test_student_can_see_assignment(uuid)     to authenticated;
-- нужны фронту
grant execute on function public.topic_test_add_item(uuid, uuid)                 to authenticated;
grant execute on function public.topic_test_assignment_items(uuid)               to authenticated;
grant execute on function public.topic_test_start_attempt(uuid)                  to authenticated;
grant execute on function public.topic_test_save_answer(uuid, uuid, text)        to authenticated;
grant execute on function public.topic_test_submit_attempt(uuid)                 to authenticated;
