-- §263, часть 1/2. Применено оркестратором 03.10 (MCP apply_migration, версия 20261003175143); применённый текст — без строк-комментариев, comment on и хвостовых комментариев.
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

