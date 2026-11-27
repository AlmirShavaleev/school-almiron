-- Personal work plans refer to existing lessons. Dates are school calendar dates (Moscow).
set local lock_timeout = '3s';
set local statement_timeout = '45s';

create table public.student_work_plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  title text not null check (length(trim(title)) between 1 and 150),
  starts_on date not null,
  ends_on date not null,
  effective_until date not null,
  daily_minutes integer not null check (daily_minutes between 1 and 720),
  rest_days date[] not null default '{}',
  course_ids uuid[] not null default '{}',
  note text not null default '' check (length(note) <= 4000),
  status text not null check (status in ('draft','published','completed','cancelled','template')),
  published_at timestamptz,
  notify boolean not null default false,
  revision integer not null default 1,
  last_request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on - starts_on between 0 and 365),
  check ((status = 'template') = (student_id is null))
);
create index student_work_plans_student_date_idx on public.student_work_plans (student_id, starts_on desc);
create index student_work_plans_published_dates_idx on public.student_work_plans (starts_on, effective_until)
  where status = 'published';

create table public.student_work_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.student_work_plans(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  homework_id uuid references public.topic_homework(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  topic_title text not null,
  scheduled_on date not null,
  due_on date not null check (due_on >= scheduled_on),
  position integer not null check (position >= 0),
  minutes integer not null check (minutes between 1 and 720),
  criterion text not null check (criterion in ('homework','task_count','specific_tasks','theory')),
  target_tasks integer check (target_tasks between 1 and 500),
  required boolean not null default true,
  note text not null default '' check (length(note) <= 2000),
  access_mode text not null default 'keep' check (access_mode in ('keep','now','scheduled')),
  repeat boolean not null default false,
  credit_after timestamptz,
  progress_snapshot jsonb,
  archived boolean not null default false
);
create unique index student_work_plan_items_topic_idx on public.student_work_plan_items (plan_id, topic_id)
  where not archived;
create index student_work_plan_items_day_idx on public.student_work_plan_items (plan_id, scheduled_on, position)
  where not archived;
create index student_work_plan_items_opens_idx on public.student_work_plan_items (course_id, plan_id, topic_id)
  include (scheduled_on, access_mode) where not archived and access_mode <> 'keep';
create index student_work_plan_items_homework_idx on public.student_work_plan_items (homework_id)
  where homework_id is not null;
create index student_work_plan_items_topic_snapshot_idx on public.student_work_plan_items (topic_id)
  where not archived and progress_snapshot is null;

create table public.student_work_plan_item_tasks (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.student_work_plan_items(id) on delete cascade,
  task_id uuid references public.topic_autocheck_tasks(id) on delete set null,
  code text not null,
  unique (item_id, task_id)
);
create index student_work_plan_item_tasks_task_idx on public.student_work_plan_item_tasks (task_id)
  where task_id is not null;

-- Only new answers from repeat rounds are stored here. The course grade and its attempts remain independent.
create table public.student_work_plan_repeat_answers (
  item_id uuid not null references public.student_work_plan_items(id) on delete cascade,
  task_id uuid not null references public.topic_autocheck_tasks(id) on delete cascade,
  attempt_no integer not null check (attempt_no between 1 and 3),
  answer_raw text not null check (length(answer_raw) between 1 and 200),
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  primary key (item_id, task_id, attempt_no)
);
create index student_work_plan_repeat_answers_task_idx on public.student_work_plan_repeat_answers (task_id);

create table public.student_work_plan_homework_attempts (
  attempt_id uuid primary key references public.topic_homework_attempts(id) on delete cascade,
  item_id uuid not null references public.student_work_plan_items(id) on delete cascade
);
create index student_work_plan_homework_attempts_item_idx on public.student_work_plan_homework_attempts (item_id);

alter table public.student_work_plans enable row level security;
alter table public.student_work_plan_items enable row level security;
alter table public.student_work_plan_item_tasks enable row level security;
alter table public.student_work_plan_repeat_answers enable row level security;
alter table public.student_work_plan_homework_attempts enable row level security;
-- No direct grants. RPCs validate scope, course membership and dates in one transaction.
revoke all on public.student_work_plans, public.student_work_plan_items, public.student_work_plan_item_tasks,
  public.student_work_plan_repeat_answers, public.student_work_plan_homework_attempts from public, anon, authenticated;

create function public._work_plan_group(p_student uuid, p_course uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select g.id
    from public.group_students gs
    join public.students s on s.id = gs.student_id and s.is_active
    join public.groups g on g.id = gs.group_id
    join public.courses c on c.id = g.course_id
   where gs.student_id = p_student and g.course_id = p_course and g.is_active
     and c.is_active and not coalesce(c.is_draft, false) and not coalesce(c.is_template, false)
     and (not exists (select 1 from public.subscription_tariffs t where t.course_id = c.id)
          or public.subscription_access_ok(p_student, c.id))
   order by g.id limit 1
$$;

create function public._work_plan_can_staff(p_student uuid, p_creator uuid, p_courses uuid[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null
    and (public.course_is_admin() or case when p_student is null then p_creator = auth.uid()
      else public.auth_is_staff_of_student(p_student)
        and (cardinality(p_courses) > 0 or p_creator = auth.uid()) end)
    and not exists (
      select 1 from unnest(p_courses) as ids(id)
      where not public.course_is_staff(ids.id)
    )
$$;

create function public._work_plan_item_access(p_item uuid, p_topic uuid, p_write boolean default false)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.student_work_plan_items i
    join public.student_work_plans p on p.id = i.plan_id
    where i.id = p_item and i.topic_id = p_topic and not i.archived and i.repeat
      and p.student_id = public.auth_student_id() and p.status in ('published','completed')
      and (not p_write or p.status = 'published')
      and public._work_plan_group(p.student_id, i.course_id) is not null
      and public.course_student_can_see_topic(i.topic_id)
  )
$$;

-- Used by the existing progressive gate. An item grants access only within its own student's course.
create function public._work_plan_topic_opens(p_course uuid, p_students uuid[])
returns table(student_id uuid, topic_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct p.student_id, i.topic_id
    from public.student_work_plans p join public.student_work_plan_items i on i.plan_id = p.id
   where p.student_id = any(p_students) and p.status = 'published' and i.course_id = p_course
     and not i.archived and i.topic_id is not null and i.access_mode <> 'keep'
     and (i.access_mode = 'now' or i.scheduled_on <= (now() at time zone 'Europe/Moscow')::date)
     and public._work_plan_group(p.student_id, p_course) is not null
$$;

create function public._work_plan_theory_videos(p_topic uuid)
returns table(id uuid, section text)
language sql stable set search_path = public, pg_temp as $$
  select m.id, m.section from public.topic_material_items m
   where m.topic_id = p_topic and m.is_visible and m.kind = 'video'
     and m.section in ('theory','notes') and m.url like 'https://iframe.mediadelivery.net/embed/%'
$$;

-- Keep all effective settings and the cached inner query of the installed progression gate.
-- Only the override source changes. A manual close and the existing demo restriction still win.
do $migration$
declare
  v_definition text := pg_get_functiondef('public._progress_state(uuid,uuid[])'::regprocedure);
  v_old text := 'o.state as override_state';
  v_new text := 'coalesce(o.state, case when po.topic_id is not null then ''open'' end) as override_state';
  v_join text := 'left join public.student_topic_overrides o on o.student_id = st.student_id and o.topic_id = t.topic_id';
begin
  if position(v_old in v_definition) = 0 or position(v_join in v_definition) = 0 then
    raise exception 'Сверьте действующее определение _progress_state перед установкой персональных планов';
  end if;
  execute replace(replace(v_definition, v_old, v_new), v_join,
    v_join || E'\n      left join public._work_plan_topic_opens(p_course_id, p_student_ids) po on po.student_id = st.student_id and po.topic_id = t.topic_id');
end
$migration$;

-- One row per plan item. Correct answers are aggregated once by task. Completion is
-- the timestamp of the Nth first correct answer (or the accepted homework submission).
create function public._work_plan_progress(p_ids uuid[], p_today date)
returns table (
  item_id uuid, plan_id uuid, student_id uuid, completed_at timestamptz, state text,
  solved integer, target integer, first_correct integer, attempted integer, activity_days date[]
)
language sql stable security definer set search_path = public, pg_temp as $$
  with all_items as materialized (
    select i.*, p.student_id, p.published_at, s.profile_id, coalesce(h.autocheck, false) as homework_autocheck
      from public.student_work_plan_items i
      join public.student_work_plans p on p.id = i.plan_id
      left join public.students s on s.id = p.student_id
      left join public.topic_homework h on h.id = i.homework_id
     where i.plan_id = any(p_ids) and not i.archived
  ), selected as materialized (
    select * from all_items where progress_snapshot is null
  ), tasks as materialized (
    select i.id as item_id, i.profile_id, i.repeat, i.credit_after, t.id as task_id
      from selected i join public.topic_autocheck_tasks t on t.topic_id = i.topic_id
     where i.criterion in ('task_count','specific_tasks') or (i.homework_autocheck and i.criterion = 'homework')
  ), eligible as materialized (
    select t.* from tasks t join selected i on i.id = t.item_id
     where i.criterion <> 'specific_tasks'
        or exists (select 1 from public.student_work_plan_item_tasks s where s.item_id = i.id and s.task_id = t.task_id)
  ), events as (
    select t.item_id, a.task_id, a.attempt_no, a.is_correct, a.created_at
      from eligible t join public.topic_autocheck_answers a on a.task_id = t.task_id and a.profile_id = t.profile_id
     where not t.repeat
    union all
    select t.item_id, a.task_id, a.attempt_no, a.is_correct, a.created_at
      from eligible t join public.student_work_plan_repeat_answers a on a.item_id = t.item_id and a.task_id = t.task_id
     where t.repeat and a.created_at >= t.credit_after
  ), by_task as (
    select item_id, task_id, min(created_at) filter (where is_correct) as solved_at,
           bool_or(is_correct and attempt_no = 1) as first_correct
      from events group by item_id, task_id
  ), totals as (
    select item_id, count(*)::int as attempted, count(solved_at)::int as solved,
           count(*) filter (where first_correct)::int as first_correct,
           array_agg(solved_at order by solved_at) filter (where solved_at is not null) as correct_times
      from by_task group by item_id
  ), hw as (
    select i.id as item_id, min(coalesce(a.submitted_at, a.updated_at)) filter (where a.status = 'accepted') as completed_at,
           bool_or(a.status = 'submitted') as pending, count(a.id) > 0 as started,
           min(a.submitted_at) as submitted_at
      from selected i join public.topic_homework_attempts a on a.homework_id = i.homework_id and a.student_id = i.student_id
      left join public.student_work_plan_homework_attempts wa on wa.attempt_id = a.id
     where i.criterion = 'homework' and not i.homework_autocheck
       and ((not i.repeat and wa.item_id is null) or (i.repeat and wa.item_id = i.id and a.created_at >= i.credit_after))
     group by i.id
  ), theory_videos as materialized (
    select i.id as item_id, i.profile_id, v.id as video_id
      from (select x.* from selected x where x.criterion = 'theory') i
      cross join lateral public._work_plan_theory_videos(i.topic_id) v
  ), watch as (
    select v.item_id, v.video_id, w.day, w.seconds, w.updated_at,
      sum(w.seconds) over watched as seconds_watched, max(w.max_position) over watched as position_reached,
      max(w.duration_seconds) over watched as duration
    from theory_videos v join public.video_watch_daily w on w.student_id = v.profile_id and w.item_id = v.video_id
    window watched as (partition by v.item_id, v.video_id order by w.day)
  ), watched as (
    select w.item_id, w.video_id, min(w.updated_at) as watched_at
      from watch w
     where w.duration > 0 and least(w.seconds_watched, w.position_reached) >= 0.9 * w.duration
     group by w.item_id, w.video_id
  ), theory as (
    select v.item_id, case when count(w.watched_at) = count(*) then max(w.watched_at) end as watched_at
      from theory_videos v left join watched w on w.item_id = v.item_id and w.video_id = v.video_id group by v.item_id
  ), activity as (
    select e.item_id, e.created_at from events e
    union all select h.item_id, h.submitted_at from hw h where h.submitted_at is not null
    union all select w.item_id, w.updated_at from watch w where w.seconds > 0
  ), days as (
    select a.item_id, array_agg(distinct (a.created_at at time zone 'Europe/Moscow')::date) as active
      from activity a join selected i on i.id = a.item_id
     where (a.created_at at time zone 'Europe/Moscow')::date between i.scheduled_on - 366 and p_today
       and a.created_at >= i.published_at
     group by a.item_id
  ), scored as (
    select i.id, i.plan_id, i.student_id, i.scheduled_on, i.due_on,
      case when i.criterion = 'theory' then t.watched_at
           when i.criterion = 'homework' and not i.homework_autocheck then h.completed_at
           else s.correct_times[i.target_tasks] end as completed,
      coalesce(h.pending, false) as pending,
      coalesce(h.started, false) or coalesce(s.attempted, 0) > 0
        or exists (select 1 from watch w where w.item_id = i.id and w.seconds > 0) as started,
      coalesce(s.solved, 0) as solved, coalesce(i.target_tasks, 0) as target,
      coalesce(s.first_correct, 0) as first_correct, coalesce(s.attempted, 0) as attempted
    from selected i
    left join totals s on s.item_id = i.id
    left join hw h on h.item_id = i.id
    left join theory t on t.item_id = i.id
  )
  select s.id, s.plan_id, s.student_id, s.completed,
         case
           when (s.completed at time zone 'Europe/Moscow')::date > s.due_on then 'late'
           when (s.completed at time zone 'Europe/Moscow')::date < s.scheduled_on then 'early'
           when s.completed is not null then 'done'
           when s.pending then 'review'
           when s.due_on < p_today then 'overdue'
           when s.started then 'started'
           else 'todo'
         end,
         s.solved, s.target, s.first_correct, s.attempted, coalesce(d.active, '{}'::date[])
    from scored s left join days d on d.item_id = s.id
  union all
  select i.id, i.plan_id, i.student_id, (i.progress_snapshot ->> 'completed_at')::timestamptz,
         i.progress_snapshot ->> 'state',
         (i.progress_snapshot ->> 'solved')::int, (i.progress_snapshot ->> 'target')::int,
         (i.progress_snapshot ->> 'first_correct')::int, (i.progress_snapshot ->> 'attempted')::int,
         array(select d::date from jsonb_array_elements_text(i.progress_snapshot -> 'activity_days') d)
    from all_items i where i.progress_snapshot is not null
$$;

-- Preserve a final report and the dated evidence of a lesson that is about to be deleted.
-- Normal solving and homework submissions do not do any extra writes.
create function public._work_plan_freeze_progress(p_ids uuid[], p_topic uuid default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.student_work_plan_items i
     set progress_snapshot = to_jsonb(r) - 'item_id' - 'plan_id' - 'student_id'
    from public._work_plan_progress(p_ids, (now() at time zone 'Europe/Moscow')::date) r
   where i.id = r.item_id and i.progress_snapshot is null and (p_topic is null or i.topic_id = p_topic)
$$;

create function public._work_plan_freeze_topic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plans uuid[];
begin
  select array_agg(distinct i.plan_id) into v_plans from public.student_work_plan_items i
    where i.topic_id = old.id and not i.archived and i.progress_snapshot is null;
  if v_plans is not null then perform public._work_plan_freeze_progress(v_plans, old.id); end if;
  return old;
end
$$;

create trigger student_work_plan_freeze_topic before delete on public.topics
  for each row execute function public._work_plan_freeze_topic();

revoke all on function public._work_plan_group(uuid,uuid), public._work_plan_can_staff(uuid,uuid,uuid[]),
  public._work_plan_item_access(uuid,uuid,boolean), public._work_plan_topic_opens(uuid,uuid[]),
  public._work_plan_theory_videos(uuid), public._work_plan_progress(uuid[],date), public._work_plan_freeze_progress(uuid[],uuid),
  public._work_plan_freeze_topic() from public, anon, authenticated;

create function public.student_work_plan_catalog(p_student_id uuid, p_course_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_student_id is null or not public._work_plan_can_staff(p_student_id, auth.uid(), coalesce(p_course_ids, '{}')) then
    raise exception 'Нет доступа к ученику или курсу' using errcode = '42501';
  end if;

  return (
    with student as (
      select s.profile_id from public.students s where s.id = p_student_id
    ), courses as materialized (
      select c.id, c.title, public.course_is_progress(c.id) as progressive,
             public._work_plan_group(p_student_id, c.id) as group_id
        from public.courses c
        join (select distinct g.course_id from public.group_students gs
              join public.groups g on g.id = gs.group_id where gs.student_id = p_student_id) membership
          on membership.course_id = c.id
       where public.course_is_staff(c.id)
    ), chosen as materialized (
      select c.* from courses c where c.id = any(p_course_ids) and c.group_id is not null
    ), topic_rows as materialized (
      select c.id as course_id, c.progressive, m.id as module_id, m.title as module_title,
             m.order_index as module_order, t.id, t.title, t.order_index, t.ege_task_numbers, t.kind,
             t.is_open, t.available_from, h.id as homework_id, h.title as homework_title, h.autocheck
        from chosen c join public.modules m on m.course_id = c.id join public.topics t on t.module_id = m.id
        left join public.topic_homework h on h.topic_id = t.id and h.is_published
    ), gates as (
      select g.* from (select c.id from chosen c where c.progressive) c
        cross join lateral public._progress_state(c.id, array[p_student_id]) g
    ), task_status as (
      select k.id, k.topic_id, k.code, k.position, coalesce(bool_or(a.is_correct), false) as solved,
             count(a.id) > 0 as attempted
        from topic_rows t join public.topic_autocheck_tasks k on k.topic_id = t.id
        left join student s on true
        left join public.topic_autocheck_answers a on a.task_id = k.id and a.profile_id = s.profile_id
       group by k.id
    ), task_groups as (
      select ts.topic_id, count(*)::int as task_count, count(*) filter (where ts.solved)::int as solved,
             count(*) filter (where ts.attempted)::int as attempted,
             jsonb_agg(jsonb_build_object('id', ts.id, 'code', ts.code, 'solved', ts.solved)
                       order by ts.position, ts.code) as tasks
        from task_status ts group by ts.topic_id
    ), hw as (
      select distinct on (a.homework_id) a.homework_id, a.status::text as status
        from topic_rows t join public.topic_homework_attempts a on a.homework_id = t.homework_id
        left join public.student_work_plan_homework_attempts ra on ra.attempt_id = a.id
       where a.student_id = p_student_id and ra.attempt_id is null
       order by a.homework_id, a.attempt_number desc, a.id
    )
    select jsonb_build_object(
      'courses', coalesce((select jsonb_agg(to_jsonb(c) order by c.title, c.id) from courses c), '[]'::jsonb),
      'topics', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'title', t.title, 'course_id', t.course_id, 'module_id', t.module_id, 'module_title', t.module_title,
          'ege_numbers', t.ege_task_numbers, 'homework_id', t.homework_id, 'homework_title', t.homework_title,
          'kind', t.kind, 'autocheck', coalesce(t.autocheck, false) or coalesce(k.task_count > 0, false),
          'task_count', coalesce(k.task_count, 0), 'solved', coalesce(k.solved, 0),
          'started', coalesce(k.attempted > 0, false) or h.status is not null,
          'completed', coalesce(h.status = 'accepted', false) or
            coalesce((t.homework_id is null or t.autocheck) and k.task_count > 0 and k.solved = k.task_count, false),
          'homework_status', h.status, 'tasks', coalesce(k.tasks, '[]'::jsonb),
          'has_theory', exists (select 1 from public.topic_material_items m
                               where m.topic_id = t.id and m.is_visible and (m.kind = 'video' or m.section in ('theory','notes'))),
          'tracked_theory', exists (select 1 from public._work_plan_theory_videos(t.id)),
          'available', case when t.progressive then coalesce(g.open, false)
                            else public.topic_open_now(t.is_open, t.available_from) end,
          'progressive', t.progressive, 'manual_closed', coalesce(g.override_state = 'closed', false)
        ) order by t.course_id, t.module_order, t.order_index, t.id)
          from topic_rows t left join task_groups k on k.topic_id = t.id left join hw h on h.homework_id = t.homework_id
          left join gates g on g.topic_id = t.id
      ), '[]'::jsonb)
    )
  );
end
$$;

create function public._work_plan_read(
  p_view text, p_plan_id uuid, p_student_id uuid, p_limit integer, p_offset integer, p_sort text, p_open_flags jsonb
)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_student uuid := public.auth_student_id();
  v_staff boolean := p_view in ('staff','staff_detail');
  v_detail boolean := p_view in ('detail','staff_detail');
  v_sort_progress boolean := p_view = 'staff' and p_sort = 'progress';
begin
  if auth.uid() is null or p_view is null
     or p_view not in ('home','mine','detail','staff','staff_detail')
     or (v_detail and p_plan_id is null)
     or (v_staff and not exists (select 1 from public.profiles pr where pr.id = auth.uid()
                                 and pr.role::text in ('teacher','curator','admin','owner')))
     or (not v_staff and v_student is null) then
    raise exception 'Нет доступа к плану' using errcode = '42501';
  end if;
  return (
    with scoped_plans as materialized (
      select p.*, coalesce(pr.full_name, 'Ученик') as student_name
        from public.student_work_plans p
        left join public.students s on s.id = p.student_id left join public.profiles pr on pr.id = s.profile_id
       where (p_plan_id is null or p.id = p_plan_id)
         and (p_student_id is null or p.student_id = p_student_id or (v_staff and p.status = 'template'))
         and (case when v_staff then public._work_plan_can_staff(p.student_id, p.created_by, p.course_ids)
                   else p.student_id = v_student and p.status in ('published','completed') end)
         and (p_view <> 'home' or (p.status = 'published' and v_today between p.starts_on and p.effective_until))
    ), sortable_progress as materialized (
      select r.* from public._work_plan_progress(
        case when v_sort_progress then array(select p.id from scoped_plans p) else '{}'::uuid[] end, v_today
      ) r where v_sort_progress
    ), percentages as (
      select r.plan_id, count(r.completed_at)::numeric / count(*) as progress
        from sortable_progress r group by r.plan_id
    ), plans as materialized (
      select p.* from scoped_plans p left join percentages x on x.plan_id = p.id
       order by
         case when p_view = 'staff' then case
           when p.status = 'published' and v_today between p.starts_on and p.effective_until then 0
           when p.status = 'published' and p.starts_on > v_today then 1
           when p.status = 'draft' then 2
           when p.status in ('published','completed') then 3
           when p.status = 'template' then 4 else 5 end
         end,
         case when v_sort_progress then coalesce(x.progress, 0) end,
         case when p_view = 'staff' and p_sort = 'deadline' then p.effective_until end,
         case when p_view = 'staff' and p_sort = 'student' then p.student_name end,
         case when p_view = 'staff' and p_sort = 'course' then (
           select min(c.title) from public.courses c where c.id = any(p.course_ids)
         ) end,
         p.starts_on desc, p.updated_at desc, p.id
       limit least(greatest(coalesce(p_limit, 100), 1), 250)
       offset case when p_view = 'staff' then greatest(coalesce(p_offset, 0), 0) else 0 end
    ), progress as materialized (
      select r.* from public._work_plan_progress(
        case when v_sort_progress then '{}'::uuid[] else array(select p.id from plans p) end, v_today
      ) r where not coalesce(v_sort_progress,false)
      union all
      select r.* from sortable_progress r join plans p on p.id = r.plan_id
    ), selected_items as materialized (
      select i.* from public.student_work_plan_items i join plans p on p.id = i.plan_id where not i.archived
    ), summary as (
      select i.plan_id, count(*)::int as total,
             count(r.completed_at)::int as done,
             count(*) filter (where r.state = 'overdue')::int as overdue,
             count(*) filter (where r.state = 'review')::int as review,
             count(*) filter (where r.state in ('done','early'))::int as on_time,
             sum(i.minutes)::int as minutes,
             coalesce(sum(i.minutes) filter (where i.scheduled_on = v_today
               or (i.scheduled_on < v_today and i.due_on = v_today and r.completed_at is null and r.state <> 'review')), 0)::int as today_minutes,
             coalesce(sum(r.solved), 0)::int as solved, coalesce(sum(greatest(r.target - r.solved, 0)), 0)::int as remaining_tasks,
             coalesce(sum(r.first_correct), 0)::int as first_correct, coalesce(sum(r.attempted), 0)::int as attempted
        from selected_items i left join progress r on r.item_id = i.id group by i.plan_id
    ), active_days as (
      select r.plan_id, count(distinct d.day)::int as count
        from progress r cross join lateral unnest(r.activity_days) d(day) group by r.plan_id
    ), visible_items as materialized (
      select i.*, r.completed_at, r.state as progress_state, r.solved, r.target,
             case when p_view = 'home' then row_number() over (partition by i.plan_id, (r.state = 'overdue')
                        order by i.due_on, i.position, i.id) else 1 end as shown_rank
        from selected_items i left join progress r on r.item_id = i.id
       where v_detail or p_view = 'home' and (
         i.scheduled_on = v_today or r.state = 'overdue'
         or (i.scheduled_on < v_today and i.due_on = v_today and r.completed_at is null and r.state <> 'review')
       )
    ), visible_courses as materialized (
      select distinct p.student_id, i.course_id
        from visible_items i join plans p on p.id = i.plan_id
       where i.shown_rank <= 8 and p.student_id is not null and i.course_id is not null
    ), course_access as materialized (
      select c.*, public._work_plan_group(c.student_id, c.course_id) as group_id,
             public.course_is_progress(c.course_id) as progressive
        from visible_courses c
    ), open_topics as materialized (
      select g.student_id, g.topic_id, g.open, g.override_state
        from (select c.* from course_access c where c.progressive and c.group_id is not null and p_open_flags is null) c
        cross join lateral public._progress_state(c.course_id, array[c.student_id]) g
    ), item_data as (
      select i.plan_id, jsonb_agg(
        (to_jsonb(i) - 'shown_rank' - 'archived' - 'credit_after' - 'progress_snapshot') || jsonb_build_object(
          'group_id', c.group_id, 'course_title', course.title,
          'module_title', case when m.course_id = i.course_id then m.title end,
          'progressive', coalesce(c.progressive,false),
          'homework_available', i.criterion <> 'homework' or coalesce(h.is_published, false),
          'available', coalesce(c.group_id is not null and m.course_id = i.course_id and
                        (i.criterion <> 'homework' or h.is_published) and
                        (case when p_open_flags is not null then public.topic_open_with(p_open_flags, p.student_id::text || ':' || i.topic_id,
                                                                                       t.is_open, t.available_from)
                              when c.progressive then g.open else public.topic_open_now(t.is_open, t.available_from) end), false),
          'manual_closed', coalesce(g.override_state = 'closed', false),
          'theory_tab', case when i.criterion = 'theory' then (
            select v.section from public._work_plan_theory_videos(i.topic_id) v order by v.section desc limit 1
          ) end,
          'task_ids', case when v_staff and v_detail then coalesce((
            select jsonb_agg(x.task_id order by x.id) from public.student_work_plan_item_tasks x
             where x.item_id = i.id and x.task_id is not null
          ), '[]'::jsonb) else '[]'::jsonb end,
          'task_codes', case when i.criterion = 'specific_tasks' then coalesce((
            select jsonb_agg(x.code order by x.id) from public.student_work_plan_item_tasks x where x.item_id = i.id
          ), '[]'::jsonb) else '[]'::jsonb end
        ) order by i.scheduled_on, i.position, i.id
      ) as items
      from visible_items i join plans p on p.id = i.plan_id
      left join public.topics t on t.id = i.topic_id left join public.modules m on m.id = t.module_id
      left join public.topic_homework h on h.id = i.homework_id
      left join public.courses course on course.id = i.course_id
      left join course_access c on c.student_id = p.student_id and c.course_id = i.course_id
      left join open_topics g on g.student_id = p.student_id and g.topic_id = i.topic_id
      where i.shown_rank <= 8
      group by i.plan_id
    )
    select jsonb_build_object('today', v_today, 'total_plans', (select count(*) from scoped_plans), 'plans', coalesce(jsonb_agg(
      (to_jsonb(p) - 'last_request_id' - 'created_by') || jsonb_build_object(
        'total', coalesce(s.total, 0), 'done', coalesce(s.done, 0), 'overdue', coalesce(s.overdue, 0),
        'review', coalesce(s.review, 0), 'on_time', coalesce(s.on_time, 0), 'minutes', coalesce(s.minutes, 0),
        'today_minutes', coalesce(s.today_minutes, 0), 'solved', coalesce(s.solved, 0),
        'remaining_tasks', coalesce(s.remaining_tasks, 0), 'first_correct', coalesce(s.first_correct, 0),
        'attempted', coalesce(s.attempted, 0), 'activity_days', coalesce(a.count, 0),
        'course_titles', coalesce((select jsonb_agg(c.title order by c.title) from public.courses c where c.id = any(p.course_ids)), '[]'::jsonb),
        'items', coalesce(i.items, '[]'::jsonb)
      ) order by p.starts_on desc, p.updated_at desc, p.id
    ), '[]'::jsonb))
    from plans p left join summary s on s.plan_id = p.id
    left join active_days a on a.plan_id = p.id left join item_data i on i.plan_id = p.id
  );
end
$$;

create function public.student_work_plan_read(
  p_view text, p_plan_id uuid default null, p_student_id uuid default null, p_limit integer default 100,
  p_offset integer default 0, p_sort text default null
)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public._work_plan_read(p_view, p_plan_id, p_student_id, p_limit, p_offset, p_sort, null)
$$;

-- Keep the existing array and all course fields. Add the compact summary to
-- one row of the RPC already used on the home page, with its already computed gates.
do $migration$
declare
  v_definition text := pg_get_functiondef('public.student_home_courses()'::regprocedure);
  v_marker text := '''course_id'', c.course_id,';
  v_field text := $field$
           'work_plans', case when c.course_id = (select mc.course_id from my_courses mc order by mc.course_id limit 1)
             then case when exists (
               select 1 from public.student_work_plans p where p.student_id in (select id from st)
                 and p.status = 'published' and (now() at time zone 'Europe/Moscow')::date between p.starts_on and p.effective_until
             ) then public._work_plan_read('home', null, null, 20, 0, null, coalesce((select f from flags), '{}'::jsonb)) end
           end,$field$;
begin
  if position(v_marker in v_definition) = 0 or position('(select f from flags)' in v_definition) = 0 then
    raise exception 'Сверьте действующее определение student_home_courses перед установкой персональных планов';
  end if;
  execute replace(v_definition, v_marker, v_marker || v_field);
end
$migration$;

revoke all on function public._work_plan_read(text,uuid,uuid,integer,integer,text,jsonb),
  public.student_work_plan_catalog(uuid,uuid[]), public.student_work_plan_read(text,uuid,uuid,integer,integer,text)
  from public, anon, authenticated;
grant execute on function public.student_work_plan_catalog(uuid,uuid[]), public.student_work_plan_read(text,uuid,uuid,integer,integer,text)
  to authenticated;

create function public._work_plan_notice(
  p_plan uuid, p_event text, p_key text, p_title text, p_message text
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile uuid;
  v_link text := '/my-work-plan/' || p_plan;
  v_dedup text := 'work-plan:' || p_plan || ':' || p_key;
  v_now timestamptz := now();
  v_local timestamp := v_now at time zone 'Europe/Moscow';
  v_send_at timestamptz;
begin
  select s.profile_id into v_profile from public.student_work_plans p
    join public.students s on s.id = p.student_id
   where p.id = p_plan and p.notify;
  if v_profile is null or exists (
    select 1 from public.notification_prefs n where n.user_id = v_profile
      and (not n.homework or p_event = 'today' and not n.remind_hw_due_tomorrow
           or p_event = 'overdue' and (not n.overdue or not n.remind_hw_overdue))
  ) then return; end if;

  insert into public.notifications (user_id, title, message, type, link, dedup_key)
  values (v_profile, p_title, p_message, 'info', v_link, v_dedup)
  on conflict (dedup_key) do nothing;

  v_send_at := case
    when v_local::time >= time '22:00' then (v_local::date + 1 + time '08:00') at time zone 'Europe/Moscow'
    when v_local::time < time '08:00' then (v_local::date + time '08:00') at time zone 'Europe/Moscow'
    else v_now end;
  insert into public.notification_queue
    (profile_id, channel, event_type, entity_type, entity_id, deduplication_key, payload, status, scheduled_for)
  select v_profile, 'telegram', 'student_work_plan', 'student_work_plan', p_plan, v_dedup,
         jsonb_build_object('kind', p_event, 'title', p_title, 'message', p_message, 'link', v_link),
         'pending', v_send_at
   where exists (select 1 from public.telegram_connections t where t.profile_id = v_profile
                 and t.is_enabled and t.disconnected_at is null and t.telegram_chat_id is not null)
     and not exists (select 1 from public.notification_prefs n where n.user_id = v_profile and not n.telegram)
  on conflict (deduplication_key) do nothing;
end
$$;

create function public.student_work_plan_save(
  p_plan jsonb, p_items jsonb, p_request_id uuid, p_expected_revision integer default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := coalesce((p_plan ->> 'id')::uuid, p_request_id);
  v_student uuid := (p_plan ->> 'student_id')::uuid;
  v_courses uuid[] := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_plan -> 'course_ids', '[]')) x);
  v_rest date[] := array(select distinct x::date from jsonb_array_elements_text(coalesce(p_plan -> 'rest_days', '[]')) x);
  v_title text := trim(coalesce(p_plan ->> 'title', ''));
  v_starts date := (p_plan ->> 'starts_on')::date;
  v_ends date := (p_plan ->> 'ends_on')::date;
  v_status text := coalesce(p_plan ->> 'status', 'draft');
  v_minutes integer := (p_plan ->> 'daily_minutes')::int;
  v_notify boolean := coalesce((p_plan ->> 'notify')::boolean, false);
  v_previous public.student_work_plans;
  v_saved public.student_work_plans;
  v_item public.student_work_plan_items;
  v_entry record;
  v_topic record;
  v_homework uuid;
  v_goal integer;
  v_task_ids uuid[];
  v_item_ids uuid[];
  v_now timestamptz := now();
begin
  if p_request_id is null or v_id is null or not public._work_plan_can_staff(v_student, auth.uid(), v_courses)
     or not exists (select 1 from public.profiles p where p.id = auth.uid()
                    and p.role::text in ('teacher','curator','admin','owner')) then
    raise exception 'Нет доступа к ученику или курсу' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_id::text, 1126));
  select * into v_previous from public.student_work_plans p where p.id = v_id;
  if found then
    if v_previous.student_id is distinct from v_student
       or not public._work_plan_can_staff(v_previous.student_id, v_previous.created_by, v_previous.course_ids) then
      raise exception 'Нет доступа к плану' using errcode = '42501';
    end if;
    if v_previous.last_request_id = p_request_id then
      return jsonb_build_object('id', v_id, 'revision', v_previous.revision);
    end if;
    if p_expected_revision is distinct from v_previous.revision then
      raise exception 'План уже изменился. Обновите его перед сохранением.' using errcode = '40001';
    end if;
  elsif p_expected_revision is not null then
    raise exception 'План не найден' using errcode = '22023';
  end if;

  if v_status in ('completed','cancelled') then
    if v_previous.status is null or v_previous.status <> 'published' then
      raise exception 'Завершить или отменить можно опубликованный план' using errcode = '22023';
    end if;
    update public.student_work_plans
       set status = v_status, revision = revision + 1, last_request_id = p_request_id, updated_at = v_now
     where id = v_id returning * into v_saved;
    if v_status = 'completed' then
      perform public._work_plan_freeze_progress(array[v_id]);
      perform public._work_plan_notice(v_id, 'completed', 'completed', 'План работы завершён', v_saved.title);
    end if;
    return jsonb_build_object('id', v_id, 'revision', v_saved.revision);
  end if;

  if v_status not in ('draft','published','template') or (v_student is null) <> (v_status = 'template')
     or v_previous.status in ('completed','cancelled')
     or (v_previous.status = 'published' and v_status <> 'published') then
    raise exception 'Недопустимое изменение статуса плана' using errcode = '22023';
  end if;
  if v_starts is null or v_ends is null or v_ends - v_starts not between 0 and 365
     or length(v_title) not between 1 and 150 or v_minutes is null or v_minutes not between 1 and 720
     or cardinality(v_courses) > 20
     or exists (select 1 from unnest(v_rest) d where d not between v_starts and v_ends)
     or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 365 then
    raise exception 'Проверьте название, даты, нагрузку и задания плана' using errcode = '22023';
  end if;
  if v_status = 'published' and (
    jsonb_array_length(p_items) = 0 or cardinality(v_courses) = 0
    or not exists (select 1 from public.students s where s.id = v_student and s.profile_id is not null)
  ) then
    raise exception 'Для публикации нужны задания и активный аккаунт ученика' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_courses) c(id)
    where v_student is not null and public._work_plan_group(v_student, c.id) is null
  ) then
    raise exception 'У ученика нет действующего доступа к одному из выбранных курсов' using errcode = '42501';
  end if;

  v_item_ids := array(select (x ->> 'id')::uuid from jsonb_array_elements(p_items) x);
  if array_position(v_item_ids, null) is not null or
     cardinality(v_item_ids) <> (select count(distinct x)::int from unnest(v_item_ids) x) then
    raise exception 'Пункты плана должны иметь разные идентификаторы' using errcode = '22023';
  end if;

  if v_previous.id is null then
    insert into public.student_work_plans
      (id, student_id, created_by, title, starts_on, ends_on, effective_until, daily_minutes, rest_days, course_ids,
       note, status, published_at, notify, last_request_id)
    values (v_id, v_student, auth.uid(), v_title, v_starts, v_ends, v_ends, v_minutes, v_rest, v_courses,
      coalesce(p_plan ->> 'note', ''), v_status, case when v_status = 'published' then v_now end, v_notify, p_request_id)
    returning * into v_saved;
  else
    update public.student_work_plans
       set title = v_title, starts_on = v_starts, ends_on = v_ends, daily_minutes = v_minutes, rest_days = v_rest,
           course_ids = v_courses, note = coalesce(p_plan ->> 'note', ''), status = v_status, notify = v_notify,
           published_at = coalesce(published_at, case when v_status = 'published' then v_now end),
           revision = revision + 1, last_request_id = p_request_id, updated_at = v_now
     where id = v_id returning * into v_saved;
  end if;

  update public.student_work_plan_items
     set archived = true where plan_id = v_id and not archived and not (id = any(v_item_ids));

  for v_entry in
    select * from jsonb_to_recordset(p_items) as x(
      id uuid, topic_id uuid, scheduled_on date, due_on date, position int, minutes int, criterion text,
      target_tasks int, task_ids uuid[], required boolean, note text, access_mode text, repeat boolean
    )
  loop
    select * into v_item from public.student_work_plan_items i where i.id = v_entry.id;
    if v_item.id is not null and (v_item.plan_id <> v_id or v_item.archived) then
      raise exception 'Пункт не относится к этому плану' using errcode = '42501';
    end if;
    if v_entry.scheduled_on is null or not (v_entry.scheduled_on between v_starts and v_ends)
       or v_entry.scheduled_on = any(v_rest)
       or coalesce(v_entry.due_on, v_entry.scheduled_on) < v_entry.scheduled_on
       or v_entry.position is null or v_entry.position < 0
       or v_entry.minutes is null or v_entry.minutes not between 1 and 720 then
      raise exception 'Дата задания должна быть учебным днём в пределах плана' using errcode = '22023';
    end if;
    if v_entry.topic_id is null and v_item.id is not null and v_item.topic_id is null then
      update public.student_work_plan_items set scheduled_on = v_entry.scheduled_on,
        due_on = coalesce(v_entry.due_on, v_entry.scheduled_on), position = v_entry.position,
        minutes = v_entry.minutes, note = coalesce(v_entry.note,'') where id = v_item.id;
      continue;
    end if;
    if v_item.id is not null and v_item.topic_id is distinct from v_entry.topic_id then
      raise exception 'Чтобы заменить тему, добавьте новый пункт' using errcode = '22023';
    end if;
    if v_item.id is not null and v_item.credit_after is not null and not coalesce(v_entry.repeat,false)
       and (exists (select 1 from public.student_work_plan_repeat_answers a where a.item_id = v_item.id)
            or exists (select 1 from public.student_work_plan_homework_attempts a where a.item_id = v_item.id)) then
      raise exception 'Ученик уже начал повторение. Чтобы изменить его, добавьте новый пункт.' using errcode = '22023';
    end if;
    select t.id, t.title, t.kind, m.course_id, h.id as homework_id, coalesce(h.autocheck,false) as autocheck
      into v_topic from public.topics t join public.modules m on m.id = t.module_id
      left join public.topic_homework h on h.topic_id = t.id and h.is_published where t.id = v_entry.topic_id;
    if v_topic.id is null or not coalesce(v_topic.course_id = any(v_courses), false) then
      raise exception 'Тема должна принадлежать одному из выбранных курсов' using errcode = '42501';
    end if;
    if coalesce(v_entry.access_mode, 'keep') <> 'keep' and not public.course_is_progress(v_topic.course_id) then
      raise exception 'Индивидуальное открытие из плана доступно в режиме «По прохождению»' using errcode = '22023';
    end if;
    v_homework := null;
    v_goal := null;
    v_task_ids := case when v_entry.criterion = 'specific_tasks' then coalesce(v_entry.task_ids, '{}') else '{}' end;
    if v_entry.criterion = 'homework' then
      v_homework := v_topic.homework_id;
      if v_homework is null or (coalesce(v_entry.repeat, false) and v_topic.kind in ('check','control')) then
        raise exception 'Выберите опубликованное ДЗ. Проверочные с общим окном нельзя назначать на повторение.' using errcode = '22023';
      end if;
      if v_topic.autocheck then
        select count(*)::int into v_goal from public.topic_autocheck_tasks t where t.topic_id = v_topic.id;
      end if;
    elsif v_entry.criterion in ('task_count','specific_tasks') then
      select count(*)::int into v_goal from public.topic_autocheck_tasks t
       where t.topic_id = v_topic.id and (v_entry.criterion = 'task_count' or t.id = any(v_task_ids));
      if v_entry.criterion = 'specific_tasks' and v_goal <> cardinality(v_task_ids)
         or v_entry.criterion = 'task_count' and (v_entry.target_tasks is null or v_entry.target_tasks > v_goal) then
        raise exception 'Выберите доступные задачи этой темы и проверьте их количество' using errcode = '22023';
      end if;
      if v_entry.criterion = 'task_count' then v_goal := v_entry.target_tasks; end if;
    elsif v_entry.criterion = 'theory' and
          (coalesce(v_entry.repeat,false) or not exists (select 1 from public._work_plan_theory_videos(v_topic.id))) then
      raise exception 'Для этого критерия нужны учебные видео с учётом просмотра' using errcode = '22023';
    end if;
    if v_goal is not null and v_goal not between 1 and 500 then
      raise exception 'Задание должно содержать от 1 до 500 задач' using errcode = '22023';
    end if;

    insert into public.student_work_plan_items
      (id, plan_id, topic_id, homework_id, course_id, topic_title, scheduled_on, due_on, position, minutes,
       criterion, target_tasks, required, note, access_mode, repeat, credit_after)
    values (v_entry.id, v_id, v_topic.id, v_homework, v_topic.course_id, v_topic.title,
      v_entry.scheduled_on, coalesce(v_entry.due_on, v_entry.scheduled_on), v_entry.position, v_entry.minutes,
      v_entry.criterion, v_goal, coalesce(v_entry.required, true), coalesce(v_entry.note, ''),
      coalesce(v_entry.access_mode, 'keep'), coalesce(v_entry.repeat, false),
      case when v_status = 'published' and v_entry.repeat then coalesce(v_item.credit_after, v_now) end)
    on conflict (id) do update set
      homework_id = excluded.homework_id, topic_title = excluded.topic_title, scheduled_on = excluded.scheduled_on,
      due_on = excluded.due_on, position = excluded.position, minutes = excluded.minutes, criterion = excluded.criterion,
      target_tasks = excluded.target_tasks, required = excluded.required, note = excluded.note,
      access_mode = excluded.access_mode, repeat = excluded.repeat, credit_after = excluded.credit_after
      where student_work_plan_items.plan_id = excluded.plan_id and not student_work_plan_items.archived;
    if not found then
      raise exception 'Пункт не относится к этому плану' using errcode = '42501';
    end if;

    delete from public.student_work_plan_item_tasks s where s.item_id = v_entry.id and not (s.task_id = any(v_task_ids));
    insert into public.student_work_plan_item_tasks (item_id, task_id, code)
      select v_entry.id, t.id, t.code from public.topic_autocheck_tasks t
       where t.id = any(v_task_ids) order by t.position, t.id
      on conflict (item_id, task_id) do nothing;
  end loop;

  update public.student_work_plans p
     set effective_until = greatest(v_ends, (
       select max(i.due_on) from public.student_work_plan_items i where i.plan_id = v_id and not i.archived
     ))
   where p.id = v_id;

  if v_status = 'published' and v_notify then
    if v_previous.published_at is null then
      perform public._work_plan_notice(v_id, 'published', 'published', 'Новый план работы', v_title);
    else
      perform public._work_plan_notice(v_id, 'updated', 'updated:' || v_saved.revision, 'План работы обновлён', v_title);
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'revision', v_saved.revision);
end
$$;

revoke all on function public._work_plan_notice(uuid,text,text,text,text),
  public.student_work_plan_save(jsonb,jsonb,uuid,integer) from public, anon, authenticated;
grant execute on function public.student_work_plan_save(jsonb,jsonb,uuid,integer) to authenticated;

create function public.student_work_plan_copy_targets(p_plan_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_plan public.student_work_plans;
begin
  select * into v_plan from public.student_work_plans p where p.id = p_plan_id;
  if v_plan.id is null or not public._work_plan_can_staff(v_plan.student_id, v_plan.created_by, v_plan.course_ids) then
    raise exception 'Нет доступа к плану' using errcode = '42501';
  end if;
  return (
    with groups as (
      select g.id, g.name, c.title as course_title from public.groups g join public.courses c on c.id = g.course_id
      where g.is_active and g.course_id = any(v_plan.course_ids)
    ), students as (
      select s.id, coalesce(p.full_name, 'Ученик') as name, array_agg(distinct gs.group_id) as group_ids
      from public.group_students gs join groups g on g.id = gs.group_id
      join public.students s on s.id = gs.student_id join public.profiles p on p.id = s.profile_id
      where s.is_active and not exists (select 1 from unnest(v_plan.course_ids) c(id)
                                       where public._work_plan_group(s.id, c.id) is null)
      group by s.id, p.full_name
    )
    select jsonb_build_object(
      'groups', coalesce((select jsonb_agg(to_jsonb(g) order by g.course_title, g.name) from groups g), '[]'::jsonb),
      'students', coalesce((select jsonb_agg(to_jsonb(s) order by s.name, s.id) from students s), '[]'::jsonb)
    )
  );
end
$$;

create function public.student_work_plan_copy(
  p_plan_id uuid, p_starts_on date, p_request_id uuid, p_student_ids uuid[] default '{}',
  p_group_id uuid default null, p_template boolean default false, p_publish boolean default false, p_notify boolean default false
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_source public.student_work_plans;
  v_students uuid[];
  v_student uuid;
  v_shift integer;
  v_id uuid;
  v_items jsonb;
  v_ok uuid[] := '{}';
  v_failed jsonb := '[]';
begin
  select * into v_source from public.student_work_plans p where p.id = p_plan_id;
  if v_source.id is null or not public._work_plan_can_staff(v_source.student_id, v_source.created_by, v_source.course_ids) then
    raise exception 'Нет доступа к плану' using errcode = '42501';
  end if;
  if p_starts_on is null or p_request_id is null then
    raise exception 'Укажите дату начала копии' using errcode = '22023';
  end if;
  if p_group_id is not null and not exists (
    select 1 from public.groups g where g.id = p_group_id and g.is_active and g.course_id = any(v_source.course_ids)
  ) then raise exception 'Группа не относится к курсам плана' using errcode = '42501'; end if;
  v_students := case when p_template then array[null::uuid]
    else array(
      select s.id from unnest(coalesce(p_student_ids, '{}')) s(id) where s.id is not null
      union
      select gs.student_id from public.group_students gs where gs.group_id = p_group_id
    ) end;
  if cardinality(v_students) not between 1 and 100 then
    raise exception 'Выберите от 1 до 100 учеников' using errcode = '22023';
  end if;
  v_shift := p_starts_on - v_source.starts_on;
  foreach v_student in array v_students loop
    v_id := md5(p_plan_id::text || ':' || p_request_id || ':' || coalesce(v_student::text, 'template'))::uuid;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', md5(v_id::text || ':' || i.id)::uuid, 'topic_id', i.topic_id,
      'scheduled_on', i.scheduled_on + v_shift, 'due_on', i.due_on + v_shift, 'position', i.position,
      'minutes', i.minutes, 'criterion', i.criterion, 'target_tasks', i.target_tasks,
      'task_ids', coalesce((select jsonb_agg(t.task_id order by t.id) from public.student_work_plan_item_tasks t
                            where t.item_id = i.id and t.task_id is not null), '[]'::jsonb),
      'required', i.required, 'note', i.note, 'access_mode', i.access_mode, 'repeat', i.repeat
    ) order by i.scheduled_on, i.position), '[]') into v_items
    from public.student_work_plan_items i where i.plan_id = p_plan_id and not i.archived and i.topic_id is not null;
    begin
      perform public.student_work_plan_save(jsonb_build_object(
        'id', v_id, 'student_id', v_student, 'title', v_source.title, 'note', v_source.note,
        'starts_on', p_starts_on, 'ends_on', v_source.ends_on + v_shift, 'daily_minutes', v_source.daily_minutes,
        'course_ids', v_source.course_ids,
        'rest_days', array(select x.day + v_shift from unnest(v_source.rest_days) x(day)),
        'status', case when p_template then 'template' when p_publish then 'published' else 'draft' end,
        'notify', p_notify and p_publish and not p_template
      ), v_items, p_request_id);
      v_ok := array_append(v_ok, v_id);
    exception when insufficient_privilege or invalid_parameter_value or check_violation then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('student_id', v_student, 'message', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('created', v_ok, 'failed', v_failed);
end
$$;

create function public._work_plan_notices_daily()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_plans uuid[];
  v_row record;
begin
  select array_agg(p.id) into v_plans from public.student_work_plans p
   where p.notify and p.status = 'published' and v_today between p.starts_on and p.effective_until + 1;
  if v_plans is null then return; end if;

  for v_row in
    select p.id, p.title, p.starts_on, p.effective_until,
           count(*) filter (where (i.scheduled_on = v_today or i.due_on = v_today)
                            and r.completed_at is null and r.state <> 'review') as today,
           count(*) filter (where i.due_on < v_today and r.state = 'overdue') as overdue,
           count(*) filter (where r.completed_at is not null) as done, count(*) as total,
           count(*) filter (where i.scheduled_on >= v_today - 7 and i.scheduled_on < v_today) as week_total,
           count(*) filter (where i.scheduled_on >= v_today - 7 and i.scheduled_on < v_today and r.completed_at is not null) as week_done
      from public._work_plan_progress(v_plans, v_today) r
      join public.student_work_plan_items i on i.id = r.item_id
      join public.student_work_plans p on p.id = i.plan_id
     where public._work_plan_group(p.student_id, i.course_id) is not null
     group by p.id
  loop
    if v_today = v_row.effective_until + 1 then
      perform public._work_plan_notice(v_row.id, 'completed', 'completed', 'Период плана завершился',
        v_row.title || ' · выполнено ' || v_row.done || ' из ' || v_row.total);
    else
      if v_row.today > 0 then
        perform public._work_plan_notice(v_row.id, 'today', 'today:' || v_today, 'Задания по плану на сегодня',
          v_row.title || ' · осталось ' || v_row.today);
      end if;
      if v_row.overdue > 0 then
        perform public._work_plan_notice(v_row.id, 'overdue', 'overdue:' || v_today, 'Просроченные задания плана',
          v_row.title || ' · осталось ' || v_row.overdue);
      end if;
    end if;
    if v_row.week_total > 0 and v_today > v_row.starts_on and (v_today - v_row.starts_on) % 7 = 0 then
      perform public._work_plan_notice(v_row.id, 'weekly', 'weekly:' || v_today, 'Итоги недели по плану',
        v_row.title || ' · выполнено ' || v_row.week_done || ' из ' || v_row.week_total);
    end if;
  end loop;
end
$$;

do $migration$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('student-work-plan-notices', '0 6 * * *', 'select public._work_plan_notices_daily()');
  end if;
end
$migration$;

revoke all on function public.student_work_plan_copy_targets(uuid),
  public.student_work_plan_copy(uuid,date,uuid,uuid[],uuid,boolean,boolean,boolean),
  public._work_plan_notices_daily() from public, anon, authenticated;
grant execute on function public.student_work_plan_copy_targets(uuid),
  public.student_work_plan_copy(uuid,date,uuid,uuid[],uuid,boolean,boolean,boolean) to authenticated;

create function public.student_work_plan_repeat_tasks(p_item_id uuid, p_topic_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_item public.student_work_plan_items;
begin
  select * into v_item from public.student_work_plan_items i where i.id = p_item_id;
  if not public._work_plan_item_access(p_item_id, p_topic_id) or v_item.target_tasks is null
     or v_item.criterion not in ('homework','task_count','specific_tasks') then
    raise exception 'Повторение недоступно' using errcode = '42501';
  end if;

  return (
    with answers as (
      select a.task_id, count(*)::int as used, bool_or(a.is_correct) as solved,
             jsonb_agg(jsonb_build_object('attempt_no', a.attempt_no, 'answer', a.answer_raw, 'correct', a.is_correct)
                       order by a.attempt_no) as entries
        from public.student_work_plan_repeat_answers a
       where a.item_id = p_item_id and a.created_at >= v_item.credit_after group by a.task_id
    ), tasks as (
      select k.id, k.code, k.position, k.statement_path, k.statement_md, k.answer_type, k.digits_any_order, k.unit,
             coalesce(a.used, 0) as attempts_used, greatest(3 - coalesce(a.used, 0), 0) as attempts_left,
             coalesce(a.solved, false) as solved, coalesce(a.solved or a.used >= 3, false) as closed,
             coalesce(a.entries, '[]'::jsonb) as answers
        from public.topic_autocheck_tasks k left join answers a on a.task_id = k.id
       where k.topic_id = p_topic_id and (v_item.criterion <> 'specific_tasks' or exists (
         select 1 from public.student_work_plan_item_tasks s where s.item_id = p_item_id and s.task_id = k.id
       ))
    )
    select jsonb_build_object('topic_id', p_topic_id, 'is_staff', false, 'solutions_after_finish', true,
      'tasks', coalesce(jsonb_agg(to_jsonb(t) order by t.position, t.code), '[]'::jsonb),
      'total', count(*), 'solved', count(*) filter (where t.solved), 'closed', count(*) filter (where t.closed),
      'finished', count(*) filter (where t.solved) >= v_item.target_tasks, 'grade', null
    ) from tasks t
  );
end
$$;

create function public.student_work_plan_repeat_check(p_item_id uuid, p_task_id uuid, p_answer text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_task public.topic_autocheck_tasks;
  v_item public.student_work_plan_items;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_used integer;
  v_solved boolean;
  v_correct boolean;
begin
  select * into v_task from public.topic_autocheck_tasks t where t.id = p_task_id;
  select * into v_item from public.student_work_plan_items i where i.id = p_item_id;
  if not public._work_plan_item_access(p_item_id, v_task.topic_id, true) or v_item.target_tasks is null
     or v_item.criterion not in ('homework','task_count','specific_tasks')
     or (v_item.criterion = 'specific_tasks' and not exists (
          select 1 from public.student_work_plan_item_tasks s where s.item_id = p_item_id and s.task_id = p_task_id
        )) then raise exception 'Повторение недоступно' using errcode = '42501'; end if;
  if length(v_answer) not between 1 and 200 then
    raise exception 'AUTOCHECK_FORMAT: введите ответ' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text || ':' || p_task_id::text, 1126));
  select count(*)::int, coalesce(bool_or(is_correct), false) into v_used, v_solved
    from public.student_work_plan_repeat_answers
   where item_id = p_item_id and task_id = p_task_id;
  if v_solved or v_used >= 3 then
    raise exception 'AUTOCHECK_CLOSED: задача уже закрыта' using errcode = 'check_violation';
  end if;
  v_correct := public.autocheck_answer_correct(v_task.answer_type, v_task.answer_value, v_task.answer_tol,
                                             v_task.answer_text, v_task.digits_any_order, v_answer);
  if v_correct is null then raise exception 'AUTOCHECK_FORMAT: проверьте формат ответа' using errcode = '22023'; end if;
  insert into public.student_work_plan_repeat_answers (item_id, task_id, attempt_no, answer_raw, is_correct)
    values (p_item_id, p_task_id, v_used + 1, v_answer, v_correct);
  return jsonb_build_object('correct', v_correct, 'state', public.student_work_plan_repeat_tasks(p_item_id, v_task.topic_id));
end
$$;

create function public._work_plan_repeat_insert_allowed(p_attempt uuid, p_homework uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select split_part(coalesce(current_setting('app.work_plan_repeat_attempt', true), ''), ':', 1) = p_attempt::text
    and p_student = public.auth_student_id() and exists (
      select 1 from public.student_work_plan_items i join public.topic_homework h on h.id = i.homework_id
       where i.id::text = split_part(current_setting('app.work_plan_repeat_attempt', true), ':', 2)
         and h.id = p_homework and i.criterion = 'homework' and not h.autocheck and h.is_published
         and public._work_plan_item_access(i.id, h.topic_id, true)
    )
$$;

do $migration$
declare
  v_definition text := replace(pg_get_functiondef('public.topic_homework_attempts_guard()'::regprocedure), chr(13), '');
  v_marker text := $guard$    if exists (
      select 1 from topic_homework_attempts a
       where a.homework_id = new.homework_id
         and a.student_id  = new.student_id
         and a.status = 'accepted'
    ) then$guard$;
begin
  if position(v_marker in v_definition) = 0 then
    raise exception 'Сверьте действующую проверку попыток ДЗ перед установкой персональных планов';
  end if;
  execute replace(v_definition, v_marker,
    replace(v_marker, ') then', ') and not public._work_plan_repeat_insert_allowed(new.id, new.homework_id, new.student_id) then'));
end
$migration$;

create function public.student_work_plan_repeat_homework_ids(p_item_id uuid, p_homework_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_topic uuid;
begin
  select h.topic_id into v_topic
    from public.student_work_plan_items i join public.topic_homework h on h.id = i.homework_id
   where i.id = p_item_id and h.id = p_homework_id and i.criterion = 'homework' and not h.autocheck and h.is_published;
  if v_topic is null or not public._work_plan_item_access(p_item_id, v_topic) then
    raise exception 'Повторение недоступно' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(a.attempt_id) from public.student_work_plan_homework_attempts a where a.item_id = p_item_id), '[]'::jsonb);
end
$$;

create function public.student_work_plan_repeat_homework_start(p_item_id uuid, p_homework_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student uuid := public.auth_student_id();
  v_topic uuid;
  v_attempt uuid;
  v_id uuid := gen_random_uuid();
begin
  select h.topic_id into v_topic
    from public.student_work_plan_items i join public.topic_homework h on h.id = i.homework_id
   where i.id = p_item_id and h.id = p_homework_id and i.criterion = 'homework' and not h.autocheck and h.is_published;
  if v_student is null or v_topic is null or not public._work_plan_item_access(p_item_id, v_topic, true)
     or public.topic_homework_is_timed(p_homework_id) then
    raise exception 'Повторение недоступно' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_student::text || ':' || p_homework_id::text, 1126));
  select a.id into v_attempt from public.student_work_plan_homework_attempts x
    join public.topic_homework_attempts a on a.id = x.attempt_id
   where x.item_id = p_item_id and a.status in ('draft','submitted','accepted')
   order by a.attempt_number desc limit 1;
  if v_attempt is not null then return v_attempt; end if;
  if exists (select 1 from public.topic_homework_attempts a where a.homework_id = p_homework_id
             and a.student_id = v_student and a.status in ('draft','submitted')) then
    raise exception 'Сначала завершите текущую попытку по этому ДЗ' using errcode = 'check_violation';
  end if;
  perform set_config('app.work_plan_repeat_attempt', v_id::text || ':' || p_item_id::text, true);
  insert into public.topic_homework_attempts (id, homework_id, student_id, attempt_number)
  values (v_id, p_homework_id, v_student, 1);
  perform set_config('app.work_plan_repeat_attempt', '', true);
  insert into public.student_work_plan_homework_attempts (attempt_id, item_id) values (v_id, p_item_id);
  return v_id;
end
$$;

revoke all on function public.student_work_plan_repeat_tasks(uuid,uuid), public.student_work_plan_repeat_check(uuid,uuid,text),
  public._work_plan_repeat_insert_allowed(uuid,uuid,uuid), public.student_work_plan_repeat_homework_ids(uuid,uuid),
  public.student_work_plan_repeat_homework_start(uuid,uuid) from public, anon, authenticated;
grant execute on function public.student_work_plan_repeat_tasks(uuid,uuid), public.student_work_plan_repeat_check(uuid,uuid,text),
  public.student_work_plan_repeat_homework_ids(uuid,uuid), public.student_work_plan_repeat_homework_start(uuid,uuid) to authenticated;

notify pgrst, 'reload schema';
