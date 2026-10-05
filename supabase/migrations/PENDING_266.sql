-- §266. Тренировочные уроки с задачами на автопроверку (новый курс физики).
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration ОДНОЙ
-- транзакцией, после чего файл переименовывается в <version>_<name>.sql точно
-- по записи в supabase_migrations.schema_migrations (MIGRATIONS.md).
-- Только добавление: новые столбцы с умолчанием, новые таблицы, бакет,
-- функции и триггеры. Две существующие функции переопределяются:
--   * _topic_homework_autopublish (§243) — точечной заменой ОДНОГО условия в
--     текущем теле (как §265 правил баллы школы): «ДЗ без файлов не выдаётся»
--     + «кроме ДЗ-носителя автопроверки»;
--   * course_copy_topic_content — тело 20260928122420 (§240) + пометка урока,
--     флаг носителя у ДЗ и задачи автопроверки.
-- Повторяемый: if not exists / create or replace / drop … if exists; второй
-- прогон проходит без ошибок (supabase/tests/avtoproverka_266/run.sh гоняет
-- файл дважды).
--
-- ── Решения владельца (задача §266) ────────────────────────────────────────
--  1. Урок (topic) с пометкой «Тренировочный» (topics.lesson_format =
--     'training') или «Формат ЕГЭ» ('ege'); null — как сейчас, без пометки.
--  2. В тренировочном уроке вместо ДЗ на проверку — задачи с автопроверкой.
--  3. 3 попытки на задачу; после верного ответа или третьей ошибки задача
--     закрыта и открыто её решение. До этого эталона и решения ученику нет
--     ни в интерфейсе, ни через API: столбцы эталона закрыты от клиента
--     (column privileges), отдаёт их только definer-функция, и только
--     персоналу курса или ученику по ЗАКРЫТОЙ задаче; файл решения в Storage
--     — по той же проверке.
--  4. Оценка в журнал по 100-балльной шкале = round(100 × решённые / все),
--     когда закрыты все задачи урока.
--
-- ── Куда ложится оценка и почему так ──────────────────────────────────────
-- Оценки ДЗ урока живут в topic_homework_attempts + topic_homework_reviews:
-- их читают журнал ДЗ (course_homework_grades, §250), «Мои задания», сводка и
-- статистика курса, карточка ученика и отчёт родителю (§261), баллы школы и
-- награды (student_school_points_of / student_achievement_progress через
-- hw_grade_equiv, §265), лента админа и клиентские хуки — больше десятка мест.
-- Переписать их все на «ещё одну таблицу оценок» — ломка. Поэтому у
-- тренировочного урока есть ОБЫЧНОЕ ДЗ урока (topic_homework, 100-балльное),
-- помеченное autocheck = true, — «носитель»: файлов у него нет, сдать его
-- файлами нельзя (сторож попыток), а когда ученик закрыл все задачи, сервер
-- сам пишет ему попытку → «сдано» → вердикт «принято» с баллом. Для всех
-- читателей это обычное принятое 100-балльное ДЗ этого урока; ни одного
-- читателя менять не пришлось. Добавили задачу после итога — при закрытии
-- новой задачи итог пересчитывается и ложится ВТОРОЙ строкой вердикта той же
-- попытки (история вердиктов только добавляется, читатели берут последнюю).
-- reviewer_id вердикта — профиль самого ученика (FK на profiles обязателен;
-- преподаватель этот балл не ставил, приписывать его учителю было бы неправдой),
-- comment — «Автопроверка: решено N из M».
--
-- Попытки ученика в задачах — по profile_id (students.id ≠ profile, и строк
-- students у профиля может быть несколько); попытка ДЗ-носителя — по
-- students.id того ученика, что состоит в группе курса.

-- ══ 1. Пометка урока ═════════════════════════════════════════════════════════
alter table public.topics add column if not exists lesson_format text;
alter table public.topics drop constraint if exists topics_lesson_format_check;
alter table public.topics add constraint topics_lesson_format_check
  check (lesson_format is null or lesson_format in ('training', 'ege'));

comment on column public.topics.lesson_format is
  '§266. Пометка урока: training — «Тренировочный» (подтема, задачи с автопроверкой вместо ДЗ на проверку), ege — «Формат ЕГЭ» (обычное ДЗ). null — без пометки, как до §266.';

-- ══ 2. ДЗ-носитель ══════════════════════════════════════════════════════════
alter table public.topic_homework add column if not exists autocheck boolean not null default false;

comment on column public.topic_homework.autocheck is
  '§266. ДЗ-носитель задач с автопроверкой: файлов нет, сдаётся ответами в уроке; попытку и вердикт пишет только сервер (_topic_autocheck_finish). Клиент флаг не меняет (topic_homework_autocheck_guard).';

-- ══ 3. Задачи урока ══════════════════════════════════════════════════════════
create table if not exists public.topic_autocheck_tasks (
  id               uuid primary key default gen_random_uuid(),
  topic_id         uuid not null references public.topics(id) on delete cascade,
  code             text not null check (length(btrim(code)) between 1 and 64),
  position         integer not null default 0 check (position >= 0),
  statement_path   text not null check (length(btrim(statement_path)) between 1 and 500),
  solution_path    text check (solution_path is null or length(btrim(solution_path)) between 1 and 500),
  answer_type      text not null check (answer_type in ('number', 'digits')),
  answer_value     numeric,
  answer_tol       numeric not null default 0 check (answer_tol >= 0),
  answer_text      text,
  digits_any_order boolean not null default false,
  unit             text check (unit is null or length(unit) <= 40),
  source_task_id   uuid references public.topic_autocheck_tasks(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint topic_autocheck_tasks_code_key unique (topic_id, code),
  constraint topic_autocheck_tasks_answer_chk check (
    (answer_type = 'number' and answer_value is not null)
    or (answer_type = 'digits' and answer_text ~ '^[0-9]+$')
  )
);

create index if not exists topic_autocheck_tasks_topic_idx  on public.topic_autocheck_tasks (topic_id, position);
create index if not exists topic_autocheck_tasks_source_idx on public.topic_autocheck_tasks (source_task_id);

comment on table public.topic_autocheck_tasks is
  '§266. Задачи с автопроверкой урока. Условие и решение — картинки (бакет topic-autocheck). Эталон (answer_value/answer_tol/answer_text) и solution_path клиенту не выдаются столбцами — только topic_autocheck_state: персоналу курса и ученику по закрытой задаче.';
comment on column public.topic_autocheck_tasks.answer_tol is
  'Абсолютный допуск числового ответа: верно, если |ответ − эталон| ≤ допуск. 0 — точное совпадение.';
comment on column public.topic_autocheck_tasks.digits_any_order is
  'digits: true — порядок цифр не важен («выберите все верные»), false — важен (соответствие).';
comment on column public.topic_autocheck_tasks.source_task_id is
  'Задача-источник (каркас или копируемый урок): копия курса/урока и загрузка в каркас ведут линейку, как §172.';

-- ══ 4. Ответы ученика ════════════════════════════════════════════════════════
create table if not exists public.topic_autocheck_answers (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.topic_autocheck_tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  attempt_no integer not null check (attempt_no between 1 and 3),
  answer_raw text not null check (length(answer_raw) between 1 and 200),
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  constraint topic_autocheck_answers_attempt_key unique (task_id, profile_id, attempt_no)
);

create index if not exists topic_autocheck_answers_profile_idx on public.topic_autocheck_answers (profile_id, task_id);

comment on table public.topic_autocheck_answers is
  '§266. Попытки ученика (по profile_id): не больше 3 на задачу (CHECK + UNIQUE), пишет только topic_autocheck_check. Задача закрыта: есть верный ответ или 3 попытки.';

-- ══ 5. Сравнение ответа — одно место ═════════════════════════════════════════
-- Основа — общая нормализация normalize_variant_answer (запятая → точка,
-- пробелы, регистр; CLAUDE.md: второй копии не заводить). Сверх неё — то, чего
-- у вариантов нет и что нужно здесь: пробелы ВНУТРИ числа («1 200»), знак
-- минус «−» (U+2212) и тире, допуск; для цифр — разделители и «порядок не
-- важен». variant_answer_verdict не подходит: допуска и цифр соответствия в нём
-- нет, а «13 31» там значит «любое из двух».
create or replace function public.autocheck_number_of(p_raw text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when x.s ~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$' then x.s::numeric end
    from (
      select regexp_replace(
               translate(public.normalize_variant_answer(coalesce(p_raw, '')), E'−–—', '---'),
               E'[\\s   ]', '', 'g') as s
    ) x;
$$;

create or replace function public.autocheck_digits_of(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when x.s ~ '^[0-9]+$' then x.s end
    from (select regexp_replace(coalesce(p_raw, ''), E'[\\s   ,;.]', '', 'g') as s) x;
$$;

create or replace function public.autocheck_sorted_chars(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select string_agg(c, '' order by c) from regexp_split_to_table(p, '') as c;
$$;

-- Верен ли ответ. NULL — ответ не того вида (не число / не цифры): попытка не
-- тратится, ученик видит «Введите число».
create or replace function public.autocheck_answer_correct(
  p_type text, p_value numeric, p_tol numeric, p_text text, p_any_order boolean, p_raw text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'number' then
      case when public.autocheck_number_of(p_raw) is null then null
           else abs(public.autocheck_number_of(p_raw) - p_value) <= coalesce(p_tol, 0) end
    when 'digits' then
      case when public.autocheck_digits_of(p_raw) is null then null
           when p_any_order then public.autocheck_sorted_chars(public.autocheck_digits_of(p_raw))
                                 = public.autocheck_sorted_chars(p_text)
           else public.autocheck_digits_of(p_raw) = p_text end
    else null
  end;
$$;

comment on function public.autocheck_answer_correct(text, numeric, numeric, text, boolean, text) is
  '§266. Вердикт автопроверки: number — |число − эталон| ≤ допуск (запятая/точка, пробелы, «−»); digits — строка цифр (разделители игнорируются), порядок важен, если не digits_any_order. NULL — ответ не того вида.';

-- ══ 6. Помощники доступа и состояния ═════════════════════════════════════════
create or replace function public.topic_autocheck_task_topic(p_task_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$ select t.topic_id from topic_autocheck_tasks t where t.id = p_task_id $$;

create or replace function public.topic_autocheck_task_can_manage(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select public.topic_material_can_manage(public.topic_autocheck_task_topic(p_task_id)) $$;

-- Закрыта ли задача у профиля: есть верный ответ или 3 попытки.
create or replace function public.topic_autocheck_task_closed(p_task_id uuid, p_profile_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(bool_or(a.is_correct) or count(*) >= 3, false)
    from topic_autocheck_answers a
   where a.task_id = p_task_id and a.profile_id = p_profile_id;
$$;

-- Ученик курса, к которому пишется попытка ДЗ-носителя: строка students этого
-- профиля, состоящая в группе курса (профиль может иметь несколько строк).
create or replace function public._topic_autocheck_student_of(p_topic_id uuid, p_profile_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.id
    from students s
    join group_students gs on gs.student_id = s.id
    join groups g          on g.id = gs.group_id
   where s.profile_id = p_profile_id
     and g.course_id = public.course_of_topic(p_topic_id)
   order by s.id
   limit 1;
$$;

-- ══ 7. RLS и права ═══════════════════════════════════════════════════════════
alter table public.topic_autocheck_tasks   enable row level security;
alter table public.topic_autocheck_answers enable row level security;

drop policy if exists topic_autocheck_tasks_select on public.topic_autocheck_tasks;
create policy topic_autocheck_tasks_select on public.topic_autocheck_tasks
  for select to authenticated
  using (public.topic_material_can_manage(topic_id) or public.course_student_can_see_topic(topic_id));

drop policy if exists topic_autocheck_answers_select on public.topic_autocheck_answers;
create policy topic_autocheck_answers_select on public.topic_autocheck_answers
  for select to authenticated
  using (profile_id = auth.uid() or public.topic_autocheck_task_can_manage(task_id));

-- Записи клиенту нет вовсе (ни политик, ни грантов): задачи пишет загрузка
-- (topic_autocheck_import) и копирование, ответы — topic_autocheck_check.
-- Столбцы эталона и пути решения клиенту не выдаются даже на чтение.
revoke all on table public.topic_autocheck_tasks   from public, anon, authenticated;
revoke all on table public.topic_autocheck_answers from public, anon, authenticated;
grant select (id, topic_id, code, position, statement_path, answer_type, digits_any_order, unit, created_at, updated_at)
  on public.topic_autocheck_tasks to authenticated;
grant select on public.topic_autocheck_answers to authenticated;

-- ══ 8. Хранилище: условия и решения картинками ══════════════════════════════
-- Пути не пересобираются при копировании: копия урока ссылается на тот же
-- объект (как материалы §101). Загружает скрипт под сервисным ключом —
-- пишущих политик нет.
insert into storage.buckets (id, name, public, file_size_limit)
values ('topic-autocheck', 'topic-autocheck', false, 5242880)
on conflict (id) do nothing;

create or replace function public.topic_autocheck_object_visible(p_object_name text)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from topic_autocheck_tasks t
     where t.statement_path = p_object_name
       and (public.topic_material_can_manage(t.topic_id) or public.course_student_can_see_topic(t.topic_id))
  ) or exists (
    select 1 from topic_autocheck_tasks t
     where t.solution_path = p_object_name
       and (public.topic_material_can_manage(t.topic_id)
            or (public.course_student_can_see_topic(t.topic_id)
                and public.topic_autocheck_task_closed(t.id, auth.uid())))
  );
$$;

drop policy if exists topic_autocheck_files_read on storage.objects;
create policy topic_autocheck_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'topic-autocheck' and public.topic_autocheck_object_visible(name));

-- ══ 9. Сторожа ДЗ-носителя ═══════════════════════════════════════════════════
-- Флаг носителя: клиент его не ставит и не снимает; копия ДЗ (копирование
-- курса/урока, синхронизация каркаса §172 — все пишут source_homework_id)
-- наследует флаг источника. НЕ definer: смотрит, кто пишет.
create or replace function public.topic_homework_autocheck_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.source_homework_id is not null
       and exists (select 1 from topic_homework s where s.id = new.source_homework_id and s.autocheck) then
      new.autocheck := true;
    elsif current_user in ('authenticated', 'anon') then
      new.autocheck := false;
    end if;
    return new;
  end if;
  if current_user in ('authenticated', 'anon') then
    new.autocheck := old.autocheck;
  end if;
  return new;
end $$;

drop trigger if exists topic_homework_autocheck_guard on public.topic_homework;
create trigger topic_homework_autocheck_guard
  before insert or update on public.topic_homework
  for each row execute function public.topic_homework_autocheck_guard();

-- Попытку и вердикт по носителю пишет только _topic_autocheck_finish: он
-- ставит транзакционный флаг «ДЗ:ученик» (как §198/§240 у своих флагов).
-- Ученик не создаст попытку файлами, учитель не перепишет балл формулы.
create or replace function public.topic_homework_attempts_autocheck_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from topic_homework h where h.id = new.homework_id and h.autocheck)
     and coalesce(current_setting('app.topic_autocheck', true), '') <> new.homework_id::text || ':' || new.student_id::text then
    raise exception 'Задачи с автопроверкой сдаются ответами в уроке, а не файлами'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists topic_homework_attempts_autocheck_guard on public.topic_homework_attempts;
create trigger topic_homework_attempts_autocheck_guard
  before insert on public.topic_homework_attempts
  for each row execute function public.topic_homework_attempts_autocheck_guard();

create or replace function public.topic_homework_reviews_autocheck_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  select a.homework_id::text || ':' || a.student_id::text into v_key
    from topic_homework_attempts a
    join topic_homework h on h.id = a.homework_id
   where a.id = new.attempt_id and h.autocheck;
  if v_key is not null and coalesce(current_setting('app.topic_autocheck', true), '') <> v_key then
    raise exception 'Оценку за задачи с автопроверкой ставит сайт: доля решённых задач урока'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists topic_homework_reviews_autocheck_guard on public.topic_homework_reviews;
create trigger topic_homework_reviews_autocheck_guard
  before insert on public.topic_homework_reviews
  for each row execute function public.topic_homework_reviews_autocheck_guard();

-- ══ 10. Носитель: завести / найти ═══════════════════════════════════════════
-- Существующее ДЗ урока становится носителем, только если у него нет ни
-- файлов, ни попыток (иначе это настоящее ДЗ с работами учеников — его не
-- подменяем, загрузка останавливается с объяснением).
create or replace function public._topic_autocheck_ensure_homework(p_topic_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_hw    record;
  v_owner uuid;
  v_id    uuid;
begin
  select h.id, h.autocheck into v_hw from topic_homework h where h.topic_id = p_topic_id;
  if v_hw.id is not null then
    if v_hw.autocheck then
      return v_hw.id;
    end if;
    if exists (select 1 from topic_homework_attempts a where a.homework_id = v_hw.id)
       or exists (select 1 from topic_homework_files f where f.homework_id = v_hw.id) then
      raise exception 'В уроке уже есть ДЗ с файлами или работами учеников — задачи с автопроверкой его не заменят. Уберите это ДЗ или загрузите задачи в другой урок.'
        using errcode = 'check_violation';
    end if;
    update topic_homework
       set autocheck = true, grade_scale = 'hundred', title = 'Задачи с автопроверкой'
     where id = v_hw.id;
    return v_hw.id;
  end if;

  select c.owner_id into v_owner
    from topics t join modules m on m.id = t.module_id join courses c on c.id = m.course_id
   where t.id = p_topic_id;

  insert into topic_homework (topic_id, title, is_published, created_by, grade_scale, autocheck)
  values (p_topic_id, 'Задачи с автопроверкой', false, coalesce(auth.uid(), v_owner), 'hundred', true)
  returning id into v_id;
  return v_id;
end $$;

-- ══ 11. Итог урока → журнал ═════════════════════════════════════════════════
-- Все задачи урока закрыты → балл round(100 × решённые / все) ложится в ДЗ-
-- носитель как принятая работа. Повторный вызов с тем же баллом ничего не
-- пишет; другой балл (задачи добавили/убрали) — новая строка вердикта.
-- Возвращает балл или NULL (не всё закрыто / задач нет / нет ученика курса).
create or replace function public._topic_autocheck_finish(p_topic_id uuid, p_profile_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_total   integer;
  v_closed  integer;
  v_solved  integer;
  v_grade   integer;
  v_student uuid;
  v_hw      uuid;
  v_att     uuid;
  v_last    integer;
  v_comment text;
begin
  select count(*)::int,
         count(*) filter (where public.topic_autocheck_task_closed(t.id, p_profile_id))::int,
         count(*) filter (where exists (select 1 from topic_autocheck_answers a
                                         where a.task_id = t.id and a.profile_id = p_profile_id and a.is_correct))::int
    into v_total, v_closed, v_solved
    from topic_autocheck_tasks t
   where t.topic_id = p_topic_id;

  if v_total = 0 or v_closed < v_total then
    return null;
  end if;

  v_grade := round(100.0 * v_solved / v_total)::int;
  v_student := public._topic_autocheck_student_of(p_topic_id, p_profile_id);
  if v_student is null then
    return v_grade;
  end if;

  v_hw := public._topic_autocheck_ensure_homework(p_topic_id);
  -- Тема открыта, а носитель ещё не выдан (создан до открытия, крон не успел):
  -- выдаём тем же единственным путём §243.
  perform public._topic_homework_autopublish(array[v_hw], 'content');

  v_comment := format('Автопроверка: решено %s из %s', v_solved, v_total);
  perform set_config('app.topic_autocheck', v_hw::text || ':' || v_student::text, true);

  select a.id into v_att from topic_homework_attempts a
   where a.homework_id = v_hw and a.student_id = v_student and a.status = 'accepted';

  if v_att is not null then
    select r.score into v_last from topic_homework_reviews r
     where r.attempt_id = v_att order by r.created_at desc, r.id desc limit 1;
    if v_last is distinct from v_grade then
      insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score)
      values (v_att, p_profile_id, 'accepted', v_comment, v_grade);
    end if;
  else
    insert into topic_homework_attempts (homework_id, student_id, attempt_number)
    values (v_hw, v_student, 1)
    returning id into v_att;
    update topic_homework_attempts set status = 'submitted', submitted_at = now() where id = v_att;
    insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score)
    values (v_att, p_profile_id, 'accepted', v_comment, v_grade);
    update topic_homework_attempts set status = 'accepted' where id = v_att;
  end if;

  perform set_config('app.topic_autocheck', '', true);
  return v_grade;
end $$;

-- Пересчёт итога у всех, кто уже получил его (после загрузки/удаления задач).
create or replace function public._topic_autocheck_regrade(p_topic_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_p record;
  v_n integer := 0;
begin
  for v_p in
    select distinct s.profile_id
      from topic_homework h
      join topic_homework_attempts a on a.homework_id = h.id and a.status = 'accepted'
      join students s on s.id = a.student_id
     where h.topic_id = p_topic_id and h.autocheck and s.profile_id is not null
  loop
    if public._topic_autocheck_finish(p_topic_id, v_p.profile_id) is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- ══ 12. Состояние урока (ученик и персонал) ═════════════════════════════════
-- Ученику: задачи со своим состоянием; эталон и путь решения — только у
-- закрытых. Персоналу курса: всё, без личного состояния. Остальным — 42501.
create or replace function public.topic_autocheck_state(p_topic_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_staff boolean;
  v_tasks jsonb;
  v_total integer;
  v_solved integer;
  v_closed integer;
begin
  if v_uid is null then
    raise exception 'Нужен вход' using errcode = '42501';
  end if;
  v_staff := public.topic_material_can_manage(p_topic_id);
  if not v_staff and not public.course_student_can_see_topic(p_topic_id) then
    raise exception 'Нет доступа к этому уроку' using errcode = '42501';
  end if;

  with t as (
    select k.*,
           coalesce((select count(*) from topic_autocheck_answers a
                      where a.task_id = k.id and a.profile_id = v_uid), 0)::int as used,
           exists (select 1 from topic_autocheck_answers a
                    where a.task_id = k.id and a.profile_id = v_uid and a.is_correct) as solved
      from topic_autocheck_tasks k
     where k.topic_id = p_topic_id
  ), s as (
    select t.*, (t.solved or t.used >= 3) as closed from t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               s.id,
           'code',             s.code,
           'position',         s.position,
           'statement_path',   s.statement_path,
           'answer_type',      s.answer_type,
           'digits_any_order', s.digits_any_order,
           'unit',             s.unit,
           'attempts_used',    case when v_staff then 0 else s.used end,
           'attempts_left',    case when v_staff then 3 else greatest(3 - s.used, 0) end,
           'solved',           not v_staff and s.solved,
           'closed',           not v_staff and s.closed,
           'answers',          case when v_staff then '[]'::jsonb else coalesce((
                                 select jsonb_agg(jsonb_build_object('attempt_no', a.attempt_no,
                                                                     'answer', a.answer_raw,
                                                                     'correct', a.is_correct)
                                                  order by a.attempt_no)
                                   from topic_autocheck_answers a
                                  where a.task_id = s.id and a.profile_id = v_uid), '[]'::jsonb) end,
           'answer_value',     case when v_staff or s.closed then s.answer_value end,
           'answer_tol',       case when v_staff or s.closed then s.answer_tol end,
           'answer_text',      case when v_staff or s.closed then s.answer_text end,
           'solution_path',    case when v_staff or s.closed then s.solution_path end
         ) order by s.position, s.code), '[]'::jsonb),
         count(*)::int,
         count(*) filter (where not v_staff and s.solved)::int,
         count(*) filter (where not v_staff and s.closed)::int
    into v_tasks, v_total, v_solved, v_closed
    from s;

  return jsonb_build_object(
    'topic_id', p_topic_id,
    'is_staff', v_staff,
    'tasks',    v_tasks,
    'total',    v_total,
    'solved',   v_solved,
    'closed',   v_closed,
    'finished', not v_staff and v_total > 0 and v_closed = v_total,
    'grade',    case when not v_staff and v_total > 0 and v_closed = v_total
                     then round(100.0 * v_solved / v_total)::int end
  );
end $$;

comment on function public.topic_autocheck_state(uuid) is
  '§266. Задачи с автопроверкой урока: ученику — со своим состоянием (попытки, решена, закрыта), эталон и путь решения — только у закрытых задач; персоналу курса — всё, без личного состояния. Иначе 42501.';

-- ══ 13. Проверка ответа ═════════════════════════════════════════════════════
-- Сравнение на сервере, счётчик попыток (не больше 3: CHECK + UNIQUE +
-- блокировка по паре задача×профиль), закрытие, итог урока. Ответ не того
-- вида (не число) попытку не тратит — ошибка 22023 «AUTOCHECK_FORMAT».
-- Закрытая задача — ошибка «AUTOCHECK_CLOSED», четвёртой попытки нет.
create or replace function public.topic_autocheck_check(p_task_id uuid, p_answer text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_task    record;
  v_used    integer;
  v_solved  boolean;
  v_ok      boolean;
  v_raw     text := btrim(coalesce(p_answer, ''));
  v_grade   integer;
  v_closed  boolean;
begin
  if v_uid is null then
    raise exception 'Нужен вход' using errcode = '42501';
  end if;

  select * into v_task from topic_autocheck_tasks where id = p_task_id;
  if v_task.id is null or not public.course_student_can_see_topic(v_task.topic_id) then
    raise exception 'Нет доступа к этой задаче' using errcode = '42501';
  end if;
  if public._topic_autocheck_student_of(v_task.topic_id, v_uid) is null
     and public.auth_student_id() is null then
    raise exception 'Отвечать может только ученик курса' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_task_id::text || ':' || v_uid::text, 266));

  select count(*)::int, coalesce(bool_or(a.is_correct), false) into v_used, v_solved
    from topic_autocheck_answers a where a.task_id = p_task_id and a.profile_id = v_uid;
  if v_solved or v_used >= 3 then
    raise exception 'AUTOCHECK_CLOSED: задача уже закрыта — попыток больше нет'
      using errcode = 'check_violation';
  end if;

  if v_raw = '' or length(v_raw) > 200 then
    raise exception 'AUTOCHECK_FORMAT: введите ответ' using errcode = '22023';
  end if;
  v_ok := public.autocheck_answer_correct(v_task.answer_type, v_task.answer_value, v_task.answer_tol,
                                          v_task.answer_text, v_task.digits_any_order, v_raw);
  if v_ok is null then
    raise exception 'AUTOCHECK_FORMAT: %',
      case v_task.answer_type when 'number' then 'введите число' else 'введите цифры ответа' end
      using errcode = '22023';
  end if;

  insert into topic_autocheck_answers (task_id, profile_id, attempt_no, answer_raw, is_correct)
  values (p_task_id, v_uid, v_used + 1, v_raw, v_ok);

  v_closed := v_ok or v_used + 1 >= 3;
  if v_closed then
    v_grade := public._topic_autocheck_finish(v_task.topic_id, v_uid);
  end if;

  return jsonb_build_object(
    'task_id',       p_task_id,
    'correct',       v_ok,
    'attempts_used', v_used + 1,
    'attempts_left', greatest(3 - (v_used + 1), 0),
    'closed',        v_closed,
    'grade',         v_grade,
    'state',         public.topic_autocheck_state(v_task.topic_id)
  );
end $$;

comment on function public.topic_autocheck_check(uuid, text) is
  '§266. Ответ ученика на задачу с автопроверкой: сравнение на сервере, 3 попытки, после закрытия — эталон и решение в state; закрыты все задачи урока — оценка в журнал (ДЗ-носитель). Ошибки: AUTOCHECK_CLOSED (закрыта), AUTOCHECK_FORMAT (не число — попытка не тратится), 42501.';

-- ══ 14. Результаты класса (персонал) ════════════════════════════════════════
create or replace function public.topic_autocheck_results(p_topic_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_course uuid := public.course_of_topic(p_topic_id);
begin
  if not public.course_is_staff(v_course) then
    raise exception 'Нет прав на этот курс' using errcode = '42501';
  end if;

  return (
    with tasks as (
      select k.id, k.code, k.position from topic_autocheck_tasks k where k.topic_id = p_topic_id
    ),
    roster as (
      select distinct on (s.id) s.id as student_id, s.profile_id,
             coalesce(nullif(btrim(p.full_name), ''), 'Без имени') as name
        from group_students gs
        join groups g   on g.id = gs.group_id
        join students s on s.id = gs.student_id
        left join profiles p on p.id = s.profile_id
       where g.course_id = v_course
       order by s.id
    ),
    cell as (
      select r.student_id, k.id as task_id,
             count(a.id)::int as attempts,
             coalesce(bool_or(a.is_correct), false) as solved,
             (coalesce(bool_or(a.is_correct), false) or count(a.id) >= 3) as closed
        from roster r cross join tasks k
        left join topic_autocheck_answers a on a.task_id = k.id and a.profile_id = r.profile_id
       group by r.student_id, k.id
    ),
    per as (
      select r.student_id, r.profile_id, r.name,
             coalesce(sum(c.attempts), 0)::int as attempts,
             count(*) filter (where c.solved)::int as solved,
             count(*) filter (where c.closed)::int as closed,
             coalesce(jsonb_agg(jsonb_build_object('task_id', c.task_id, 'attempts', c.attempts,
                                                   'solved', c.solved, 'closed', c.closed))
                      filter (where c.task_id is not null), '[]'::jsonb) as cells
        from roster r left join cell c on c.student_id = r.student_id
       group by r.student_id, r.profile_id, r.name
    )
    select jsonb_build_object(
      'topic_id', p_topic_id,
      'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'position', position)
                                          order by position, code) from tasks), '[]'::jsonb),
      'students', coalesce((select jsonb_agg(jsonb_build_object(
                     'student_id', per.student_id, 'name', per.name,
                     'attempts', per.attempts, 'solved', per.solved, 'closed', per.closed,
                     'finished', (select count(*) from tasks) > 0 and per.closed = (select count(*) from tasks),
                     'grade', case when (select count(*) from tasks) > 0 and per.closed = (select count(*) from tasks)
                                   then round(100.0 * per.solved / (select count(*) from tasks))::int end,
                     'cells', per.cells) order by per.name, per.student_id) from per), '[]'::jsonb)
    )
  );
end $$;

comment on function public.topic_autocheck_results(uuid) is
  '§266. Результаты класса по задачам с автопроверкой урока (course_is_staff, иначе 42501): ученики групп курса × задачи — попытки, решена, закрыта; итог (balls = round(100 × решённые / все)) — когда закрыты все.';

-- ══ 15. Загрузка задач (скрипт под сервисным ключом или персонал курса) ═════
-- p_tasks — массив {code, position, statement_path, solution_path, answer_type,
-- answer_value, answer_tol, answer_text, digits_any_order, unit}. Повтор по
-- (урок, code) обновляет строку. Урок без пометки становится
-- «Тренировочным». Каркас: те же задачи уезжают в уроки-копии (по
-- source_topic_id), с линейкой source_task_id.
create or replace function public.topic_autocheck_import(p_topic_id uuid, p_tasks jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_role   text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_t      jsonb;
  v_ins    integer := 0;
  v_upd    integer := 0;
  v_same   integer := 0;
  v_id     uuid;
  v_copy   record;
  v_copies integer := 0;
  v_n      integer;
  v_type   text;
begin
  if auth.uid() is null then
    if v_role not in ('service_role', '') then
      raise exception 'Нет прав' using errcode = '42501';
    end if;
  elsif not public.topic_material_can_manage(p_topic_id) then
    raise exception 'Нет прав на этот урок' using errcode = '42501';
  end if;
  if not exists (select 1 from topics where id = p_topic_id) then
    raise exception 'Урок не найден' using errcode = 'no_data_found';
  end if;
  -- Проверочной и контрольной носитель не подходит: их шкала — 2–5 (§265).
  if exists (select 1 from topics where id = p_topic_id and kind in ('check', 'control')) then
    raise exception 'Задачи с автопроверкой — только в уроке, не в проверочной или контрольной'
      using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_tasks) is distinct from 'array' or jsonb_array_length(p_tasks) = 0 then
    raise exception 'Нужен непустой массив задач' using errcode = '22023';
  end if;

  for v_t in select * from jsonb_array_elements(p_tasks) loop
    v_type := v_t ->> 'answer_type';
    if coalesce(btrim(v_t ->> 'code'), '') = '' or coalesce(btrim(v_t ->> 'statement_path'), '') = '' then
      raise exception 'У задачи нет кода или файла условия: %', v_t using errcode = '22023';
    end if;
    if v_type = 'number' and (v_t ->> 'answer_value') is null then
      raise exception 'Задача %: у числового ответа нет значения', v_t ->> 'code' using errcode = '22023';
    end if;
    if v_type = 'digits' and coalesce(v_t ->> 'answer_text', '') !~ '^[0-9]+$' then
      raise exception 'Задача %: ответ из цифр должен быть строкой цифр', v_t ->> 'code' using errcode = '22023';
    end if;
    if v_type is null or v_type not in ('number', 'digits') then
      raise exception 'Задача %: тип ответа — number или digits', v_t ->> 'code' using errcode = '22023';
    end if;

    select id into v_id from topic_autocheck_tasks where topic_id = p_topic_id and code = btrim(v_t ->> 'code');
    if v_id is null then
      insert into topic_autocheck_tasks (topic_id, code, position, statement_path, solution_path, answer_type,
                                         answer_value, answer_tol, answer_text, digits_any_order, unit)
      values (p_topic_id, btrim(v_t ->> 'code'), coalesce((v_t ->> 'position')::int, 0),
              v_t ->> 'statement_path', nullif(v_t ->> 'solution_path', ''), v_type,
              case when v_type = 'number' then (v_t ->> 'answer_value')::numeric end,
              coalesce((v_t ->> 'answer_tol')::numeric, 0),
              case when v_type = 'digits' then v_t ->> 'answer_text' end,
              coalesce((v_t ->> 'digits_any_order')::boolean, false),
              nullif(btrim(coalesce(v_t ->> 'unit', '')), ''));
      v_ins := v_ins + 1;
    else
      update topic_autocheck_tasks k
         set position = coalesce((v_t ->> 'position')::int, 0),
             statement_path = v_t ->> 'statement_path',
             solution_path = nullif(v_t ->> 'solution_path', ''),
             answer_type = v_type,
             answer_value = case when v_type = 'number' then (v_t ->> 'answer_value')::numeric end,
             answer_tol = coalesce((v_t ->> 'answer_tol')::numeric, 0),
             answer_text = case when v_type = 'digits' then v_t ->> 'answer_text' end,
             digits_any_order = coalesce((v_t ->> 'digits_any_order')::boolean, false),
             unit = nullif(btrim(coalesce(v_t ->> 'unit', '')), ''),
             updated_at = now()
       where k.id = v_id
         and (k.position, k.statement_path, k.solution_path, k.answer_type, k.answer_value, k.answer_tol,
              k.answer_text, k.digits_any_order, k.unit)
             is distinct from
             (coalesce((v_t ->> 'position')::int, 0), v_t ->> 'statement_path', nullif(v_t ->> 'solution_path', ''),
              v_type, case when v_type = 'number' then (v_t ->> 'answer_value')::numeric end,
              coalesce((v_t ->> 'answer_tol')::numeric, 0), case when v_type = 'digits' then v_t ->> 'answer_text' end,
              coalesce((v_t ->> 'digits_any_order')::boolean, false), nullif(btrim(coalesce(v_t ->> 'unit', '')), ''));
      get diagnostics v_n = row_count;
      if v_n > 0 then v_upd := v_upd + 1; else v_same := v_same + 1; end if;
    end if;
  end loop;

  update topics set lesson_format = 'training' where id = p_topic_id and lesson_format is null;
  perform public._topic_autocheck_ensure_homework(p_topic_id);
  perform public._topic_autocheck_regrade(p_topic_id);

  -- Уроки-копии каркаса (и прочие копии с линейкой): те же задачи.
  for v_copy in
    select ct.id from topics ct
      join modules m on m.id = ct.module_id
     where ct.source_topic_id = p_topic_id
  loop
    v_copies := v_copies + 1;
    insert into topic_autocheck_tasks (topic_id, code, position, statement_path, solution_path, answer_type,
                                       answer_value, answer_tol, answer_text, digits_any_order, unit, source_task_id)
    select v_copy.id, k.code, k.position, k.statement_path, k.solution_path, k.answer_type,
           k.answer_value, k.answer_tol, k.answer_text, k.digits_any_order, k.unit, k.id
      from topic_autocheck_tasks k
     where k.topic_id = p_topic_id
    on conflict (topic_id, code) do update
       set position = excluded.position, statement_path = excluded.statement_path,
           solution_path = excluded.solution_path, answer_type = excluded.answer_type,
           answer_value = excluded.answer_value, answer_tol = excluded.answer_tol,
           answer_text = excluded.answer_text, digits_any_order = excluded.digits_any_order,
           unit = excluded.unit, source_task_id = excluded.source_task_id, updated_at = now()
     where (topic_autocheck_tasks.position, topic_autocheck_tasks.statement_path, topic_autocheck_tasks.solution_path,
            topic_autocheck_tasks.answer_type, topic_autocheck_tasks.answer_value, topic_autocheck_tasks.answer_tol,
            topic_autocheck_tasks.answer_text, topic_autocheck_tasks.digits_any_order, topic_autocheck_tasks.unit,
            topic_autocheck_tasks.source_task_id)
           is distinct from
           (excluded.position, excluded.statement_path, excluded.solution_path, excluded.answer_type,
            excluded.answer_value, excluded.answer_tol, excluded.answer_text, excluded.digits_any_order,
            excluded.unit, excluded.source_task_id);
    update topics set lesson_format = 'training' where id = v_copy.id and lesson_format is null;
    perform public._topic_autocheck_ensure_homework(v_copy.id);
    perform public._topic_autocheck_regrade(v_copy.id);
  end loop;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'unchanged', v_same, 'copies', v_copies,
                            'total', (select count(*) from topic_autocheck_tasks where topic_id = p_topic_id));
end $$;

comment on function public.topic_autocheck_import(uuid, jsonb) is
  '§266. Загрузка задач с автопроверкой в урок (скрипт scripts/import-autocheck.mjs под сервисным ключом или персонал курса): upsert по (урок, code), урок без пометки → training, ДЗ-носитель, пересчёт итогов; уроки-копии (source_topic_id) получают те же задачи.';

-- ══ 16. Порядок и удаление (персонал) ═══════════════════════════════════════
create or replace function public.topic_autocheck_reorder(p_topic_id uuid, p_task_ids uuid[])
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if not public.topic_material_can_manage(p_topic_id) then
    raise exception 'Нет прав на этот урок' using errcode = '42501';
  end if;
  update topic_autocheck_tasks k
     set position = x.ord::int, updated_at = now()
    from unnest(p_task_ids) with ordinality as x(id, ord)
   where k.id = x.id and k.topic_id = p_topic_id and k.position is distinct from x.ord::int;
  get diagnostics v_n = row_count;
  -- Копии каркаса: тот же порядок по линейке.
  update topic_autocheck_tasks c
     set position = s.position, updated_at = now()
    from topic_autocheck_tasks s
   where c.source_task_id = s.id and s.topic_id = p_topic_id and c.position is distinct from s.position;
  return v_n;
end $$;

create or replace function public.topic_autocheck_delete(p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_topic   uuid := public.topic_autocheck_task_topic(p_task_id);
  v_answers integer;
  v_kept    integer := 0;
  v_copy    record;
begin
  if v_topic is null or not public.topic_material_can_manage(v_topic) then
    raise exception 'Нет прав на эту задачу' using errcode = '42501';
  end if;
  select count(*)::int into v_answers from topic_autocheck_answers where task_id = p_task_id;
  if v_answers > 0 then
    raise exception 'По задаче уже есть ответы учеников (%) — удалить её нельзя: изменились бы их оценки', v_answers
      using errcode = 'check_violation';
  end if;
  -- Копии без ответов уходят вместе с задачей каркаса; с ответами — остаются.
  for v_copy in select c.id, c.topic_id from topic_autocheck_tasks c where c.source_task_id = p_task_id loop
    if exists (select 1 from topic_autocheck_answers a where a.task_id = v_copy.id) then
      v_kept := v_kept + 1;
    else
      delete from topic_autocheck_tasks where id = v_copy.id;
      perform public._topic_autocheck_regrade(v_copy.topic_id);
    end if;
  end loop;
  delete from topic_autocheck_tasks where id = p_task_id;
  perform public._topic_autocheck_regrade(v_topic);
  return jsonb_build_object('deleted', true, 'kept_in_copies', v_kept);
end $$;

-- ══ 17. Пометка урока каркаса уезжает в копии ═══════════════════════════════
-- Отдельным триггером, а не правкой движка синхронизации §172: у движка свой
-- список столбцов, и менять его тело ради одного столбца — лишний риск.
create or replace function public.trg_topic_lesson_format_sync()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from modules m join courses c on c.id = m.course_id
              where m.id = new.module_id and c.is_template) then
    update topics set lesson_format = new.lesson_format
     where source_topic_id = new.id and lesson_format is distinct from new.lesson_format;
  end if;
  return null;
end $$;

drop trigger if exists topics_lesson_format_sync on public.topics;
create trigger topics_lesson_format_sync
  after update of lesson_format on public.topics
  for each row when (old.lesson_format is distinct from new.lesson_format)
  execute function public.trg_topic_lesson_format_sync();

-- ══ 18. Выдача §243: носитель выдаётся без файлов ═══════════════════════════
-- Точечная замена одного условия в текущем теле _topic_homework_autopublish
-- (как §265): «ДЗ урока без файлов не выдаётся» → «… кроме носителя
-- автопроверки». Остальной текст не меняется; замена обязана сработать ровно
-- один раз, иначе — ошибка; повторный прогон видит уже заменённое и молчит.
do $mig$
declare
  d  text;
  n0 text;
begin
  d := pg_get_functiondef('public._topic_homework_autopublish(uuid[], text)'::regprocedure);
  if position('h.autocheck' in d) > 0 then
    return;
  end if;
  n0 := d;
  d := regexp_replace(d,
         $re$or exists \(select 1 from topic_homework_files f where f\.homework_id = h\.id\)\)$re$,
         'or exists (select 1 from topic_homework_files f where f.homework_id = h.id) or h.autocheck)');
  if d = n0 then
    raise exception '§266: в _topic_homework_autopublish не найдено условие «есть файл»';
  end if;
  execute d;
end
$mig$;

-- ══ 19. Копирование курса/урока: пометка, флаг носителя, задачи ═════════════
-- Тело — 20260928122420 (§240) дословно, плюс три правки, помеченные §266.
-- Обе функции копирования (course_copy_stage и topic_copy_stage) зовут эту
-- сразу после вставки темы — одно место, пути не разъедутся.
create or replace function public.course_copy_topic_content(
  p_source_topic_id uuid,
  p_target_topic_id uuid,
  p_mode text,
  p_shift_days integer
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row record;
  v_hw_id uuid;
  v_new_hw_id uuid;
  v_variant_id uuid;
  v_new_variant_id uuid;
begin
  -- Перенос тумблера живёт здесь, а не в course_copy_stage и topic_copy_stage:
  -- обе зовут эту функцию сразу после вставки темы, и только тут есть оба
  -- идентификатора. Одно место — два пути копирования не разъедутся.
  --
  -- Правило: nullif(is_open, true) — false → false, true → null, null → null.
  -- §240: тип темы (урок / проверочная / контрольная) едет вместе с темой.
  -- §266: и пометка урока («Тренировочный» / «Формат ЕГЭ»).
  -- Окно времени — у ДЗ и классное: ниже его не переносим.
  update topics tgt
     set is_open = nullif(src.is_open, true),
         kind = src.kind,
         lesson_format = src.lesson_format
    from topics src
   where tgt.id = p_target_topic_id
     and src.id = p_source_topic_id;

  -- Пути НЕ пересобираются: копия ссылается на тот же объект (§101).
  for v_row in
    select * from topic_material_items
     where topic_id = p_source_topic_id
     order by position, created_at
  loop
    insert into topic_material_items (
      topic_id, kind, title, content, url, storage_path,
      file_name, mime_type, size_bytes, position, is_visible, section,
      created_by, source_item_id, track, subtopic_code, subtopic_title
    ) values (
      p_target_topic_id, v_row.kind, v_row.title, v_row.content,
      v_row.url, v_row.storage_path, v_row.file_name, v_row.mime_type, v_row.size_bytes,
      v_row.position, v_row.is_visible, v_row.section, auth.uid(), v_row.id,
      v_row.track, v_row.subtopic_code, v_row.subtopic_title
    );
  end loop;

  -- §266: задачи с автопроверкой — до ДЗ: носитель, выданный при вставке в
  -- открытую тему, уже видит свои задачи. Пути те же (§101), ответов нет.
  insert into topic_autocheck_tasks (
    topic_id, code, position, statement_path, solution_path, answer_type,
    answer_value, answer_tol, answer_text, digits_any_order, unit, source_task_id
  )
  select p_target_topic_id, k.code, k.position, k.statement_path, k.solution_path, k.answer_type,
         k.answer_value, k.answer_tol, k.answer_text, k.digits_any_order, k.unit, k.id
    from topic_autocheck_tasks k
   where k.topic_id = p_source_topic_id
  on conflict (topic_id, code) do nothing;

  select id into v_hw_id from topic_homework where topic_id = p_source_topic_id;
  if v_hw_id is not null then
    -- §266: autocheck — флаг ДЗ-носителя.
    insert into topic_homework (topic_id, title, instructions, is_published, created_by, due_at, grade_scale, source_homework_id, autocheck)
    select p_target_topic_id, title, instructions, false, auth.uid(),
           public.course_copy_shift_date(due_at, p_mode, p_shift_days), grade_scale, id, autocheck
      from topic_homework where id = v_hw_id
    returning id into v_new_hw_id;

    for v_row in
      select * from topic_homework_files where homework_id = v_hw_id order by position
    loop
      insert into topic_homework_files (homework_id, storage_path, original_filename, mime_type, size_bytes, position, source_file_id)
      values (v_new_hw_id, v_row.storage_path, v_row.original_filename, v_row.mime_type, v_row.size_bytes, v_row.position, v_row.id);
    end loop;
  end if;

  insert into topic_test_assignments (test_id, topic_id, assigned_by)
  select test_id, p_target_topic_id, auth.uid()
    from topic_test_assignments where topic_id = p_source_topic_id;

  -- Задачи к уроку (§164). Своей линейки у набора нет: у темы он один, связь
  -- идёт через тему. Выдач не создаётся ни одной — в классе строка выдачи
  -- заведётся сама при первом обращении ученика.
  select id into v_variant_id from test_variants where topic_id = p_source_topic_id;

  if v_variant_id is not null
     and not exists (select 1 from test_variants where topic_id = p_target_topic_id)
  then
    insert into test_variants (
      title, description, subject, exam_type, status, created_by,
      settings, tasks_count, source_type, topic_id
    )
    select title, description, subject, exam_type, status, auth.uid(),
           settings, tasks_count, source_type, p_target_topic_id
      from test_variants where id = v_variant_id
    returning id into v_new_variant_id;

    insert into test_variant_items (
      variant_id, task_id, position, section_id, topic_id, points, grading_type
    )
    select v_new_variant_id, task_id, position, section_id, topic_id, points, grading_type
      from test_variant_items where variant_id = v_variant_id;
  end if;

  -- Дублировать нечего: фаза копирования файлов на клиенте остаётся пустой.
  return '[]'::jsonb;
end
$function$;

-- ══ 20. Гранты ═══════════════════════════════════════════════════════════════
revoke all on function public.autocheck_number_of(text)                          from public, anon;
revoke all on function public.autocheck_digits_of(text)                          from public, anon;
revoke all on function public.autocheck_sorted_chars(text)                       from public, anon;
revoke all on function public.autocheck_answer_correct(text, numeric, numeric, text, boolean, text) from public, anon;
revoke all on function public.topic_autocheck_task_topic(uuid)                    from public, anon;
revoke all on function public.topic_autocheck_task_can_manage(uuid)               from public, anon;
revoke all on function public.topic_autocheck_task_closed(uuid, uuid)             from public, anon, authenticated;
revoke all on function public._topic_autocheck_student_of(uuid, uuid)             from public, anon, authenticated;
revoke all on function public.topic_autocheck_object_visible(text)                from public, anon;
revoke all on function public.topic_homework_autocheck_guard()                    from public, anon, authenticated;
revoke all on function public.topic_homework_attempts_autocheck_guard()           from public, anon, authenticated;
revoke all on function public.topic_homework_reviews_autocheck_guard()            from public, anon, authenticated;
revoke all on function public._topic_autocheck_ensure_homework(uuid)              from public, anon, authenticated;
revoke all on function public._topic_autocheck_finish(uuid, uuid)                 from public, anon, authenticated;
revoke all on function public._topic_autocheck_regrade(uuid)                      from public, anon, authenticated;
revoke all on function public.topic_autocheck_state(uuid)                         from public, anon;
revoke all on function public.topic_autocheck_check(uuid, text)                   from public, anon;
revoke all on function public.topic_autocheck_results(uuid)                       from public, anon;
revoke all on function public.topic_autocheck_import(uuid, jsonb)                 from public, anon;
revoke all on function public.topic_autocheck_reorder(uuid, uuid[])               from public, anon;
revoke all on function public.topic_autocheck_delete(uuid)                        from public, anon;
revoke all on function public.trg_topic_lesson_format_sync()                      from public, anon, authenticated;

-- Политикам и проверке на клиенте нужны помощники; сам вердикт — чистая функция.
grant execute on function public.autocheck_number_of(text)                        to authenticated;
grant execute on function public.autocheck_digits_of(text)                        to authenticated;
grant execute on function public.autocheck_sorted_chars(text)                     to authenticated;
grant execute on function public.autocheck_answer_correct(text, numeric, numeric, text, boolean, text) to authenticated;
grant execute on function public.topic_autocheck_task_topic(uuid)                 to authenticated;
grant execute on function public.topic_autocheck_task_can_manage(uuid)            to authenticated;
grant execute on function public.topic_autocheck_object_visible(text)             to authenticated;
grant execute on function public.topic_autocheck_state(uuid)                      to authenticated;
grant execute on function public.topic_autocheck_check(uuid, text)                to authenticated;
grant execute on function public.topic_autocheck_results(uuid)                    to authenticated;
grant execute on function public.topic_autocheck_import(uuid, jsonb)              to authenticated;
grant execute on function public.topic_autocheck_reorder(uuid, uuid[])            to authenticated;
grant execute on function public.topic_autocheck_delete(uuid)                     to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.topic_autocheck_import(uuid, jsonb) to service_role';
    execute 'grant select, insert, update, delete on table public.topic_autocheck_tasks to service_role';
    execute 'grant select on table public.topic_autocheck_answers to service_role';
  end if;
end $$;
