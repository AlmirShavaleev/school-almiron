-- §262, шаг 1 из 2 (262a). Ответы и разборы каталога ученику — только с сервера, по правилу.
-- Применено оркестратором 03.10 (MCP apply_migration, версия 20261003155843); применённый текст — без строк-комментариев и comment on.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration одной транзакцией, после чего файл
-- переименовывается в <version>_<name>.sql точно по записи в supabase_migrations.schema_migrations
-- (MIGRATIONS.md). ТОЛЬКО ДОБАВЛЕНИЕ: четыре НОВЫЕ функции, ни одного drop, ни одного изменения
-- существующих таблиц, политик, прав и функций. Повторяемая (create or replace).
--
-- Порядок §262: 262a → выкладка клиента §262 → 262b (PENDING_262b.sql — закрытие колонок ответов).
-- После 262a сайт работает и старым клиентом (он по-прежнему читает catalog_tasks напрямую), и новым
-- (он берёт ответы только через функции ниже).
--
-- Какие поля секретные: answer_html, solution_html, solution_plan_html, grade_criteria_html
-- (ответ, решение, план решения, критерии). has_answer / has_solution — флаги, остаются открытыми.
--
-- ══ ПРАВИЛО: когда текст ответа положен (одно место — catalog_answer_reasons) ═══════════════════════
-- Найдено в коде и базе, повторено дословно по смыслу; причина — первая подходящая по порядку:
--   staff          — персонал платформы: profiles.role in (teacher, curator, admin, owner). То же, что
--                    topic_test_bank_is_staff() (20260726142040) и STAFF_ROLES страниц каталога.
--                    Конструктор вариантов, PDF, корзина учителя, подборки, проверка — как сейчас.
--   — дальше только опубликованные задачи (как RLS catalog_tasks_select_auth: auth.uid() и is_published);
--   not_checkable  — задача каталога без проверки (catalog_task_checkable = false: часть 2 или эталон, который
--                    автопроверка не берёт). Сейчас ученик видит её ответ/решение без «раскрытия»
--                    (TaskDisplayCard: needsReveal только у проверяемых) — так и остаётся: в баллы и
--                    прогноз такие задачи не идут (catalog_check_answer их не принимает).
--   solved         — верная попытка в каталоге (catalog_task_attempts.verdict = 'correct', §256): ответ уже
--                    пришёл ученику в ответе catalog_check_answer, задача повторно не засчитывается.
--   revealed       — ответ открыт (catalog_task_reveals, catalog_reveal_answer §256): дальше не засчитывается.
--   variant        — задача варианта, СДАННОГО учеником (test_variant_student_assignments.status in
--                    ('submitted','completed')) — ровно условие get_variant_items_for_student (20260802233144).
--   lesson         — задача к уроку, разбор которой ученик открыл (test_variant_answers.solution_shown_at,
--                    выдача темы не отменена) — условие topic_tasks_for_student (20260912212817) и
--                    reveal_topic_task_solution (20260914213339, «после первой попытки»).
--   test           — задача теста темы, попытка ЗАВЕРШЕНА (topic_test_attempts.status = 'completed') —
--                    условие topic_test_assignment_items (20260726142040). Там эталон — снимок
--                    topic_test_items; здесь — текущий текст той же задачи каталога.
--   иначе — null: ответ/разбор не отдаётся (до раскрытия или верной проверки — null).
--
-- Контекстные функции (get_variant_items_for_student, topic_tasks_for_student, reveal_topic_task_solution,
-- topic_test_assignment_items, catalog_check_answer, catalog_reveal_answer) НЕ переписаны: каждая отдаёт
-- текст по правилу СВОЕГО контекста (вариант во время попытки не показывает ответ, даже если ученик
-- открыл его в каталоге) и уже security definer — после 262b работают как прежде. Правило выше — их
-- объединение для мест, где задача показывается вне контекста: страницы каталога, поиск, корзина,
-- PDF ученика, подборки, конструктор.

-- ══ 1. Правило (внутреннее) ══════════════════════════════════════════════════════════════════════════
create or replace function public.catalog_answer_reasons(p_uid uuid, p_task_ids uuid[])
returns table (task_id uuid, reason text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ids as (
    select distinct x.id
      from unnest(coalesce(p_task_ids, '{}'::uuid[])) as x(id)
     where p_uid is not null and x.id is not null
  ),
  who as (
    select exists (select 1 from public.profiles p
                    where p.id = p_uid and p.role in ('teacher', 'curator', 'admin', 'owner')) as staff
  ),
  mine as (
    select s.id from public.students s where s.profile_id = p_uid
  ),
  by_variant as (
    select distinct tvi.task_id
      from public.test_variant_student_assignments tvsa
      join public.test_variant_items tvi on tvi.variant_id = tvsa.variant_id
     where tvsa.student_id in (select m.id from mine m)
       and tvsa.status in ('submitted', 'completed')
       and tvi.task_id in (select i.id from ids i)
  ),
  by_lesson as (
    select distinct tvi.task_id
      from public.test_variant_assignments tva
      join public.test_variant_student_assignments tvsa on tvsa.assignment_id = tva.id
      join public.test_variant_items tvi on tvi.variant_id = tva.variant_id
      join public.test_variant_answers ans on ans.student_assignment_id = tvsa.id and ans.variant_item_id = tvi.id
     where tva.topic_id is not null
       and tvsa.student_id in (select m.id from mine m)
       and tvsa.status <> 'cancelled'
       and ans.solution_shown_at is not null
       and tvi.task_id in (select i.id from ids i)
  ),
  by_test as (
    select distinct ti.task_id
      from public.topic_test_attempts att
      join public.topic_test_items ti on ti.test_id = att.test_id
     where att.student_id in (select m.id from mine m)
       and att.status = 'completed'
       and ti.task_id in (select i.id from ids i)
  )
  select ct.id,
         case
           when who.staff then 'staff'
           when not ct.is_published then null
           when not public.catalog_task_checkable(ct.exam_part, ct.answer_html, ct.partial_type) then 'not_checkable'
           when exists (select 1 from public.catalog_task_attempts a
                         where a.profile_id = p_uid and a.task_id = ct.id and a.verdict = 'correct') then 'solved'
           when exists (select 1 from public.catalog_task_reveals rv
                         where rv.profile_id = p_uid and rv.task_id = ct.id) then 'revealed'
           when ct.id in (select v.task_id from by_variant v) then 'variant'
           when ct.id in (select l.task_id from by_lesson l) then 'lesson'
           when ct.id in (select t.task_id from by_test t) then 'test'
         end
    from public.catalog_tasks ct
    join ids on ids.id = ct.id
   cross join who;
$$;

comment on function public.catalog_answer_reasons(uuid, uuid[]) is
  '§262. ПРАВИЛО одним местом: почему пользователю положен текст ответа/разбора задачи каталога — staff | not_checkable | solved | revealed | variant | lesson | test; null — не положен. Внутренняя (только из definer-функций §262).';

revoke all on function public.catalog_answer_reasons(uuid, uuid[]) from public, anon, authenticated;

-- ══ 2. Выдача пачкой (и персоналу — все поля) ════════════════════════════════════════════════════════
-- Одна функция для ученика и для персонала: персоналу правило отвечает 'staff' — все поля всех задач;
-- ученику — тексты только там, где правило не null. Строка есть у каждой видимой задачи (allowed = false
-- — «закрыто»: клиент показывает кнопку и открывает через catalog_reveal_answers). has_plan / has_criteria —
-- есть ли план и критерии (флаги, как has_answer / has_solution), чтобы кнопки не пропадали до раскрытия.
-- Неопубликованных задач ученик не получает вовсе (как RLS). Не больше 300 id за раз (как catalog_practice_state).
create or replace function public.catalog_task_texts(p_task_ids uuid[])
returns table (
  task_id             uuid,
  allowed             boolean,
  reason              text,
  answer_html         text,
  solution_html       text,
  solution_plan_html  text,
  grade_criteria_html text,
  has_plan            boolean,
  has_criteria        boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'catalog_task_texts: нужен вход' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_task_ids, '{}'::uuid[])) > 300 then
    raise exception 'TOO_MANY: не больше 300 задач за раз' using errcode = '22023';
  end if;

  return query
    select ct.id,
           r.reason is not null,
           r.reason,
           case when r.reason is not null then ct.answer_html end,
           case when r.reason is not null then ct.solution_html end,
           case when r.reason is not null then ct.solution_plan_html end,
           case when r.reason is not null then ct.grade_criteria_html end,
           coalesce(ct.solution_plan_html, '') <> '',
           coalesce(ct.grade_criteria_html, '') <> ''
      from public.catalog_answer_reasons(v_uid, p_task_ids) r
      join public.catalog_tasks ct on ct.id = r.task_id
     where r.reason is not null or ct.is_published;
end;
$$;

comment on function public.catalog_task_texts(uuid[]) is
  '§262. Ответ, решение, план и критерии задач каталога по списку id (до 300) — ученику только по правилу catalog_answer_reasons (иначе null и allowed = false), персоналу платформы — всё. Единственный путь к этим полям для клиента после 262b.';

revoke all on function public.catalog_task_texts(uuid[]) from public, anon;
grant execute on function public.catalog_task_texts(uuid[]) to authenticated;

-- ══ 3. Выдача по одной задаче ════════════════════════════════════════════════════════════════════════
create or replace function public.catalog_task_text(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(t) from public.catalog_task_texts(array[p_task_id]) t;
$$;

comment on function public.catalog_task_text(uuid) is
  '§262. То же, что catalog_task_texts, для одной задачи: jsonb {task_id, allowed, reason, answer_html, solution_html, solution_plan_html, grade_criteria_html, has_plan, has_criteria} или null.';

revoke all on function public.catalog_task_text(uuid) from public, anon;
grant execute on function public.catalog_task_text(uuid) to authenticated;

-- ══ 4. Раскрыть и получить тексты (пачкой) ═══════════════════════════════════════════════════════════
-- То же действие, что catalog_reveal_answer (§256): отметка в catalog_task_reveals (первое раскрытие,
-- опубликованная задача в опубликованном разделе) — дальнейшие попытки revealed_before, в баллы и прогноз не
-- идут; решённую задачу раскрытие не трогает. Отличия: пачкой (PDF ученика с ответами — одной операцией,
-- без N+1) и в ответе все четыре поля по правилу (после отметки — 'revealed'), а не только answer_html.
-- catalog_reveal_answer остаётся как есть (прежний клиент её вызывает).
create or replace function public.catalog_reveal_answers(p_task_ids uuid[])
returns table (
  task_id             uuid,
  allowed             boolean,
  reason              text,
  answer_html         text,
  solution_html       text,
  solution_plan_html  text,
  grade_criteria_html text,
  has_plan            boolean,
  has_criteria        boolean
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'catalog_reveal_answers: нужен вход' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_task_ids, '{}'::uuid[])) > 300 then
    raise exception 'TOO_MANY: не больше 300 задач за раз' using errcode = '22023';
  end if;

  insert into public.catalog_task_reveals (profile_id, task_id)
  select v_uid, ct.id
    from public.catalog_tasks ct
    join public.catalog_sections cs on cs.id = ct.section_id
   where ct.id = any (coalesce(p_task_ids, '{}'::uuid[])) and ct.is_published and cs.is_published
  on conflict (profile_id, task_id) do nothing;

  return query select * from public.catalog_task_texts(p_task_ids);
end;
$$;

comment on function public.catalog_reveal_answers(uuid[]) is
  '§262. Открыть ответы задач каталога (до 300): отметка в catalog_task_reveals, как catalog_reveal_answer (§256) — дальше задача в баллы и прогноз не идёт, решённую не трогает; возвращает тексты по правилу (как catalog_task_texts).';

revoke all on function public.catalog_reveal_answers(uuid[]) from public, anon;
grant execute on function public.catalog_reveal_answers(uuid[]) to authenticated;
