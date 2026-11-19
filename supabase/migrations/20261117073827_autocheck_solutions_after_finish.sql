-- Opt-in gate: other courses retain their per-task solution behavior.
ALTER TABLE public.topics ADD COLUMN IF NOT EXISTS autocheck_solutions_after_finish boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.topic_autocheck_solutions_unlocked(p_topic_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
  select public.topic_material_can_manage(p_topic_id) or (
    auth.uid() is not null and (
      not exists (select 1 from topics t left join topics s on s.id=t.source_topic_id
                  where t.id=p_topic_id and (t.autocheck_solutions_after_finish or coalesce(s.autocheck_solutions_after_finish,false)))
      or (
        exists (select 1 from topic_autocheck_tasks k where k.topic_id=p_topic_id)
        and not exists (
          select 1 from topic_autocheck_tasks k where k.topic_id=p_topic_id
           and not public.topic_autocheck_task_closed(k.id,auth.uid())
        )
      )
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.topic_autocheck_solutions_unlocked(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.topic_autocheck_solutions_unlocked(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.topic_autocheck_state(p_topic_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_staff boolean;
  v_tasks jsonb;
  v_total integer;
  v_solved integer;
  v_closed integer;
  v_reveal_solutions boolean;
  v_after_finish boolean;
begin
  if v_uid is null then
    raise exception 'Нужен вход' using errcode = '42501';
  end if;
  v_staff := public.topic_material_can_manage(p_topic_id);
  if not v_staff and not public.course_student_can_see_topic(p_topic_id) then
    raise exception 'Нет доступа к этому уроку' using errcode = '42501';
  end if;

  select t.autocheck_solutions_after_finish or coalesce(s.autocheck_solutions_after_finish,false)
    into v_after_finish from topics t left join topics s on s.id=t.source_topic_id where t.id=p_topic_id;
  v_reveal_solutions := public.topic_autocheck_solutions_unlocked(p_topic_id);

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
           'statement_md',     s.statement_md,
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
           'answer_value',     case when v_staff or (s.closed and v_reveal_solutions) then s.answer_value end,
           'answer_tol',       case when v_staff or (s.closed and v_reveal_solutions) then s.answer_tol end,
           'answer_text',      case when v_staff or (s.closed and v_reveal_solutions) then s.answer_text end,
           'solution_path',    case when v_staff or (s.closed and v_reveal_solutions) then s.solution_path end,
           'solution_md',      case when v_staff or (s.closed and v_reveal_solutions) then s.solution_md end
         ) order by s.position, s.code), '[]'::jsonb),
         count(*)::int,
         count(*) filter (where not v_staff and s.solved)::int,
         count(*) filter (where not v_staff and s.closed)::int
    into v_tasks, v_total, v_solved, v_closed
    from s;

  return jsonb_build_object(
    'topic_id', p_topic_id,
    'is_staff', v_staff,
    'solutions_after_finish', coalesce(v_after_finish,false),
    'tasks',    v_tasks,
    'total',    v_total,
    'solved',   v_solved,
    'closed',   v_closed,
    'finished', not v_staff and v_total > 0 and v_closed = v_total,
    'grade',    case when not v_staff and v_total > 0 and v_closed = v_total
                     then round(100.0 * v_solved / v_total)::int end
  );
end $function$;
CREATE OR REPLACE FUNCTION public.topic_autocheck_object_visible(p_object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from topic_autocheck_tasks t
     where t.statement_path = p_object_name
       and (public.topic_material_can_manage(t.topic_id) or public.course_student_can_see_topic(t.topic_id))
  ) or exists (
    select 1 from topic_autocheck_tasks t
     where t.solution_path = p_object_name
       and (public.topic_material_can_manage(t.topic_id)
            or (public.course_student_can_see_topic(t.topic_id)
                and public.topic_autocheck_task_closed(t.id, auth.uid())
                and public.topic_autocheck_solutions_unlocked(t.topic_id)))
  );
$function$;
CREATE OR REPLACE FUNCTION public.topic_solution_unlocked(p_topic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when exists (
    select 1 from topics t left join topics s on s.id=t.source_topic_id
     where t.id=p_topic_id and (t.autocheck_solutions_after_finish or coalesce(s.autocheck_solutions_after_finish,false))
  ) then public.topic_autocheck_solutions_unlocked(p_topic_id) else (
    exists (
      select 1 from app_feature_flags f where f.key = 'read_only_mode' and f.enabled
    )
    or not exists (
      select 1 from topic_homework h where h.topic_id = p_topic_id
    )
    or exists (
      select 1
        from topic_homework_attempts a
        join topic_homework h on h.id = a.homework_id
       where h.topic_id = p_topic_id
         and a.student_id = public.auth_student_id()
         and a.status = 'accepted'
    )) end;
$function$;
