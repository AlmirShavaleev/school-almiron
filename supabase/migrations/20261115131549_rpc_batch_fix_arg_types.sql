-- 15.11.2026. Исправление rpc_batch (20261115131439): proargtypes — oidvector с
-- нумерацией с 0, приведение к oid[] сохраняло нижнюю границу 0, и тип первого
-- аргумента терялся («a column definition list is required…»). Берём массив
-- через unnest — нумерация с 1, как у proargnames. Остальное без изменений.

create or replace function public.rpc_batch(p_calls jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_allowed constant text[] := array[
    'my_subscriptions', 'subscription_enabled', 'subscription_tariffs_public', 'my_work_mode',
    'get_student_topic_journal', 'student_home_courses', 'student_path_home', 'student_home_activity',
    'student_exam_forecast_evidence', 'student_visible_topics', 'student_tmi_visible_topics',
    'my_course_topic_locks', 'my_course_access', 'my_course_demo', 'my_course_assessments', 'my_mock_exams',
    'course_topic_tasks_progress_for_student', 'topic_solution_state', 'topic_student_variants',
    'topic_tasks_for_student', 'topic_autocheck_state', 'topic_template_link', 'courses_showcase',
    'my_live_timed_works', 'my_topic_rating', 'catalog_my_overview'
  ];
  v_out jsonb := '[]'::jsonb;
  v_call jsonb;
  v_fn text;
  v_args jsonb;
  v_oid oid;
  v_retset boolean;
  v_names text[];
  v_modes "char"[];
  v_types oid[];
  v_in_names text[];
  v_in_types oid[];
  v_key text;
  v_idx int;
  v_coldefs text[];
  v_callargs text[];
  v_target text;
  v_sql text;
  v_res jsonb;
  v_state text;
  v_msg text;
  v_detail text;
  v_hint text;
  i int;
begin
  if jsonb_typeof(p_calls) is distinct from 'array' or jsonb_array_length(p_calls) > 12 then
    raise exception 'rpc_batch: нужен массив не длиннее 12 вызовов' using errcode = '22023';
  end if;

  for v_call in select e.value from jsonb_array_elements(p_calls) as e(value) loop
    v_fn := v_call ->> 'fn';
    v_args := coalesce(v_call -> 'args', '{}'::jsonb);

    if v_fn is null or not (v_fn = any (v_allowed)) or jsonb_typeof(v_args) <> 'object' then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'status', 404,
        'body', jsonb_build_object('code', 'PGRST202', 'details', null, 'hint', null,
                                   'message', format('rpc_batch: функция не разрешена: %s', coalesce(v_fn, '?')))));
      continue;
    end if;

    v_oid := null;
    select p.oid, p.proretset, p.proargnames, p.proargmodes, array(select unnest(p.proargtypes))::oid[]
      into v_oid, v_retset, v_names, v_modes, v_types
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn
     limit 1;

    if v_oid is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'status', 404,
        'body', jsonb_build_object('code', 'PGRST202', 'details', null, 'hint', null,
                                   'message', format('Could not find the function public.%s', v_fn))));
      continue;
    end if;

    v_in_names := array[]::text[];
    v_in_types := v_types;
    if v_modes is null then
      v_in_names := coalesce(v_names[1:coalesce(array_length(v_types, 1), 0)], array[]::text[]);
    else
      for i in 1 .. coalesce(array_length(v_modes, 1), 0) loop
        if v_modes[i] in ('i', 'b', 'v') then
          v_in_names := v_in_names || v_names[i];
        end if;
      end loop;
    end if;

    v_coldefs := array[]::text[];
    v_callargs := array[]::text[];
    v_sql := null;
    for v_key in select jsonb_object_keys(v_args) loop
      v_idx := array_position(v_in_names, v_key);
      if v_idx is null then
        v_sql := 'bad-arg';
        exit;
      end if;
      v_coldefs := v_coldefs || format('%I %s', v_key, format_type(v_in_types[v_idx], null));
      v_callargs := v_callargs || format('%I => _.%I', v_key, v_key);
    end loop;

    if v_sql = 'bad-arg' then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'status', 404,
        'body', jsonb_build_object('code', 'PGRST202', 'details', null, 'hint', null,
                                   'message', format('Could not find the function public.%s with argument %s', v_fn, v_key))));
      continue;
    end if;

    v_target := format('%I.%I(%s)', 'public', v_fn, array_to_string(v_callargs, ', '));
    if array_length(v_coldefs, 1) is null then
      v_sql := case when v_retset
        then format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from %s t', v_target)
        else format('select to_jsonb(%s)', v_target) end;
    else
      v_sql := case when v_retset
        then format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from jsonb_to_record($1) as _(%s) cross join lateral %s t',
                    array_to_string(v_coldefs, ', '), v_target)
        else format('select to_jsonb(%s) from jsonb_to_record($1) as _(%s)', v_target, array_to_string(v_coldefs, ', ')) end;
    end if;

    begin
      execute v_sql into v_res using v_args;
      v_out := v_out || jsonb_build_array(jsonb_build_object('status', 200, 'body', v_res));
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'status', case v_state when '42501' then 403 when 'P0002' then 404 else 400 end,
        'body', jsonb_build_object('code', v_state, 'message', v_msg,
                                   'details', nullif(v_detail, ''), 'hint', nullif(v_hint, ''))));
    end;
  end loop;

  return v_out;
end;
$$;

revoke all on function public.rpc_batch(jsonb) from public;
revoke all on function public.rpc_batch(jsonb) from anon;
grant execute on function public.rpc_batch(jsonb) to authenticated;

comment on function public.rpc_batch(jsonb) is
  '15.11.2026: пакет чтений для клиента (src/lib/perf/rpcBatch.ts). SECURITY INVOKER, только функции из списка, формат ответа как у PostgREST.';
