-- No roster row means the existing whole-group assignment. A roster row
-- records the selection, so later enrolments do not inherit the exam.
create table public.mock_exam_rosters (
  mock_exam_id uuid primary key references public.mock_exams(id) on delete cascade,
  student_ids uuid[] not null
);

alter table public.mock_exam_rosters enable row level security;
revoke all on public.mock_exam_rosters from public, anon, authenticated;
grant select on public.mock_exam_rosters to authenticated;

create policy mock_exam_rosters_staff_select on public.mock_exam_rosters
  for select to authenticated using (public.mock_exam_is_staff(mock_exam_id));

comment on table public.mock_exam_rosters is
  'Explicit selection of mock exam participants. Exams without a row keep their group roster.';

-- Internal to the database. Client reads of the saved selection use the
-- staff-only relation above.
create view public.mock_exam_members as
  select e.id as mock_exam_id, gs.student_id
    from public.mock_exams e
    join public.group_students gs on gs.group_id = e.group_id
    left join public.mock_exam_rosters r on r.mock_exam_id = e.id
   where r.mock_exam_id is null or gs.student_id = any(r.student_ids);

revoke all on public.mock_exam_members from public, anon, authenticated;

create function public.mock_exam_is_participant(p_mock_exam_id uuid, p_student_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select (p_student_id = public.auth_student_id() or public.mock_exam_is_staff(p_mock_exam_id))
     and exists (select 1 from public.mock_exam_members m
                  where m.mock_exam_id = p_mock_exam_id and m.student_id = p_student_id);
$$;

revoke all on function public.mock_exam_is_participant(uuid, uuid) from public, anon;
grant execute on function public.mock_exam_is_participant(uuid, uuid) to authenticated;

create function public.mock_exam_assigned_to_me(p_mock_exam_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.mock_exam_members m
    join public.mock_exams e on e.id = m.mock_exam_id
    join public.students s on s.id = m.student_id
    left join public.mock_exam_rosters r on r.mock_exam_id = e.id
    where m.mock_exam_id = p_mock_exam_id and s.profile_id = auth.uid()
      and (r.mock_exam_id is null or e.starts_at is not null)
  );
$$;

revoke all on function public.mock_exam_assigned_to_me(uuid) from public, anon;
grant execute on function public.mock_exam_assigned_to_me(uuid) to authenticated;

drop policy mock_exams_select on public.mock_exams;
create policy mock_exams_select on public.mock_exams for select to authenticated using (
  public.is_admin_or_owner()
  or public.mock_exam_group_is_staff(group_id)
  or (group_id is null and public.mock_exam_is_my_teacher(created_by))
  or public.mock_exam_assigned_to_me(id)
);

create function public._check_mock_exam_roster(p_group_id uuid, p_student_ids uuid[], p_starts_at timestamptz)
returns void
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  if p_group_id is null or p_student_ids is null
     or (p_starts_at is not null and cardinality(p_student_ids) = 0)
     or cardinality(p_student_ids) <> (select count(distinct id) from unnest(p_student_ids) ids(id))
     or exists (
       select 1 from unnest(p_student_ids) ids(id)
        where not exists (select 1 from public.group_students gs
                           where gs.group_id = p_group_id and gs.student_id = ids.id)
     ) then
    raise exception 'Состав группы изменился или список пуст. Обновите список участников.' using errcode = '23514';
  end if;
end;
$$;

revoke all on function public._check_mock_exam_roster(uuid, uuid[], timestamptz) from public, anon, authenticated;

create function public.create_mock_exams_for_participants(p_exams jsonb)
returns table(id uuid, group_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  entry record;
  v_exam_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Нет доступа к назначению пробников' using errcode = '42501';
  end if;
  if p_exams is null or jsonb_array_length(p_exams) = 0 then
    raise exception 'Выберите группу и её участников' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_exams) as exams(group_id uuid)
     group by exams.group_id having count(*) > 1
  ) then
    raise exception 'Группа может быть выбрана один раз' using errcode = '23514';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_exams) as exams(student_ids uuid[])
      cross join lateral unnest(exams.student_ids) participants(student_id)
     group by participants.student_id
    having count(*) > 1
  ) then
    raise exception 'Ученик может быть назначен только в одной группе' using errcode = '23514';
  end if;
  for entry in
    select me.*, roster.student_ids
      from jsonb_array_elements(p_exams) as input(row_data)
      cross join lateral jsonb_populate_record(null::public.mock_exams, input.row_data) me
      cross join lateral jsonb_to_record(input.row_data) as roster(student_ids uuid[])
  loop
    if (public.is_admin_or_owner() or (
      public.mock_exam_group_can_manage(entry.group_id)
      and (entry.created_by is null or public.mock_exam_is_my_teacher(entry.created_by))
    )) is not true then
      raise exception 'Нет доступа к назначению пробника в этой группе' using errcode = '42501';
    end if;
    perform public._check_mock_exam_roster(entry.group_id, entry.student_ids, entry.starts_at);
    -- Initialise the roster before scheduling so no reminder targets the whole group.
    insert into public.mock_exams as e (
      title, subject, exam_type, date, group_id, template_id, max_score, created_by, duration_minutes, variant_mode
    ) values (
      entry.title, entry.subject, entry.exam_type, entry.date, entry.group_id, entry.template_id, entry.max_score,
      entry.created_by, entry.duration_minutes, coalesce(entry.variant_mode, 'order')
    ) returning e.id into v_exam_id;
    insert into public.mock_exam_rosters (mock_exam_id, student_ids) values (v_exam_id, entry.student_ids);
    if entry.starts_at is not null then
      update public.mock_exams e set starts_at = entry.starts_at where e.id = v_exam_id;
    end if;
    id := v_exam_id;
    group_id := entry.group_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.create_mock_exams_for_participants(jsonb) from public, anon;
grant execute on function public.create_mock_exams_for_participants(jsonb) to authenticated;

create function public.save_mock_exam_participant_settings(p_mock_exam_id uuid, p_settings jsonb, p_student_ids uuid[])
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  saved public.mock_exams;
  changes public.mock_exams;
begin
  select e.* into saved from public.mock_exams e where e.id = p_mock_exam_id
    and auth.uid() is not null
    and (public.is_admin_or_owner() or public.mock_exam_group_can_manage(e.group_id))
    for update;
  if not found then
    raise exception 'Нет доступа к настройке пробника' using errcode = '42501';
  end if;

  changes := jsonb_populate_record(saved, p_settings);
  if changes.group_id is distinct from saved.group_id and (
    public.is_admin_or_owner() or public.mock_exam_group_can_manage(changes.group_id)
  ) is not true then
    raise exception 'Нет доступа к этой группе' using errcode = '42501';
  end if;
  if saved.starts_at <= now()
     or exists (select 1 from public.mock_exam_task_scores x where x.mock_exam_id = saved.id)
     or exists (select 1 from public.mock_exam_results x where x.mock_exam_id = saved.id)
     or exists (select 1 from public.mock_exam_sheets x where x.mock_exam_id = saved.id)
     or exists (select 1 from public.mock_exam_photos x where x.mock_exam_id = saved.id) then
    raise exception 'Список участников можно изменить до начала пробника' using errcode = '23514';
  end if;

  perform public._check_mock_exam_roster(changes.group_id, p_student_ids, changes.starts_at);
  insert into public.mock_exam_rosters (mock_exam_id, student_ids)
    values (saved.id, p_student_ids)
    on conflict (mock_exam_id) do update set student_ids = excluded.student_ids;
  delete from public.mock_exam_variant_students v
   where v.mock_exam_id = saved.id and not (v.student_id = any(p_student_ids));
  update public.mock_exams e
     set title = changes.title, date = changes.date, group_id = changes.group_id,
         starts_at = changes.starts_at, duration_minutes = changes.duration_minutes,
         template_id = changes.template_id, variant_mode = changes.variant_mode
   where e.id = saved.id
   returning e.* into changes;
  if (saved.starts_at, saved.duration_minutes, saved.group_id, saved.title)
      is not distinct from (changes.starts_at, changes.duration_minutes, changes.group_id, changes.title) then
    perform public._reschedule_mock_exam_notifications(saved.id, changes);
  end if;
end;
$$;

revoke all on function public.save_mock_exam_participant_settings(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.save_mock_exam_participant_settings(uuid, jsonb, uuid[]) to authenticated;

create function public.mock_exam_roster_schedule_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  roster uuid[];
begin
  if new.group_id is distinct from old.group_id or (old.starts_at is null and new.starts_at is not null) then
    select r.student_ids into roster from public.mock_exam_rosters r where r.mock_exam_id = new.id;
    if found then
      perform public._check_mock_exam_roster(new.group_id, roster, new.starts_at);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.mock_exam_roster_schedule_guard() from public, anon, authenticated;

create trigger mock_exam_roster_schedule_guard before update of group_id, starts_at on public.mock_exams
  for each row execute function public.mock_exam_roster_schedule_guard();

-- Use the same roster for student access, reminders, and staff workflow.
create function public._reschedule_mock_exam_notifications(p_mock_exam_id uuid, v_exam public.mock_exams)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_now     timestamptz := now();
  v_ends    timestamptz;
  v_until   timestamptz;
  v_epoch   bigint;
  v_payload jsonb;
begin
  update public.notification_queue q
     set status = 'cancelled'
   where q.entity_type = 'mock_exam'
     and q.entity_id = p_mock_exam_id
     and q.event_type in ('mock_exam_soon', 'mock_exam_started')
     and q.status = 'pending';
  if v_exam is null or v_exam.starts_at is null or v_exam.group_id is null or v_exam.starts_at <= v_now then
    return;
  end if;

  v_ends  := v_exam.starts_at + make_interval(mins => v_exam.duration_minutes);
  v_until := v_ends + make_interval(mins => v_exam.photo_grace_minutes);
  v_epoch := floor(extract(epoch from v_exam.starts_at))::bigint;
  v_payload := jsonb_build_object(
    'title',        v_exam.title,
    'exam_id',      v_exam.id,
    'group_id',     v_exam.group_id,
    'starts_at',    v_exam.starts_at,
    'ends_at',      v_ends,
    'photos_until', v_until,
    'link',         '/my-course/' || v_exam.group_id || '?mock=' || v_exam.id,
    'button_text',  'Открыть пробник'
  );

  insert into public.notification_queue as q
         (profile_id, channel, event_type, entity_type, entity_id,
          deduplication_key, payload, status, scheduled_for)
  select s.profile_id, 'telegram', ev.event_type, 'mock_exam', v_exam.id,
         ev.event_type || ':' || v_exam.id || ':' || v_epoch || ':' || s.profile_id,
         v_payload, 'pending'::public.notification_queue_status, ev.at
    from public.mock_exam_members gs
    join public.students s on s.id = gs.student_id and s.profile_id is not null
    cross join (values ('mock_exam_soon',    v_exam.starts_at - interval '1 hour'),
                       ('mock_exam_started', v_exam.starts_at)) as ev(event_type, at)
   where gs.mock_exam_id = v_exam.id
     and ev.at > v_now
  on conflict (deduplication_key) do update
     set payload       = excluded.payload,
         scheduled_for = excluded.scheduled_for,
         status        = 'pending',
         attempts      = 0
   where q.status = 'cancelled';
end;
$$;

revoke all on function public._reschedule_mock_exam_notifications(uuid, public.mock_exams) from public, anon, authenticated;

create or replace function public.mock_exam_schedule_notifications()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public._reschedule_mock_exam_notifications(old.id, null::public.mock_exams);
  elsif tg_op = 'INSERT'
     or (old.starts_at, old.duration_minutes, old.group_id, old.title, old.photo_grace_minutes)
         is distinct from (new.starts_at, new.duration_minutes, new.group_id, new.title, new.photo_grace_minutes) then
    perform public._reschedule_mock_exam_notifications(new.id, new);
  end if;
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION public.mock_exam_my_student_id(p_mock_exam_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select s.id
    from public.mock_exams me
    join public.mock_exam_members gs on gs.mock_exam_id = me.id
    join public.students s on s.id = gs.student_id
    join public.groups g on g.id = me.group_id
   where me.id = p_mock_exam_id and s.profile_id = auth.uid()
     and (not exists (select 1 from public.subscription_tariffs t where t.course_id = g.course_id)
          or public.subscription_access_ok(s.id, g.course_id))
   limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.my_mock_exams(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              me.id,
           'title',           me.title,
           'module_id',       me.module_id,
           'module_position', me.module_position,
           'starts_at',       w.starts_at,
           'ends_at',         w.ends_at,
           'photos_until',    w.photos_until,
           'duration_minutes', me.duration_minutes,
           'submitted_at',    sh.submitted_at,
           'has_work',        sh.submitted_at is not null
                              or exists (select 1 from unnest(sh.answers) a where nullif(btrim(a), '') is not null)
                              or exists (select 1 from public.mock_exam_photos ph
                                          where ph.mock_exam_id = me.id and ph.student_id = s.id),
           'notified',        r.notified_at is not null and now() >= w.ends_at,
           'score',           case when r.notified_at is not null and now() >= w.ends_at then r.score end,
           'max_score',       case when r.notified_at is not null and now() >= w.ends_at then me.max_score end,
           'server_now',      now()
         ) order by me.starts_at), '[]'::jsonb)
    from public.mock_exams me
    join public.mock_exam_members gs on gs.mock_exam_id = me.id
    join public.students s on s.id = gs.student_id and s.profile_id = auth.uid()
    cross join lateral public.mock_exam_window(me.id) w
    left join public.mock_exam_sheets sh on sh.mock_exam_id = me.id and sh.student_id = s.id
    left join public.mock_exam_results r on r.mock_exam_id = me.id and r.student_id = s.id
   where me.group_id = p_group_id
     and me.starts_at is not null;
$function$;

CREATE OR REPLACE FUNCTION public.my_course_assessments(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_student uuid;
  v_course  uuid;
  v_now     timestamptz := now();
  v_works   jsonb;
  v_mocks   jsonb;
begin
  select s.id, g.course_id
    into v_student, v_course
    from public.groups g
    join public.group_students gs on gs.group_id = g.id
    join public.students s on s.id = gs.student_id
   where g.id = p_group_id
     and s.profile_id = auth.uid()
   limit 1;
  if v_student is null then
    raise exception 'Это не ваша группа' using errcode = '42501';
  end if;
  with roster as (
    select gs.student_id from public.group_students gs where gs.group_id = p_group_id
  ),
  w as (
    select t.id as topic_id, t.title, t.kind, t.order_index as topic_order,
           t.is_open, t.available_from,
           m.id as module_id, m.title as module_title, m.order_index as module_order,
           h.id as homework_id, h.grade_scale
      from public.topics t
      join public.modules m on m.id = t.module_id
      left join public.topic_homework h on h.topic_id = t.id and h.is_published
     where m.course_id = v_course
       and t.kind in ('check', 'control')
  ),
  last_att as (
    select distinct on (a.homework_id, a.student_id)
           a.id, a.homework_id, a.student_id, a.status, a.submitted_at, a.auto_submitted
      from public.topic_homework_attempts a
      join roster r on r.student_id = a.student_id
     where a.homework_id in (select w.homework_id from w where w.homework_id is not null)
     order by a.homework_id, a.student_id, a.attempt_number desc
  ),
  verdict as (
    select la.homework_id, la.student_id, la.id as attempt_id,
           rv.decision::text as decision, rv.score, rv.created_at
      from last_att la
      join lateral (
        select r.decision, r.score, r.created_at
          from public.topic_homework_reviews r
         where r.attempt_id = la.id
         order by r.created_at desc
         limit 1
      ) rv on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'topic_id',       w.topic_id,
           'homework_id',    w.homework_id,
           'kind',           w.kind,
           'title',          w.title,
           'module_id',      w.module_id,
           'module_title',   w.module_title,
           'topic_open',     public.topic_open_with((select public.progress_open_by_student(null, array[v_student])), v_student::text || ':' || w.topic_id::text, w.is_open, w.available_from),
           'available_from', w.available_from,
           'grade_scale',    w.grade_scale,
           'opens_at',       win.opens_at,
           'closes_at',      win.closes_at,
           'personal',       coalesce(win.personal, false),
           'status',         case
                               when la.id is null then 'none'
                               when la.status = 'draft' then 'draft'
                               when v.attempt_id is not null then 'reviewed'
                               when la.auto_submitted then 'auto_submitted'
                               else 'submitted'
                             end,
           'submitted_at',   la.submitted_at,
           'reviewed_at',    v.created_at,
           'score',          case when v.decision = 'accepted' then v.score end,
           'tasks',          case when v.attempt_id is not null then (
                               select jsonb_agg(jsonb_build_object('no', rt.no, 'verdict', rt.verdict)
                                                order by rt.position, rt.no)
                                 from public.topic_homework_review_tasks rt
                                where rt.attempt_id = la.id) end,
           'group',          case when v.decision = 'accepted' and v.score is not null and gs.peers >= 3 then
                               jsonb_build_object(
                                 'avg',        round(gs.avg_all, 1),
                                 'count',      gs.n_all,
                                 'submitted',  gs.submitted,
                                 'in_group',   (select count(*) from roster),
                                 'better_pct', nullif(floor(100.0 * gs.lower / gs.peers)::int, 0),
                                 'best',       gs.higher = 0)
                             end
         ) order by w.module_order, w.topic_order, w.title), '[]'::jsonb)
    into v_works
    from w
    left join lateral public.topic_homework_student_window(w.homework_id, v_student) win on w.homework_id is not null
    left join last_att la on la.homework_id = w.homework_id and la.student_id = v_student
    left join verdict v on v.homework_id = w.homework_id and v.student_id = v_student
    left join lateral (
      select count(*) filter (where g.student_id <> v_student)                  as peers,
             count(*) filter (where g.student_id <> v_student and g.score < v.score) as lower,
             count(*) filter (where g.student_id <> v_student and g.score > v.score) as higher,
             avg(g.score)                                                         as avg_all,
             count(*)                                                             as n_all,
             (select count(*) from last_att s2
               where s2.homework_id = w.homework_id and s2.status <> 'draft')    as submitted
        from verdict g
       where g.homework_id = w.homework_id
         and g.decision = 'accepted'
         and g.score is not null
    ) gs on w.homework_id is not null;
  with mx as (
    select me.id, me.title, me.max_score, me.duration_minutes,
           w.starts_at, w.ends_at, w.photos_until,
           sh.submitted_at,
           sh.submitted_at is not null
             or exists (select 1 from unnest(sh.answers) a where nullif(btrim(a), '') is not null)
             or exists (select 1 from public.mock_exam_photos ph
                         where ph.mock_exam_id = me.id and ph.student_id = v_student) as has_work,
           r.notified_at is not null and v_now >= w.ends_at as visible,
           r.score, r.primary_score, r.part1_score, r.part2_score,
           (select sum(x)::int from unnest(t.max_points) x) as primary_max
      from public.mock_exams me
      join public.mock_exam_members member on member.mock_exam_id = me.id and member.student_id = v_student
      cross join lateral public.mock_exam_window(me.id) w
      left join public.mock_exam_templates t on t.id = me.template_id
      left join public.mock_exam_sheets sh on sh.mock_exam_id = me.id and sh.student_id = v_student
      left join public.mock_exam_results r on r.mock_exam_id = me.id and r.student_id = v_student
     where me.group_id = p_group_id
       and me.starts_at is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               m.id,
           'title',            m.title,
           'starts_at',        m.starts_at,
           'ends_at',          m.ends_at,
           'photos_until',     m.photos_until,
           'duration_minutes', m.duration_minutes,
           'submitted_at',     m.submitted_at,
           'has_work',         m.has_work,
           'notified',         m.visible,
           'score',            case when m.visible then m.score end,
           'max_score',        case when m.visible then m.max_score end,
           'primary_score',    case when m.visible then m.primary_score end,
           'primary_max',      case when m.visible then m.primary_max end,
           'part1_score',      case when m.visible then m.part1_score end,
           'part2_score',      case when m.visible then m.part2_score end,
           'prev_score',       case when m.visible and m.score is not null then (
                                 select p.score from mx p
                                  where p.visible and p.score is not null and p.starts_at < m.starts_at
                                  order by p.starts_at desc limit 1) end,
           'group',            case when m.visible and m.score is not null and gs.peers >= 3 then
                                 jsonb_build_object(
                                   'avg',        round(gs.avg_all, 1),
                                   'count',      gs.n_all,
                                   'better_pct', nullif(floor(100.0 * gs.lower / gs.peers)::int, 0),
                                   'best',       gs.higher = 0)
                               end,
           'server_now',       v_now
         ) order by m.starts_at), '[]'::jsonb)
    into v_mocks
    from mx m
    left join lateral (
      select count(*) filter (where r2.student_id <> v_student)                    as peers,
             count(*) filter (where r2.student_id <> v_student and r2.score < m.score) as lower,
             count(*) filter (where r2.student_id <> v_student and r2.score > m.score) as higher,
             avg(r2.score)                                                          as avg_all,
             count(*)                                                               as n_all
        from public.mock_exam_results r2
        join public.mock_exam_members ro on ro.mock_exam_id = m.id and ro.student_id = r2.student_id
       where r2.mock_exam_id = m.id
         and r2.score is not null
    ) gs on m.visible;
  return jsonb_build_object(
    'server_now', v_now,
    'course_id',  v_course,
    'works',      v_works,
    'mocks',      v_mocks
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_active_works(p_student_id uuid)
 RETURNS TABLE(kind text, work_kind text, homework_id uuid, mock_exam_id uuid, topic_id uuid, course_id uuid, group_id uuid, title text, opens_at timestamp with time zone, closes_at timestamp with time zone, personal boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with eligible_timed as materialized (
    select h.id as homework_id, t.id as topic_id, t.kind as work_kind,
           m.course_id, t.title, t.is_open, t.available_from,
           w.opens_at, w.closes_at, w.personal
    from public.topic_homework h
    join public.topics t on t.id = h.topic_id and t.kind in ('check', 'control')
    join public.modules m on m.id = t.module_id
   cross join lateral public.topic_homework_student_window(h.id, p_student_id) w
   where p_student_id is not null
     and h.is_published
     and ((h.opens_at <= now() and now() < h.closes_at)
          or exists (select 1 from public.topic_homework_personal_windows pw
                      where pw.homework_id = h.id and pw.student_id = p_student_id))
     and w.opens_at <= now() and now() < w.closes_at
     and (exists (select 1 from public.group_students gs
                    join public.groups g on g.id = gs.group_id
                   where gs.student_id = p_student_id and g.course_id = m.course_id)
          or exists (select 1 from public.student_courses sc
                      where sc.student_id = p_student_id and sc.course_id = m.course_id
                        and sc.status in ('active', 'trial')
                        and (sc.expires_at is null or sc.expires_at > now())))
     and not exists (select 1 from public.topic_homework_attempts a
                      where a.homework_id = h.id and a.student_id = p_student_id and a.status <> 'draft')

  ),
  progress as materialized (
    -- Do not calculate course progress when no timed work can be active.
    select public.progress_open_by_student(null, array[p_student_id]) as state
     where exists (select 1 from eligible_timed)
  )
  select 'timed'::text, e.work_kind, e.homework_id, null::uuid, e.topic_id, e.course_id,
         (select g.id from public.groups g
            join public.group_students gs on gs.group_id = g.id
           where g.course_id = e.course_id and gs.student_id = p_student_id
           limit 1),
         e.title, e.opens_at, e.closes_at, e.personal
    from eligible_timed e
   cross join progress p
   where public.topic_open_with(p.state, p_student_id::text || ':' || e.topic_id::text,
                                e.is_open, e.available_from)
  union all
  select 'mock'::text, 'mock'::text, null::uuid, me.id, null::uuid, g.course_id, me.group_id,
         me.title, w.starts_at, w.ends_at, false
    from public.mock_exams me
    join public.mock_exam_members gs on gs.mock_exam_id = me.id and gs.student_id = p_student_id
    join public.groups g on g.id = me.group_id
   cross join lateral public.mock_exam_window(me.id) w
   where p_student_id is not null
     and me.starts_at is not null
     and w.starts_at <= now() and now() < w.ends_at
     and not exists (select 1 from public.mock_exam_sheets sh
                      where sh.mock_exam_id = me.id and sh.student_id = p_student_id
                        and sh.submitted_at is not null);
$function$;

CREATE OR REPLACE FUNCTION public.mock_exam_live(p_mock_exam_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_exam record;
  v_w    record;
  v_now  timestamptz := now();
  v_open boolean;
begin
  if not public.mock_exam_is_staff(p_mock_exam_id) then
    raise exception 'Нет доступа к этому пробнику' using errcode = '42501';
  end if;
  select me.id, me.title, me.group_id, t.part1_last
    into v_exam
    from public.mock_exams me
    left join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  select * into v_w from public.mock_exam_window(p_mock_exam_id);
  v_open := v_w.starts_at is not null and v_now >= v_w.starts_at and v_now < v_w.ends_at;

  return jsonb_build_object(
    'id',           v_exam.id,
    'title',        v_exam.title,
    'group_id',     v_exam.group_id,
    'starts_at',    v_w.starts_at,
    'ends_at',      v_w.ends_at,
    'photos_until', v_w.photos_until,
    'server_now',   v_now,
    'part1_last',   v_exam.part1_last,
    'students',     (
      select coalesce(jsonb_agg(jsonb_build_object(
               'student_id',   s.id,
               'name',         coalesce(nullif(btrim(p.full_name), ''), '—'),
               'has_sheet',    sh.student_id is not null,
               'opened_at',    coalesce(sh.opened_at, sh.created_at),
               'last_seen_at', sh.last_seen_at,
               'online',       v_open and sh.last_seen_at is not null
                                 and sh.last_seen_at >= v_now - interval '75 seconds',
               'answered',     coalesce((select count(*) from unnest(sh.answers) a
                                          where nullif(btrim(a), '') is not null), 0),
               'submitted_at', sh.submitted_at,
               'photos',       (select count(*) from public.mock_exam_photos ph
                                 where ph.mock_exam_id = p_mock_exam_id and ph.student_id = s.id)
             ) order by p.full_name), '[]'::jsonb)
        from public.mock_exam_members gs
        join public.students s on s.id = gs.student_id
        left join public.profiles p on p.id = s.profile_id
        left join public.mock_exam_sheets sh on sh.mock_exam_id = p_mock_exam_id and sh.student_id = s.id
       where gs.mock_exam_id = p_mock_exam_id
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.course_assessments_summary(p_course_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now      timestamptz := now();
  v_template boolean;
  v_group    record;
  v_in_class int;
  v_works    jsonb;
  v_mocks    jsonb;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = '42501';
  end if;
  select coalesce(c.is_template, false) into v_template from public.courses c where c.id = p_course_id;
  select g.id, g.name into v_group
    from public.groups g where g.course_id = p_course_id order by g.name limit 1;
  select count(distinct gs.student_id)::int into v_in_class
    from public.group_students gs join public.groups g on g.id = gs.group_id
   where g.course_id = p_course_id;
  with roster as (
    select distinct gs.student_id
      from public.group_students gs join public.groups g on g.id = gs.group_id
     where g.course_id = p_course_id
  ),
  w as (
    select t.id as topic_id, t.title, t.kind, t.order_index as topic_order,
           m.title as module_title, m.order_index as module_order,
           h.id as homework_id, h.is_published, h.opens_at, h.closes_at, h.grade_scale
      from public.topics t
      join public.modules m on m.id = t.module_id
      left join public.topic_homework h on h.topic_id = t.id
     where m.course_id = p_course_id
       and t.kind in ('check', 'control')
  ),
  last_att as (
    select distinct on (a.homework_id, a.student_id)
           a.id, a.homework_id, a.student_id, a.status
      from public.topic_homework_attempts a
      join roster r on r.student_id = a.student_id
     where a.homework_id in (select w.homework_id from w where w.homework_id is not null)
     order by a.homework_id, a.student_id, a.attempt_number desc
  ),
  verdict as (
    select la.homework_id, la.student_id, rv.decision::text as decision, rv.score
      from last_att la
      join lateral (
        select r.decision, r.score from public.topic_homework_reviews r
         where r.attempt_id = la.id order by r.created_at desc limit 1
      ) rv on true
  ),
  stats as (
    select w.topic_id,
           (select count(*) from last_att la where la.homework_id = w.homework_id and la.status <> 'draft')::int as submitted,
           (select count(*) from last_att la where la.homework_id = w.homework_id and la.status = 'submitted')::int as pending,
           (select count(*) from verdict v where v.homework_id = w.homework_id)::int as reviewed,
           (select round(avg(v.score), 2) from verdict v
             where v.homework_id = w.homework_id and v.decision = 'accepted' and v.score is not null) as avg_score,
           (select count(*) from last_att la
             where la.homework_id = w.homework_id and la.status = 'draft'
               and public.topic_homework_window_open(la.homework_id, la.student_id))::int as writing,
           (select count(*) from public.topic_homework_personal_windows pw
             where pw.homework_id = w.homework_id and pw.opens_at <= v_now and v_now < pw.closes_at)::int as personal_live
      from w
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'topic_id',     w.topic_id,
           'homework_id',  w.homework_id,
           'kind',         w.kind,
           'title',        w.title,
           'module_title', w.module_title,
           'published',    coalesce(w.is_published, false),
           'opens_at',     w.opens_at,
           'closes_at',    w.closes_at,
           'grade_scale',  w.grade_scale,
           'status',       case
                             when w.homework_id is null or w.opens_at is null then
                               case when s.pending > 0 then 'review' else 'unscheduled' end
                             when v_now < w.opens_at then 'planned'
                             when v_now < w.closes_at then 'live'
                             when s.pending > 0 then 'review'
                             else 'done'
                           end,
           'submitted',    s.submitted,
           'pending',      s.pending,
           'reviewed',     s.reviewed,
           'avg_score',    s.avg_score,
           'writing',      s.writing,
           'personal_live', s.personal_live
         ) order by w.module_order, w.topic_order, w.title), '[]'::jsonb)
    into v_works
    from w join stats s on s.topic_id = w.topic_id;
  with mx as (
    select me.id, me.title, me.template_id, me.max_score, me.group_id,
           w.starts_at, w.ends_at, w.photos_until
      from public.mock_exams me
      join public.groups g on g.id = me.group_id and g.course_id = p_course_id
      cross join lateral public.mock_exam_window(me.id) w
  ),
  per_student as (
    select m.id as mock_id, gs.student_id,
           (sh.submitted_at is not null
             or exists (select 1 from unnest(sh.answers) a where nullif(btrim(a), '') is not null)
             or exists (select 1 from public.mock_exam_photos ph
                         where ph.mock_exam_id = m.id and ph.student_id = gs.student_id)
             or r.id is not null) as has_work,
           r.score, r.notified_at,
           m.starts_at is not null and v_now >= m.starts_at and v_now < m.ends_at
             and sh.submitted_at is null
             and sh.last_seen_at is not null and sh.last_seen_at >= v_now - interval '75 seconds' as online
      from mx m
      join public.mock_exam_members gs on gs.mock_exam_id = m.id
      left join public.mock_exam_sheets sh on sh.mock_exam_id = m.id and sh.student_id = gs.student_id
      left join public.mock_exam_results r on r.mock_exam_id = m.id and r.student_id = gs.student_id
  ),
  stats as (
    select ps.mock_id,
           count(*) filter (where ps.has_work)::int                              as submitted,
           count(*) filter (where ps.has_work and ps.notified_at is null)::int    as pending,
           round(avg(ps.score), 1)                                               as avg_score,
           count(*) filter (where ps.online)::int                                as writing,
           count(*)::int                                                         as in_group
      from per_student ps group by ps.mock_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           m.id,
           'title',        m.title,
           'template_id',  m.template_id,
           'max_score',    m.max_score,
           'starts_at',    m.starts_at,
           'ends_at',      m.ends_at,
           'photos_until', m.photos_until,
           'status',       case
                             when m.starts_at is null then
                               case when coalesce(s.pending, 0) > 0 then 'review'
                                    when coalesce(s.submitted, 0) > 0 then 'done'
                                    else 'unscheduled' end
                             when v_now < m.starts_at then 'planned'
                             when v_now < m.ends_at then 'live'
                             when coalesce(s.pending, 0) > 0 then 'review'
                             else 'done'
                           end,
           'submitted',    coalesce(s.submitted, 0),
           'pending',      coalesce(s.pending, 0),
           'avg_score',    s.avg_score,
           'writing',      coalesce(s.writing, 0),
           'in_group',     coalesce(s.in_group, 0)
         ) order by m.starts_at nulls last, m.title), '[]'::jsonb)
    into v_mocks
    from mx m left join stats s on s.mock_id = m.id;
  return jsonb_build_object(
    'server_now',  v_now,
    'is_template', v_template,
    'group_id',    v_group.id,
    'group_name',  v_group.name,
    'in_class',    coalesce(v_in_class, 0),
    'works',       v_works,
    'mocks',       v_mocks
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.mock_exam_ensure_variant(p_mock_exam_id uuid, p_student_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
begin
  select vs.variant_id into v_id from public.mock_exam_variant_students vs
   where vs.mock_exam_id = p_mock_exam_id and vs.student_id = p_student_id;
  if v_id is not null then
    return v_id;
  end if;
  if not exists (select 1 from public.mock_exam_variants v where v.mock_exam_id = p_mock_exam_id) then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mock_exam_variants:' || p_mock_exam_id::text, 0));
  select vs.variant_id into v_id from public.mock_exam_variant_students vs
   where vs.mock_exam_id = p_mock_exam_id and vs.student_id = p_student_id;
  if v_id is not null then
    return v_id;
  end if;

  if public.mock_exam_student_has_work(p_mock_exam_id, p_student_id) then
    select v.id into v_id from public.mock_exam_variants v
     where v.mock_exam_id = p_mock_exam_id order by v.position limit 1;
  else
    select v.id into v_id
      from public.mock_exam_variants v
      left join lateral (
        select count(*) as n
          from public.mock_exam_variant_students vs
          join public.mock_exams me on me.id = vs.mock_exam_id
          join public.mock_exam_members gs on gs.mock_exam_id = me.id and gs.student_id = vs.student_id
         where vs.variant_id = v.id
      ) c on true
     where v.mock_exam_id = p_mock_exam_id
     order by c.n, (v.condition_path is null), v.position
     limit 1;
  end if;

  insert into public.mock_exam_variant_students (mock_exam_id, student_id, variant_id)
  values (p_mock_exam_id, p_student_id, v_id)
  on conflict (mock_exam_id, student_id) do nothing;
  return (select vs.variant_id from public.mock_exam_variant_students vs
           where vs.mock_exam_id = p_mock_exam_id and vs.student_id = p_student_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.mock_exam_variant_students_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_before uuid;
  v_after  uuid;
  v_exam   uuid := coalesce(new.mock_exam_id, old.mock_exam_id);
  v_stud   uuid := coalesce(new.student_id, old.student_id);
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.mock_exams me where me.id = old.mock_exam_id) then
      return old;
    end if;
    if not exists (select 1 from public.mock_exam_variants v where v.id = old.variant_id) then
      return old;  -- каскад удаления варианта: его защищает свой триггер
    end if;
    v_before := old.variant_id;
    select v.id into v_after from public.mock_exam_variants v
     where v.mock_exam_id = old.mock_exam_id order by v.position limit 1;
  else
    if tg_op = 'UPDATE' and (new.mock_exam_id, new.student_id) is distinct from (old.mock_exam_id, old.student_id) then
      raise exception 'Строка выдачи не переносится на другого ученика или пробник' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.mock_exams me
        join public.mock_exam_members gs on gs.mock_exam_id = me.id
       where me.id = new.mock_exam_id and gs.student_id = new.student_id
    ) then
      raise exception 'Ученик не назначен на этот пробник' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' then
      v_before := old.variant_id;
    else
      select v.id into v_before from public.mock_exam_variants v
       where v.mock_exam_id = new.mock_exam_id order by v.position limit 1;
    end if;
    v_after := new.variant_id;
  end if;

  if v_after is distinct from v_before and public.mock_exam_student_has_work(v_exam, v_stud) then
    raise exception 'Вариант не сменить: ученик уже открыл пробник — у него есть бланк или фото'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'INSERT' or new.variant_id is distinct from old.variant_id then
    new.assigned_at := now();
    new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mock_exam_task_scores_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    select 1 from public.mock_exam_members gs where gs.mock_exam_id = new.mock_exam_id and gs.student_id = new.student_id
  ) then
    raise exception 'Ученик не назначен на этот пробник'
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.grade_mock_exam_part1(p_mock_exam_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_has_var  boolean;
  v_first    uuid;
  v_skey     text[];
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
  select v.id into v_first from public.mock_exam_variants v
   where v.mock_exam_id = p_mock_exam_id order by v.position limit 1;
  v_has_var := v_first is not null;
  if (v_has_var and not exists (select 1 from public.mock_exam_variant_keys vk where vk.mock_exam_id = p_mock_exam_id))
     or (not v_has_var and v_key is null) then
    return jsonb_build_object('graded_students', 0, 'changed_cells', 0, 'skipped', 'no_key');
  end if;
  select w.ends_at into v_ends_at from public.mock_exam_window(p_mock_exam_id) w;
  v_n := array_length(v_exam.max_points, 1);

  perform pg_advisory_xact_lock(hashtextextended('save_mock_exam_grid:' || p_mock_exam_id::text, 0));

  for v_sheet in
    select sh.student_id, sh.answers,
           case when v_has_var then
             (select vk.answers from public.mock_exam_variant_keys vk
               where vk.variant_id = coalesce(
                       (select vs.variant_id from public.mock_exam_variant_students vs
                         where vs.mock_exam_id = p_mock_exam_id and vs.student_id = sh.student_id),
                       v_first))
           else v_key end as key_answers
      from public.mock_exam_sheets sh
     where sh.mock_exam_id = p_mock_exam_id
       and public.mock_exam_is_participant(p_mock_exam_id, sh.student_id)
       and (sh.submitted_at is not null
            or (now() >= v_ends_at
                and (exists (select 1 from unnest(sh.answers) a where nullif(btrim(a), '') is not null)
                     or exists (select 1 from public.mock_exam_photos ph
                                 where ph.mock_exam_id = p_mock_exam_id and ph.student_id = sh.student_id))))
     order by sh.student_id
  loop
    v_skey := v_sheet.key_answers;
    if v_skey is null then
      continue;  -- §229: у варианта ученика ключа нет — первую часть ставит преподаватель
    end if;
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
      if i <= v_exam.part1_last and nullif(btrim(coalesce(v_skey[i], '')), '') is not null then
        v_verdict := public.variant_answer_verdict(
          public.normalize_variant_answer(v_skey[i]),
          public.normalize_variant_answer(coalesce(v_sheet.answers[i], '')));
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
$function$;

CREATE OR REPLACE FUNCTION public.notify_mock_exam_results(p_mock_exam_id uuid, p_student_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_exam        record;
  v_now         timestamptz := now();
  v_part1_max   int;
  v_part2_max   int;
  v_primary_max int;
  v_r           record;
  v_key         text;
  v_msg         text;
  v_sent        int := 0;
  v_telegram    int := 0;
  v_already     int := 0;
  v_no_profile  int := 0;
  v_no_result   int := 0;
  v_n           int;
  v_rows        jsonb := '[]'::jsonb;
  v_ends_at     timestamptz;
  v_peers       int;
  v_lower       int;
  v_higher      int;
  v_better_pct  int;
  v_prev_score  int;
  v_prev_title  text;
  v_stats       text;
begin
  select me.id, me.title, me.date, me.starts_at, me.max_score, me.group_id, me.template_id, g.course_id,
         t.max_points, t.part1_last
    into v_exam
    from public.mock_exams me
    left join public.groups g on g.id = me.group_id
    left join public.mock_exam_templates t on t.id = me.template_id
   where me.id = p_mock_exam_id;
  if not found then
    raise exception 'Пробник не найден' using errcode = 'P0002';
  end if;
  if v_exam.group_id is null then
    raise exception 'У пробника нет группы — уведомлять некого' using errcode = '22023';
  end if;
  if not (public.course_is_staff(v_exam.course_id)
          and (public.is_admin_or_owner() or public.get_my_role() = 'teacher')) then
    raise exception 'Нет доступа к результатам этого пробника' using errcode = '42501';
  end if;
  if v_exam.max_points is not null then
    select coalesce(sum(m) filter (where i <= v_exam.part1_last), 0)::int,
           coalesce(sum(m) filter (where i >  v_exam.part1_last), 0)::int,
           coalesce(sum(m), 0)::int
      into v_part1_max, v_part2_max, v_primary_max
      from unnest(v_exam.max_points) with ordinality as x(m, i);
  end if;
  select w.ends_at into v_ends_at from public.mock_exam_window(p_mock_exam_id) w;
  perform pg_advisory_xact_lock(hashtextextended('notify_mock_exam_results:' || p_mock_exam_id::text, 0));
  if p_student_ids is not null then
    select count(*) into v_no_result
      from (select distinct unnest(p_student_ids) as sid) q
     where not exists (
       select 1 from public.mock_exam_results r
         join public.mock_exam_members gs on gs.mock_exam_id = p_mock_exam_id and gs.student_id = r.student_id
        where r.mock_exam_id = p_mock_exam_id and r.student_id = q.sid);
  end if;
  for v_r in
    select r.id, r.student_id, r.score, r.part1_score, r.part2_score, r.primary_score,
           r.notified_at, r.notified_score, r.notified_part1_score, r.notified_part2_score,
           s.profile_id
      from public.mock_exam_results r
      join public.students s on s.id = r.student_id
      join public.mock_exam_members gs on gs.mock_exam_id = p_mock_exam_id and gs.student_id = r.student_id
     where r.mock_exam_id = p_mock_exam_id
       and (p_student_ids is null or r.student_id = any (p_student_ids))
     order by r.student_id
       for update of r
  loop
    if v_r.notified_at is not null
       and (v_r.notified_score, v_r.notified_part1_score, v_r.notified_part2_score)
           is not distinct from (v_r.score, v_r.part1_score, v_r.part2_score) then
      v_already := v_already + 1;
      continue;
    end if;
    if v_r.profile_id is null then
      v_no_profile := v_no_profile + 1;
      continue;
    end if;
    v_key := 'mock_exam_result:' || v_r.id || ':' || floor(extract(epoch from v_now) * 1000)::bigint;
    select count(*)::int,
           count(*) filter (where r2.score < v_r.score)::int,
           count(*) filter (where r2.score > v_r.score)::int
      into v_peers, v_lower, v_higher
      from public.mock_exam_results r2
      join public.mock_exam_members gs2 on gs2.mock_exam_id = p_mock_exam_id and gs2.student_id = r2.student_id
     where r2.mock_exam_id = p_mock_exam_id
       and r2.student_id <> v_r.student_id
       and r2.score is not null;
    v_better_pct := case when v_r.score is not null and v_peers >= 3
                         then floor(100.0 * v_lower / v_peers)::int end;
    v_prev_score := null;
    v_prev_title := null;
    if v_exam.template_id is not null and v_r.score is not null then
      select r3.score, me3.title
        into v_prev_score, v_prev_title
        from public.mock_exam_results r3
        join public.mock_exams me3 on me3.id = r3.mock_exam_id
       where r3.student_id = v_r.student_id
         and me3.id <> p_mock_exam_id
         and me3.template_id = v_exam.template_id
         and r3.score is not null
         and coalesce(me3.starts_at, me3.date) < coalesce(v_exam.starts_at, v_exam.date)
       order by coalesce(me3.starts_at, me3.date) desc
       limit 1;
    end if;
    v_stats := case when v_r.score is not null and v_peers >= 3 and v_higher = 0 then ' · лучший результат в группе'
                    when v_better_pct > 0 then ' · лучше, чем ' || v_better_pct || '% группы'
                    else '' end
            || case when v_prev_score is not null then
                 ' · ' || case when v_r.score - v_prev_score > 0 then '+' when v_r.score - v_prev_score < 0 then '−' else '±' end
                 || abs(v_r.score - v_prev_score) || ' к прошлому пробнику'
               else '' end;
    v_msg := '«' || v_exam.title || '» — ' || v_r.score
      || coalesce(' из ' || v_exam.max_score, '')
      || case when v_r.part1_score is not null or v_r.part2_score is not null then
           ' · 1 часть: ' || coalesce(v_r.part1_score::text, '—') || coalesce(' из ' || v_part1_max, '')
           || ', 2 часть: ' || coalesce(v_r.part2_score::text, '—') || coalesce(' из ' || v_part2_max, '')
         else '' end
      || case when v_r.primary_score is not null and v_r.primary_score is distinct from v_r.score then
           ' · первичный: ' || v_r.primary_score || coalesce(' из ' || v_primary_max, '')
         else '' end
      || v_stats;
    insert into public.notifications (user_id, title, message, type, link, dedup_key)
    values (v_r.profile_id, '📊 Результат пробника', v_msg, 'info', null, v_key)
    on conflict (dedup_key) do nothing;
    insert into public.notification_queue
      (profile_id, channel, event_type, entity_type, entity_id,
       deduplication_key, payload, status, scheduled_for)
    select v_r.profile_id,
           'telegram',
           'mock_exam_result',
           'mock_exam_result',
           v_r.id,
           v_key,
           jsonb_build_object(
             'title',         v_exam.title,
             'exam_date',     to_char(v_exam.date at time zone 'UTC', 'YYYY-MM-DD'),
             'score',         v_r.score,
             'max_score',     v_exam.max_score,
             'primary_score', v_r.primary_score,
             'primary_max',   v_primary_max,
             'part1_score',   v_r.part1_score,
             'part1_max',     v_part1_max,
             'part2_score',   v_r.part2_score,
             'part2_max',     v_part2_max,
             'peers',         v_peers,
             'better_pct',    v_better_pct,
             'is_best',       (v_r.score is not null and v_peers >= 3 and v_higher = 0),
             'prev_score',    v_prev_score,
             'prev_title',    v_prev_title
           ),
           'pending'::public.notification_queue_status,
           greatest(v_now, coalesce(v_ends_at, v_now))
      from public.telegram_connections tc
     where tc.profile_id = v_r.profile_id
       and tc.is_enabled
       and tc.disconnected_at is null
       and tc.telegram_chat_id is not null
    on conflict (deduplication_key) do nothing;
    get diagnostics v_n = row_count;
    v_telegram := v_telegram + v_n;
    update public.mock_exam_results
       set notified_at          = v_now,
           notified_score       = v_r.score,
           notified_part1_score = v_r.part1_score,
           notified_part2_score = v_r.part2_score
     where id = v_r.id;
    v_sent := v_sent + 1;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('student_id', v_r.student_id, 'notified_at', v_now));
  end loop;
  return jsonb_build_object(
    'sent',       v_sent,
    'telegram',   v_telegram,
    'already',    v_already,
    'no_result',  v_no_result,
    'no_profile', v_no_profile,
    'rows',       v_rows
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.mock_exam_ai_request_check(p_mock_exam_id uuid, p_student_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_group    uuid;
  v_template uuid;
  v_out      jsonb := '[]'::jsonb;
  v_sid      uuid;
  v_outcome  text;
  v_status   text;
begin
  if auth.uid() is null then
    raise exception 'Нужно войти' using errcode = '42501';
  end if;
  if not (public.is_admin_or_owner() or public.mock_exam_can_manage(p_mock_exam_id)) then
    raise exception 'Нет доступа к этому пробнику' using errcode = '42501';
  end if;
  if p_student_ids is not null and coalesce(array_length(p_student_ids, 1), 0) > 200 then
    raise exception 'Слишком много учеников за один раз' using errcode = '22023';
  end if;

  select me.group_id, me.template_id into v_group, v_template
    from public.mock_exams me where me.id = p_mock_exam_id;
  if v_group is null then
    raise exception 'У пробника нет группы — проверять некого' using errcode = '22023';
  end if;
  if v_template is null then
    raise exception 'У пробника нет шаблона — номеров второй части нет' using errcode = '22023';
  end if;

  update public.mock_exam_ai_runs r
     set status = 'error',
         finished_at = now(),
         last_error = coalesce(r.last_error,
           'Проверка оборвалась, результата не будет: функция не ответила за 10 минут. Запустите проверку заново.')
   where r.mock_exam_id = p_mock_exam_id
     and r.status in ('queued', 'running')
     and coalesce(r.started_at, r.requested_at) < now() - interval '10 minutes';

  for v_sid in
    select coalesce(gs.student_id, ids.sid)
      from (select distinct unnest(p_student_ids) as sid) ids
      full join (select g.student_id from public.mock_exam_members g where g.mock_exam_id = p_mock_exam_id) gs
        on gs.student_id = ids.sid
     where p_student_ids is null or ids.sid is not null
     order by 1
  loop
    if not exists (select 1 from public.mock_exam_members g where g.mock_exam_id = p_mock_exam_id and g.student_id = v_sid) then
      v_outcome := 'not_in_group';
    elsif not exists (select 1 from public.mock_exam_photos p where p.mock_exam_id = p_mock_exam_id and p.student_id = v_sid) then
      v_outcome := 'no_photos';
    else
      select r.status into v_status from public.mock_exam_ai_runs r
       where r.mock_exam_id = p_mock_exam_id and r.student_id = v_sid;
      if v_status = 'running' then
        v_outcome := 'running';
      elsif p_student_ids is null and exists (
        select 1 from public.mock_exam_ai_suggestions s where s.mock_exam_id = p_mock_exam_id and s.student_id = v_sid
      ) then
        v_outcome := 'has_suggestions';
      else
        insert into public.mock_exam_ai_runs as r (mock_exam_id, student_id, status, requested_by, requested_at)
        values (p_mock_exam_id, v_sid, 'queued', auth.uid(), now())
        on conflict (mock_exam_id, student_id) do update
          set status = 'queued', requested_by = excluded.requested_by, requested_at = excluded.requested_at,
              last_error = null, note = null, started_at = null, finished_at = null;
        v_outcome := 'queued';
      end if;
    end if;
    if p_student_ids is not null or v_outcome in ('queued', 'running') then
      v_out := v_out || jsonb_build_object('student_id', v_sid, 'outcome', v_outcome);
    end if;
  end loop;

  return v_out;
end $function$;
