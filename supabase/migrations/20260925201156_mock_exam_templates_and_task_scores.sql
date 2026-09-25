-- §218. Пробник по номерам заданий: шаблон экзамена, баллы по заданиям,
-- сохранение таблицы одной транзакцией.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration, после чего
-- файл переименовывается в <version>_<name>.sql точно по записи в
-- supabase_migrations.schema_migrations (MIGRATIONS.md). Данные (шаблон
-- профильной математики) — отдельным файлом PENDING_218_seed.sql, ПОСЛЕ этой
-- миграции.
--
-- Миграция только добавляющая: две новые таблицы, две новые колонки у
-- существующих таблиц, новые функции и триггеры. Существующие политики
-- mock_exams и mock_exam_results НЕ тронуты (граница карточки 070): любой
-- преподаватель по-прежнему может писать туда напрямую, а ученик по-прежнему
-- не читает даже свой результат. Это отдельная работа.
--
-- Зачем всё это. Владелец: «как Статград: в Excel видно, сколько набираем по
-- каждому номеру». До сих пор у пробника был один общий балл (и то не
-- сохранялся, §215), а вопрос «на каком номере группа проседает» задать было
-- не к чему.
--
-- ──────────────────────────────────────────────────────────────────────────
-- 1. Шаблон пробника — структура экзамена на год
-- ──────────────────────────────────────────────────────────────────────────
-- Максимум за каждое задание, где кончается первая часть, и (необязательно)
-- официальная таблица перевода первичного балла в тестовый. Заводится один
-- раз на экзамен и год и переиспользуется всеми пробниками — поэтому не
-- колонками у mock_exams: девятнадцать чисел, скопированные в каждый пробник,
-- разъехались бы при первой же правке демоверсии.

-- Годится ли таблица перевода: длина ровно «максимум первичных + 1» (индекс =
-- первичный балл, от нуля), без пустот, не отрицательная, не убывает. Та же
-- проверка — в клиенте (src/lib/mockExamGrid.ts, checkScale): там она нужна,
-- чтобы объяснить ошибку словами до отправки, здесь — чтобы её нельзя было
-- обойти. Менять вместе.
create or replace function public.mock_exam_template_scale_ok(p_max_points smallint[], p_scale smallint[])
returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_scale is null or (
    coalesce(array_length(p_scale, 1), 0) = (select coalesce(sum(m), 0) from unnest(p_max_points) m) + 1
    and array_position(p_scale, null) is null
    and 0 <= all (p_scale)
    and not exists (
      select 1 from generate_subscripts(p_scale, 1) i
       where i > 1 and p_scale[i] < p_scale[i - 1]
    )
  );
$$;

create table if not exists public.mock_exam_templates (
  id          uuid primary key default gen_random_uuid(),
  subject     public.subject_type not null,
  exam_type   public.exam_type    not null,
  year        smallint not null check (year between 2000 and 2100),
  title       text not null check (length(btrim(title)) > 0),
  -- max_points[1] — максимум за задание №1, и так далее. Ноль допустим:
  -- задание, снятое из экзамена, но оставленное ради номеров.
  max_points  smallint[] not null
              check (array_length(max_points, 1) between 1 and 60
                     and array_position(max_points, null) is null
                     and 0 <= all (max_points) and 20 >= all (max_points)),
  -- Номер ПОСЛЕДНЕГО задания первой части: 12 у профильной математики.
  part1_last  smallint not null,
  -- Таблица перевода: score_scale[первичный + 1] = тестовый. null — таблицы
  -- нет, тестовый балл равен первичному (так велит карточка 070: отчёт для
  -- родителя тогда хотя бы не пустой).
  score_scale smallint[],
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint mock_exam_templates_part1_in_range
    check (part1_last between 1 and array_length(max_points, 1)),
  constraint mock_exam_templates_scale_ok
    check (public.mock_exam_template_scale_ok(max_points, score_scale)),
  constraint mock_exam_templates_unique unique (subject, exam_type, year, title)
);

comment on table public.mock_exam_templates is
  '§218. Структура экзамена на год: максимум за каждое задание, граница частей, таблица перевода первичный → тестовый. Один шаблон — много пробников.';
comment on column public.mock_exam_templates.max_points is
  'Максимум за задание: max_points[1] — за №1. Длина массива — число заданий.';
comment on column public.mock_exam_templates.part1_last is
  'Номер последнего задания первой части (включительно).';
comment on column public.mock_exam_templates.score_scale is
  'Перевод: score_scale[первичный + 1] = тестовый (массивы в Postgres с единицы). null — таблицы нет, тестовый = первичный.';

-- Тестовый балл по первичному. Одна функция на сохранение и на пересчёт
-- (триггер ниже): две копии формулы разъехались бы. Зеркало toTestScore в
-- src/lib/mockExamGrid.ts — менять вместе.
create or replace function public.mock_exam_test_score(p_primary integer, p_scale smallint[])
returns integer
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_primary is null then null
    when p_scale is null or coalesce(array_length(p_scale, 1), 0) = 0 then p_primary
    else p_scale[p_primary + 1]
  end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Пробник ссылается на шаблон; у итога — первичный балл
-- ──────────────────────────────────────────────────────────────────────────
-- Ссылка необязательная: у девяти пробников-образцов на проде шаблона нет, и
-- придумывать его им нельзя (прод-данные не трогаем). Без шаблона пробник
-- просто не открывает таблицу по номерам.

alter table public.mock_exams
  add column if not exists template_id uuid references public.mock_exam_templates(id) on delete restrict;

comment on column public.mock_exams.template_id is
  '§218. Шаблон (структура экзамена). null — старый пробник без разбивки по заданиям; таблица по номерам у такого не открывается.';

create index if not exists mock_exams_template_idx on public.mock_exams (template_id);

-- Первичный балл — всегда первичный. score остаётся тем, что читает отчёт
-- для родителя (§217, student_progress_report): тестовый по таблице
-- перевода, а без неё — первичный. Так отчёт заработал без единой правки.
alter table public.mock_exam_results
  add column if not exists primary_score integer check (primary_score is null or primary_score >= 0);

comment on column public.mock_exam_results.primary_score is
  '§218. Первичный балл — сумма баллов по заданиям. score рядом — тестовый по таблице перевода шаблона (или первичный, если таблицы нет); part1_score / part2_score — первичные по частям.';

-- max_score пробника с шаблоном берётся из шаблона, а не из формы: иначе
-- «42 из 100» при первичном максимуме 32 и без таблицы перевода. С таблицей
-- — последний тестовый балл таблицы, без неё — сумма максимумов.
create or replace function public.mock_exam_template_max_score(p_template_id uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when t.score_scale is not null then t.score_scale[array_length(t.score_scale, 1)]
    else (select sum(m)::int from unnest(t.max_points) m)
  end
  from public.mock_exam_templates t where t.id = p_template_id;
$$;

create or replace function public.mock_exams_template_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.template_id is distinct from old.template_id
     and exists (select 1 from public.mock_exam_task_scores s where s.mock_exam_id = new.id) then
    -- Баллы по заданиям введены под раскладку старого шаблона: №14 «макс 3»
    -- в новом может оказаться «макс 2». Молча переложить их нельзя.
    raise exception 'У пробника уже введены баллы по заданиям — шаблон менять нельзя'
      using errcode = '23514';
  end if;
  if new.template_id is not null then
    new.max_score := public.mock_exam_template_max_score(new.template_id);
  end if;
  return new;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Баллы по заданиям
-- ──────────────────────────────────────────────────────────────────────────
-- Строка = пробник + ученик + номер задания. Пустой клетки в таблице здесь
-- нет строкой вовсе: «нет данных» ≠ «0 баллов», и ноль пишется нулём.

create table if not exists public.mock_exam_task_scores (
  id           uuid primary key default gen_random_uuid(),
  mock_exam_id uuid not null references public.mock_exams(id) on delete cascade,
  student_id   uuid not null references public.students(id)   on delete cascade,
  task_number  smallint not null check (task_number >= 1),
  points       smallint not null check (points >= 0),
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now(),
  constraint mock_exam_task_scores_unique unique (mock_exam_id, student_id, task_number)
);

comment on table public.mock_exam_task_scores is
  '§218. Балл ученика за одно задание пробника. Пустая клетка таблицы — строки нет (нет данных); ноль — «решал и не получил». Не больше максимума задания по шаблону — проверяет триггер.';

create index if not exists mock_exam_task_scores_student_idx on public.mock_exam_task_scores (student_id);

-- «Балл не больше максимума своего задания» — в базе, а не только в клиенте.
-- Ограничением (check) это не выразить: максимум лежит в другой таблице.
-- Заодно: номер задания есть в шаблоне, ученик — из группы пробника.
create or replace function public.mock_exam_task_scores_check()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_max_points smallint[];
  v_group_id   uuid;
begin
  select t.max_points, me.group_id into v_max_points, v_group_id
    from public.mock_exams me
    join public.mock_exam_templates t on t.id = me.template_id
   where me.id = new.mock_exam_id;

  if v_max_points is null then
    raise exception 'У пробника нет шаблона — баллы по заданиям ему не вводятся'
      using errcode = '23514';
  end if;
  if new.task_number > array_length(v_max_points, 1) then
    raise exception 'В этом пробнике % заданий, задания №% нет', array_length(v_max_points, 1), new.task_number
      using errcode = '23514';
  end if;
  if new.points > v_max_points[new.task_number] then
    raise exception 'За задание №% можно не больше % (введено %)', new.task_number, v_max_points[new.task_number], new.points
      using errcode = '23514';
  end if;
  if v_group_id is null or not exists (
    select 1 from public.group_students gs where gs.group_id = v_group_id and gs.student_id = new.student_id
  ) then
    raise exception 'Ученик не из группы этого пробника'
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mock_exam_task_scores_check on public.mock_exam_task_scores;
create trigger mock_exam_task_scores_check
  before insert or update on public.mock_exam_task_scores
  for each row execute function public.mock_exam_task_scores_check();

drop trigger if exists mock_exams_template_guard on public.mock_exams;
create trigger mock_exams_template_guard
  before insert or update of template_id on public.mock_exams
  for each row execute function public.mock_exams_template_guard();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Правка шаблона после ввода баллов
-- ──────────────────────────────────────────────────────────────────────────
-- Раскладку (максимумы, граница частей) после ввода баллов менять нельзя —
-- по той же причине, что и шаблон пробника (раздел 2).
--
-- А вот таблицу перевода менять МОЖНО и нужно: владелец внесёт официальную
-- позже, чем пройдут первые пробники (сид её намеренно не заполняет). Без
-- пересчёта у тех пробников в score навсегда остался бы первичный балл, и
-- отчёт для родителя печатал бы «18» рядом с целью «70». Поэтому смена
-- таблицы пересчитывает score и max_score всех пробников этого шаблона.
-- Уведомлений пересчёт не шлёт: баллы ученика не менялись, поменялась шкала.

create or replace function public.mock_exam_templates_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.max_points is distinct from old.max_points or new.part1_last is distinct from old.part1_last)
     and exists (
       select 1 from public.mock_exam_task_scores s
         join public.mock_exams me on me.id = s.mock_exam_id
        where me.template_id = new.id
     ) then
    raise exception 'По этому шаблону уже введены баллы — максимумы и границу частей менять нельзя. Заведите новый шаблон.'
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.mock_exam_templates_rescore()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.score_scale is distinct from old.score_scale then
    update public.mock_exam_results r
       set score = public.mock_exam_test_score(r.primary_score, new.score_scale)
      from public.mock_exams me
     where me.id = r.mock_exam_id
       and me.template_id = new.id
       and r.primary_score is not null;
    update public.mock_exams
       set max_score = public.mock_exam_template_max_score(new.id)
     where template_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists mock_exam_templates_guard on public.mock_exam_templates;
create trigger mock_exam_templates_guard
  before update on public.mock_exam_templates
  for each row execute function public.mock_exam_templates_guard();

drop trigger if exists mock_exam_templates_rescore on public.mock_exam_templates;
create trigger mock_exam_templates_rescore
  after update of score_scale on public.mock_exam_templates
  for each row execute function public.mock_exam_templates_rescore();

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Права
-- ──────────────────────────────────────────────────────────────────────────
-- Баллы по заданиям: персонал курса ТОЙ группы, к которой привязан пробник.
-- Своих правил не изобретаем: вопрос «персонал ли он по курсу» в проекте
-- отвечает ОДНА функция course_is_staff (админ платформы, владелец курса,
-- преподаватель группы, куратор группы, куратор курса). Готового помощника
-- «персонал ли он для этого пробника» нет, а у соседних (auth_is_staff_of_student)
-- вопрос другой — «персонал ли он для ученика вообще, в любой его группе»:
-- преподаватель физики у того же ученика прошёл бы в математический пробник.
-- Поэтому ниже тонкая обёртка: пробник → группа → курс → course_is_staff.
-- Правила в ней нет, только путь до курса.
--
-- Ученику — ничего, ни чтения: читать свои результаты он не может и в
-- mock_exam_results (политика там не менялась), и по отдельности баллы
-- по заданиям без итога ему показывать некуда.

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

comment on function public.mock_exam_is_staff(uuid) is
  '§218. Персонал ли вызывающий по курсу группы этого пробника. Только путь пробник → группа → курс; само правило — course_is_staff.';

revoke all on function public.mock_exam_is_staff(uuid) from public, anon;
grant execute on function public.mock_exam_is_staff(uuid) to authenticated;

alter table public.mock_exam_task_scores enable row level security;
grant select, insert, update, delete on public.mock_exam_task_scores to authenticated;

drop policy if exists mock_exam_task_scores_staff_select on public.mock_exam_task_scores;
create policy mock_exam_task_scores_staff_select
  on public.mock_exam_task_scores
  for select to authenticated
  using (public.mock_exam_is_staff(mock_exam_id));

drop policy if exists mock_exam_task_scores_staff_insert on public.mock_exam_task_scores;
create policy mock_exam_task_scores_staff_insert
  on public.mock_exam_task_scores
  for insert to authenticated
  with check (public.mock_exam_is_staff(mock_exam_id) and updated_by = auth.uid());

drop policy if exists mock_exam_task_scores_staff_update on public.mock_exam_task_scores;
create policy mock_exam_task_scores_staff_update
  on public.mock_exam_task_scores
  for update to authenticated
  using (public.mock_exam_is_staff(mock_exam_id))
  with check (public.mock_exam_is_staff(mock_exam_id) and updated_by = auth.uid());

drop policy if exists mock_exam_task_scores_staff_delete on public.mock_exam_task_scores;
create policy mock_exam_task_scores_staff_delete
  on public.mock_exam_task_scores
  for delete to authenticated
  using (public.mock_exam_is_staff(mock_exam_id));

-- Шаблон к группе не привязан — это структура экзамена, общая на школу.
-- Читать: весь персонал по роли, тем же условием, что у существующего
-- mock_exams_select (is_admin_or_owner() или роль teacher/curator):
-- преподаватель выбирает шаблон, заводя пробник. Писать: только
-- владелец/админ платформы. Официальную таблицу перевода вносит владелец
-- (карточка 070), и правка таблицы пересчитывает итоги ЧУЖИХ групп
-- (раздел 4) — давать это каждому преподавателю нельзя.
alter table public.mock_exam_templates enable row level security;
grant select, insert, update, delete on public.mock_exam_templates to authenticated;

drop policy if exists mock_exam_templates_staff_select on public.mock_exam_templates;
create policy mock_exam_templates_staff_select
  on public.mock_exam_templates
  for select to authenticated
  using (public.is_admin_or_owner() or public.get_my_role() in ('teacher', 'curator'));

drop policy if exists mock_exam_templates_admin_insert on public.mock_exam_templates;
create policy mock_exam_templates_admin_insert
  on public.mock_exam_templates
  for insert to authenticated
  with check (public.is_admin_or_owner());

drop policy if exists mock_exam_templates_admin_update on public.mock_exam_templates;
create policy mock_exam_templates_admin_update
  on public.mock_exam_templates
  for update to authenticated
  using (public.is_admin_or_owner())
  with check (public.is_admin_or_owner());

drop policy if exists mock_exam_templates_admin_delete on public.mock_exam_templates;
create policy mock_exam_templates_admin_delete
  on public.mock_exam_templates
  for delete to authenticated
  using (public.is_admin_or_owner());

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Сохранение таблицы — всё или ничего
-- ──────────────────────────────────────────────────────────────────────────
-- Баллы по заданиям и итоги в mock_exam_results пишутся ОДНИМ вызовом, то
-- есть одной транзакцией: не бывает так, что задания записались, а итог нет
-- (и отчёт для родителя показывает старое число при новых клетках).
--
-- security INVOKER, намеренно. Все записи идут под правами вызывающего:
--   * баллы по заданиям — под политиками раздела 5 (персонал курса группы);
--   * итоги — под существующей политикой mock_exam_results_manage, которую
--     эта работа не трогает (is_admin_or_owner() или роль teacher).
-- Отсюда следствие, и оно верное: куратор курса проходит первую проверку, но
-- не вторую — и вся транзакция откатывается целиком, ничего не записав.
-- Явная проверка course_is_staff в начале — не замена политикам, а понятная
-- ошибка вместо «new row violates row-level security policy».
--
-- p_rows: [{ "student_id": uuid, "points": [int|null, …] }, …] — ровно по
-- числу заданий шаблона; null — пустая клетка («нет данных»). Строка из
-- одних null стирает итог ученика: итог без единого балла — выдумка.
--
-- Возвращает { rows: [{ student_id, old_score, score }] }: старое значение
-- итога читается в ТОЙ ЖЕ транзакции, и по нему клиент решает, кому слать
-- уведомление (только тем, у кого итог появился или изменился —
-- totalsToNotify в src/lib/mockExamGrid.ts).

create or replace function public.save_mock_exam_grid(p_mock_exam_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_group_id   uuid;
  v_course_id  uuid;
  v_template   public.mock_exam_templates%rowtype;
  v_n          int;
  v_row        jsonb;
  v_student    uuid;
  v_points     jsonb;
  v_cell       jsonb;
  v_p          int;
  v_p1         int;
  v_p2         int;
  v_any        boolean;
  v_primary    int;
  v_score      int;
  v_old        int;
  v_out        jsonb := '[]'::jsonb;
  i            int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows: ожидается массив строк' using errcode = '22023';
  end if;

  select me.group_id, g.course_id into v_group_id, v_course_id
    from public.mock_exams me
    left join public.groups g on g.id = me.group_id
   where me.id = p_mock_exam_id;
  if not found then
    raise exception 'Пробник не найден' using errcode = 'P0002';
  end if;
  if v_group_id is null then
    raise exception 'У пробника нет группы — результаты не ввести' using errcode = '22023';
  end if;
  if not public.course_is_staff(v_course_id) then
    raise exception 'Нет доступа к результатам этого пробника' using errcode = '42501';
  end if;

  select t.* into v_template
    from public.mock_exams me
    join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  if not found then
    raise exception 'У пробника нет шаблона — баллы по заданиям ему не вводятся' using errcode = '22023';
  end if;
  v_n := array_length(v_template.max_points, 1);

  if (select count(*) from jsonb_array_elements(p_rows) r)
     <> (select count(distinct r->>'student_id') from jsonb_array_elements(p_rows) r) then
    raise exception 'Один ученик в таблице дважды' using errcode = '22023';
  end if;

  -- Два преподавателя жмут «Сохранить» одновременно: пусть идут по очереди,
  -- иначе old_score второго прочитается до записи первого и уведомление
  -- уйдёт дважды.
  perform pg_advisory_xact_lock(hashtextextended('save_mock_exam_grid:' || p_mock_exam_id::text, 0));

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_student := (v_row->>'student_id')::uuid;
    v_points  := v_row->'points';
    if v_points is null or jsonb_typeof(v_points) <> 'array' or jsonb_array_length(v_points) <> v_n then
      raise exception 'Строка ученика %: нужно ровно % баллов по заданиям', v_student, v_n using errcode = '22023';
    end if;

    v_p1 := 0; v_p2 := 0; v_any := false;
    for i in 1..v_n loop
      v_cell := v_points->(i - 1);
      if jsonb_typeof(v_cell) = 'null' then
        delete from public.mock_exam_task_scores
         where mock_exam_id = p_mock_exam_id and student_id = v_student and task_number = i;
      else
        if jsonb_typeof(v_cell) <> 'number' then
          raise exception 'Строка ученика %, задание №%: не число', v_student, i using errcode = '22023';
        end if;
        -- Дробь («1.5») на ::int молча округлилась бы — ловим явно.
        if (v_cell::text)::numeric <> trunc((v_cell::text)::numeric) then
          raise exception 'Строка ученика %, задание №%: балл должен быть целым', v_student, i using errcode = '22023';
        end if;
        v_p := ((v_cell::text)::numeric)::int;
        -- Максимум и «ученик из группы» проверяет триггер
        -- mock_exam_task_scores_check — второй копии проверки здесь нет.
        insert into public.mock_exam_task_scores (mock_exam_id, student_id, task_number, points, updated_by)
        values (p_mock_exam_id, v_student, i, v_p, auth.uid())
        on conflict (mock_exam_id, student_id, task_number)
        do update set points = excluded.points, updated_by = excluded.updated_by
          where public.mock_exam_task_scores.points is distinct from excluded.points;
        v_any := true;
        if i <= v_template.part1_last then v_p1 := v_p1 + v_p; else v_p2 := v_p2 + v_p; end if;
      end if;
    end loop;

    select r.score into v_old
      from public.mock_exam_results r
     where r.mock_exam_id = p_mock_exam_id and r.student_id = v_student;

    if v_any then
      v_primary := v_p1 + v_p2;
      v_score   := public.mock_exam_test_score(v_primary, v_template.score_scale);
      insert into public.mock_exam_results (mock_exam_id, student_id, score, primary_score, part1_score, part2_score)
      values (p_mock_exam_id, v_student, v_score, v_primary, v_p1, v_p2)
      on conflict (mock_exam_id, student_id)
      do update set score         = excluded.score,
                    primary_score = excluded.primary_score,
                    part1_score   = excluded.part1_score,
                    part2_score   = excluded.part2_score;
    else
      v_score := null;
      delete from public.mock_exam_results
       where mock_exam_id = p_mock_exam_id and student_id = v_student;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'student_id', v_student, 'old_score', v_old, 'score', v_score));
  end loop;

  return jsonb_build_object('rows', v_out);
end;
$$;

comment on function public.save_mock_exam_grid(uuid, jsonb) is
  '§218. Сохранить таблицу пробника: баллы по заданиям + итоги (score — тестовый, primary_score, part1/part2 — первичные) одной транзакцией. Под правами вызывающего. Возвращает старый и новый итог каждого ученика — для уведомлений только об изменившихся.';

revoke all on function public.save_mock_exam_grid(uuid, jsonb) from public, anon;
grant execute on function public.save_mock_exam_grid(uuid, jsonb) to authenticated;

revoke all on function public.mock_exam_template_max_score(uuid) from public, anon;
grant execute on function public.mock_exam_template_max_score(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. Пробы прав — выполнять ОТДЕЛЬНО, в откатываемом блоке, под authenticated
-- ──────────────────────────────────────────────────────────────────────────
-- Прогонялись на локальном Postgres 16 с уменьшенным слепком схемы (те же
-- редакции course_is_staff, course_is_admin, is_admin_or_owner, get_my_role
-- и те же политики mock_exams / mock_exam_results, что в supabase/migrations)
-- и на выдуманных данных. НА ПРОДЕ НЕ ПРОГОНЯЛИСЬ: облачный агент к проду не
-- ходит. Фактический вывод локального прогона — в PROJECT_STATE.md §218.
--
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<uuid преподавателя группы>","role":"authenticated"}';
-- select public.save_mock_exam_grid('<пробник>', '[{"student_id":"<ученик>","points":[1,1,1,1,1,1,1,1,1,1,1,1,2,3,2,2,3,4,4]}]');
--   -- ожидание: rows[0].score = 32 (таблицы перевода нет), old_score null
-- select public.save_mock_exam_grid('<пробник>', '[{"student_id":"<ученик>","points":[1,1,1,1,1,1,1,1,1,1,1,1,2,4,2,2,3,4,4]}]');
--   -- ожидание: ERROR 23514 «За задание №14 можно не больше 3» — и первая
--   --           запись в этой же транзакции НЕ тронута (всё или ничего)
-- set local request.jwt.claims = '{"sub":"<uuid ЧУЖОГО преподавателя>","role":"authenticated"}';
-- select public.save_mock_exam_grid('<пробник>', '[]');           -- ERROR 42501
-- select count(*) from public.mock_exam_task_scores;              -- 0
-- set local request.jwt.claims = '{"sub":"<uuid ученика>","role":"authenticated"}';
-- select count(*) from public.mock_exam_task_scores;              -- 0
-- select public.save_mock_exam_grid('<пробник>', '[]');           -- ERROR 42501
-- rollback;
