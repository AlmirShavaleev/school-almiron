-- Учебный план по неделям (§151).
--
-- План принадлежит курсу: курс = группа (§61/§64, индекс groups_one_per_course).
-- Раскладка «неделя № → темы» одна на класс; отклонения по ученику двух видов —
-- сдвиг срока и снятие темы. Все записи идут через RPC: у таблиц нет политик
-- INSERT/UPDATE/DELETE, потому что запись в план тянет за собой открытие тем
-- (available_from + is_open = null), и этот побочный эффект должен жить в одном
-- месте, а не повторяться в клиенте.
--
-- Открытие тем: своей формулы нет. План переводит тему на автоматику
-- (`is_open = null`) и ставит `available_from` = понедельник её недели, дальше
-- решает существующая `topic_open_now`. Тему с `is_open = true` план не трогает —
-- это «открыть раньше» руками. При снятии темы с плана её состояние
-- замораживается: `is_open := topic_open_now(...)`, дата снимается — иначе
-- `null + null` читалось бы как «открыта».
--
-- Часовой пояс — 'Europe/Moscow', тот же литерал, что в admin_live_pulse.

-- ─── Таблицы ────────────────────────────────────────────────────────────────

create table public.course_study_plans (
  course_id  uuid primary key references public.courses(id) on delete cascade,
  start_date date not null,
  auto_open  boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_study_plans_start_monday check (extract(isodow from start_date) = 1)
);
comment on table public.course_study_plans is
  'Учебный план курса по неделям (§151): дата старта (понедельник) и правило открытия тем.';
comment on column public.course_study_plans.auto_open is
  'План сам открывает темы в их неделю: пишет topics.available_from и is_open = null.';

create table public.course_study_plan_items (
  course_id uuid not null references public.course_study_plans(course_id) on delete cascade,
  topic_id  uuid not null references public.topics(id) on delete cascade,
  week_no   integer not null check (week_no between 1 and 104),
  primary key (course_id, topic_id)
);
create index course_study_plan_items_week_idx on public.course_study_plan_items (course_id, week_no);
comment on table public.course_study_plan_items is
  'Раскладка тем курса по неделям плана. Пишется только через study_plan_* RPC.';

create table public.course_study_plan_overrides (
  course_id  uuid not null references public.course_study_plans(course_id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  topic_id   uuid not null references public.topics(id) on delete cascade,
  week_no    integer check (week_no between 1 and 104),
  removed    boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (course_id, student_id, topic_id),
  constraint course_study_plan_overrides_kind check (removed or week_no is not null)
);
comment on table public.course_study_plan_overrides is
  'Отклонения по ученику: сдвиг темы на другую неделю (week_no) либо снятие (removed).';

-- Тема должна принадлежать курсу плана — иначе раскладка молча примет чужую тему.
create or replace function public.study_plan_item_check_topic()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.topics t
      join public.modules m on m.id = t.module_id
     where t.id = new.topic_id and m.course_id = new.course_id
  ) then
    raise exception 'Тема % не принадлежит курсу %', new.topic_id, new.course_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger course_study_plan_items_topic_chk
  before insert or update on public.course_study_plan_items
  for each row execute function public.study_plan_item_check_topic();

create trigger course_study_plan_overrides_topic_chk
  before insert or update on public.course_study_plan_overrides
  for each row execute function public.study_plan_item_check_topic();

-- ─── RLS: только чтение. Запись — через RPC ниже. ───────────────────────────

alter table public.course_study_plans enable row level security;
alter table public.course_study_plan_items enable row level security;
alter table public.course_study_plan_overrides enable row level security;

create policy course_study_plans_select on public.course_study_plans
  for select using (
    public.course_is_staff(course_id) or public.course_student_has_access(course_id)
  );

create policy course_study_plan_items_select on public.course_study_plan_items
  for select using (
    public.course_is_staff(course_id) or public.course_student_has_access(course_id)
  );

create policy course_study_plan_overrides_select on public.course_study_plan_overrides
  for select using (
    public.course_is_staff(course_id) or student_id = public.auth_student_id()
  );

-- ─── Недели ─────────────────────────────────────────────────────────────────

-- Понедельник недели плана.
create or replace function public.study_plan_week_start(p_start date, p_week integer)
returns date
language sql
immutable
as $$
  select p_start + 7 * (p_week - 1);
$$;

-- Конец недели: воскресенье 23:59:59 по Москве = полночь понедельника следующей.
create or replace function public.study_plan_week_deadline(p_start date, p_week integer)
returns timestamptz
language sql
immutable
as $$
  select ((p_start + 7 * p_week)::timestamp) at time zone 'Europe/Moscow';
$$;

-- Номер текущей недели по московской дате. До старта — 0 и меньше.
create or replace function public.study_plan_current_week(p_start date)
returns integer
language sql
stable
as $$
  select floor(((now() at time zone 'Europe/Moscow')::date - p_start) / 7.0)::integer + 1;
$$;

-- ─── Открытие тем по плану ──────────────────────────────────────────────────

-- Внутренняя: применяет даты плана к темам. Вызывается из RPC, свою проверку
-- прав не делает — её делает вызывающая функция.
create or replace function public.study_plan_apply_opening_internal(p_course_id uuid, p_topic_id uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_plan public.course_study_plans;
  v_n integer := 0;
begin
  select * into v_plan from public.course_study_plans where course_id = p_course_id;
  if not found or not v_plan.auto_open then
    return 0;
  end if;

  -- Темы плана: на автоматику по дате. Открытые руками (true) не трогаем.
  update public.topics t
     set available_from = public.study_plan_week_start(v_plan.start_date, i.week_no),
         is_open = null
    from public.course_study_plan_items i
   where i.course_id = p_course_id
     and i.topic_id = t.id
     and (p_topic_id is null or t.id = p_topic_id)
     and t.is_open is distinct from true
     and (t.available_from is distinct from public.study_plan_week_start(v_plan.start_date, i.week_no)
          or t.is_open is not null);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Снятие темы с плана: заморозить текущее состояние, дату убрать.
create or replace function public.study_plan_freeze_topic_internal(p_topic_id uuid)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  update public.topics
     set is_open = public.topic_open_now(is_open, available_from),
         available_from = null
   where id = p_topic_id
     and is_open is null;
$$;

create or replace function public.study_plan_apply_opening(p_course_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.course_is_teacher_staff(p_course_id) then
    raise exception 'Нет прав на план курса' using errcode = '42501';
  end if;
  return public.study_plan_apply_opening_internal(p_course_id);
end;
$$;

-- ─── Записи плана ───────────────────────────────────────────────────────────

-- Создать план или сменить дату старта / автооткрытие.
create or replace function public.study_plan_save(p_course_id uuid, p_start_date date, p_auto_open boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.course_is_teacher_staff(p_course_id) then
    raise exception 'Нет прав на план курса' using errcode = '42501';
  end if;
  if extract(isodow from p_start_date) <> 1 then
    raise exception 'Дата старта должна быть понедельником' using errcode = 'check_violation';
  end if;

  insert into public.course_study_plans (course_id, start_date, auto_open, created_by)
  values (p_course_id, p_start_date, coalesce(p_auto_open, true), auth.uid())
  on conflict (course_id) do update
    set start_date = excluded.start_date,
        auto_open  = excluded.auto_open,
        updated_at = now();

  perform public.study_plan_apply_opening_internal(p_course_id);
end;
$$;

-- Разложить все темы курса по N в неделю в порядке программы. Существующая
-- раскладка заменяется целиком; отклонения учеников сохраняются (тема остаётся
-- в плане, только в другой неделе).
create or replace function public.study_plan_spread(p_course_id uuid, p_per_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_n integer;
begin
  if not public.course_is_teacher_staff(p_course_id) then
    raise exception 'Нет прав на план курса' using errcode = '42501';
  end if;
  if p_per_week is null or p_per_week < 1 or p_per_week > 50 then
    raise exception 'Тем в неделю: от 1 до 50' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.course_study_plans where course_id = p_course_id) then
    raise exception 'Сначала задайте дату старта плана' using errcode = 'check_violation';
  end if;

  delete from public.course_study_plan_items where course_id = p_course_id;

  -- Порядок — пара (order_index, id) на обоих уровнях: тот же, которым сортирует
  -- интерфейс и topics_open_until (§59.5).
  insert into public.course_study_plan_items (course_id, topic_id, week_no)
  select p_course_id, x.topic_id, ((x.rn - 1) / p_per_week) + 1
    from (
      select t.id as topic_id,
             row_number() over (order by m.order_index, m.id, t.order_index, t.id) as rn
        from public.topics t
        join public.modules m on m.id = t.module_id
       where m.course_id = p_course_id
    ) x;
  get diagnostics v_n = row_count;

  perform public.study_plan_apply_opening_internal(p_course_id);
  update public.course_study_plans set updated_at = now() where course_id = p_course_id;
  return v_n;
end;
$$;

-- Перенести тему в неделю (p_week_no) или снять с плана (null).
create or replace function public.study_plan_set_topic_week(p_course_id uuid, p_topic_id uuid, p_week_no integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.course_is_teacher_staff(p_course_id) then
    raise exception 'Нет прав на план курса' using errcode = '42501';
  end if;
  if not exists (select 1 from public.course_study_plans where course_id = p_course_id) then
    raise exception 'Сначала задайте дату старта плана' using errcode = 'check_violation';
  end if;

  if p_week_no is null then
    delete from public.course_study_plan_items
     where course_id = p_course_id and topic_id = p_topic_id;
    if found and (select auto_open from public.course_study_plans where course_id = p_course_id) then
      perform public.study_plan_freeze_topic_internal(p_topic_id);
    end if;
  else
    insert into public.course_study_plan_items (course_id, topic_id, week_no)
    values (p_course_id, p_topic_id, p_week_no)
    on conflict (course_id, topic_id) do update set week_no = excluded.week_no;
    perform public.study_plan_apply_opening_internal(p_course_id, p_topic_id);
  end if;

  update public.course_study_plans set updated_at = now() where course_id = p_course_id;
end;
$$;

-- Отклонение по ученику. p_removed = true — снять тему; иначе p_week_no — сдвиг;
-- оба пустые — убрать отклонение.
create or replace function public.study_plan_set_override(
  p_course_id uuid, p_student_id uuid, p_topic_id uuid,
  p_week_no integer default null, p_removed boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.course_is_teacher_staff(p_course_id) then
    raise exception 'Нет прав на план курса' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.group_students gs
      join public.groups g on g.id = gs.group_id
     where g.course_id = p_course_id and gs.student_id = p_student_id
  ) then
    raise exception 'Ученик не состоит в группе курса' using errcode = 'check_violation';
  end if;

  if coalesce(p_removed, false) = false and p_week_no is null then
    delete from public.course_study_plan_overrides
     where course_id = p_course_id and student_id = p_student_id and topic_id = p_topic_id;
    return;
  end if;

  insert into public.course_study_plan_overrides (course_id, student_id, topic_id, week_no, removed, created_by)
  values (p_course_id, p_student_id, p_topic_id,
          case when coalesce(p_removed, false) then null else p_week_no end,
          coalesce(p_removed, false), auth.uid())
  on conflict (course_id, student_id, topic_id) do update
    set week_no = excluded.week_no,
        removed = excluded.removed,
        created_by = excluded.created_by,
        updated_at = now();
end;
$$;

-- ─── Зачёт ──────────────────────────────────────────────────────────────────

-- Состояние ученика по теме — одна функция на таблицу владельца и неделю ученика.
--
-- Зачёт («сделано»):
--   • тема с опубликованным ДЗ — сдана работа (submitted/accepted; returned без
--     новой сдачи — не сдана, мяч у ученика, правило §141);
--   • тема без опубликованного ДЗ — тема завершена по правилу кабинета ученика
--     (`topicDone` в lib/topicProgress.ts): отмечены все самоотмечаемые группы,
--     которые у темы реально есть, и принято ДЗ, если группа ДЗ есть.
-- «Отмечено» показывается рядом с зачётом: все самоотмечаемые группы отмечены.
--
-- Группы считаются как в useMyProgress: theory = видео или notes/theory;
-- lesson = tasks/task_solution/worksheet_tasks; homework = worksheet_homework
-- или опубликованное ДЗ. Рубрика solution намеренно не участвует: ученику она
-- видна только после принятого ДЗ, то есть ровно тогда, когда группа ДЗ и так
-- сделана.
create or replace function public.study_plan_topic_states(p_course_id uuid)
returns table (
  student_id      uuid,
  topic_id        uuid,
  hw_published    boolean,
  hw_status       text,
  submitted_at    timestamptz,
  self_groups     integer,
  self_marked     integer,
  marked          boolean,
  done            boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with roster as (
    select gs.student_id
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
     where g.course_id = p_course_id
  ),
  course_topics as (
    select t.id as topic_id
      from public.topics t
      join public.modules m on m.id = t.module_id
     where m.course_id = p_course_id
  ),
  topic_shape as (
    select ct.topic_id,
           h.id as homework_id,
           coalesce(h.is_published, false) as hw_published,
           exists (select 1 from public.topic_material_items i
                    where i.topic_id = ct.topic_id and i.is_visible
                      and (i.kind = 'video' or i.section in ('notes', 'theory'))) as has_theory,
           exists (select 1 from public.topic_material_items i
                    where i.topic_id = ct.topic_id and i.is_visible
                      and i.section in ('tasks', 'task_solution', 'worksheet_tasks')) as has_lesson,
           (coalesce(h.is_published, false)
            or exists (select 1 from public.topic_material_items i
                        where i.topic_id = ct.topic_id and i.is_visible
                          and i.section = 'worksheet_homework')) as has_homework
      from course_topics ct
      left join public.topic_homework h on h.topic_id = ct.topic_id
  ),
  attempt as (
    -- Принятая попытка терминальна; иначе самая свежая сданная, иначе черновик.
    select distinct on (a.homework_id, a.student_id)
           a.homework_id, a.student_id, a.status::text as status, a.submitted_at
      from public.topic_homework_attempts a
      join topic_shape ts on ts.homework_id = a.homework_id
      join roster r on r.student_id = a.student_id
     order by a.homework_id, a.student_id,
              (a.status = 'accepted') desc, a.submitted_at desc nulls last, a.attempt_number desc
  ),
  marks as (
    select m.student_id, m.topic_id,
           bool_or(m.group_key = 'theory') as theory_marked,
           bool_or(m.group_key = 'lesson') as lesson_marked
      from public.topic_section_marks m
      join roster r on r.student_id = m.student_id
      join course_topics ct on ct.topic_id = m.topic_id
     group by m.student_id, m.topic_id
  )
  select r.student_id,
         ts.topic_id,
         ts.hw_published,
         case
           when not ts.hw_published then 'none'
           when a.status is null then 'not_started'
           when a.status = 'returned_for_revision' then 'returned'
           else a.status
         end as hw_status,
         case when a.status in ('submitted', 'accepted') then a.submitted_at end as submitted_at,
         (ts.has_theory::int + ts.has_lesson::int) as self_groups,
         ((ts.has_theory and coalesce(mk.theory_marked, false))::int
          + (ts.has_lesson and coalesce(mk.lesson_marked, false))::int) as self_marked,
         ((ts.has_theory or ts.has_lesson)
          and (not ts.has_theory or coalesce(mk.theory_marked, false))
          and (not ts.has_lesson or coalesce(mk.lesson_marked, false))) as marked,
         case
           when ts.hw_published then coalesce(a.status in ('submitted', 'accepted'), false)
           else (ts.has_theory or ts.has_lesson or ts.has_homework)
                and (not ts.has_theory or coalesce(mk.theory_marked, false))
                and (not ts.has_lesson or coalesce(mk.lesson_marked, false))
                and (not ts.has_homework or coalesce(a.status = 'accepted', false))
         end as done
    from roster r
    cross join topic_shape ts
    left join attempt a on a.homework_id = ts.homework_id and a.student_id = r.student_id
    left join marks mk on mk.student_id = r.student_id and mk.topic_id = ts.topic_id;
$$;

-- ─── Экран владельца: один запрос ───────────────────────────────────────────

create or replace function public.study_plan_board(p_course_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_plan public.course_study_plans;
  v_result jsonb;
begin
  if not public.course_is_staff(p_course_id) then
    return null;
  end if;

  select * into v_plan from public.course_study_plans where course_id = p_course_id;

  with roster_students as (
    select s.id as student_id, s.profile_id, coalesce(p.full_name, p.email, '—') as full_name
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
      join public.students s on s.id = gs.student_id
      join public.profiles p on p.id = s.profile_id
     where g.course_id = p_course_id
  ),
  plan_topics as (
    select t.id as topic_id, t.title, m.title as module_title,
           row_number() over (order by m.order_index, m.id, t.order_index, t.id) as position,
           i.week_no,
           t.is_open, t.available_from,
           public.topic_open_now(t.is_open, t.available_from) as open_now
      from public.topics t
      join public.modules m on m.id = t.module_id
      left join public.course_study_plan_items i on i.course_id = p_course_id and i.topic_id = t.id
     where m.course_id = p_course_id
  ),
  cells as (
    select st.student_id, tp.topic_id,
           coalesce(o.week_no, tp.week_no) as week_no,
           coalesce(o.removed, false) as removed,
           (o.week_no is not null) as shifted,
           case when v_plan.course_id is not null and coalesce(o.week_no, tp.week_no) is not null
                then public.study_plan_week_deadline(v_plan.start_date, coalesce(o.week_no, tp.week_no)) end as deadline,
           x.hw_published, x.hw_status, x.submitted_at,
           x.self_groups, x.self_marked, x.marked, x.done
      from roster_students st
      join plan_topics tp on true
      join public.study_plan_topic_states(p_course_id) x on x.student_id = st.student_id and x.topic_id = tp.topic_id
      left join public.course_study_plan_overrides o
        on o.course_id = p_course_id and o.student_id = st.student_id and o.topic_id = tp.topic_id
     where tp.week_no is not null or o.week_no is not null
  ),
  cells_flagged as (
    select c.*,
           (not c.removed and not c.done and c.deadline is not null and c.deadline < now()) as overdue,
           (c.done and c.hw_published and c.submitted_at is not null and c.deadline is not null
            and c.submitted_at > c.deadline) as late
      from cells c
  ),
  summary as (
    select student_id, week_no,
           count(*) filter (where not removed) as total,
           count(*) filter (where not removed and done) as done,
           count(*) filter (where overdue) as overdue
      from cells_flagged
     group by student_id, week_no
  )
  select jsonb_build_object(
    'plan', case when v_plan.course_id is null then null else jsonb_build_object(
      'start_date', v_plan.start_date,
      'auto_open', v_plan.auto_open,
      'current_week', public.study_plan_current_week(v_plan.start_date),
      'weeks_total', coalesce((select max(week_no) from public.course_study_plan_items where course_id = p_course_id), 0)
    ) end,
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'student_id', student_id, 'profile_id', profile_id, 'full_name', full_name)
        order by full_name) from roster_students), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(jsonb_build_object(
        'topic_id', topic_id, 'title', title, 'module_title', module_title, 'position', position,
        'week_no', week_no, 'is_open', is_open, 'available_from', available_from, 'open_now', open_now)
        order by position) from plan_topics), '[]'::jsonb),
    'cells', coalesce((select jsonb_agg(jsonb_build_object(
        's', student_id, 't', topic_id, 'w', week_no, 'rm', removed, 'sh', shifted,
        'dl', deadline, 'hp', hw_published, 'hs', hw_status, 'sa', submitted_at,
        'sg', self_groups, 'sm', self_marked, 'mk', marked, 'dn', done, 'od', overdue, 'lt', late))
        from cells_flagged), '[]'::jsonb),
    'summary', coalesce((select jsonb_agg(jsonb_build_object(
        's', student_id, 'w', week_no, 'total', total, 'done', done, 'overdue', overdue))
        from summary), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ─── Кабинет ученика: текущая неделя ────────────────────────────────────────

create or replace function public.student_week_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student uuid := public.auth_student_id();
  v_result jsonb;
begin
  if v_student is null then
    return '[]'::jsonb;
  end if;

  with my_courses as (
    select distinct g.course_id, g.id as group_id
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
     where gs.student_id = v_student and g.course_id is not null
  ),
  plans as (
    select mc.course_id, mc.group_id, c.title as course_title, c.subject,
           p.start_date,
           public.study_plan_current_week(p.start_date) as week_no,
           (select max(week_no) from public.course_study_plan_items i where i.course_id = mc.course_id) as weeks_total
      from my_courses mc
      join public.courses c on c.id = mc.course_id
      join public.course_study_plans p on p.course_id = mc.course_id
  ),
  week_topics as (
    select pl.course_id, t.id as topic_id, t.title,
           row_number() over (partition by pl.course_id order by m.order_index, m.id, t.order_index, t.id) as position,
           public.topic_open_now(t.is_open, t.available_from) as open_now,
           x.hw_published, x.hw_status, x.done, x.marked, x.self_groups, x.self_marked
      from plans pl
      join public.course_study_plan_items i on i.course_id = pl.course_id
      join public.topics t on t.id = i.topic_id
      join public.modules m on m.id = t.module_id
      left join public.course_study_plan_overrides o
        on o.course_id = pl.course_id and o.student_id = v_student and o.topic_id = t.id
      join public.study_plan_topic_states(pl.course_id) x
        on x.student_id = v_student and x.topic_id = t.id
     where coalesce(o.removed, false) = false
       and coalesce(o.week_no, i.week_no) = pl.week_no
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'course_id', pl.course_id,
    'group_id', pl.group_id,
    'course_title', pl.course_title,
    'subject', pl.subject,
    'week_no', pl.week_no,
    'weeks_total', coalesce(pl.weeks_total, 0),
    'week_start', public.study_plan_week_start(pl.start_date, pl.week_no),
    'week_end', public.study_plan_week_start(pl.start_date, pl.week_no) + 6,
    'deadline', public.study_plan_week_deadline(pl.start_date, pl.week_no),
    'topics', coalesce((select jsonb_agg(jsonb_build_object(
        'topic_id', wt.topic_id, 'title', wt.title, 'open_now', wt.open_now,
        'hw_published', wt.hw_published, 'hw_status', wt.hw_status,
        'done', wt.done, 'marked', wt.marked)
        order by wt.position) from week_topics wt where wt.course_id = pl.course_id), '[]'::jsonb)
  ) order by pl.course_title), '[]'::jsonb)
  into v_result
  from plans pl;

  return v_result;
end;
$$;

-- ─── Права вызова ───────────────────────────────────────────────────────────

revoke all on function public.study_plan_apply_opening_internal(uuid, uuid) from public, anon, authenticated;
revoke all on function public.study_plan_freeze_topic_internal(uuid) from public, anon, authenticated;
revoke all on function public.study_plan_topic_states(uuid) from public, anon;

grant execute on function public.study_plan_week_start(date, integer) to authenticated;
grant execute on function public.study_plan_week_deadline(date, integer) to authenticated;
grant execute on function public.study_plan_current_week(date) to authenticated;
grant execute on function public.study_plan_apply_opening(uuid) to authenticated;
grant execute on function public.study_plan_save(uuid, date, boolean) to authenticated;
grant execute on function public.study_plan_spread(uuid, integer) to authenticated;
grant execute on function public.study_plan_set_topic_week(uuid, uuid, integer) to authenticated;
grant execute on function public.study_plan_set_override(uuid, uuid, uuid, integer, boolean) to authenticated;
grant execute on function public.study_plan_board(uuid) to authenticated;
grant execute on function public.student_week_plan() to authenticated;
