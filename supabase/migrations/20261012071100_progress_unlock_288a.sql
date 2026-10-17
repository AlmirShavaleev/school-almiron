-- §288 (часть A) — открытие уроков по прохождению. ТОЛЬКО ДОБАВЛЕНИЕ:
-- новые таблицы и функции. Ворота доступа ученика здесь не меняются — их
-- подключает часть B (PENDING_288_b_gates.sql). Пока B не применена, режим
-- «по прохождению» виден только на экранах (замки, «Прохождение»), а доступ
-- к материалам — как сейчас.
--
-- Решения владельца (письма 11.10):
--   • режим — на курс: 'schedule' (по умолчанию, как сейчас) | 'progress';
--     ни один существующий курс не переводится, только кнопкой админа;
--   • в 'progress' урок открыт ученику, если нет его персональной отметки
--     'closed' и выполнено хоть одно: первые 2 урока раздела (order_index);
--     наступила available_from; закрыт предыдущий урок этого раздела (сам бывший открытым —
--     запертый пустой урок цепочку не продолжает);
--     персональная отметка 'open'. topics.is_open в 'progress' не читается;
--   • урок закрыт учеником: каждая задача автопроверки завершена (верно или 3
--     попытки — лимит не меняется) И опубликованное ДЗ второй части
--     (autocheck = false) принято — последняя попытка 'accepted'. Нет задач /
--     нет такого ДЗ — условие выполнено; нет ни того, ни другого — закрыт;
--   • % урока — существующий балл: последняя проверка принятой попытки ДЗ урока
--     (у «тренировки» его ставит _topic_autocheck_finish); шкала 'five' → ×20.
--
-- Одно определение — _progress_state(course, students[]): его зовут ворота
-- ученика, экран ученика и экран «Прохождение», поэтому они не расходятся.
-- Считается множествами (агрегаты и оконные функции), без вызовов на строку.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Режим курса
-- ─────────────────────────────────────────────────────────────────────────

create table public.course_unlock_modes (
  course_id  uuid primary key references public.courses(id) on delete cascade,
  mode       text not null default 'schedule' check (mode in ('schedule', 'progress')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.course_unlock_modes enable row level security;
create policy course_unlock_modes_read on public.course_unlock_modes
  for select to authenticated using (true);
revoke all on public.course_unlock_modes from anon, authenticated;
grant select on public.course_unlock_modes to authenticated;

create function public.course_is_progress(p_course_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.course_unlock_modes u
                  where u.course_id = p_course_id and u.mode = 'progress');
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Персональные отметки и их журнал
-- ─────────────────────────────────────────────────────────────────────────

create table public.student_topic_overrides (
  student_id uuid not null references public.students(id) on delete cascade,
  topic_id   uuid not null references public.topics(id) on delete cascade,
  state      text not null check (state in ('open', 'closed')),
  note       text,
  set_by     uuid references public.profiles(id) on delete set null,
  set_at     timestamptz not null default now(),
  primary key (student_id, topic_id)
);
create index student_topic_overrides_topic_idx on public.student_topic_overrides (topic_id);

create table public.student_topic_override_log (
  id         bigint generated always as identity primary key,
  student_id uuid not null,
  topic_id   uuid not null,
  old_state  text,
  new_state  text,
  note       text,
  action     text not null,
  actor      uuid,
  created_at timestamptz not null default now()
);
create index student_topic_override_log_idx on public.student_topic_override_log (student_id, topic_id, created_at desc);

-- Читают и пишут только definer-функции (проверка персонала — внутри).
alter table public.student_topic_overrides enable row level security;
alter table public.student_topic_override_log enable row level security;
revoke all on public.student_topic_overrides from anon, authenticated;
revoke all on public.student_topic_override_log from anon, authenticated;

-- Событие «открыт урок по прохождению» — для будущего Telegram (пишет часть B).
create table public.topic_unlock_events (
  student_id uuid not null references public.students(id) on delete cascade,
  topic_id   uuid not null references public.topics(id) on delete cascade,
  reason     text not null,
  opened_at  timestamptz not null default now(),
  notified_at timestamptz,
  primary key (student_id, topic_id)
);
alter table public.topic_unlock_events enable row level security;
revoke all on public.topic_unlock_events from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Одно определение состояния
-- ─────────────────────────────────────────────────────────────────────────

-- Ученики курса: группа курса + действующие student_courses (как в воротах).
create function public._course_student_ids(p_course_id uuid)
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct x.student_id), '{}'::uuid[]) from (
    select gs.student_id from public.group_students gs
      join public.groups g on g.id = gs.group_id
     where g.course_id = p_course_id
    union
    select sc.student_id from public.student_courses sc
     where sc.course_id = p_course_id and sc.status in ('active', 'trial')
       and (sc.expires_at is null or sc.expires_at > now())
  ) x;
$$;

create function public._progress_state(p_course_id uuid, p_student_ids uuid[])
returns table (
  student_id      uuid,
  topic_id        uuid,
  module_id       uuid,
  rn              int,
  closed          boolean,
  closed_at       timestamptz,
  open            boolean,
  open_reason     text,      -- manual | first2 | date | prev_closed | null
  autocheck_total int,
  autocheck_left  int,
  hw_state        text,      -- none | draft | submitted | returned | accepted (ДЗ второй части)
  percent         int,
  override_state  text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with t as (
    select tp.id as topic_id, tp.module_id, tp.available_from,
           (row_number() over (partition by tp.module_id order by tp.order_index, tp.id))::int as rn
      from public.topics tp
      join public.modules m on m.id = tp.module_id
     where m.course_id = p_course_id
  ),
  st as (
    select s.id as student_id, s.profile_id
      from public.students s
     where s.id = any (p_student_ids)
  ),
  tasks as (
    select k.id as task_id, k.topic_id from public.topic_autocheck_tasks k
     where k.topic_id in (select t.topic_id from t)
  ),
  -- по задаче: завершена (верно или 3 попытки) и когда
  ans as (
    select a.profile_id, a.task_id,
           (bool_or(a.is_correct) or count(*) >= 3) as done,
           max(a.created_at) as at
      from public.topic_autocheck_answers a
     where a.profile_id in (select st.profile_id from st)
       and a.task_id in (select tasks.task_id from tasks)
     group by a.profile_id, a.task_id
  ),
  ac as (
    select st.student_id, tasks.topic_id,
           count(*)::int as total,
           (count(*) filter (where not coalesce(ans.done, false)))::int as left_n,
           max(ans.at) filter (where ans.done) as at
      from st
      cross join tasks
      left join ans on ans.profile_id = st.profile_id and ans.task_id = tasks.task_id
     group by st.student_id, tasks.topic_id
  ),
  hw as (
    select h.id as homework_id, h.topic_id, h.autocheck, h.grade_scale, h.is_published
      from public.topic_homework h
     where h.topic_id in (select t.topic_id from t)
  ),
  last_att as (
    select distinct on (a.homework_id, a.student_id)
           a.homework_id, a.student_id, a.id as attempt_id, a.status::text as status
      from public.topic_homework_attempts a
     where a.homework_id in (select hw.homework_id from hw)
       and a.student_id in (select st.student_id from st)
     order by a.homework_id, a.student_id, a.attempt_number desc, a.created_at desc
  ),
  acc_review as (
    -- последняя проверка принятой попытки: балл и время
    select distinct on (la.homework_id, la.student_id)
           la.homework_id, la.student_id, r.score, r.created_at as at
      from last_att la
      join public.topic_homework_reviews r on r.attempt_id = la.attempt_id
     where la.status = 'accepted'
     order by la.homework_id, la.student_id, r.created_at desc, r.id desc
  ),
  base as (
    select st.student_id, t.topic_id, t.module_id, t.rn, t.available_from,
           coalesce(ac.total, 0) as ac_total,
           coalesce(ac.left_n, 0) as ac_left,
           ac.at as ac_at,
           -- ДЗ второй части: только опубликованное и не автопроверочное
           case when h2.homework_id is null then 'none'
                when la2.status is null then 'none'
                when la2.status = 'returned_for_revision' then 'returned'
                else la2.status end as hw_state,
           h2.homework_id is not null as has_hw2,
           rv2.at as hw2_at,
           -- % — балл ДЗ урока (любого: автопроверочного или второй части)
           case hx.grade_scale
             when 'hundred' then rvx.score
             when 'five' then rvx.score * 20
           end as percent,
           o.state as override_state
      from st
      cross join t
      left join ac on ac.student_id = st.student_id and ac.topic_id = t.topic_id
      left join hw h2 on h2.topic_id = t.topic_id and not coalesce(h2.autocheck, false) and h2.is_published
      left join last_att la2 on la2.homework_id = h2.homework_id and la2.student_id = st.student_id
      left join acc_review rv2 on rv2.homework_id = h2.homework_id and rv2.student_id = st.student_id
      left join hw hx on hx.topic_id = t.topic_id
      left join acc_review rvx on rvx.homework_id = hx.homework_id and rvx.student_id = st.student_id
      left join public.student_topic_overrides o on o.student_id = st.student_id and o.topic_id = t.topic_id
  ),
  cl as (
    select b.*,
           (b.ac_left = 0 and (not b.has_hw2 or b.hw_state = 'accepted')) as is_closed,
           -- «опора» — открыт сам по себе: отметка open, первые 2, наступила дата
           (coalesce(b.override_state = 'open', false) or b.rn <= 2
            or (b.available_from is not null and b.available_from <= current_date)) as anchor,
           b.override_state is distinct from 'closed' as allowed
      from base b
  ),
  -- Урок открывается «закрытием предыдущего», только если предыдущий был ОТКРЫТ
  -- и закрыт. Открытость рекурсивна, поэтому так: серия подряд идущих уроков,
  -- каждый закрыт и не закрыт вручную; в серии до предыдущего урока есть опора —
  -- значит, вся серия была открыта. Запертый пустой урок цепочку не продолжает.
  runs as (
    select c.*,
           not (c.is_closed and c.allowed) as brk,
           sum(case when c.is_closed and c.allowed then 0 else 1 end)
             over (partition by c.student_id, c.module_id order by c.rn rows unbounded preceding) as grp
      from cl c
  ),
  chained as (
    select r.*,
           bool_or(r.anchor and not r.brk)
             over (partition by r.student_id, r.module_id, r.grp order by r.rn rows unbounded preceding) as run_anchored
      from runs r
  ),
  seq as (
    select c.*,
           coalesce(lag(not c.brk and c.run_anchored)
                      over (partition by c.student_id, c.module_id order by c.rn), false) as prev_closed
      from chained c
  )
  select s.student_id, s.topic_id, s.module_id, s.rn,
         s.is_closed,
         case when s.is_closed then
           nullif(greatest(coalesce(s.ac_at, '-infinity'::timestamptz),
                           coalesce(s.hw2_at, '-infinity'::timestamptz)), '-infinity'::timestamptz)
         end,
         (s.allowed and (s.anchor or s.prev_closed)),
         case when not s.allowed then null
              when s.override_state = 'open' then 'manual'
              when s.rn <= 2 then 'first2'
              when s.available_from is not null and s.available_from <= current_date then 'date'
              when s.prev_closed then 'prev_closed'
         end,
         s.ac_total, s.ac_left, s.hw_state, s.percent, s.override_state
    from seq s;
$$;

-- Открытые ученику уроки всех его курсов с 'progress' — один раз на запрос.
create function public.student_progress_open_topics()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  -- состояние считается только по курсам в 'progress' (у большинства учеников их нет)
  select coalesce(array_agg(ps.topic_id), '{}'::uuid[])
    from (select c.course_id from unnest(public.student_access_courses()) as c(course_id)
           where public.course_is_progress(c.course_id)) pc
    cross join lateral public._progress_state(pc.course_id, array[public.auth_student_id()]) ps
   where ps.open;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Экран ученика: замки урока курса
--    Ученику — его состояние; персоналу курса — «ученик с нулевым прогрессом»
--    без отметок (превью «глазами ученика»). Курс 'schedule' — mode и пусто.
-- ─────────────────────────────────────────────────────────────────────────

create function public.my_course_topic_locks(p_course_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid := public.auth_student_id();
  v_staff   boolean := public.course_is_staff(p_course_id);
begin
  if not public.course_is_progress(p_course_id) then
    return jsonb_build_object('mode', 'schedule', 'topics', '[]'::jsonb);
  end if;
  if not v_staff and (v_student is null or not public.course_student_has_access(p_course_id)) then
    raise exception 'Нет доступа к курсу' using errcode = '42501';
  end if;

  return jsonb_build_object('mode', 'progress', 'preview', v_staff and v_student is null, 'topics', coalesce((
    with s as (
      select ps.topic_id, ps.module_id, ps.rn, ps.open, ps.open_reason, ps.closed, ps.percent
        from public._progress_state(p_course_id, array[v_student]) ps
       where not v_staff or v_student is not null
      union all
      -- превью персонала: первые 2 и даты, без прогресса и отметок
      select t.id, t.module_id, t.rn,
             (t.rn <= 2 or (t.available_from is not null and t.available_from <= current_date)),
             case when t.rn <= 2 then 'first2'
                  when t.available_from is not null and t.available_from <= current_date then 'date' end,
             false, null::int
        from (select tp.id, tp.module_id, tp.available_from,
                     (row_number() over (partition by tp.module_id order by tp.order_index, tp.id))::int as rn
                from public.topics tp join public.modules m on m.id = tp.module_id
               where m.course_id = p_course_id) t
       where v_staff and v_student is null
    )
    select jsonb_agg(jsonb_build_object(
             'topic_id', s.topic_id,
             'title', tp.title,
             'open', s.open,
             'reason', s.open_reason,
             'closed', s.closed,
             'percent', s.percent,
             'after_topic_id', p.id,
             'after_title', p.title,
             'opens_on', tp.available_from
           ) order by s.module_id, s.rn)
      from s
      join public.topics tp on tp.id = s.topic_id
      left join lateral (
        select pt.id, pt.title from public.topics pt
         where pt.module_id = s.module_id
           and (pt.order_index, pt.id) < (tp.order_index, tp.id)
         order by pt.order_index desc, pt.id desc limit 1
      ) p on true
  ), '[]'::jsonb));
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Экран «Прохождение» (персонал курса)
--    Ячейка — массив [state, reason, autocheck_left, hw_state, percent, override]:
--    state ∈ closed | pending_review | open | locked.
-- ─────────────────────────────────────────────────────────────────────────

create function public.course_progress_matrix(p_course_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_students uuid[];
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Только для персонала курса' using errcode = '42501', hint = 'ONLY_STAFF';
  end if;
  v_students := public._course_student_ids(p_course_id);

  return (
    with ps as materialized (
      select * from public._progress_state(p_course_id, v_students)
    ),
    tp as (
      select t.id, t.title, t.module_id, m.title as module_title, m.order_index as m_ord, t.order_index
        from public.topics t join public.modules m on m.id = t.module_id
       where m.course_id = p_course_id
    )
    select jsonb_build_object(
      'mode', case when public.course_is_progress(p_course_id) then 'progress' else 'schedule' end,
      'topics', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', tp.id, 'title', tp.title, 'module_id', tp.module_id, 'module_title', tp.module_title)
                  order by tp.m_ord, tp.module_id, tp.order_index, tp.id) from tp), '[]'::jsonb),
      'students', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', s.id, 'full_name', pr.full_name, 'email', pr.email,
                 'last_closed_at', (select max(x.closed_at) from ps x where x.student_id = s.id and x.open),
                 'closed', (select count(*) from ps x where x.student_id = s.id and x.closed and x.open),
                 'cells', (select jsonb_agg(jsonb_build_array(
                              -- закрыть можно только открытый урок: «пустой» урок за
                              -- будущей датой формально закрыт, но для ученика заперт
                              case when not x.open then 'locked'
                                   when x.closed then 'closed'
                                   when x.hw_state = 'submitted' then 'pending_review'
                                   else 'open' end,
                              x.open_reason, x.autocheck_left, x.hw_state, x.percent, x.override_state)
                              order by tp.m_ord, tp.module_id, tp.order_index, tp.id)
                             from tp join ps x on x.topic_id = tp.id and x.student_id = s.id))
               order by pr.full_name, s.id)
          from public.students s join public.profiles pr on pr.id = s.profile_id
         where s.id = any (v_students)), '[]'::jsonb)
    )
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Ручные действия персонала
-- ─────────────────────────────────────────────────────────────────────────

-- Одна отметка: p_state 'open' | 'closed' | null (снять). Ученик — курса этого урока.
create function public.staff_topic_override_set(p_student_id uuid, p_topic_id uuid, p_state text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_course uuid := public.course_of_topic(p_topic_id);
  v_old    text;
begin
  if v_course is null or not public.course_is_staff(v_course) then
    raise exception 'Только для персонала курса' using errcode = '42501', hint = 'ONLY_STAFF';
  end if;
  if p_state is not null and p_state not in ('open', 'closed') then
    raise exception 'Отметка: open, closed или пусто' using errcode = '22023';
  end if;
  if not (p_student_id = any (public._course_student_ids(v_course))) then
    raise exception 'Ученик не в этом курсе' using errcode = 'P0001', hint = 'NOT_IN_COURSE';
  end if;
  select o.state into v_old from public.student_topic_overrides o
   where o.student_id = p_student_id and o.topic_id = p_topic_id for update;
  if p_state is null then
    delete from public.student_topic_overrides where student_id = p_student_id and topic_id = p_topic_id;
  else
    insert into public.student_topic_overrides (student_id, topic_id, state, note, set_by, set_at)
    values (p_student_id, p_topic_id, p_state, nullif(btrim(p_note), ''), auth.uid(), now())
    on conflict (student_id, topic_id) do update
       set state = excluded.state, note = excluded.note, set_by = excluded.set_by, set_at = excluded.set_at;
  end if;
  insert into public.student_topic_override_log (student_id, topic_id, old_state, new_state, note, action, actor)
  values (p_student_id, p_topic_id, v_old, p_state, nullif(btrim(p_note), ''), 'set', auth.uid());
  return jsonb_build_object('state', p_state, 'was', v_old);
end $$;

-- «Открыть урок всем ученикам курса».
create function public.staff_topic_open_for_course(p_topic_id uuid, p_note text default null)
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_course uuid := public.course_of_topic(p_topic_id);
  v_n      int;
begin
  if v_course is null or not public.course_is_staff(v_course) then
    raise exception 'Только для персонала курса' using errcode = '42501', hint = 'ONLY_STAFF';
  end if;
  with ids as (select unnest(public._course_student_ids(v_course)) as student_id),
  old as (
    select ids.student_id, o.state from ids
      left join public.student_topic_overrides o on o.student_id = ids.student_id and o.topic_id = p_topic_id
  ),
  up as (
    insert into public.student_topic_overrides (student_id, topic_id, state, note, set_by, set_at)
    select ids.student_id, p_topic_id, 'open', nullif(btrim(p_note), ''), auth.uid(), now() from ids
    on conflict (student_id, topic_id) do update
       set state = 'open', note = excluded.note, set_by = excluded.set_by, set_at = excluded.set_at
    returning student_id
  )
  insert into public.student_topic_override_log (student_id, topic_id, old_state, new_state, note, action, actor)
  select up.student_id, p_topic_id, old.state, 'open', nullif(btrim(p_note), ''), 'open_for_course', auth.uid()
    from up join old on old.student_id = up.student_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- «Открыть ученику весь раздел».
create function public.staff_module_open_for_student(p_student_id uuid, p_module_id uuid, p_note text default null)
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_course uuid := (select m.course_id from public.modules m where m.id = p_module_id);
  v_n      int;
begin
  if v_course is null or not public.course_is_staff(v_course) then
    raise exception 'Только для персонала курса' using errcode = '42501', hint = 'ONLY_STAFF';
  end if;
  if not (p_student_id = any (public._course_student_ids(v_course))) then
    raise exception 'Ученик не в этом курсе' using errcode = 'P0001', hint = 'NOT_IN_COURSE';
  end if;
  with tps as (select t.id as topic_id from public.topics t where t.module_id = p_module_id),
  old as (
    select tps.topic_id, o.state from tps
      left join public.student_topic_overrides o on o.student_id = p_student_id and o.topic_id = tps.topic_id
  ),
  up as (
    insert into public.student_topic_overrides (student_id, topic_id, state, note, set_by, set_at)
    select p_student_id, tps.topic_id, 'open', nullif(btrim(p_note), ''), auth.uid(), now() from tps
    on conflict (student_id, topic_id) do update
       set state = 'open', note = excluded.note, set_by = excluded.set_by, set_at = excluded.set_at
    returning topic_id
  )
  insert into public.student_topic_override_log (student_id, topic_id, old_state, new_state, note, action, actor)
  select p_student_id, up.topic_id, old.state, 'open', nullif(btrim(p_note), ''), 'open_module', auth.uid()
    from up join old on old.topic_id = up.topic_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Переключение режима курса — только админ/владелец платформы.
create function public.admin_course_unlock_mode_set(p_course_id uuid, p_mode text)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_or_owner() then
    raise exception 'Только для администратора' using errcode = '42501', hint = 'ONLY_ADMIN';
  end if;
  if p_mode not in ('schedule', 'progress') then
    raise exception 'Режим: schedule или progress' using errcode = '22023';
  end if;
  insert into public.course_unlock_modes (course_id, mode, updated_at, updated_by)
  values (p_course_id, p_mode, now(), auth.uid())
  on conflict (course_id) do update set mode = excluded.mode, updated_at = now(), updated_by = auth.uid();
  return p_mode;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Права на функции
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public._course_student_ids(uuid)',
    'public._progress_state(uuid, uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.course_is_progress(uuid)',
    'public.student_progress_open_topics()',
    'public.my_course_topic_locks(uuid)',
    'public.course_progress_matrix(uuid)',
    'public.staff_topic_override_set(uuid, uuid, text, text)',
    'public.staff_topic_open_for_course(uuid, text)',
    'public.staff_module_open_for_student(uuid, uuid, text)',
    'public.admin_course_unlock_mode_set(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
