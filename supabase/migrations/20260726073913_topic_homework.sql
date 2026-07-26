-- ============================================================
-- PDF-ДЗ на уровне темы
-- ============================================================
-- СТАТУС: ПРИМЕНЕНО 2026-07-26 через одобренный MCP-процесс.
--   version = 20260726073913
--   name    = topic_homework
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- Модель: курс -> тема -> ОДНО PDF-ДЗ -> попытки ученика -> история reviews.
-- Дедлайнов, назначения группам и баллов нет.
--
-- НЕ трогает: homework_* (Homework V2), topic_materials, course_lessons,
-- catalog_*, всё остальное.
--
-- Переиспользует уже существующие хелперы доступа:
--   topic_material_can_manage(topic_id)   — персонал курса темы
--   course_student_can_see_topic(topic_id) — доступ ученика + available_from
--   auth_student_id()                      — students.id текущего пользователя
-- ============================================================

-- ============================================================
-- 1. Типы
-- ============================================================
create type public.topic_homework_attempt_status as enum (
  'draft',                 -- ученик набирает файлы, ещё не сдал
  'submitted',             -- сдано, ждёт преподавателя
  'accepted',              -- принято; новые попытки запрещены
  'returned_for_revision'  -- возвращено на доработку; можно создать новую попытку
);

create type public.topic_homework_review_decision as enum (
  'accepted',
  'returned_for_revision'
);

-- ============================================================
-- 2. Само ДЗ — одно на тему
-- ============================================================
create table public.topic_homework (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid not null unique references public.topics(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 300),
  instructions text check (length(instructions) <= 10000),
  is_published boolean not null default false,
  created_by   uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.topic_homework is
  'PDF-ДЗ темы. UNIQUE(topic_id) — ровно одно ДЗ на тему.';
comment on column public.topic_homework.is_published is
  'Черновик виден только персоналу курса.';

-- PDF от преподавателя. Отдельной таблицей: заданий может быть несколько файлов.
create table public.topic_homework_files (
  id                uuid primary key default gen_random_uuid(),
  homework_id       uuid not null references public.topic_homework(id) on delete cascade,
  storage_path      text not null unique,          -- бакет topic-homework, путь {topic_id}/…
  original_filename text not null,
  mime_type         text,
  size_bytes        bigint check (size_bytes >= 0),
  position          integer not null default 0 check (position >= 0),
  created_at        timestamptz not null default now()
);

create index topic_homework_files_hw_idx on public.topic_homework_files(homework_id, position);

-- ============================================================
-- 3. Попытки
-- ============================================================
create table public.topic_homework_attempts (
  id             uuid primary key default gen_random_uuid(),
  homework_id    uuid not null references public.topic_homework(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  attempt_number integer not null check (attempt_number >= 1),
  status         public.topic_homework_attempt_status not null default 'draft',
  submitted_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint topic_homework_attempts_unique_number unique (homework_id, student_id, attempt_number),
  -- сдана => есть отметка времени сдачи; черновик => нет
  constraint topic_homework_attempts_submitted_chk check (
    (status = 'draft' and submitted_at is null)
    or (status <> 'draft' and submitted_at is not null)
  )
);

comment on table public.topic_homework_attempts is
  'Попытка сдачи. Старые попытки не перезаписываются: каждая пересдача — новая строка.';
comment on column public.topic_homework_attempts.status is
  'draft -> submitted -> accepted | returned_for_revision. Терминальные статусы неизменяемы.';

-- Один активный цикл сдачи на ученика: не больше одной незавершённой попытки.
create unique index topic_homework_attempts_one_active
  on public.topic_homework_attempts(homework_id, student_id)
  where status in ('draft', 'submitted');

-- Принятая попытка может быть только одна — на неё опирается запрет пересдачи.
create unique index topic_homework_attempts_one_accepted
  on public.topic_homework_attempts(homework_id, student_id)
  where status = 'accepted';

create index topic_homework_attempts_student_idx on public.topic_homework_attempts(student_id, created_at desc);
create index topic_homework_attempts_queue_idx
  on public.topic_homework_attempts(submitted_at) where status = 'submitted';

-- ============================================================
-- 4. Файлы попытки
-- ============================================================
-- page_number / sha256 / width / height / rotation / metadata заведены
-- заранее под будущий OCR и AI-проверку: препроцессор сможет писать сюда
-- страницы, хеши и геометрию, не меняя схему.
create table public.topic_homework_attempt_files (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null references public.topic_homework_attempts(id) on delete cascade,
  storage_path text not null unique,               -- бакет topic-homework-attempts, путь {attempt_id}/…
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0),
  position     integer not null default 0 check (position >= 0),

  -- задел под OCR
  page_number  integer check (page_number is null or page_number >= 1),
  sha256       text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  width        integer check (width  is null or width  > 0),
  height       integer check (height is null or height > 0),
  rotation     integer check (rotation is null or rotation in (0, 90, 180, 270)),
  metadata     jsonb not null default '{}'::jsonb,

  created_at   timestamptz not null default now()
);

create index topic_homework_attempt_files_attempt_idx
  on public.topic_homework_attempt_files(attempt_id, position);

comment on column public.topic_homework_attempt_files.metadata is
  'Свободное место для препроцессора OCR: результаты выравнивания, детекции полей и т.п.';

-- ============================================================
-- 5. История проверок
-- ============================================================
-- Review — событие, а не поле в попытке: пересдача не затирает предыдущий
-- комментарий преподавателя.
create table public.topic_homework_reviews (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references public.topic_homework_attempts(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  decision    public.topic_homework_review_decision not null,
  comment     text check (length(comment) <= 5000),
  created_at  timestamptz not null default now(),

  -- возврат без объяснения бесполезен ученику
  constraint topic_homework_reviews_comment_chk check (
    decision <> 'returned_for_revision'
    or (comment is not null and btrim(comment) <> '')
  )
);

create index topic_homework_reviews_attempt_idx on public.topic_homework_reviews(attempt_id, created_at);

comment on table public.topic_homework_reviews is
  'История проверок. Только человек: reviewer_id -> profiles. AI никогда не пишет сюда — его место в будущей topic_homework_ai_jobs(attempt_id), которая лишь предлагает результат.';

-- ============================================================
-- 6. Инварианты
-- ============================================================
create or replace function public.topic_homework_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger topic_homework_touch_trg
  before update on public.topic_homework
  for each row execute function public.topic_homework_touch();

create trigger topic_homework_attempts_touch_trg
  before update on public.topic_homework_attempts
  for each row execute function public.topic_homework_touch();

-- ── попытки ──────────────────────────────────────────────────
create or replace function public.topic_homework_attempts_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_next integer;
begin
  if tg_op = 'INSERT' then
    -- принято => пересдача запрещена
    if exists (
      select 1 from topic_homework_attempts a
       where a.homework_id = new.homework_id
         and a.student_id  = new.student_id
         and a.status = 'accepted'
    ) then
      raise exception 'Работа уже принята, новые попытки запрещены'
        using errcode = 'check_violation';
    end if;

    -- номер попытки назначает база, а не клиент
    select coalesce(max(a.attempt_number), 0) + 1 into v_next
      from topic_homework_attempts a
     where a.homework_id = new.homework_id and a.student_id = new.student_id;
    new.attempt_number := v_next;

    -- новая попытка всегда начинается черновиком
    new.status := 'draft';
    new.submitted_at := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.homework_id is distinct from old.homework_id
       or new.student_id is distinct from old.student_id
       or new.attempt_number is distinct from old.attempt_number then
      raise exception 'Привязку и номер попытки менять нельзя'
        using errcode = 'check_violation';
    end if;

    -- терминальные статусы неизменяемы: история не переписывается
    if old.status in ('accepted', 'returned_for_revision')
       and new.status is distinct from old.status then
      raise exception 'Проверенную попытку изменить нельзя'
        using errcode = 'check_violation';
    end if;

    if old.status = 'draft' and new.status = 'submitted' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Сданную попытку удалить нельзя'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  return null;
end $$;

create trigger topic_homework_attempts_guard_trg
  before insert or update or delete on public.topic_homework_attempts
  for each row execute function public.topic_homework_attempts_guard();

-- ── файлы попытки: неизменяемы после сдачи ──────────────────
create or replace function public.topic_homework_attempt_files_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status public.topic_homework_attempt_status;
  v_attempt uuid := coalesce(new.attempt_id, old.attempt_id);
begin
  select a.status into v_status from topic_homework_attempts a where a.id = v_attempt;
  if v_status is null then
    raise exception 'Попытка не найдена' using errcode = 'foreign_key_violation';
  end if;
  if v_status <> 'draft' then
    raise exception 'Файлы сданной попытки изменять нельзя'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

create trigger topic_homework_attempt_files_guard_trg
  before insert or update or delete on public.topic_homework_attempt_files
  for each row execute function public.topic_homework_attempt_files_guard();

-- ── reviews: только добавление ──────────────────────────────
create or replace function public.topic_homework_reviews_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'История проверок неизменяема' using errcode = 'check_violation';
end $$;

create trigger topic_homework_reviews_immutable_trg
  before update or delete on public.topic_homework_reviews
  for each row execute function public.topic_homework_reviews_immutable();

-- ============================================================
-- 7. Хелперы доступа
-- ============================================================
create or replace function public.topic_homework_topic(p_homework_id uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select h.topic_id from topic_homework h where h.id = p_homework_id;
$$;

create or replace function public.topic_homework_can_manage(p_homework_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.topic_material_can_manage(public.topic_homework_topic(p_homework_id));
$$;

create or replace function public.topic_homework_student_can_see(p_homework_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_homework h
     where h.id = p_homework_id
       and h.is_published
       and public.course_student_can_see_topic(h.topic_id)
  );
$$;

create or replace function public.topic_homework_attempt_is_own(p_attempt_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_homework_attempts a
     where a.id = p_attempt_id and a.student_id = public.auth_student_id()
  );
$$;

create or replace function public.topic_homework_attempt_can_review(p_attempt_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_homework_attempts a
     where a.id = p_attempt_id
       and public.topic_homework_can_manage(a.homework_id)
  );
$$;

-- ============================================================
-- 8. RLS
-- ============================================================
alter table public.topic_homework               enable row level security;
alter table public.topic_homework_files         enable row level security;
alter table public.topic_homework_attempts      enable row level security;
alter table public.topic_homework_attempt_files enable row level security;
alter table public.topic_homework_reviews       enable row level security;

grant select, insert, update, delete on public.topic_homework               to authenticated;
grant select, insert, update, delete on public.topic_homework_files         to authenticated;
grant select, insert, update, delete on public.topic_homework_attempts      to authenticated;
grant select, insert, update, delete on public.topic_homework_attempt_files to authenticated;
grant select, insert                 on public.topic_homework_reviews       to authenticated;

-- ── ДЗ ──
create policy topic_homework_staff_all on public.topic_homework
  for all to authenticated
  using      (public.topic_material_can_manage(topic_id))
  with check (public.topic_material_can_manage(topic_id) and created_by = auth.uid());

create policy topic_homework_student_select on public.topic_homework
  for select to authenticated
  using (is_published and public.course_student_can_see_topic(topic_id));

-- ── файлы задания ──
create policy topic_homework_files_staff_all on public.topic_homework_files
  for all to authenticated
  using      (public.topic_homework_can_manage(homework_id))
  with check (public.topic_homework_can_manage(homework_id));

create policy topic_homework_files_student_select on public.topic_homework_files
  for select to authenticated
  using (public.topic_homework_student_can_see(homework_id));

-- ── попытки ──
create policy topic_homework_attempts_select on public.topic_homework_attempts
  for select to authenticated
  using (student_id = public.auth_student_id() or public.topic_homework_can_manage(homework_id));

create policy topic_homework_attempts_student_insert on public.topic_homework_attempts
  for insert to authenticated
  with check (
    student_id = public.auth_student_id()
    and public.topic_homework_student_can_see(homework_id)
  );

-- ученик двигает только свой черновик; терминальные статусы стережёт триггер
create policy topic_homework_attempts_student_update on public.topic_homework_attempts
  for update to authenticated
  using      (student_id = public.auth_student_id() and status = 'draft')
  with check (student_id = public.auth_student_id() and status in ('draft', 'submitted'));

create policy topic_homework_attempts_student_delete on public.topic_homework_attempts
  for delete to authenticated
  using (student_id = public.auth_student_id() and status = 'draft');

-- преподаватель проставляет вердикт (через RPC, но политика нужна и для прямого пути)
create policy topic_homework_attempts_staff_update on public.topic_homework_attempts
  for update to authenticated
  using      (public.topic_homework_can_manage(homework_id))
  with check (public.topic_homework_can_manage(homework_id));

-- ── файлы попытки ──
create policy topic_homework_attempt_files_select on public.topic_homework_attempt_files
  for select to authenticated
  using (
    public.topic_homework_attempt_is_own(attempt_id)
    or public.topic_homework_attempt_can_review(attempt_id)
  );

create policy topic_homework_attempt_files_student_write on public.topic_homework_attempt_files
  for all to authenticated
  using      (public.topic_homework_attempt_is_own(attempt_id))
  with check (public.topic_homework_attempt_is_own(attempt_id));

-- ── reviews ──
create policy topic_homework_reviews_select on public.topic_homework_reviews
  for select to authenticated
  using (
    public.topic_homework_attempt_is_own(attempt_id)
    or public.topic_homework_attempt_can_review(attempt_id)
  );

create policy topic_homework_reviews_staff_insert on public.topic_homework_reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and public.topic_homework_attempt_can_review(attempt_id)
  );

-- ============================================================
-- 9. Storage
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('topic-homework', 'topic-homework', false, 52428800),
       ('topic-homework-attempts', 'topic-homework-attempts', false, 52428800)
on conflict (id) do nothing;

-- задание: путь {topic_id}/…
create policy topic_homework_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'topic-homework'
    and (
      public.topic_material_can_manage(((storage.foldername(name))[1])::uuid)
      or public.course_student_can_see_topic(((storage.foldername(name))[1])::uuid)
    )
  );

create policy topic_homework_files_write on storage.objects
  for all to authenticated
  using      (bucket_id = 'topic-homework'
              and public.topic_material_can_manage(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'topic-homework'
              and public.topic_material_can_manage(((storage.foldername(name))[1])::uuid));

-- работа ученика: путь {attempt_id}/…
create policy topic_homework_attempt_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'topic-homework-attempts'
    and (
      public.topic_homework_attempt_is_own(((storage.foldername(name))[1])::uuid)
      or public.topic_homework_attempt_can_review(((storage.foldername(name))[1])::uuid)
    )
  );

create policy topic_homework_attempt_files_write on storage.objects
  for all to authenticated
  using      (bucket_id = 'topic-homework-attempts'
              and public.topic_homework_attempt_is_own(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'topic-homework-attempts'
              and public.topic_homework_attempt_is_own(((storage.foldername(name))[1])::uuid));

-- ============================================================
-- 10. RPC
-- ============================================================

-- Начать попытку. Идемпотентна: если активная попытка уже есть — вернёт её.
create or replace function public.topic_homework_start_attempt(p_homework_id uuid)
returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_student uuid := public.auth_student_id();
  v_id uuid;
begin
  if v_student is null then
    raise exception 'Только ученик может создать попытку' using errcode = 'insufficient_privilege';
  end if;

  select a.id into v_id
    from topic_homework_attempts a
   where a.homework_id = p_homework_id
     and a.student_id = v_student
     and a.status in ('draft', 'submitted')
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into topic_homework_attempts (homework_id, student_id, attempt_number)
  values (p_homework_id, v_student, 1)   -- номер перезапишет триггер
  returning id into v_id;

  return v_id;
end $$;

-- Сдать попытку.
create or replace function public.topic_homework_submit_attempt(p_attempt_id uuid)
returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update topic_homework_attempts
     set status = 'submitted', submitted_at = now()
   where id = p_attempt_id
     and status = 'draft';

  if not found then
    raise exception 'Попытка не найдена, уже сдана или нет прав';
  end if;
end $$;

-- Проверить: принять или вернуть на доработку.
-- Пишет review И статус попытки одной транзакцией — вердикт без записи
-- в истории (или наоборот) невозможен.
create or replace function public.topic_homework_review_attempt(
  p_attempt_id uuid,
  p_decision   public.topic_homework_review_decision,
  p_comment    text default null
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_review uuid;
begin
  insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment)
  values (p_attempt_id, auth.uid(), p_decision, p_comment)
  returning id into v_review;

  update topic_homework_attempts
     set status = p_decision::text::public.topic_homework_attempt_status
   where id = p_attempt_id
     and status = 'submitted';

  if not found then
    raise exception 'Попытка не в статусе «сдано»';
  end if;

  return v_review;
end $$;

comment on function public.topic_homework_review_attempt(uuid, public.topic_homework_review_decision, text) is
  'Вердикт преподавателя. Только человек: reviewer_id = auth.uid(). AI-проверка, когда появится, пишет в свои таблицы и вызывать это не будет.';

-- ============================================================
-- 11. Гранты: PUBLIC/anon закрыты, authenticated — где нужно
-- ============================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'topic\_homework%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- нужны политикам
grant execute on function public.topic_homework_can_manage(uuid)         to authenticated;
grant execute on function public.topic_homework_student_can_see(uuid)    to authenticated;
grant execute on function public.topic_homework_attempt_is_own(uuid)     to authenticated;
grant execute on function public.topic_homework_attempt_can_review(uuid) to authenticated;
-- нужны фронту
grant execute on function public.topic_homework_start_attempt(uuid)      to authenticated;
grant execute on function public.topic_homework_submit_attempt(uuid)     to authenticated;
grant execute on function public.topic_homework_review_attempt(uuid, public.topic_homework_review_decision, text) to authenticated;
