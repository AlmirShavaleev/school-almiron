-- §221. Пробник как урок в курсе: окно по времени, бланк первой части, фото
-- второй части, ключ ответов, автопроверка первой части.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration, после чего
-- файл переименовывается в <version>_<name>.sql точно по записи в
-- supabase_migrations.schema_migrations (MIGRATIONS.md).
--
-- Только добавляющая: новые колонки у mock_exams и mock_exam_task_scores,
-- четыре новые таблицы, новые функции, приватный бакет хранилища и его
-- политики. Политики mock_exams и mock_exam_results НЕ тронуты (граница
-- карточки 072), save_mock_exam_grid (§218) и notify_mock_exam_results (§219)
-- НЕ тронуты — автопроверка кормит их, а не переписывает.
--
-- ГЛАВНОЕ ПРАВИЛО: время проверяет база. Всё, что зависит от часов, решается
-- здесь по now(), а не в браузере. Таймер на экране — только отображение.
-- Поэтому у ученика НЕТ ни одной политики записи: бланк, сдача, фото —
-- только через функции ниже, каждая сама сверяет окно:
--
--   до начала               — условия нет (ни пути, ни файла);
--   начало … конец          — бланк пишется, сдать можно;
--   после сдачи             — бланк не пишется;
--   после конца             — бланк не пишется, сдать нельзя;
--   конец … конец + 15 мин  — фото ещё принимаются;
--   после конец + 15 мин    — фото не принимаются;
--   ключ ответов            — ученику никогда (таблица без политик для него);
--   решение и разбор        — только после mock_exam_results.notified_at (§219).
--
-- ──────────────────────────────────────────────────────────────────────────
-- 1. Пробник в программе курса и его окно
-- ──────────────────────────────────────────────────────────────────────────
-- Пробник уже привязан к группе и шаблону (§218). В программу курса он
-- встаёт привязкой к РАЗДЕЛУ (modules) с местом среди тем, а не особым видом
-- темы: тема несёт на себе материалы, ДЗ, тесты, «тема пройдена»
-- (topic_done_events, §152), копирование курса и счётчики §141 — пробник в
-- любой из этих механизмов лёг бы чужеродно. Привязка к разделу не трогает
-- ни одного из них.
--
-- module_position — место среди тем раздела: пробник показывается сразу
-- после последней темы, у которой order_index <= module_position (меньше
-- всех — первым в разделе). Хранится число, а не ссылка на тему: удалённая
-- или перенесённая тема не утащит пробник в чужой раздел.

alter table public.mock_exams
  add column if not exists module_id           uuid references public.modules(id) on delete set null,
  add column if not exists module_position     integer not null default 0,
  add column if not exists starts_at           timestamptz,
  add column if not exists duration_minutes    smallint not null default 240
    check (duration_minutes between 10 and 720),
  add column if not exists photo_grace_minutes smallint not null default 15
    check (photo_grace_minutes between 0 and 120),
  add column if not exists condition_path      text,
  add column if not exists solution_path       text;

comment on column public.mock_exams.module_id is
  '§221. Раздел программы курса, в котором пробник виден ученику как урок. null — пробник вне программы (как до §221).';
comment on column public.mock_exams.module_position is
  '§221. Место в разделе: пробник идёт после последней темы с order_index <= module_position.';
comment on column public.mock_exams.starts_at is
  '§221. Общее начало для всех. null — пробник без онлайн-окна (результаты вносятся только таблицей §218).';
comment on column public.mock_exams.duration_minutes is
  '§221. Сколько идёт пробник от начала. Бланк пишется до starts_at + duration.';
comment on column public.mock_exams.photo_grace_minutes is
  '§221. Сколько после конца ещё принимаются фото второй части.';
comment on column public.mock_exams.condition_path is
  '§221. Условие (PDF) в бакете mock-exams. Выдаётся ученику только с начала — политикой хранилища по now().';
comment on column public.mock_exams.solution_path is
  '§221. Решение (PDF) в бакете mock-exams. Ученику — только после отправки ему результата (notified_at).';

create index if not exists mock_exams_module_idx on public.mock_exams (module_id);

-- Окно одного пробника. Одна функция — все проверки ниже спрашивают её,
-- своих копий арифметики «конец = начало + длительность» нет.
create or replace function public.mock_exam_window(p_mock_exam_id uuid)
returns table (starts_at timestamptz, ends_at timestamptz, photos_until timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select me.starts_at,
         me.starts_at + make_interval(mins => me.duration_minutes),
         me.starts_at + make_interval(mins => me.duration_minutes + me.photo_grace_minutes)
    from public.mock_exams me
   where me.id = p_mock_exam_id;
$$;

revoke all on function public.mock_exam_window(uuid) from public, anon;
grant execute on function public.mock_exam_window(uuid) to authenticated;

-- Раздел — из курса группы пробника; у онлайн-пробника есть шаблон (без него
-- неизвестно, сколько полей в бланке) и группа (без неё некому писать).
create or replace function public.mock_exams_lesson_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.module_id is not null and not exists (
    select 1 from public.modules m
      join public.groups g on g.course_id = m.course_id
     where m.id = new.module_id and g.id = new.group_id
  ) then
    raise exception 'Раздел не из курса группы этого пробника' using errcode = '23514';
  end if;
  if new.starts_at is not null and (new.template_id is null or new.group_id is null) then
    raise exception 'Онлайн-пробнику нужны шаблон и группа' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists mock_exams_lesson_guard on public.mock_exams;
create trigger mock_exams_lesson_guard
  before insert or update of module_id, group_id, starts_at, template_id on public.mock_exams
  for each row execute function public.mock_exams_lesson_guard();

-- Кто вправе НАСТРАИВАТЬ пробник и писать итоги: персонал курса группы
-- (mock_exam_is_staff → course_is_staff, §218) и то же условие, что у
-- существующей mock_exam_results_manage (is_admin_or_owner() или роль
-- teacher). Ровно так же §219 решает, кто рассылает результат.
create or replace function public.mock_exam_can_manage(p_mock_exam_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.mock_exam_is_staff(p_mock_exam_id)
     and (public.is_admin_or_owner() or public.get_my_role() = 'teacher');
$$;

revoke all on function public.mock_exam_can_manage(uuid) from public, anon;
grant execute on function public.mock_exam_can_manage(uuid) to authenticated;

-- id ученика-вызывающего, если он в группе пробника; иначе null. Условие —
-- то же, что в ученической ветке политики mock_exams_select.
create or replace function public.mock_exam_my_student_id(p_mock_exam_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id
    from public.mock_exams me
    join public.group_students gs on gs.group_id = me.group_id
    join public.students s on s.id = gs.student_id
   where me.id = p_mock_exam_id and s.profile_id = auth.uid()
   limit 1;
$$;

revoke all on function public.mock_exam_my_student_id(uuid) from public, anon;
grant execute on function public.mock_exam_my_student_id(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Ключ ответов первой части — только персоналу
-- ──────────────────────────────────────────────────────────────────────────
-- Отдельная таблица, а не колонка mock_exams: mock_exams ученик читает
-- (политика mock_exams_select), и колонку от него политикой не закрыть.
-- Здесь для ученика нет НИ ОДНОЙ политики — ни чтения, ни записи.
-- Функции, которые ученик зовёт, ключ не возвращают; единственная, что
-- показывает ему верные ответы, — my_mock_exam_result, и только после того,
-- как ему отправлен результат.

create table if not exists public.mock_exam_answer_keys (
  mock_exam_id uuid primary key references public.mock_exams(id) on delete cascade,
  answers      text[] not null,
  updated_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);

comment on table public.mock_exam_answer_keys is
  '§221. Ключ ответов первой части: answers[1] — ответ на №1. Только персоналу курса; ученику недоступен никогда.';

alter table public.mock_exam_answer_keys enable row level security;
grant select, insert, update, delete on public.mock_exam_answer_keys to authenticated;

drop policy if exists mock_exam_answer_keys_staff_select on public.mock_exam_answer_keys;
create policy mock_exam_answer_keys_staff_select
  on public.mock_exam_answer_keys for select to authenticated
  using (public.mock_exam_is_staff(mock_exam_id));

drop policy if exists mock_exam_answer_keys_manage_insert on public.mock_exam_answer_keys;
create policy mock_exam_answer_keys_manage_insert
  on public.mock_exam_answer_keys for insert to authenticated
  with check (public.mock_exam_can_manage(mock_exam_id) and updated_by = auth.uid());

drop policy if exists mock_exam_answer_keys_manage_update on public.mock_exam_answer_keys;
create policy mock_exam_answer_keys_manage_update
  on public.mock_exam_answer_keys for update to authenticated
  using (public.mock_exam_can_manage(mock_exam_id))
  with check (public.mock_exam_can_manage(mock_exam_id) and updated_by = auth.uid());

drop policy if exists mock_exam_answer_keys_manage_delete on public.mock_exam_answer_keys;
create policy mock_exam_answer_keys_manage_delete
  on public.mock_exam_answer_keys for delete to authenticated
  using (public.mock_exam_can_manage(mock_exam_id));

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Бланк ученика и фото второй части
-- ──────────────────────────────────────────────────────────────────────────
-- Чтение: свой — ученику, все — персоналу курса. Записи для ученика нет:
-- только функции ниже, каждая сверяет окно по now().

create table if not exists public.mock_exam_sheets (
  mock_exam_id uuid not null references public.mock_exams(id) on delete cascade,
  student_id   uuid not null references public.students(id)   on delete cascade,
  answers      text[] not null default '{}',
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (mock_exam_id, student_id)
);

comment on table public.mock_exam_sheets is
  '§221. Бланк первой части: answers[1] — ответ на №1 как введён. Строка появляется с первым ответом, фото или сдачей. Пишется только функциями save_mock_exam_answer / submit_mock_exam / add_mock_exam_photo.';

create index if not exists mock_exam_sheets_student_idx on public.mock_exam_sheets (student_id);

alter table public.mock_exam_sheets enable row level security;
grant select on public.mock_exam_sheets to authenticated;

drop policy if exists mock_exam_sheets_own_select on public.mock_exam_sheets;
create policy mock_exam_sheets_own_select
  on public.mock_exam_sheets for select to authenticated
  using (exists (select 1 from public.students s where s.id = mock_exam_sheets.student_id and s.profile_id = auth.uid()));

drop policy if exists mock_exam_sheets_staff_select on public.mock_exam_sheets;
create policy mock_exam_sheets_staff_select
  on public.mock_exam_sheets for select to authenticated
  using (public.mock_exam_is_staff(mock_exam_id));

create table if not exists public.mock_exam_photos (
  id           uuid primary key default gen_random_uuid(),
  mock_exam_id uuid not null references public.mock_exams(id) on delete cascade,
  student_id   uuid not null references public.students(id)   on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

comment on table public.mock_exam_photos is
  '§221. Фото второй части: файл в бакете mock-exams по пути <пробник>/photos/<ученик>/… Пишется только функциями add_mock_exam_photo / remove_mock_exam_photo — до конца окна + photo_grace_minutes.';

create index if not exists mock_exam_photos_exam_student_idx on public.mock_exam_photos (mock_exam_id, student_id);

alter table public.mock_exam_photos enable row level security;
grant select on public.mock_exam_photos to authenticated;

drop policy if exists mock_exam_photos_own_select on public.mock_exam_photos;
create policy mock_exam_photos_own_select
  on public.mock_exam_photos for select to authenticated
  using (exists (select 1 from public.students s where s.id = mock_exam_photos.student_id and s.profile_id = auth.uid()));

drop policy if exists mock_exam_photos_staff_select on public.mock_exam_photos;
create policy mock_exam_photos_staff_select
  on public.mock_exam_photos for select to authenticated
  using (public.mock_exam_is_staff(mock_exam_id));

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Отметка «авто» у балла задания
-- ──────────────────────────────────────────────────────────────────────────
-- Что поставила проверка по ключу. Клетка «авто», пока points = auto_points;
-- преподаватель исправил (опечатка в ключе) — points разошлись с auto_points,
-- и клетка видна как поставленная вручную. Отдельного флага нет: флаг
-- пришлось бы сбрасывать при каждой ручной правке, а save_mock_exam_grid
-- (§218) о нём не знает и знать не должна.

alter table public.mock_exam_task_scores
  add column if not exists auto_points smallint check (auto_points is null or auto_points >= 0);

comment on column public.mock_exam_task_scores.auto_points is
  '§221. Балл, поставленный проверкой по ключу. Клетка «авто», пока points = auto_points; иначе — ручная.';

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Ученик: бланк, сдача, фото
-- ──────────────────────────────────────────────────────────────────────────

-- Общая проверка для записи ученика: кто он, есть ли окно, открыто ли оно.
-- p_until = 'sheet' — до конца окна и до сдачи; 'photos' — до конца + грейс.
create or replace function public.mock_exam_student_gate(p_mock_exam_id uuid, p_until text)
returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_student uuid;
  v_w       record;
  v_sub     timestamptz;
begin
  v_student := public.mock_exam_my_student_id(p_mock_exam_id);
  if v_student is null then
    raise exception 'Этот пробник не ваш' using errcode = '42501';
  end if;
  select * into v_w from public.mock_exam_window(p_mock_exam_id);
  if v_w.starts_at is null then
    raise exception 'У пробника нет онлайн-окна' using errcode = '22023';
  end if;
  if now() < v_w.starts_at then
    raise exception 'Пробник ещё не начался' using errcode = '22023';
  end if;
  if p_until = 'sheet' then
    if now() >= v_w.ends_at then
      raise exception 'Время пробника вышло — бланк закрыт' using errcode = '22023';
    end if;
    select sh.submitted_at into v_sub from public.mock_exam_sheets sh
     where sh.mock_exam_id = p_mock_exam_id and sh.student_id = v_student;
    if v_sub is not null then
      raise exception 'Работа уже сдана — ответы не меняются' using errcode = '22023';
    end if;
  elsif p_until = 'photos' then
    if now() >= v_w.photos_until then
      raise exception 'Время загрузки фото вышло' using errcode = '22023';
    end if;
  else
    raise exception 'mock_exam_student_gate: неизвестный режим %', p_until using errcode = '22023';
  end if;
  return v_student;
end;
$$;

revoke all on function public.mock_exam_student_gate(uuid, text) from public, anon, authenticated;

-- Один ответ бланка. На каждый ввод (с задержкой на экране) — одно поле, не
-- весь бланк: две вкладки не затирают друг другу соседние ответы.
-- Возвращает только то, что записано, и время записи — ни верности, ни ключа.
create or replace function public.save_mock_exam_answer(p_mock_exam_id uuid, p_task integer, p_answer text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid;
  v_part1   int;
  v_answer  text;
  v_now     timestamptz := now();
begin
  v_student := public.mock_exam_student_gate(p_mock_exam_id, 'sheet');
  select t.part1_last into v_part1
    from public.mock_exams me join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  if p_task is null or p_task < 1 or p_task > v_part1 then
    raise exception 'В бланке первой части поля №1–№%', v_part1 using errcode = '22023';
  end if;
  v_answer := nullif(btrim(coalesce(p_answer, '')), '');
  if length(v_answer) > 40 then
    raise exception 'Ответ длиннее 40 знаков — в бланк пишется только ответ' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mock_exam_sheet:' || p_mock_exam_id || ':' || v_student, 0));
  insert into public.mock_exam_sheets as sh (mock_exam_id, student_id, answers, updated_at)
  values (p_mock_exam_id, v_student, array_fill(null::text, array[v_part1]), v_now)
  on conflict (mock_exam_id, student_id) do nothing;
  update public.mock_exam_sheets
     set answers[p_task] = v_answer, updated_at = v_now
   where mock_exam_id = p_mock_exam_id and student_id = v_student;

  return jsonb_build_object('task', p_task, 'answer', v_answer, 'saved_at', v_now);
end;
$$;

revoke all on function public.save_mock_exam_answer(uuid, integer, text) from public, anon;
grant execute on function public.save_mock_exam_answer(uuid, integer, text) to authenticated;

-- Сдать раньше времени. После этого бланк не пишется; фото — ещё можно до
-- конца + грейс (макет: «после сдачи ответы не меняются, но фото можно
-- догрузить»).
create or replace function public.submit_mock_exam(p_mock_exam_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid;
  v_part1   int;
  v_now     timestamptz := now();
begin
  v_student := public.mock_exam_student_gate(p_mock_exam_id, 'sheet');
  select t.part1_last into v_part1
    from public.mock_exams me join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  perform pg_advisory_xact_lock(hashtextextended('mock_exam_sheet:' || p_mock_exam_id || ':' || v_student, 0));
  insert into public.mock_exam_sheets (mock_exam_id, student_id, answers, submitted_at, updated_at)
  values (p_mock_exam_id, v_student, array_fill(null::text, array[v_part1]), v_now, v_now)
  on conflict (mock_exam_id, student_id)
  do update set submitted_at = v_now, updated_at = v_now;
  return jsonb_build_object('submitted_at', v_now);
end;
$$;

revoke all on function public.submit_mock_exam(uuid) from public, anon;
grant execute on function public.submit_mock_exam(uuid) to authenticated;

-- Зарегистрировать загруженное фото. Файл уже лежит в хранилище (его туда
-- пустила политика бакета, тоже по окну); строка в таблице — то, что видит
-- преподаватель. Проверяем, что объект существует и лежит в папке ЭТОГО
-- ученика этого пробника: чужой путь не зарегистрировать.
create or replace function public.add_mock_exam_photo(
  p_mock_exam_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid;
  v_part1   int;
  v_pos     int;
  v_row     public.mock_exam_photos;
  v_now     timestamptz := now();
begin
  v_student := public.mock_exam_student_gate(p_mock_exam_id, 'photos');
  if p_storage_path is null or p_storage_path not like (p_mock_exam_id::text || '/photos/' || v_student::text || '/%') then
    raise exception 'Файл не из вашей папки этого пробника' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'mock-exams' and o.name = p_storage_path) then
    raise exception 'Файл не найден в хранилище — загрузите заново' using errcode = 'P0002';
  end if;
  if (select count(*) from public.mock_exam_photos p where p.mock_exam_id = p_mock_exam_id and p.student_id = v_student) >= 40 then
    raise exception 'Не больше 40 фото на работу' using errcode = '22023';
  end if;
  select t.part1_last into v_part1
    from public.mock_exams me join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  -- Фото без единого ответа — тоже работа: строка бланка нужна, чтобы
  -- первая часть проверилась (пустые — нули) и ученик не числился «не сдал».
  insert into public.mock_exam_sheets (mock_exam_id, student_id, answers, updated_at)
  values (p_mock_exam_id, v_student, array_fill(null::text, array[v_part1]), v_now)
  on conflict (mock_exam_id, student_id) do nothing;

  select coalesce(max(p.position) + 1, 0) into v_pos
    from public.mock_exam_photos p where p.mock_exam_id = p_mock_exam_id and p.student_id = v_student;
  insert into public.mock_exam_photos (mock_exam_id, student_id, storage_path, file_name, mime_type, size_bytes, position)
  values (p_mock_exam_id, v_student, p_storage_path, left(coalesce(p_file_name, 'фото'), 200), p_mime_type, p_size_bytes, v_pos)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.add_mock_exam_photo(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.add_mock_exam_photo(uuid, text, text, text, bigint) to authenticated;

-- Убрать своё фото — пока фото принимаются. Возвращает путь: файл из
-- хранилища убирает клиент (политика удаления бакета — по тому же окну).
create or replace function public.remove_mock_exam_photo(p_photo_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_photo   public.mock_exam_photos;
  v_student uuid;
begin
  select * into v_photo from public.mock_exam_photos where id = p_photo_id;
  if not found then
    raise exception 'Фото не найдено' using errcode = 'P0002';
  end if;
  v_student := public.mock_exam_student_gate(v_photo.mock_exam_id, 'photos');
  if v_photo.student_id <> v_student then
    raise exception 'Это не ваше фото' using errcode = '42501';
  end if;
  delete from public.mock_exam_photos where id = p_photo_id;
  return v_photo.storage_path;
end;
$$;

revoke all on function public.remove_mock_exam_photo(uuid) from public, anon;
grant execute on function public.remove_mock_exam_photo(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Ученик: что показать
-- ──────────────────────────────────────────────────────────────────────────
-- Все три функции отдают серверное now() (server_now): экран считает таймер
-- от него, а не от часов устройства. Переведённые часы меняют только цифры
-- на экране, но не то, что база примет.

-- Пробники в программе курса одной группы — для списка разделов.
create or replace function public.my_mock_exams(p_group_id uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              me.id,
           'title',           me.title,
           'module_id',       me.module_id,
           'module_position', me.module_position,
           'starts_at',       w.starts_at,
           'ends_at',         w.ends_at,
           'photos_until',    w.photos_until,
           'submitted_at',    sh.submitted_at,
           'has_work',        sh.student_id is not null,
           'notified',        r.notified_at is not null,
           'server_now',      now()
         ) order by me.starts_at), '[]'::jsonb)
    from public.mock_exams me
    join public.group_students gs on gs.group_id = me.group_id
    join public.students s on s.id = gs.student_id and s.profile_id = auth.uid()
    cross join lateral public.mock_exam_window(me.id) w
    left join public.mock_exam_sheets sh on sh.mock_exam_id = me.id and sh.student_id = s.id
    left join public.mock_exam_results r on r.mock_exam_id = me.id and r.student_id = s.id
   where me.group_id = p_group_id
     and me.module_id is not null
     and me.starts_at is not null;
$$;

revoke all on function public.my_mock_exams(uuid) from public, anon;
grant execute on function public.my_mock_exams(uuid) to authenticated;

-- Страница пробника у ученика: окно, свой бланк, свои фото. Путь к условию —
-- только с начала (и файл политика хранилища до начала не выдаст всё равно).
-- Ключа, верности ответов, баллов здесь нет.
create or replace function public.my_mock_exam(p_mock_exam_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_student uuid;
  v_exam    record;
  v_w       record;
  v_sheet   public.mock_exam_sheets;
  v_started boolean;
begin
  v_student := public.mock_exam_my_student_id(p_mock_exam_id);
  if v_student is null then
    raise exception 'Этот пробник не ваш' using errcode = '42501';
  end if;
  select me.id, me.title, me.group_id, me.module_id, me.condition_path, me.solution_path,
         t.max_points, t.part1_last, t.title as template_title
    into v_exam
    from public.mock_exams me
    left join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  select * into v_w from public.mock_exam_window(p_mock_exam_id);
  select * into v_sheet from public.mock_exam_sheets
   where mock_exam_id = p_mock_exam_id and student_id = v_student;
  v_started := v_w.starts_at is not null and now() >= v_w.starts_at;

  return jsonb_build_object(
    'id',             v_exam.id,
    'title',          v_exam.title,
    'group_id',       v_exam.group_id,
    'student_id',     v_student,
    'template_title', v_exam.template_title,
    'task_count',     coalesce(array_length(v_exam.max_points, 1), 0),
    'part1_last',     v_exam.part1_last,
    'part2_max',      (select coalesce(jsonb_agg(m order by i), '[]'::jsonb)
                         from unnest(v_exam.max_points) with ordinality x(m, i)
                        where i > v_exam.part1_last),
    'starts_at',      v_w.starts_at,
    'ends_at',        v_w.ends_at,
    'photos_until',   v_w.photos_until,
    'server_now',     now(),
    'condition_path', case when v_started then v_exam.condition_path end,
    'answers',        case when v_sheet.student_id is not null then to_jsonb(v_sheet.answers) else '[]'::jsonb end,
    'submitted_at',   v_sheet.submitted_at,
    'updated_at',     v_sheet.updated_at,
    'notified',       exists (select 1 from public.mock_exam_results r
                               where r.mock_exam_id = p_mock_exam_id and r.student_id = v_student
                                 and r.notified_at is not null),
    'photos',         (select coalesce(jsonb_agg(jsonb_build_object(
                                 'id', p.id, 'storage_path', p.storage_path, 'file_name', p.file_name,
                                 'mime_type', p.mime_type, 'size_bytes', p.size_bytes,
                                 'position', p.position, 'created_at', p.created_at)
                               order by p.position, p.created_at), '[]'::jsonb)
                         from public.mock_exam_photos p
                        where p.mock_exam_id = p_mock_exam_id and p.student_id = v_student)
  );
end;
$$;

revoke all on function public.my_mock_exam(uuid) from public, anon;
grant execute on function public.my_mock_exam(uuid) to authenticated;

-- Результат ученика — ровно его строка и только после отправки (§219,
-- notified_at). До этого — { status: 'pending' } и ничего больше: ни баллов,
-- ни ключа, ни пути к решению. Политики mock_exam_results не тронуты (у
-- ученика по-прежнему нет права читать таблицу) — решено функцией.
--
-- Показывается ТЕКУЩЕЕ состояние таблицы, а не снимок отправленного: если
-- преподаватель поправил балл после «Уведомить», ученик увидит поправку, а
-- таблица §219 покажет преподавателю «итог изменён после отправки».
create or replace function public.my_mock_exam_result(p_mock_exam_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_student uuid;
  v_r       public.mock_exam_results;
  v_exam    record;
  v_sheet   public.mock_exam_sheets;
  v_key     text[];
begin
  v_student := public.mock_exam_my_student_id(p_mock_exam_id);
  if v_student is null then
    raise exception 'Этот пробник не ваш' using errcode = '42501';
  end if;
  select * into v_r from public.mock_exam_results
   where mock_exam_id = p_mock_exam_id and student_id = v_student;
  if not found or v_r.notified_at is null then
    return jsonb_build_object('status', 'pending');
  end if;

  select me.title, me.max_score, me.solution_path, t.max_points, t.part1_last
    into v_exam
    from public.mock_exams me
    left join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  select * into v_sheet from public.mock_exam_sheets
   where mock_exam_id = p_mock_exam_id and student_id = v_student;
  select k.answers into v_key from public.mock_exam_answer_keys k where k.mock_exam_id = p_mock_exam_id;

  return jsonb_build_object(
    'status',        'ready',
    'title',         v_exam.title,
    'notified_at',   v_r.notified_at,
    'score',         v_r.score,
    'max_score',     v_exam.max_score,
    'primary_score', v_r.primary_score,
    'part1_score',   v_r.part1_score,
    'part2_score',   v_r.part2_score,
    'part1_last',    v_exam.part1_last,
    'solution_path', v_exam.solution_path,
    'tasks',         (select coalesce(jsonb_agg(jsonb_build_object(
                               'n',       i,
                               'max',     m,
                               'points',  sc.points,
                               'answer',  case when i <= v_exam.part1_last then v_sheet.answers[i] end,
                               'correct', case when i <= v_exam.part1_last then v_key[i] end)
                             order by i), '[]'::jsonb)
                        from unnest(v_exam.max_points) with ordinality x(m, i)
                        left join public.mock_exam_task_scores sc
                          on sc.mock_exam_id = p_mock_exam_id and sc.student_id = v_student and sc.task_number = i)
  );
end;
$$;

revoke all on function public.my_mock_exam_result(uuid) from public, anon;
grant execute on function public.my_mock_exam_result(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. Преподаватель: ключ и автопроверка первой части
-- ──────────────────────────────────────────────────────────────────────────
-- Сравнение ответа с ключом — normalize_variant_answer + variant_answer_verdict
-- (§63, §66; CLAUDE.md: «второй копии не заводить»). «0,75», «0.75»,
-- « 0,75 » — одно и то же; пустой ответ — неверно, то есть 0, а не «нет
-- данных». Эталон, который автопроверке не поддаётся (verdict = null), —
-- клетка остаётся преподавателю.
--
-- Результат ложится в таблицу §218 её же функцией save_mock_exam_grid:
-- итоги по частям, первичный и тестовый считает она, как при ручном вводе.
-- Поэтому функция — под правами вызывающего (security invoker), как и
-- save_mock_exam_grid: писать баллы может тот же, кто может их записать
-- руками. Куратор курса (итоги не пишет, §218) получит отказ RLS.
--
-- Проверяются только законченные бланки: сдан или окно кончилось. Идущий
-- пробник по ключу не проверяется — ученик ещё пишет.
--
-- Ручная клетка не трогается никогда: перезаписывается только пустая или
-- «авто» (points = auto_points). Повторный вызов без изменений ничего не
-- пишет.

create or replace function public.grade_mock_exam_part1(p_mock_exam_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam     record;
  v_ends_at  timestamptz;
  v_key      text[];
  v_n        int;
  v_sheet    record;
  v_cur_p    smallint[];
  v_cur_a    smallint[];
  v_pts      jsonb;
  v_auto     jsonb;
  v_rows     jsonb := '[]'::jsonb;
  v_autos    jsonb := '[]'::jsonb;
  v_changed  boolean;
  v_verdict  boolean;
  v_a        int;
  v_p        int;
  v_students int := 0;
  v_cells    int := 0;
  i          int;
  x          jsonb;
begin
  if not public.mock_exam_can_manage(p_mock_exam_id) then
    raise exception 'Нет доступа к результатам этого пробника' using errcode = '42501';
  end if;
  select me.group_id, me.starts_at, t.max_points, t.part1_last
    into v_exam
    from public.mock_exams me
    join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  if not found or v_exam.starts_at is null then
    return jsonb_build_object('graded_students', 0, 'changed_cells', 0, 'skipped', 'no_window');
  end if;
  select k.answers into v_key from public.mock_exam_answer_keys k where k.mock_exam_id = p_mock_exam_id;
  if v_key is null then
    return jsonb_build_object('graded_students', 0, 'changed_cells', 0, 'skipped', 'no_key');
  end if;
  select w.ends_at into v_ends_at from public.mock_exam_window(p_mock_exam_id) w;
  v_n := array_length(v_exam.max_points, 1);

  -- Тот же замок, что у save_mock_exam_grid: чтение текущих клеток и запись
  -- не должны разойтись с одновременным «Сохранить» преподавателя.
  perform pg_advisory_xact_lock(hashtextextended('save_mock_exam_grid:' || p_mock_exam_id::text, 0));

  for v_sheet in
    select sh.student_id, sh.answers
      from public.mock_exam_sheets sh
      join public.group_students gs on gs.group_id = v_exam.group_id and gs.student_id = sh.student_id
     where sh.mock_exam_id = p_mock_exam_id
       and (sh.submitted_at is not null or now() >= v_ends_at)
     order by sh.student_id
  loop
    v_cur_p := array_fill(null::smallint, array[v_n]);
    v_cur_a := array_fill(null::smallint, array[v_n]);
    for x in
      select jsonb_build_object('t', sc.task_number, 'p', sc.points, 'a', sc.auto_points)
        from public.mock_exam_task_scores sc
       where sc.mock_exam_id = p_mock_exam_id and sc.student_id = v_sheet.student_id
         and sc.task_number between 1 and v_n
    loop
      v_cur_p[(x->>'t')::int] := (x->>'p')::smallint;
      v_cur_a[(x->>'t')::int] := (x->>'a')::smallint;
    end loop;

    v_pts := '[]'::jsonb;
    v_auto := '[]'::jsonb;
    v_changed := false;
    for i in 1..v_n loop
      v_p := v_cur_p[i];
      if i <= v_exam.part1_last and nullif(btrim(coalesce(v_key[i], '')), '') is not null then
        v_verdict := public.variant_answer_verdict(
          public.normalize_variant_answer(v_key[i]),
          public.normalize_variant_answer(coalesce(v_sheet.answers[i], '')));
        -- Пустая или «авто» клетка — её ведёт ключ; ручную не трогаем.
        if v_verdict is not null and (v_cur_p[i] is null or v_cur_p[i] = v_cur_a[i]) then
          v_a := case when v_verdict then v_exam.max_points[i] else 0 end;
          if v_cur_p[i] is distinct from v_a or v_cur_a[i] is distinct from v_a then
            v_changed := true;
            v_cells := v_cells + 1;
          end if;
          v_p := v_a;
          v_auto := v_auto || jsonb_build_array(jsonb_build_object('t', i, 'a', v_a));
        end if;
      end if;
      v_pts := v_pts || jsonb_build_array(to_jsonb(v_p));
    end loop;

    v_students := v_students + 1;
    if v_changed then
      v_rows  := v_rows || jsonb_build_array(jsonb_build_object('student_id', v_sheet.student_id, 'points', v_pts));
      v_autos := v_autos || jsonb_build_array(jsonb_build_object('student_id', v_sheet.student_id, 'cells', v_auto));
    end if;
  end loop;

  if jsonb_array_length(v_rows) > 0 then
    -- Баллы и итоги — функцией §218, ровно как при ручном «Сохранить».
    perform public.save_mock_exam_grid(p_mock_exam_id, v_rows);
    update public.mock_exam_task_scores sc
       set auto_points = (c->>'a')::smallint,
           updated_by  = auth.uid()
      from jsonb_array_elements(v_autos) s,
           jsonb_array_elements(s->'cells') c
     where sc.mock_exam_id = p_mock_exam_id
       and sc.student_id   = (s->>'student_id')::uuid
       and sc.task_number  = (c->>'t')::int
       and sc.auto_points is distinct from (c->>'a')::smallint;
  end if;

  return jsonb_build_object('graded_students', v_students, 'changed_cells', v_cells);
end;
$$;

comment on function public.grade_mock_exam_part1(uuid) is
  '§221. Проверить первую часть законченных бланков по ключу (normalize_variant_answer + variant_answer_verdict) и записать в таблицу §218 через save_mock_exam_grid. Трогает только пустые и «авто»-клетки. Под правами вызывающего.';

revoke all on function public.grade_mock_exam_part1(uuid) from public, anon;
grant execute on function public.grade_mock_exam_part1(uuid) to authenticated;

-- Сохранить ключ и сразу перепроверить законченные бланки. Возвращает, какие
-- ответы ключа автопроверке не поддаются (их клетки ставит преподаватель).
create or replace function public.save_mock_exam_key(p_mock_exam_id uuid, p_answers text[])
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_part1 int;
  v_clean text[];
  v_bad   int[];
  v_grade jsonb;
begin
  if not public.mock_exam_can_manage(p_mock_exam_id) then
    raise exception 'Нет доступа к этому пробнику' using errcode = '42501';
  end if;
  select t.part1_last into v_part1
    from public.mock_exams me join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  if v_part1 is null then
    raise exception 'У пробника нет шаблона — неизвестно, сколько ответов в ключе' using errcode = '22023';
  end if;
  if coalesce(array_length(p_answers, 1), 0) <> v_part1 then
    raise exception 'В ключе должно быть ровно % ответов (первая часть)', v_part1 using errcode = '22023';
  end if;
  select array_agg(nullif(btrim(coalesce(a, '')), '') order by i) into v_clean
    from unnest(p_answers) with ordinality x(a, i);
  if exists (select 1 from unnest(v_clean) a where length(a) > 40) then
    raise exception 'Ответ ключа длиннее 40 знаков' using errcode = '22023';
  end if;

  insert into public.mock_exam_answer_keys (mock_exam_id, answers, updated_by, updated_at)
  values (p_mock_exam_id, v_clean, auth.uid(), now())
  on conflict (mock_exam_id) do update
    set answers = excluded.answers, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  select coalesce(array_agg(i::int order by i), '{}') into v_bad
    from unnest(v_clean) with ordinality x(a, i)
   where a is not null
     and public.variant_answer_verdict(public.normalize_variant_answer(a), public.normalize_variant_answer(a)) is null;

  v_grade := public.grade_mock_exam_part1(p_mock_exam_id);
  return jsonb_build_object('not_checkable', to_jsonb(v_bad), 'grade', v_grade);
end;
$$;

revoke all on function public.save_mock_exam_key(uuid, text[]) from public, anon;
grant execute on function public.save_mock_exam_key(uuid, text[]) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. Хранилище: приватный бакет mock-exams
-- ──────────────────────────────────────────────────────────────────────────
-- Пути: <пробник>/condition/…   — условие (PDF), пишет персонал;
--       <пробник>/solution/…    — решение (PDF), пишет персонал;
--       <пробник>/photos/<ученик>/… — фото второй части, пишет ученик.
--
-- Ученику файл выдаётся подписанной ссылкой (createSignedUrl под его же
-- токеном): хранилище подписывает только то, что пропускает политика
-- чтения ниже, а она сверяет время по now() базы. Публичного пути нет.
-- Отдельная edge-функция для выдачи ссылок поэтому не нужна.

insert into storage.buckets (id, name, public, file_size_limit)
values ('mock-exams', 'mock-exams', false, 52428800)
on conflict (id) do nothing;

-- Разбор пути без исключений: политика хранилища вычисляется и для чужих
-- бакетов, и кривой первый сегмент не должен ронять чужую загрузку.
create or replace function public.mock_exam_file_readable(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_exam  uuid;
  v_me    uuid;
  v_w     record;
begin
  if coalesce(array_length(v_parts, 1), 0) < 3
     or v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_exam := v_parts[1]::uuid;
  if public.mock_exam_is_staff(v_exam) then
    return true;
  end if;
  v_me := public.mock_exam_my_student_id(v_exam);
  if v_me is null then
    return false;
  end if;
  if v_parts[2] = 'condition' then
    select * into v_w from public.mock_exam_window(v_exam);
    return v_w.starts_at is not null and now() >= v_w.starts_at;
  elsif v_parts[2] = 'solution' then
    return exists (select 1 from public.mock_exam_results r
                    where r.mock_exam_id = v_exam and r.student_id = v_me and r.notified_at is not null);
  elsif v_parts[2] = 'photos' then
    return array_length(v_parts, 1) >= 4 and v_parts[3] = v_me::text;
  end if;
  return false;
end;
$$;

create or replace function public.mock_exam_file_writable(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_exam  uuid;
  v_me    uuid;
  v_w     record;
begin
  if coalesce(array_length(v_parts, 1), 0) < 3
     or v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_exam := v_parts[1]::uuid;
  if v_parts[2] in ('condition', 'solution') then
    return public.mock_exam_can_manage(v_exam);
  elsif v_parts[2] = 'photos' then
    v_me := public.mock_exam_my_student_id(v_exam);
    if v_me is null or array_length(v_parts, 1) < 4 or v_parts[3] <> v_me::text then
      return false;
    end if;
    select * into v_w from public.mock_exam_window(v_exam);
    return v_w.starts_at is not null and now() >= v_w.starts_at and now() < v_w.photos_until;
  end if;
  return false;
end;
$$;

revoke all on function public.mock_exam_file_readable(text) from public, anon;
revoke all on function public.mock_exam_file_writable(text) from public, anon;
grant execute on function public.mock_exam_file_readable(text) to authenticated;
grant execute on function public.mock_exam_file_writable(text) to authenticated;

drop policy if exists mock_exam_files_read on storage.objects;
create policy mock_exam_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'mock-exams' and public.mock_exam_file_readable(name));

drop policy if exists mock_exam_files_insert on storage.objects;
create policy mock_exam_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mock-exams' and public.mock_exam_file_writable(name));

drop policy if exists mock_exam_files_delete on storage.objects;
create policy mock_exam_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'mock-exams' and public.mock_exam_file_writable(name));

-- ──────────────────────────────────────────────────────────────────────────
-- 9. Пробы — выполнять ОТДЕЛЬНО, в откатываемом блоке, под authenticated
-- ──────────────────────────────────────────────────────────────────────────
-- Прогонялись на локальном Postgres 16 со слепком схемы (см. PROJECT_STATE
-- §221). НА ПРОДЕ НЕ ПРОГОНЯЛИСЬ. Время двигалось сдвигом starts_at
-- пробника относительно now() — проверяется именно серверная сторона.
--
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', '{"sub":"<ученик группы>","role":"authenticated"}', true);
-- select public.my_mock_exam('<пробник>');                  -- condition_path = null до начала
-- select public.save_mock_exam_answer('<пробник>', 1, '5'); -- до начала / после конца: ERROR 22023
-- select * from public.mock_exam_answer_keys;               -- 0 строк
-- select public.my_mock_exam_result('<пробник>');           -- {"status":"pending"} до «Уведомить»
-- rollback;
