-- §240. Тип темы «Проверочная / Контрольная работа»: окно времени у класса,
-- автосдача в момент закрытия, одна попытка, решение и критерии — после проверки.
--
-- ТОЛЬКО ДОБАВЛЯЮЩАЯ. Новые столбцы с умолчанием, новая таблица, новое
-- значение в CHECK рубрик; функции — `create or replace` с прежним телом плюс
-- ветки «работа по времени». Обычные ДЗ (тема kind = 'lesson', их сейчас все)
-- ведут себя как раньше: каждая новая проверка начинается с
-- `topic_homework_is_timed(...)`, у урока она ложна, и дальше идёт прежний код.
-- Файл повторяем: второй прогон проходит без ошибок (supabase/tests/kontrolnaya_240/run.sh).
--
-- Применять ОДНОЙ транзакцией (MCP apply_migration так и делает): CHECK рубрик
-- снимается и ставится заново, политики — drop/create.
--
-- Решения владельца (28.09), из которых следует всё ниже:
--  1. «Проверочная» и «Контрольная» отличаются только названием — одна ветка
--     правил, в базе они различимы только ради подписи (topics.kind).
--  2. Окно — у ДЗ темы копии курса (topic_homework.opens_at / closes_at), в
--     шаблоне времени нет; синхронизация и копирование переносят тип темы, но
--     не окно (template_sync_homework и course_copy_topic_content пишут в
--     topic_homework явный список столбцов — окна в нём нет и не будет).
--  3. До открытия условие не отдаётся (строки материалов, файлы ДЗ и объекты
--     хранилища); начать / залить / удалить фото / сдать — только в окне.
--  4. В момент закрытия черновик с фото сдаётся сам (pg_cron раз в минуту),
--     submitted_at = время закрытия, auto_submitted = true.
--  5. Одна попытка, «на доработку» нельзя.
--  6. Решение и новая рубрика «Ответы и критерии» (criteria) — тем же гейтом,
--     что решение ДЗ (topic_solution_unlocked = есть принятая попытка).
--  7. «Открыть заново»: личное окно ученику, пока у него нет сданной попытки;
--     личное окно заменяет общее во всех правилах выше.
--  8. Работа по времени без окна = «время не назначено»: начать нельзя,
--     условие не отдаётся (кроме тех, у кого уже есть сданная работа), сданные
--     попытки и их проверка работают как есть.

-- ── 1. Тип темы ─────────────────────────────────────────────────────────────

alter table public.topics add column if not exists kind text not null default 'lesson';
alter table public.topics drop constraint if exists topics_kind_check;
alter table public.topics add constraint topics_kind_check
  check (kind = any (array['lesson', 'check', 'control']::text[]));

comment on column public.topics.kind is
  'Тип темы: lesson — урок; check — проверочная работа; control — контрольная работа. '
  'Проверочная и контрольная отличаются только названием: окно времени у ДЗ, одна попытка, автосдача. §240';

-- ── 2. Окно у ДЗ и отметка автосдачи ────────────────────────────────────────

alter table public.topic_homework
  add column if not exists opens_at timestamptz,
  add column if not exists closes_at timestamptz;

alter table public.topic_homework drop constraint if exists topic_homework_window_check;
alter table public.topic_homework add constraint topic_homework_window_check
  check ((opens_at is null) = (closes_at is null) and (closes_at is null or closes_at > opens_at));

comment on column public.topic_homework.opens_at is
  'Общее окно работы по времени (проверочная/контрольная): открывается. Своё у каждой копии курса, из шаблона не переносится. У урока не используется. §240';
comment on column public.topic_homework.closes_at is
  'Общее окно работы по времени: закрывается. В этот момент черновики с фото сдаются сами. §240';

alter table public.topic_homework_attempts
  add column if not exists auto_submitted boolean not null default false;

comment on column public.topic_homework_attempts.auto_submitted is
  'Сдано автоматически в момент закрытия окна (работа по времени). Ставит только topic_homework_autosubmit_due. §240';

-- ── 3. Личные окна («Открыть заново») ───────────────────────────────────────

create table if not exists public.topic_homework_personal_windows (
  homework_id uuid not null references public.topic_homework(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  opens_at    timestamptz not null,
  closes_at   timestamptz not null,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (homework_id, student_id),
  constraint topic_homework_personal_windows_order_check check (closes_at > opens_at)
);

comment on table public.topic_homework_personal_windows is
  'Личное окно ученика для работы по времени («Открыть заново», например после болезни). '
  'Заменяет общее окно ДЗ во всех правилах. Пишут только definer-функции '
  'topic_homework_set_personal_window / topic_homework_clear_personal_window. §240';

alter table public.topic_homework_personal_windows enable row level security;
revoke all on public.topic_homework_personal_windows from anon;
revoke insert, update, delete on public.topic_homework_personal_windows from authenticated;
grant select on public.topic_homework_personal_windows to authenticated;

drop policy if exists topic_homework_personal_windows_select on public.topic_homework_personal_windows;
create policy topic_homework_personal_windows_select on public.topic_homework_personal_windows
  for select to authenticated
  using (
    student_id = public.auth_student_id()
    -- topic_homework_can_manage → topic_material_can_manage → course_is_staff
    -- по курсу темы: тот же предикат, что у попыток и вердиктов.
    or public.topic_homework_can_manage(homework_id)
  );

-- ── 4. Рубрика «Ответы и критерии оценивания» ───────────────────────────────
-- Список — из 20260927153810 (§234) плюс criteria.

alter table public.topic_material_items drop constraint if exists topic_material_items_section_check;
alter table public.topic_material_items add constraint topic_material_items_section_check
  check (section = any (array[
    'notes', 'theory', 'tasks',
    'task_solution',       -- Решение задач
    'worksheet_tasks',     -- Рабочий лист задач
    'worksheet_homework',  -- Рабочий лист ДЗ (у работы по времени — «Условие»)
    'solution',            -- Решение ДЗ (с гейтом, кроме тренировки)
    'homework_tasks',      -- ДЗ · список задач (только тренировка, §234)
    'criteria'             -- Ответы и критерии оценивания (гейт как у решения, §240)
  ]::text[]));

-- ── 5. Помощники: тип и действующее окно ────────────────────────────────────

create or replace function public.topic_is_timed(p_topic_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from topics t where t.id = p_topic_id and t.kind in ('check', 'control')
  );
$function$;

create or replace function public.topic_homework_is_timed(p_homework_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from topic_homework h join topics t on t.id = h.topic_id
     where h.id = p_homework_id and t.kind in ('check', 'control')
  );
$function$;

-- Действующее окно ученика: личное, если оно есть, иначе общее. ЕДИНСТВЕННОЕ
-- место, где решается «какое окно у этого ученика» — остальные правила зовут её.
create or replace function public.topic_homework_student_window(p_homework_id uuid, p_student_id uuid)
returns table (opens_at timestamptz, closes_at timestamptz, personal boolean)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select case when w.homework_id is not null then w.opens_at else h.opens_at end,
         case when w.homework_id is not null then w.closes_at else h.closes_at end,
         w.homework_id is not null
    from topic_homework h
    left join topic_homework_personal_windows w
      on w.homework_id = h.id and w.student_id = p_student_id
   where h.id = p_homework_id;
$function$;

-- Идёт ли работа для ученика прямо сейчас. Урок — всегда «да»: у обычного ДЗ
-- окна нет, срок мягкий. Работа без окна — «нет» (время не назначено).
create or replace function public.topic_homework_window_open(p_homework_id uuid, p_student_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select case
    when not public.topic_homework_is_timed(p_homework_id) then true
    else coalesce((
      select w.opens_at <= now() and now() < w.closes_at
        from public.topic_homework_student_window(p_homework_id, p_student_id) w
    ), false)
  end;
$function$;

-- Текст отказа «вне окна» — один на все места, где сервер отказывает.
create or replace function public.topic_homework_window_message(p_homework_id uuid, p_student_id uuid)
returns text
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((
    select case
      when w.opens_at is null then 'Время работы ещё не назначено'
      when now() < w.opens_at then 'Работа ещё не началась'
      else 'Время работы вышло — сдача закрыта'
    end
      from public.topic_homework_student_window(p_homework_id, p_student_id) w
  ), 'Работа не найдена');
$function$;

-- Видно ли ученику условие работы. Урок — всегда. Работа по времени — с
-- момента открытия его окна; и тому, у кого уже есть сданная работа (иначе
-- работа без окна спрятала бы условие и от тех, кого уже проверили).
create or replace function public.topic_homework_condition_open(p_homework_id uuid, p_student_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select case
    when not public.topic_homework_is_timed(p_homework_id) then true
    else coalesce((
      select w.opens_at <= now()
        from public.topic_homework_student_window(p_homework_id, p_student_id) w
    ), false)
    or exists (
      select 1 from topic_homework_attempts a
       where a.homework_id = p_homework_id and a.student_id = p_student_id
         and a.status <> 'draft'
    )
  end;
$function$;

-- То же по теме, для вызывающего ученика — в политику на строку материала и
-- в видимость файла. DEFINER — по той же причине, что topic_solution_unlocked:
-- подзапрос в политике исполнялся бы под учеником.
create or replace function public.topic_condition_visible(p_topic_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select not public.topic_is_timed(p_topic_id)
      or exists (
        select 1 from topic_homework h
         where h.topic_id = p_topic_id
           and public.topic_homework_condition_open(h.id, public.auth_student_id())
      );
$function$;

revoke all on function public.topic_is_timed(uuid) from public, anon;
revoke all on function public.topic_homework_is_timed(uuid) from public, anon;
revoke all on function public.topic_homework_student_window(uuid, uuid) from public, anon, authenticated;
revoke all on function public.topic_homework_window_open(uuid, uuid) from public, anon;
revoke all on function public.topic_homework_window_message(uuid, uuid) from public, anon;
revoke all on function public.topic_homework_condition_open(uuid, uuid) from public, anon;
revoke all on function public.topic_condition_visible(uuid) from public, anon;
-- Нужны политикам и invoker-функциям (topic_homework_review_attempt, сдача).
grant execute on function public.topic_is_timed(uuid) to authenticated;
grant execute on function public.topic_homework_is_timed(uuid) to authenticated;
grant execute on function public.topic_homework_window_open(uuid, uuid) to authenticated;
grant execute on function public.topic_homework_window_message(uuid, uuid) to authenticated;
grant execute on function public.topic_homework_condition_open(uuid, uuid) to authenticated;
grant execute on function public.topic_condition_visible(uuid) to authenticated;
grant execute on function public.topic_homework_student_window(uuid, uuid) to service_role;

-- ── 6. Условие до открытия не отдаётся; критерии — как решение ──────────────
-- Политика — из 20260927153810 (§234), добавлены две строки: criteria за тем
-- же гейтом, что solution, и worksheet_homework («Условие») работы по времени
-- — только после открытия окна ученика.

drop policy if exists topic_material_items_student_select on public.topic_material_items;
create policy topic_material_items_student_select on public.topic_material_items
  for select to authenticated
  using (
    is_visible
    and public.course_student_can_see_topic(topic_id)
    and (section is distinct from 'solution'
         or track = 'training'
         or public.topic_solution_unlocked(topic_id))
    and (section is distinct from 'criteria'
         or track = 'training'
         or public.topic_solution_unlocked(topic_id))
    and (section is distinct from 'worksheet_homework'
         or track = 'training'
         or public.topic_condition_visible(topic_id))
    and (track <> 'training'
         or not public.topic_subtopic_is_hidden(topic_id, subtopic_code))
  );

-- Видимость файла материала (политика topic_material_files_read). Тело — из
-- 20260927153810, добавлены те же две строки.
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
            )
       )
  );
$$;

-- Файлы задания (бакет topic-homework): условие может лежать и здесь. Тело —
-- из 20260808181617, в ветку ученика добавлено окно.
create or replace function public.topic_homework_object_visible(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.topic_homework_files f
      join public.topic_homework h on h.id = f.homework_id
     where f.storage_path = p_object_name
       and (
            public.topic_material_can_manage(h.topic_id)
         or (
              public.course_student_can_see_topic(h.topic_id)
              and public.topic_homework_condition_open(h.id, public.auth_student_id())
            )
       )
  );
$$;

-- Строки файлов задания: политика из 20260726073913 плюс окно.
drop policy if exists topic_homework_files_student_select on public.topic_homework_files;
create policy topic_homework_files_student_select on public.topic_homework_files
  for select to authenticated
  using (
    public.topic_homework_student_can_see(homework_id)
    and public.topic_homework_condition_open(homework_id, public.auth_student_id())
  );

-- ── 7. Фото работы: писать только в окне ────────────────────────────────────
-- Предикат пишущих политик страниц работы (строки И объекты хранилища,
-- 20260811222514). Тело прежнее плюс окно: у урока window_open всегда истина.
create or replace function public.topic_homework_attempt_is_own_draft(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from topic_homework_attempts a
     where a.id = p_attempt_id
       and a.student_id = public.auth_student_id()
       and a.status = 'draft'
       and public.topic_homework_window_open(a.homework_id, a.student_id)
  );
$$;

-- ── 8. Сторож попыток: одна попытка, окно, автосдача, без «на доработку» ────
-- Тело — из 20260917194110 (§198), добавлены ветки работы по времени и
-- защита отметки auto_submitted. Старт и сдача (topic_homework_start_attempt,
-- topic_homework_submit_attempt) не меняются: их INSERT/UPDATE проходят через
-- этот сторож, и прямой REST-запрос в обход RPC упирается в него же.
create or replace function public.topic_homework_attempts_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_next integer;
begin
  if tg_op = 'INSERT' then
    if exists (
      select 1 from topic_homework_attempts a
       where a.homework_id = new.homework_id
         and a.student_id  = new.student_id
         and a.status = 'accepted'
    ) then
      raise exception 'Работа уже принята, новые попытки запрещены'
        using errcode = 'check_violation';
    end if;

    -- §240. Проверочная и контрольная: одна попытка и только внутри окна
    -- (личное окно ученика заменяет общее). Обычного ДЗ ветка не касается.
    if public.topic_homework_is_timed(new.homework_id) then
      if exists (
        select 1 from topic_homework_attempts a
         where a.homework_id = new.homework_id and a.student_id = new.student_id
      ) then
        raise exception 'Работу по времени сдают один раз — попытка уже есть'
          using errcode = 'check_violation';
      end if;
      if not public.topic_homework_window_open(new.homework_id, new.student_id) then
        raise exception '%', public.topic_homework_window_message(new.homework_id, new.student_id)
          using errcode = 'check_violation';
      end if;
    end if;

    select coalesce(max(a.attempt_number), 0) + 1 into v_next
      from topic_homework_attempts a
     where a.homework_id = new.homework_id and a.student_id = new.student_id;
    new.attempt_number := v_next;

    new.status := 'draft';
    new.submitted_at := null;
    new.auto_submitted := false;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.homework_id is distinct from old.homework_id
       or new.student_id is distinct from old.student_id
       or new.attempt_number is distinct from old.attempt_number then
      raise exception 'Привязку и номер попытки менять нельзя'
        using errcode = 'check_violation';
    end if;

    -- Терминальные статусы неизменяемы. Единственное исключение (§198):
    -- возвращённую работу можно принять как есть — но лишь изнутри
    -- topic_homework_review_attempt, которая перед UPDATE кладёт id попытки в
    -- транзакционный флаг и в той же транзакции пишет строку вердикта.
    -- Флаг именно с id, а не 'on': иначе одна разрешённая правка открывала бы
    -- дорогу остальным строкам той же транзакции.
    if old.status in ('accepted', 'returned_for_revision')
       and new.status is distinct from old.status then
      if not (old.status = 'returned_for_revision'
              and new.status = 'accepted'
              and coalesce(current_setting('app.topic_homework_revise', true), '') = old.id::text) then
        raise exception 'Проверенную попытку изменить нельзя'
          using errcode = 'check_violation';
      end if;
    end if;

    if old.status = 'draft' and new.status = 'submitted' then
      new.submitted_at := coalesce(new.submitted_at, now());
    end if;

    -- §240. Флаг «сдано автоматически» ставит только автосдача (транзакционный
    -- флаг с id попытки, как у пересмотра §198) — не ученик и не PATCH.
    if new.auto_submitted is distinct from old.auto_submitted
       and coalesce(current_setting('app.topic_homework_autosubmit', true), '') <> old.id::text then
      raise exception 'Отметку автосдачи ставит только сервер'
        using errcode = 'check_violation';
    end if;

    if public.topic_homework_is_timed(new.homework_id) then
      -- Сдача работы по времени — только внутри окна; время сдачи ставит
      -- сервер. Автосдача приходит со своим флагом и своим временем
      -- (= время закрытия).
      if old.status = 'draft' and new.status = 'submitted'
         and coalesce(current_setting('app.topic_homework_autosubmit', true), '') <> old.id::text then
        if not public.topic_homework_window_open(old.homework_id, old.student_id) then
          raise exception '%', public.topic_homework_window_message(old.homework_id, old.student_id)
            using errcode = 'check_violation';
        end if;
        new.submitted_at := now();
      end if;
      -- Одна попытка: на доработку работу по времени не возвращают.
      if new.status = 'returned_for_revision' and old.status is distinct from 'returned_for_revision' then
        raise exception 'Проверочную и контрольную работу нельзя вернуть на доработку — только оценить'
          using errcode = 'check_violation';
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.course_delete', true), '') = 'on' then
      return old;
    end if;
    if old.status <> 'draft' then
      raise exception 'Сданную попытку удалить нельзя'
        using errcode = 'check_violation';
    end if;
    -- §240. Черновик работы по времени ученик вне окна не удаляет: иначе
    -- между закрытием и автосдачей можно было бы «передумать» за сервер.
    -- Каскад от преподавателя (удаление темы/ДЗ) сюда не попадает — там
    -- удаляет не сам ученик.
    if old.student_id = public.auth_student_id()
       and public.topic_homework_is_timed(old.homework_id)
       and not public.topic_homework_window_open(old.homework_id, old.student_id) then
      raise exception '%', public.topic_homework_window_message(old.homework_id, old.student_id)
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  return null;
end $$;

-- ── 9. Вердикт: работу по времени на доработку не вернуть ───────────────────
-- Тело — из 20260917194110, добавлен ранний отказ с понятным текстом.
create or replace function public.topic_homework_review_attempt(
  p_attempt_id uuid,
  p_decision   public.topic_homework_review_decision,
  p_comment    text default null,
  p_score      integer default null
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_scale text;
  v_max integer;
  v_review uuid;
  v_status public.topic_homework_attempt_status;
  v_homework uuid;
  v_student uuid;
  v_number integer;
  v_newer_number integer;
  v_newer_status public.topic_homework_attempt_status;
begin
  -- Право не новое: та же проверка, что у пометок и ИИ-разбора. Спрашиваем её
  -- явно только ради внятного отказа — настоящую защиту держат RLS-политики
  -- (insert в topic_homework_reviews и update попытки) ниже.
  if not public.topic_homework_attempt_can_review(p_attempt_id) then
    raise exception 'Нет прав на проверку этой работы'
      using errcode = 'insufficient_privilege';
  end if;

  select a.status, a.homework_id, a.student_id, a.attempt_number, h.grade_scale
    into v_status, v_homework, v_student, v_number, v_scale
    from topic_homework_attempts a
    join topic_homework h on h.id = a.homework_id
   where a.id = p_attempt_id;

  if v_status is null then
    raise exception 'Попытка не найдена' using errcode = 'no_data_found';
  end if;

  -- Вердикт ставится сданной работе; возвращённую можно пересмотреть и принять
  -- как есть (§198): преподаватель вернул, потом разобрался в почерке или
  -- ученик объяснил решение на занятии. Принятую не трогаем — у ученика уже
  -- виден балл.
  if v_status = 'accepted' then
    raise exception 'Работа уже принята — вердикт не меняется';
  end if;
  if v_status not in ('submitted', 'returned_for_revision') then
    raise exception 'Попытка не в статусе «сдано»';
  end if;

  -- §240. Проверочная и контрольная — одна попытка: вернуть на доработку
  -- нельзя, только оценить. Тот же запрет держит сторож попыток (на прямой
  -- UPDATE), здесь — ради внятного текста до записи вердикта.
  if p_decision = 'returned_for_revision' and public.topic_homework_is_timed(v_homework) then
    raise exception 'Проверочную и контрольную работу нельзя вернуть на доработку — только оценить'
      using errcode = 'check_violation';
  end if;

  -- Пересматривать можно только ПОСЛЕДНЮЮ попытку. Иначе преподаватель примет
  -- старую версию работы, а на проверке будет висеть новая.
  select a.attempt_number, a.status into v_newer_number, v_newer_status
    from topic_homework_attempts a
   where a.homework_id = v_homework
     and a.student_id  = v_student
     and a.attempt_number > v_number
   order by a.attempt_number desc
   limit 1;

  if v_newer_number is not null then
    if v_newer_status = 'draft' then
      raise exception 'Ученик уже начал новую попытку (№%) — старую принимать нельзя', v_newer_number
        using errcode = 'check_violation';
    end if;
    raise exception 'Ученик уже сдал работу заново — открывайте последнюю попытку (№%)', v_newer_number
      using errcode = 'check_violation';
  end if;

  if p_decision = 'accepted' and v_scale is not null then
    v_max := case v_scale when 'five' then 5 else 100 end;
    if p_score is null then
      raise exception 'У этого ДЗ есть шкала баллов — укажите балл (0–%)', v_max
        using errcode = 'check_violation';
    end if;
    if p_score < 0 or p_score > v_max then
      raise exception 'Балл должен быть от 0 до %', v_max using errcode = 'check_violation';
    end if;
  else
    -- возврат на доработку или ДЗ без баллов — балла быть не должно
    p_score := null;
  end if;

  -- История append-only: пересмотр добавляет ВТОРУЮ строку, «вернул, потом
  -- принял» остаётся видно целиком.
  insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score)
  values (p_attempt_id, auth.uid(), p_decision, p_comment, p_score)
  returning id into v_review;

  -- Флаг для сторожа: он пускает returned_for_revision → accepted только для
  -- этой попытки и только до конца транзакции.
  perform set_config('app.topic_homework_revise', p_attempt_id::text, true);

  update topic_homework_attempts
     set status = p_decision::text::public.topic_homework_attempt_status
   where id = p_attempt_id
     and status in ('submitted', 'returned_for_revision');

  if not found then
    -- Сюда попадаем только гонкой: пока мы считали балл, работу принял
    -- кто-то другой (accepted из набора исключён). Текст узнаёт клиент —
    -- isAlreadyReviewedError в src/lib/homeworkQueue.ts.
    raise exception 'Работа уже принята другим проверяющим';
  end if;

  perform set_config('app.topic_homework_revise', '', true);

  -- Уведомление — best effort: его сбой не должен откатить вердикт.
  begin
    perform public.topic_homework_enqueue_reviewed(v_review);
  exception when others then
    raise warning 'topic_homework_enqueue_reviewed(%): %', v_review, sqlerrm;
  end;

  return v_review;
end $$;

-- ── 10. Автосдача в момент закрытия ─────────────────────────────────────────
-- Черновики работ по времени с хотя бы одним фото, у которых ДЕЙСТВУЮЩЕЕ окно
-- (с учётом личного) закрылось, → submitted, submitted_at = время закрытия,
-- auto_submitted = true. Черновик без фото остаётся черновиком («не сдано»).
-- Повторный запуск ничего не меняет: сдавать больше нечего. Уведомление — как
-- у обычной сдачи; его сбой сдачу не откатывает.
create or replace function public.topic_homework_autosubmit_due()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
  v_rows integer;
  v_done integer := 0;
begin
  for r in
    select a.id, w.closes_at
      from topic_homework_attempts a
      join topic_homework h on h.id = a.homework_id
      join topics t on t.id = h.topic_id
      cross join lateral public.topic_homework_student_window(a.homework_id, a.student_id) w
     where a.status = 'draft'
       and t.kind in ('check', 'control')
       and w.closes_at is not null
       and w.closes_at <= now()
       and exists (select 1 from topic_homework_attempt_files f where f.attempt_id = a.id)
     order by w.closes_at, a.id
     for update of a skip locked
  loop
    -- Флаг для сторожа: он пускает сдачу вне окна и отметку автосдачи только
    -- этой попытке и только до конца транзакции.
    perform set_config('app.topic_homework_autosubmit', r.id::text, true);
    update topic_homework_attempts
       set status = 'submitted', submitted_at = r.closes_at, auto_submitted = true
     where id = r.id and status = 'draft';
    get diagnostics v_rows = row_count;
    perform set_config('app.topic_homework_autosubmit', '', true);

    if v_rows > 0 then
      v_done := v_done + 1;
      begin
        perform public.notify_homework_submitted(r.id);
      exception when others then
        raise warning 'Уведомление об автосдаче % не создано: % — %', r.id, sqlstate, sqlerrm;
      end;
    end if;
  end loop;
  return v_done;
end
$function$;

comment on function public.topic_homework_autosubmit_due() is
  'Автосдача работ по времени: черновики с фото и закрывшимся действующим окном → submitted (время закрытия, auto_submitted). Зовёт pg_cron раз в минуту (задание topic-homework-autosubmit). Идемпотентна. §240';

revoke all on function public.topic_homework_autosubmit_due() from public, anon, authenticated;
grant execute on function public.topic_homework_autosubmit_due() to service_role;

-- Задание pg_cron. По имени: повторный прогон файла не плодит задания
-- (cron.schedule с тем же именем обновляет существующее).
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('topic-homework-autosubmit', '* * * * *',
                          'select public.topic_homework_autosubmit_due()');
  end if;
end $$;

-- ── 11. Учителю: личное окно, сводка; всем — серверное время ────────────────

create or replace function public.topic_homework_set_personal_window(
  p_homework_id uuid, p_student_id uuid, p_opens_at timestamptz, p_closes_at timestamptz)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_course uuid;
begin
  select public.course_of_topic(h.topic_id) into v_course
    from topic_homework h where h.id = p_homework_id;
  if v_course is null or not public.course_is_staff(v_course) then
    raise exception 'Нет прав на эту работу' using errcode = 'insufficient_privilege';
  end if;
  if not public.topic_homework_is_timed(p_homework_id) then
    raise exception 'Личное время бывает только у проверочной и контрольной работы'
      using errcode = 'check_violation';
  end if;
  if p_opens_at is null or p_closes_at is null or p_closes_at <= p_opens_at then
    raise exception 'Время закрытия должно быть позже времени открытия'
      using errcode = 'check_violation';
  end if;
  if not exists (
       select 1 from group_students gs join groups g on g.id = gs.group_id
        where g.course_id = v_course and gs.student_id = p_student_id)
     and not exists (
       select 1 from student_courses sc
        where sc.course_id = v_course and sc.student_id = p_student_id)
  then
    raise exception 'Ученик не из этого курса' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from topic_homework_attempts a
     where a.homework_id = p_homework_id and a.student_id = p_student_id
       and a.status <> 'draft'
  ) then
    raise exception 'У ученика уже есть сданная работа — открыть заново нельзя'
      using errcode = 'check_violation';
  end if;

  insert into topic_homework_personal_windows (homework_id, student_id, opens_at, closes_at, created_by)
  values (p_homework_id, p_student_id, p_opens_at, p_closes_at, auth.uid())
  on conflict (homework_id, student_id) do update
     set opens_at = excluded.opens_at, closes_at = excluded.closes_at,
         created_by = excluded.created_by, updated_at = now();
end
$function$;

create or replace function public.topic_homework_clear_personal_window(p_homework_id uuid, p_student_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_course uuid;
begin
  select public.course_of_topic(h.topic_id) into v_course
    from topic_homework h where h.id = p_homework_id;
  if v_course is null or not public.course_is_staff(v_course) then
    raise exception 'Нет прав на эту работу' using errcode = 'insufficient_privilege';
  end if;
  if exists (
    select 1 from topic_homework_attempts a
     where a.homework_id = p_homework_id and a.student_id = p_student_id
       and a.status <> 'draft'
  ) then
    raise exception 'У ученика уже есть сданная работа — личное время не снимается'
      using errcode = 'check_violation';
  end if;
  delete from topic_homework_personal_windows
   where homework_id = p_homework_id and student_id = p_student_id;
end
$function$;

-- Сводка по работе: сдали сами / сдано автоматически / не сдали / в классе.
-- «Не сдали» — ученики класса без сданной попытки (черновик без фото сюда же).
create or replace function public.topic_homework_timed_summary(p_homework_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_course uuid;
  v_hw record;
  v_result jsonb;
begin
  select h.id, h.opens_at, h.closes_at, public.course_of_topic(h.topic_id) as course_id
    into v_hw
    from topic_homework h where h.id = p_homework_id;
  v_course := v_hw.course_id;
  if v_course is null or not public.course_is_staff(v_course) then
    raise exception 'Нет прав на эту работу' using errcode = 'insufficient_privilege';
  end if;

  with roster as (
    select distinct gs.student_id
      from group_students gs join groups g on g.id = gs.group_id
     where g.course_id = v_course
  ),
  done as (
    select a.student_id, bool_or(not a.auto_submitted) as self, bool_or(a.auto_submitted) as auto
      from topic_homework_attempts a
     where a.homework_id = p_homework_id and a.status <> 'draft'
     group by a.student_id
  )
  select jsonb_build_object(
    'in_class',       (select count(*) from roster),
    'submitted_self', (select count(*) from done where self),
    'submitted_auto', (select count(*) from done where auto and not self),
    'not_submitted',  (select count(*) from roster r where not exists (select 1 from done d where d.student_id = r.student_id)),
    'personal_windows', (select count(*) from topic_homework_personal_windows w where w.homework_id = p_homework_id),
    'opens_at',  v_hw.opens_at,
    'closes_at', v_hw.closes_at,
    'closed',    v_hw.closes_at is not null and v_hw.closes_at <= now(),
    'server_now', now()
  ) into v_result;
  return v_result;
end
$function$;

-- Своё действующее окно — ученику (личное или общее) вместе с серверным
-- временем: таймер считает от сервера, а не от часов телефона.
create or replace function public.topic_homework_my_window(p_homework_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when not public.topic_homework_student_can_see(p_homework_id) then null
    else (
      select jsonb_build_object(
        'timed', public.topic_homework_is_timed(p_homework_id),
        'opens_at', w.opens_at,
        'closes_at', w.closes_at,
        'personal', w.personal,
        'server_now', now()
      )
        from public.topic_homework_student_window(p_homework_id, public.auth_student_id()) w
    )
  end;
$function$;

create or replace function public.app_server_now()
returns timestamptz
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select now();
$function$;

revoke all on function public.topic_homework_set_personal_window(uuid, uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.topic_homework_clear_personal_window(uuid, uuid) from public, anon;
revoke all on function public.topic_homework_timed_summary(uuid) from public, anon;
revoke all on function public.topic_homework_my_window(uuid) from public, anon;
revoke all on function public.app_server_now() from public, anon;
grant execute on function public.topic_homework_set_personal_window(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.topic_homework_clear_personal_window(uuid, uuid) to authenticated;
grant execute on function public.topic_homework_timed_summary(uuid) to authenticated;
grant execute on function public.topic_homework_my_window(uuid) to authenticated;
grant execute on function public.app_server_now() to authenticated;

-- ── 12. Каркас → классы и копирование: тип темы едет, окно — нет ────────────
-- template_sync_topic_apply — тело из 20260927153810 (§234), добавлен kind в
-- UPDATE и сравнение. Новые темы копий (template_sync_module_apply) вставляются
-- без kind и сразу проходят через эту же функцию — отдельной правки не нужно.
-- template_sync_homework не трогаем: он пишет в topic_homework явный список
-- столбцов (title, instructions, grade_scale), окна в нём нет — синхронизация
-- не затирает окно копии и не приносит его из шаблона.
create or replace function public.template_sync_topic_apply(p_template_topic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_tpl        record;
  v_copy       record;
  v_tpl_var    record;
  v_copy_var   uuid;
  v_item       record;
  v_n          integer;
  v_copies     integer := 0;
  v_ins        integer := 0;
  v_upd        integer := 0;
  v_del        integer := 0;
  v_tasks_ins  integer := 0;
  v_tasks_del  integer := 0;
  v_kept       integer := 0;
  v_issues     integer := 0;
  v_maxpos     integer;
BEGIN
  SELECT t.id, t.title, t.order_index, t.max_score, t.kind, m.course_id
    INTO v_tpl
    FROM public.topics t
    JOIN public.modules m ON m.id = t.module_id
   WHERE t.id = p_template_topic_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('copies', 0, 'skipped', 'no_topic');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.courses c WHERE c.id = v_tpl.course_id AND c.is_template) THEN
    RETURN jsonb_build_object('copies', 0, 'skipped', 'not_a_template');
  END IF;

  SELECT v.id, v.title, v.created_by INTO v_tpl_var
    FROM public.test_variants v WHERE v.topic_id = p_template_topic_id;

  FOR v_copy IN
    SELECT ct.id AS topic_id, cm.course_id
      FROM public.topics ct
      JOIN public.modules cm ON cm.id = ct.module_id
     WHERE ct.source_topic_id = p_template_topic_id
  LOOP
    v_copies := v_copies + 1;

    -- Прошлые расхождения по этой паре снимаем: плашка должна описывать
    -- сегодняшнее состояние, а не историю попыток.
    DELETE FROM public.template_sync_issues
     WHERE template_topic_id = p_template_topic_id AND copy_topic_id = v_copy.topic_id;

    -- 1. Сама тема: название, порядок, балл и тип (§240). Открытие и дата — классные.
    UPDATE public.topics
       SET title = v_tpl.title, order_index = v_tpl.order_index, max_score = v_tpl.max_score,
           kind = v_tpl.kind
     WHERE id = v_copy.topic_id
       AND (title, order_index, max_score, kind)
           IS DISTINCT FROM (v_tpl.title, v_tpl.order_index, v_tpl.max_score, v_tpl.kind);

    -- 2. Материалы. Сначала исчезнувшие в шаблоне.
    DELETE FROM public.topic_material_items ci
     WHERE ci.topic_id = v_copy.topic_id
       AND ci.source_item_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.topic_material_items ti
          WHERE ti.id = ci.source_item_id AND ti.topic_id = p_template_topic_id);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_del := v_del + v_n;

    UPDATE public.topic_material_items ci
       SET kind = ti.kind, title = ti.title, content = ti.content, url = ti.url,
           storage_path = ti.storage_path, file_name = ti.file_name,
           mime_type = ti.mime_type, size_bytes = ti.size_bytes,
           position = ti.position, is_visible = ti.is_visible, section = ti.section,
           track = ti.track, subtopic_code = ti.subtopic_code, subtopic_title = ti.subtopic_title,
           updated_at = now()
      FROM public.topic_material_items ti
     WHERE ti.id = ci.source_item_id
       AND ci.topic_id = v_copy.topic_id
       AND ti.topic_id = p_template_topic_id
       AND (ci.kind, ci.title, ci.content, ci.url, ci.storage_path, ci.file_name,
            ci.mime_type, ci.size_bytes, ci.position, ci.is_visible, ci.section,
            ci.track, ci.subtopic_code, ci.subtopic_title)
           IS DISTINCT FROM
           (ti.kind, ti.title, ti.content, ti.url, ti.storage_path, ti.file_name,
            ti.mime_type, ti.size_bytes, ti.position, ti.is_visible, ti.section,
            ti.track, ti.subtopic_code, ti.subtopic_title);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_upd := v_upd + v_n;

    -- Пути к файлам те же: копия ссылается на тот же объект (§101), никакой
    -- перезаливки — именно она когда-то стоила 584 МБ на один курс.
    INSERT INTO public.topic_material_items (
      topic_id, kind, title, content, url, storage_path, file_name, mime_type,
      size_bytes, position, is_visible, section, created_by, source_item_id,
      track, subtopic_code, subtopic_title)
    SELECT v_copy.topic_id, ti.kind, ti.title, ti.content, ti.url, ti.storage_path,
           ti.file_name, ti.mime_type, ti.size_bytes, ti.position, ti.is_visible,
           ti.section, coalesce(auth.uid(), ti.created_by), ti.id,
           ti.track, ti.subtopic_code, ti.subtopic_title
      FROM public.topic_material_items ti
     WHERE ti.topic_id = p_template_topic_id
       AND NOT EXISTS (
         SELECT 1 FROM public.topic_material_items ci
          WHERE ci.topic_id = v_copy.topic_id AND ci.source_item_id = ti.id);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_ins := v_ins + v_n;

    -- 3. Домашнее задание. `is_published` и `due_at` не переносятся: срок и
    --    публикация — решение класса, а не каркаса.
    PERFORM public.template_sync_homework(p_template_topic_id, v_copy.topic_id);

    -- 4. Задачи к уроку. Набор у темы один (§164), связь идёт через тему.
    IF v_tpl_var.id IS NOT NULL THEN
      SELECT id INTO v_copy_var FROM public.test_variants WHERE topic_id = v_copy.topic_id;

      IF v_copy_var IS NULL THEN
        INSERT INTO public.test_variants
          (title, subject, exam_type, status, created_by, settings, tasks_count, source_type, topic_id)
        SELECT v_tpl_var.title, c.subject, c.exam_type, 'ready',
               coalesce(auth.uid(), v_tpl_var.created_by), '{}'::jsonb, 0, 'teacher_assigned', v_copy.topic_id
          FROM public.courses c WHERE c.id = v_copy.course_id
        RETURNING id INTO v_copy_var;
      END IF;

      -- Убранное в шаблоне убираем и здесь — но не вместе с чужими ответами.
      FOR v_item IN
        SELECT ci.id, ci.task_id,
               (SELECT count(*) FROM public.test_variant_answers a WHERE a.variant_item_id = ci.id) AS answers
          FROM public.test_variant_items ci
         WHERE ci.variant_id = v_copy_var
           AND NOT EXISTS (
             SELECT 1 FROM public.test_variant_items ti
              WHERE ti.variant_id = v_tpl_var.id AND ti.task_id = ci.task_id)
      LOOP
        IF v_item.answers > 0 THEN
          v_kept := v_kept + 1;
          INSERT INTO public.template_sync_issues (template_topic_id, copy_topic_id, kind, detail)
          VALUES (p_template_topic_id, v_copy.topic_id, 'kept_with_answers',
                  format('Задача убрана из каркаса, но по ней уже есть ответы (%s) — осталась в классе', v_item.answers));
          v_issues := v_issues + 1;
        ELSE
          DELETE FROM public.test_variant_items WHERE id = v_item.id;
          v_tasks_del := v_tasks_del + 1;
        END IF;
      END LOOP;

      -- Позиции освобождаем целиком: (variant_id, position) уникальна, и
      -- переносить порядок «по месту» значит ловить конфликт на каждой второй.
      UPDATE public.test_variant_items SET position = -position - 1
       WHERE variant_id = v_copy_var;

      UPDATE public.test_variant_items ci
         SET position = ti.position, points = ti.points,
             grading_type = ti.grading_type, section_id = ti.section_id
        FROM public.test_variant_items ti
       WHERE ti.variant_id = v_tpl_var.id
         AND ci.variant_id = v_copy_var
         AND ci.task_id = ti.task_id;

      INSERT INTO public.test_variant_items (variant_id, task_id, position, section_id, points, grading_type)
      SELECT v_copy_var, ti.task_id, ti.position, ti.section_id, ti.points, ti.grading_type
        FROM public.test_variant_items ti
       WHERE ti.variant_id = v_tpl_var.id
         AND NOT EXISTS (
           SELECT 1 FROM public.test_variant_items ci
            WHERE ci.variant_id = v_copy_var AND ci.task_id = ti.task_id);
      GET DIAGNOSTICS v_n = ROW_COUNT; v_tasks_ins := v_tasks_ins + v_n;

      -- Оставшиеся в минусе — те, что удержали ответы. Ставим их в конец.
      SELECT coalesce(max(position), 0) INTO v_maxpos
        FROM public.test_variant_items WHERE variant_id = v_copy_var AND position >= 0;

      FOR v_item IN
        SELECT id FROM public.test_variant_items
         WHERE variant_id = v_copy_var AND position < 0 ORDER BY position DESC
      LOOP
        v_maxpos := v_maxpos + 1;
        UPDATE public.test_variant_items SET position = v_maxpos WHERE id = v_item.id;
      END LOOP;

      UPDATE public.test_variants
         SET tasks_count = (SELECT count(*) FROM public.test_variant_items WHERE variant_id = v_copy_var),
             updated_at = now()
       WHERE id = v_copy_var;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'copies', v_copies,
    'items_inserted', v_ins, 'items_updated', v_upd, 'items_deleted', v_del,
    'tasks_inserted', v_tasks_ins, 'tasks_deleted', v_tasks_del,
    'kept_with_answers', v_kept, 'issues', v_issues);
END;
$function$;

-- course_copy_topic_content — тело из 20260927153810, kind переносится там же,
-- где тумблер открытости (обе функции копирования зовут её сразу после вставки
-- темы). ДЗ копируется явным списком столбцов — окно не переносится.
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
  -- Окно времени — у ДЗ и классное: ниже его не переносим.
  update topics tgt
     set is_open = nullif(src.is_open, true),
         kind = src.kind
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

  select id into v_hw_id from topic_homework where topic_id = p_source_topic_id;
  if v_hw_id is not null then
    insert into topic_homework (topic_id, title, instructions, is_published, created_by, due_at, grade_scale, source_homework_id)
    select p_target_topic_id, title, instructions, false, auth.uid(),
           public.course_copy_shift_date(due_at, p_mode, p_shift_days), grade_scale, id
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

-- Триггер темы каркаса: смена типа в шаблоне тоже уезжает в классы. Тело
-- trg_template_sync_topic не меняется — только список столбцов (20260913195101).
drop trigger if exists template_sync_topic_write on public.topics;
create trigger template_sync_topic_write
  after insert or update of title, order_index, max_score, module_id, kind on public.topics
  for each row execute function public.trg_template_sync_topic();
