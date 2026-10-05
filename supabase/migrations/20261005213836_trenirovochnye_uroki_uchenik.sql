-- Применено оркестратором 05.10.2026 через MCP apply_migration (§266, часть «trenirovochnye_uroki_uchenik»). Версия совпадает с schema_migrations.

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
