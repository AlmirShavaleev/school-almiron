-- §263. Проверочная вживую (учитель), режим работы (ученик), флажки варианта «ответы/решения после сдачи».
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration ОДНОЙ транзакцией, после чего файл
-- переименовывается в <version>_<name>.sql точно по записи в supabase_migrations.schema_migrations
-- (MIGRATIONS.md). ТОЛЬКО ДОБАВЛЕНИЕ: ни одного drop. Новые таблица, функции, политики (через
-- do $$ … if not exists (pg_policies) $$), триггеры (через if not exists (pg_trigger)); create or replace
-- ТРЁХ существующих функций с тем же видом (topic_material_object_visible, catalog_answer_reasons,
-- get_variant_items_for_student: сигнатура и тип результата прежние) — тела взяты из последних редакций в
-- репозитории и дополнены (каждая помечена ниже); default true у двух колонок test_variant_assignments и
-- разовое обновление данных (раздел 0). Повторяемая: второй прогон проходит без ошибок
-- и ничего не меняет (supabase/tests/rezhim_263/run.sh гоняет файл дважды).
--
-- Что меняется для пользователей сразу после применения (до выкладки клиента):
--   * ученик, у которого идёт работа по времени (проверочная/контрольная §240, окно — личное §240, если есть)
--     или пробник (§221, окно mock_exam_window), пока не сдал: каталог (строки catalog_tasks, тексты ответов
--     catalog_task_texts/catalog_reveal_answers, проверка и раскрытие §256), материалы тем (строки и файлы),
--     кроме условия СВОЕЙ работы, и ответы/решения вариантов — закрыты сервером. Сдал или окно кончилось —
--     всё открывается тем же запросом (правило считается по now()).
--   * Варианты: show_answers_after_submit / show_solutions_after_submit начинают работать. Уже выданным
--     вариантам оба флажка ставятся в true (раньше флажки не применялись и ученик видел всё — так и остаётся);
--     у колонок default true.
--
-- ══ 0. Флажки варианта: уже выданным — как было (один раз) ════════════════════════════════════════════
-- Раньше флажки не применял ни сервер (get_variant_items_for_student отдавал эталон и решение после сдачи
-- всем), ни клиент. Выдача с учительской страницы (AssignVariantPage) ставила их по умолчанию в false,
-- привязка к теме (attach_variant_to_topic, ленивая выдача задач урока) — в true. Чтобы включение правила
-- не спрятало ответы у уже выданных вариантов, все существующие выдачи получают true/true — ровно то, что
-- ученики видели до сих пор. Делается ОДИН раз: признак «уже делали» — существование таблицы work_activity,
-- которую этот же файл создаёт ниже (на повторном прогоне таблица уже есть — данные не трогаются, и выбор
-- учителя, сделанный после применения, не перетирается).
do $$
begin
  if to_regclass('public.work_activity') is null then
    update public.test_variant_assignments
       set show_answers_after_submit = true,
           show_solutions_after_submit = true
     where not (show_answers_after_submit and show_solutions_after_submit);
  end if;
end
$$;

alter table public.test_variant_assignments alter column show_answers_after_submit set default true;
alter table public.test_variant_assignments alter column show_solutions_after_submit set default true;

-- ══ 1. Отметки ученика во время работы: открыл условие, уходил со страницы ═════════════════════════════
-- Своя таблица, а не черновик попытки (решение §263): черновик в момент открытия поменял бы смысл попытки —
-- «есть черновик» сейчас значит «начал загружать фото»; автосдача §240 сдаёт черновики С ФОТО (без фото — нет,
-- так и остаётся), «Открыть заново» отказывает только при сданной, очереди проверки и счётчики «пишут» §241
-- считают черновики. Отметка открытия отдельно ничего из этого не трогает.
-- Одна строка на ученика и работу: работа по времени (homework_id) ИЛИ пробник (mock_exam_id). У пробника
-- «открыл» уже пишет mock_exam_ping (§224, mock_exam_sheets.opened_at) — здесь для него только уходы.
-- Пишут ТОЛЬКО definer-функции work_mark_opened / work_report_away (ученик — про себя и только пока идёт его
-- работа); читает только персонал курса (ученику счётчик не показывается — решение §263).
create table if not exists public.work_activity (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.students(id) on delete cascade,
  homework_id    uuid references public.topic_homework(id) on delete cascade,
  mock_exam_id   uuid references public.mock_exams(id) on delete cascade,
  opened_at      timestamptz,
  away_count     integer not null default 0 check (away_count >= 0),
  away_seconds   integer not null default 0 check (away_seconds >= 0),
  last_away_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint work_activity_one_target check (num_nonnulls(homework_id, mock_exam_id) = 1)
);

create unique index if not exists work_activity_homework_key
  on public.work_activity (homework_id, student_id) where homework_id is not null;
create unique index if not exists work_activity_mock_key
  on public.work_activity (mock_exam_id, student_id) where mock_exam_id is not null;

comment on table public.work_activity is
  '§263. Отметки ученика во время работы по времени / пробника: первое открытие условия (opened_at, только у работы по времени) и уходы со страницы работы (away_count, away_seconds). Пишут только work_mark_opened / work_report_away; читает персонал курса.';

alter table public.work_activity enable row level security;
revoke all on public.work_activity from anon;
revoke insert, update, delete on public.work_activity from authenticated;
grant select on public.work_activity to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'work_activity' and policyname = 'work_activity_staff_select') then
    create policy work_activity_staff_select on public.work_activity
      for select to authenticated
      using (
        (homework_id is not null and public.topic_homework_can_manage(homework_id))
        or (mock_exam_id is not null and public.mock_exam_is_staff(mock_exam_id))
      );
  end if;
end
$$;

-- ══ 2. ОДНО определение «у ученика сейчас идёт работа» ════════════════════════════════════════════════
-- Работа по времени: тема kind check/control, ДЗ опубликовано, тема ученику открыта (topic_open_now), ученик
-- в курсе (группа курса или действующая подписка — как course_student_has_access), действующее окно
-- (topic_homework_student_window: личное заменяет общее, §240) идёт сейчас, сданной попытки нет.
-- Пробник: ученик в группе пробника, окно mock_exam_window (§221) идёт (starts_at <= now() < ends_at —
-- догрузка фото после конца в режим не входит), бланк не сдан.
-- Внутренняя: её зовут функции и политики ниже (ученику — work_mode_* по auth_student_id(), учителю — монитор).
create or replace function public.student_active_works(p_student_id uuid)
returns table (
  kind         text,      -- timed | mock
  work_kind    text,      -- check | control | mock
  homework_id  uuid,
  mock_exam_id uuid,
  topic_id     uuid,
  course_id    uuid,
  group_id     uuid,
  title        text,
  opens_at     timestamptz,
  closes_at    timestamptz,
  personal     boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 'timed'::text, t.kind, h.id, null::uuid, t.id, m.course_id,
         (select g.id from public.groups g
            join public.group_students gs on gs.group_id = g.id
           where g.course_id = m.course_id and gs.student_id = p_student_id
           limit 1),
         t.title, w.opens_at, w.closes_at, w.personal
    from public.topic_homework h
    join public.topics t on t.id = h.topic_id and t.kind in ('check', 'control')
    join public.modules m on m.id = t.module_id
   cross join lateral public.topic_homework_student_window(h.id, p_student_id) w
   where p_student_id is not null
     and h.is_published
     -- Сужение до вычисления окна: общее окно идёт ИЛИ у ученика есть личное (окончательно решает w ниже).
     and ((h.opens_at <= now() and now() < h.closes_at)
          or exists (select 1 from public.topic_homework_personal_windows pw
                      where pw.homework_id = h.id and pw.student_id = p_student_id))
     and w.opens_at <= now() and now() < w.closes_at
     and public.topic_open_now(t.is_open, t.available_from)
     and (exists (select 1 from public.group_students gs
                    join public.groups g on g.id = gs.group_id
                   where gs.student_id = p_student_id and g.course_id = m.course_id)
          or exists (select 1 from public.student_courses sc
                      where sc.student_id = p_student_id and sc.course_id = m.course_id
                        and sc.status in ('active', 'trial')
                        and (sc.expires_at is null or sc.expires_at > now())))
     and not exists (select 1 from public.topic_homework_attempts a
                      where a.homework_id = h.id and a.student_id = p_student_id and a.status <> 'draft')
  union all
  select 'mock'::text, 'mock'::text, null::uuid, me.id, null::uuid, g.course_id, me.group_id,
         me.title, w.starts_at, w.ends_at, false
    from public.mock_exams me
    join public.group_students gs on gs.group_id = me.group_id and gs.student_id = p_student_id
    join public.groups g on g.id = me.group_id
   cross join lateral public.mock_exam_window(me.id) w
   where p_student_id is not null
     and me.starts_at is not null
     and w.starts_at <= now() and now() < w.ends_at
     and not exists (select 1 from public.mock_exam_sheets sh
                      where sh.mock_exam_id = me.id and sh.student_id = p_student_id
                        and sh.submitted_at is not null);
$$;

comment on function public.student_active_works(uuid) is
  '§263. ЕДИНСТВЕННОЕ определение «у ученика сейчас идёт работа»: работа по времени (действующее окно — topic_homework_student_window, не сдана) или пробник (окно mock_exam_window, бланк не сдан). Внутренняя.';

revoke all on function public.student_active_works(uuid) from public, anon, authenticated;

-- Для политик и функций под вызывающим. Обе — по auth_student_id(); у персонала (нет строки students)
-- работы нет никогда. В политиках зовутся как (select …) — один раз на запрос, не на строку.
create or replace function public.work_mode_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.student_active_works(public.auth_student_id()));
$$;

-- null — работы нет (всё открыто); массив — идёт работа, открыты только условия этих тем (у пробника — пусто).
create or replace function public.work_mode_condition_topics()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when count(*) > 0
              then coalesce(array_agg(w.topic_id) filter (where w.topic_id is not null), '{}'::uuid[])
         end
    from public.student_active_works(public.auth_student_id()) w;
$$;

-- Строка материала темы открыта ли сейчас под режимом работы (для функции видимости файлов).
create or replace function public.work_mode_material_open(p_topic_id uuid, p_section text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select w is null or (p_section = 'worksheet_homework' and p_topic_id = any (w))
    from (select public.work_mode_condition_topics() as w) x;
$$;

-- То же для произвольного ученика по профилю (триггеры каталога: строку пишет definer-функция, auth.uid()
-- там прежний, но правило — про того, чья строка).
create or replace function public.work_mode_active_for_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.students s
     cross join lateral public.student_active_works(s.id) w
     where s.profile_id = p_profile_id
  );
$$;

revoke all on function public.work_mode_active() from public, anon;
revoke all on function public.work_mode_condition_topics() from public, anon;
revoke all on function public.work_mode_material_open(uuid, text) from public, anon;
revoke all on function public.work_mode_active_for_profile(uuid) from public, anon, authenticated;
grant execute on function public.work_mode_active() to authenticated;
grant execute on function public.work_mode_condition_topics() to authenticated;
grant execute on function public.work_mode_material_open(uuid, text) to authenticated;

-- Клиенту: идёт ли у меня работа (полоса «Идёт проверочная · до HH:MM», закрытые разделы). Несколько работ
-- разом — та, что кончается раньше. Серверное время — для таймера.
create or replace function public.my_work_mode()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object(
              'active', true,
              'kind', w.kind,
              'work_kind', w.work_kind,
              'homework_id', w.homework_id,
              'mock_exam_id', w.mock_exam_id,
              'topic_id', w.topic_id,
              'course_id', w.course_id,
              'group_id', w.group_id,
              'title', w.title,
              'opens_at', w.opens_at,
              'closes_at', w.closes_at,
              'personal', w.personal,
              'server_now', now())
       from public.student_active_works(public.auth_student_id()) w
      order by w.closes_at, w.title
      limit 1),
    jsonb_build_object('active', false, 'server_now', now()));
$$;

comment on function public.my_work_mode() is
  '§263. Режим работы вызывающего ученика: {active, kind, work_kind, homework_id | mock_exam_id, topic_id, course_id, group_id, title, opens_at, closes_at, personal, server_now}; без работы — {active: false, server_now}.';

revoke all on function public.my_work_mode() from public, anon;
grant execute on function public.my_work_mode() to authenticated;

-- ══ 3. Сервер закрывает на время работы ═══════════════════════════════════════════════════════════════
-- 3.1. Каталог: строки задач (условия) — ограничительная политика (AND с действующими разрешающими).
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'catalog_tasks' and policyname = 'catalog_tasks_work_mode') then
    create policy catalog_tasks_work_mode on public.catalog_tasks
      as restrictive
      for select to authenticated
      using (not (select public.work_mode_active()));
  end if;
end
$$;

-- 3.2. Материалы тем: строки — ограничительная политика; открыто только условие своей работы
-- (worksheet_homework темы, у которой идёт работа). Решение и критерии своей работы и так закрыты до проверки.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'topic_material_items' and policyname = 'topic_material_items_work_mode') then
    create policy topic_material_items_work_mode on public.topic_material_items
      as restrictive
      for select to authenticated
      using (
        (select public.work_mode_condition_topics()) is null
        or (section = 'worksheet_homework' and topic_id = any ((select public.work_mode_condition_topics())::uuid[]))
      );
  end if;
end
$$;

-- 3.3. Файлы материалов (бакет topic-materials, политика topic_material_files_read).
-- Тело — из 20260928122420_kontrolnaya_timed_work.sql (последняя редакция), в ветку ученика добавлена
-- одна строка: work_mode_material_open. Ветка персонала прежняя.
create or replace function public.topic_material_object_visible(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.topic_material_items i
     where i.storage_path = p_object_name
       and (
            public.topic_material_can_manage(i.topic_id)
         or (
              public.course_student_can_see_topic(i.topic_id)
              and (i.section is distinct from 'solution'
                   or i.track = 'training'
                   or public.topic_solution_unlocked(i.topic_id))
              and (i.section is distinct from 'criteria'
                   or i.track = 'training'
                   or public.topic_solution_unlocked(i.topic_id))
              and (i.section is distinct from 'worksheet_homework'
                   or i.track = 'training'
                   or public.topic_condition_visible(i.topic_id))
              and public.work_mode_material_open(i.topic_id, i.section)
            )
       )
  );
$$;

-- 3.4. Проверка и раскрытие ответа каталога (§256 catalog_check_answer, catalog_reveal_answer; §262
-- catalog_reveal_answers) пишут строку попытки/раскрытия — сторож на вставку отказывает, пока у владельца
-- строки идёт работа. Тела функций не трогаются.
create or replace function public.catalog_work_mode_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.work_mode_active_for_profile(new.profile_id) then
    raise exception 'WORK_MODE: идёт работа по времени — каталог закрыт до её конца' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.catalog_work_mode_guard() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'catalog_task_attempts_work_mode' and tgrelid = 'public.catalog_task_attempts'::regclass) then
    create trigger catalog_task_attempts_work_mode
      before insert on public.catalog_task_attempts
      for each row execute function public.catalog_work_mode_guard();
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'catalog_task_reveals_work_mode' and tgrelid = 'public.catalog_task_reveals'::regclass) then
    create trigger catalog_task_reveals_work_mode
      before insert on public.catalog_task_reveals
      for each row execute function public.catalog_work_mode_guard();
  end if;
end
$$;

-- 3.5. ПРАВИЛО §262 (catalog_answer_reasons). Тело — из 20261003155843_catalog_answers_server_part_a_functions.sql,
-- добавлено: (а) идёт работа у ученика → null по всем задачам (catalog_task_texts / catalog_reveal_answers
-- отдают allowed = false и пустые тексты); персонал — как был; (б) ветка variant — только у выдачи, где учитель
-- оставил ОБА флажка (ответы и решения после сдачи): каталог отдаёт ответ и решение вместе, поэтому выдача
-- «только ответы» или «ничего» задачу в каталоге не открывает (раскрыть её там ученик может — §52, ценой
-- баллов каталога). Флажок null (не бывает при not null) читается как «показывать» — прежнее поведение.
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
                    where p.id = p_uid and p.role in ('teacher', 'curator', 'admin', 'owner')) as staff,
           public.work_mode_active_for_profile(p_uid) as in_work
  ),
  mine as (
    select s.id from public.students s where s.profile_id = p_uid
  ),
  by_variant as (
    select distinct tvi.task_id
      from public.test_variant_student_assignments tvsa
      join public.test_variant_items tvi on tvi.variant_id = tvsa.variant_id
      left join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
     where tvsa.student_id in (select m.id from mine m)
       and tvsa.status in ('submitted', 'completed')
       and coalesce(tva.show_answers_after_submit, true)
       and coalesce(tva.show_solutions_after_submit, true)
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
           when who.in_work then null
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

revoke all on function public.catalog_answer_reasons(uuid, uuid[]) from public, anon, authenticated;

-- 3.6. Задачи варианта ученику. Тело — из 20260802233144_variant_student_items_hide_task_number_until_submit.sql
-- (последняя редакция), сигнатура и столбцы результата прежние. Добавлено: эталон (и номер задачи — он ссылка
-- на готовый ответ, §52) — только если у выдачи show_answers_after_submit; решение, план, критерии — только если
-- show_solutions_after_submit; и то и другое — не во время работы по времени / пробника.
CREATE OR REPLACE FUNCTION public.get_variant_items_for_student(p_student_assignment_id uuid)
 RETURNS TABLE(
   item_id uuid, variant_id uuid, task_id uuid, item_position integer, points integer,
   grading_type text, statement_html text, has_answer boolean, has_solution boolean,
   task_ext_id bigint, subject text, exam_type text, exam_part smallint,
   max_points smallint, partial_type text, source_type text,
   solution_html text, solution_plan_html text, grade_criteria_html text, answer_html text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tvsa      record;
  v_after     boolean;
  v_answers   boolean;
  v_solutions boolean;
BEGIN
  SELECT tvsa.id, tvsa.variant_id, tvsa.status, tvsa.student_id,
         tva.show_answers_after_submit AS show_answers,
         tva.show_solutions_after_submit AS show_solutions
  INTO v_tvsa
  FROM public.test_variant_student_assignments tvsa
  JOIN public.students s ON s.id = tvsa.student_id
  LEFT JOIN public.test_variant_assignments tva ON tva.id = tvsa.assignment_id
  WHERE tvsa.id = p_student_assignment_id
    AND s.profile_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESS_DENIED: assignment not found or not owned by caller';
  END IF;

  IF v_tvsa.status = 'not_started' THEN
    RAISE EXCEPTION 'NOT_STARTED: start the assignment first';
  END IF;

  v_after := v_tvsa.status IN ('submitted','completed')
             AND NOT EXISTS (SELECT 1 FROM public.student_active_works(v_tvsa.student_id));
  v_answers   := v_after AND coalesce(v_tvsa.show_answers, true);
  v_solutions := v_after AND coalesce(v_tvsa.show_solutions, true);

  RETURN QUERY
  SELECT
    tvi.id, tvi.variant_id, tvi.task_id, tvi.position, tvi.points, tvi.grading_type,
    ct.statement_html, ct.has_answer, ct.has_solution,
    CASE WHEN v_answers   THEN ct.external_id         ELSE NULL END,
    ct.subject, ct.exam_type, ct.exam_part, ct.max_points, ct.partial_type, tv.source_type,
    CASE WHEN v_solutions THEN ct.solution_html       ELSE NULL END,
    CASE WHEN v_solutions THEN ct.solution_plan_html  ELSE NULL END,
    CASE WHEN v_solutions THEN ct.grade_criteria_html ELSE NULL END,
    CASE WHEN v_answers   THEN ct.answer_html         ELSE NULL END
  FROM public.test_variant_items tvi
  JOIN public.catalog_tasks ct ON ct.id = tvi.task_id
  JOIN public.test_variants tv ON tv.id = tvi.variant_id
  WHERE tvi.variant_id = v_tvsa.variant_id
  ORDER BY tvi.position;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_variant_items_for_student(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_variant_items_for_student(uuid) TO authenticated;

-- Флажки своей выдачи — странице варианта, чтобы вместо пустых клеток сказать «учитель не показывает ответы».
create or replace function public.my_variant_answer_flags(p_student_assignment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'show_answers',   coalesce(tva.show_answers_after_submit, true),
           'show_solutions', coalesce(tva.show_solutions_after_submit, true),
           'work_mode',      exists (select 1 from public.student_active_works(tvsa.student_id)))
    from public.test_variant_student_assignments tvsa
    join public.students s on s.id = tvsa.student_id
    left join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
   where tvsa.id = p_student_assignment_id
     and s.profile_id = auth.uid();
$$;

revoke all on function public.my_variant_answer_flags(uuid) from public, anon;
grant execute on function public.my_variant_answer_flags(uuid) to authenticated;

-- ══ 4. Ученик: «открыл условие» и уходы со страницы ═══════════════════════════════════════════════════
-- Только про себя (auth_student_id) и только пока идёт ЕГО работа (student_active_works); вне работы —
-- ничего не пишется и не ошибка (вкладка, оставленная после конца, не должна сыпать ошибками; как mock_exam_ping).
create or replace function public.work_mark_opened(p_homework_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid := public.auth_student_id();
  v_at      timestamptz;
begin
  if v_student is null then
    raise exception 'Отметку ставит только ученик' using errcode = '42501';
  end if;
  if not exists (select 1 from public.student_active_works(v_student) w where w.homework_id = p_homework_id) then
    return jsonb_build_object('marked', false, 'reason', 'not_live', 'server_now', now());
  end if;
  insert into public.work_activity as wa (student_id, homework_id, opened_at)
  values (v_student, p_homework_id, now())
  on conflict (homework_id, student_id) where homework_id is not null
  do update set opened_at = coalesce(wa.opened_at, excluded.opened_at),
                updated_at = case when wa.opened_at is null then now() else wa.updated_at end
  returning wa.opened_at into v_at;
  return jsonb_build_object('marked', true, 'opened_at', v_at, 'server_now', now());
end;
$$;

comment on function public.work_mark_opened(uuid) is
  '§263. Ученик открыл условие идущей работы по времени: первая отметка времени (повтор не сдвигает). Только про себя и только в своём окне; вне окна — no-op {marked:false}.';

-- Пачка уходов: сколько раз ушёл и сколько секунд был вне страницы с прошлой пачки. Значения за вызов
-- ограничены (уходов ≤ 50, секунд ≤ 4 ч) — клиент шлёт раз в 15–30 с и при возврате.
create or replace function public.work_report_away(
  p_homework_id uuid, p_mock_exam_id uuid, p_leaves integer, p_away_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid := public.auth_student_id();
  v_leaves  integer := least(greatest(coalesce(p_leaves, 0), 0), 50);
  v_seconds integer := least(greatest(coalesce(p_away_seconds, 0), 0), 14400);
begin
  if v_student is null then
    raise exception 'Отметку ставит только ученик' using errcode = '42501';
  end if;
  if num_nonnulls(p_homework_id, p_mock_exam_id) <> 1 then
    raise exception 'Нужна ровно одна работа: проверочная или пробник' using errcode = '22023';
  end if;
  if not exists (select 1 from public.student_active_works(v_student) w
                  where (p_homework_id is not null and w.homework_id = p_homework_id)
                     or (p_mock_exam_id is not null and w.mock_exam_id = p_mock_exam_id)) then
    return jsonb_build_object('saved', false, 'reason', 'not_live', 'server_now', now());
  end if;
  if v_leaves = 0 and v_seconds = 0 then
    return jsonb_build_object('saved', false, 'reason', 'empty', 'server_now', now());
  end if;

  if p_homework_id is not null then
    insert into public.work_activity as wa (student_id, homework_id, opened_at, away_count, away_seconds, last_away_at)
    values (v_student, p_homework_id, now(), v_leaves, v_seconds, now())
    on conflict (homework_id, student_id) where homework_id is not null
    do update set away_count   = wa.away_count + excluded.away_count,
                  away_seconds = wa.away_seconds + excluded.away_seconds,
                  opened_at    = coalesce(wa.opened_at, excluded.opened_at),
                  last_away_at = now(),
                  updated_at   = now();
  else
    insert into public.work_activity as wa (student_id, mock_exam_id, away_count, away_seconds, last_away_at)
    values (v_student, p_mock_exam_id, v_leaves, v_seconds, now())
    on conflict (mock_exam_id, student_id) where mock_exam_id is not null
    do update set away_count   = wa.away_count + excluded.away_count,
                  away_seconds = wa.away_seconds + excluded.away_seconds,
                  last_away_at = now(),
                  updated_at   = now();
  end if;
  return jsonb_build_object('saved', true, 'server_now', now());
end;
$$;

comment on function public.work_report_away(uuid, uuid, integer, integer) is
  '§263. Пачка уходов со страницы идущей работы (по времени или пробника): +уходы, +секунды вне страницы. Только про себя и только пока идёт своя работа; вне — no-op {saved:false}. Ученику счётчик не возвращается.';

revoke all on function public.work_mark_opened(uuid) from public, anon;
revoke all on function public.work_report_away(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.work_mark_opened(uuid) to authenticated;
grant execute on function public.work_report_away(uuid, uuid, integer, integer) to authenticated;

-- ══ 5. Учитель: монитор работы по времени («Проверочная вживую») ══════════════════════════════════════
-- Только персонал курса темы (course_is_staff), иначе 42501. Класс — ученики групп курса (как
-- topic_homework_timed_summary §240). По ученику — сырые факты; статусы и счётчики считает клиент
-- (src/lib/liveWork.ts), чтобы монитор и «итог» были одним правилом с тестами.
create or replace function public.timed_work_live(p_homework_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hw     record;
  v_rows   jsonb;
begin
  select h.id, h.topic_id, h.opens_at, h.closes_at, h.is_published, h.grade_scale,
         t.title, t.kind, m.course_id
    into v_hw
    from public.topic_homework h
    join public.topics t on t.id = h.topic_id
    join public.modules m on m.id = t.module_id
   where h.id = p_homework_id;
  if v_hw.id is null or not public.course_is_staff(v_hw.course_id) then
    raise exception 'Нет прав на эту работу' using errcode = '42501';
  end if;
  if v_hw.kind not in ('check', 'control') then
    raise exception 'Монитор — только у проверочной и контрольной работы' using errcode = '22023';
  end if;

  with roster as (
    select distinct on (gs.student_id) gs.student_id, g.id as group_id, g.name as group_name
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
     where g.course_id = v_hw.course_id
     order by gs.student_id, g.name
  ),
  last_attempt as (
    select distinct on (a.student_id) a.student_id, a.id, a.status, a.submitted_at, a.auto_submitted, a.created_at
      from public.topic_homework_attempts a
     where a.homework_id = p_homework_id
     order by a.student_id, a.attempt_number desc
  ),
  files as (
    select la.student_id, count(f.id)::int as photos, max(f.created_at) as last_photo_at
      from last_attempt la
      join public.topic_homework_attempt_files f on f.attempt_id = la.id
     group by la.student_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'student_id',      r.student_id,
           'full_name',       coalesce(nullif(btrim(p.full_name), ''), 'Ученик'),
           'group_name',      r.group_name,
           'opened_at',       case when wa.opened_at is null then la.created_at
                                   when la.created_at is null then wa.opened_at
                                   else least(wa.opened_at, la.created_at) end,
           'attempt_status',  la.status,
           'submitted_at',    la.submitted_at,
           'auto_submitted',  coalesce(la.auto_submitted, false),
           'photos',          coalesce(fl.photos, 0),
           'last_photo_at',   fl.last_photo_at,
           'away_count',      coalesce(wa.away_count, 0),
           'away_seconds',    coalesce(wa.away_seconds, 0),
           'window_opens_at', w.opens_at,
           'window_closes_at', w.closes_at,
           'personal',        coalesce(w.personal, false)
         ) order by coalesce(nullif(btrim(p.full_name), ''), 'Ученик'), r.student_id), '[]'::jsonb)
    into v_rows
    from roster r
    join public.students s on s.id = r.student_id
    left join public.profiles p on p.id = s.profile_id
    left join last_attempt la on la.student_id = r.student_id
    left join files fl on fl.student_id = r.student_id
    left join public.work_activity wa on wa.homework_id = p_homework_id and wa.student_id = r.student_id
    left join lateral public.topic_homework_student_window(p_homework_id, r.student_id) w on true;

  return jsonb_build_object(
    'homework_id', v_hw.id,
    'topic_id',    v_hw.topic_id,
    'course_id',   v_hw.course_id,
    'title',       v_hw.title,
    'kind',        v_hw.kind,
    'published',   v_hw.is_published,
    'group_name',  (select string_agg(distinct g.name, ' · ') from public.groups g where g.course_id = v_hw.course_id),
    'opens_at',    v_hw.opens_at,
    'closes_at',   v_hw.closes_at,
    'server_now',  now(),
    'students',    v_rows
  );
end;
$$;

comment on function public.timed_work_live(uuid) is
  '§263. Монитор проверочной/контрольной для персонала курса: окно, серверное время, по ученику класса — открыл условие (work_activity.opened_at или начало попытки), статус попытки, фото (число, последнее), уходы со страницы, действующее окно (личное). Чужому — 42501.';

revoke all on function public.timed_work_live(uuid) from public, anon;
grant execute on function public.timed_work_live(uuid) to authenticated;

-- Главная учителя: работы по времени его курсов, у которых окно идёт сейчас (общее или чьё-то личное),
-- — кнопка «Следить». Курсы — где вызывающий персонал (course_is_staff); шаблонов среди них нет (окна нет).
create or replace function public.my_live_timed_works()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x.j order by x.closes_at, x.title), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'homework_id', h.id,
               'topic_id',    t.id,
               'course_id',   m.course_id,
               'title',       t.title,
               'kind',        t.kind,
               'group_name',  (select string_agg(distinct g.name, ' · ') from public.groups g where g.course_id = m.course_id),
               'opens_at',    h.opens_at,
               'closes_at',   h.closes_at,
               'personal_live', (select count(*) from public.topic_homework_personal_windows pw
                                  where pw.homework_id = h.id and pw.opens_at <= now() and now() < pw.closes_at)::int,
               'server_now',  now()
             ) as j,
             coalesce(h.closes_at, now()) as closes_at,
             t.title
        from public.topic_homework h
        join public.topics t on t.id = h.topic_id and t.kind in ('check', 'control')
        join public.modules m on m.id = t.module_id
       where h.is_published
         and ((h.opens_at <= now() and now() < h.closes_at)
              or exists (select 1 from public.topic_homework_personal_windows pw
                          where pw.homework_id = h.id and pw.opens_at <= now() and now() < pw.closes_at))
         and public.course_is_staff(m.course_id)
    ) x;
$$;

comment on function public.my_live_timed_works() is
  '§263. Идущие сейчас проверочные/контрольные курсов, где вызывающий — персонал (course_is_staff): для кнопки «Следить» на главной учителя.';

revoke all on function public.my_live_timed_works() from public, anon;
grant execute on function public.my_live_timed_works() to authenticated;

-- Уходы со страницы пробника — для монитора пробника §224 (только персонал курса группы).
create or replace function public.mock_exam_away(p_mock_exam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.mock_exam_is_staff(p_mock_exam_id) then
    raise exception 'Нет прав на этот пробник' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('student_id', wa.student_id, 'away_count', wa.away_count,
                                        'away_seconds', wa.away_seconds) order by wa.student_id)
      from public.work_activity wa
     where wa.mock_exam_id = p_mock_exam_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.mock_exam_away(uuid) from public, anon;
grant execute on function public.mock_exam_away(uuid) to authenticated;
