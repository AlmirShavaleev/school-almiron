-- ФИПИ, демоверсия ЕГЭ по физике 2027, «Система оценивания», задания 1–20.
-- https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2027/fi_11_2027.zip
create function public.score_mock_exam_physics_partial(p_task integer, p_key text, p_answer text)
returns integer
language plpgsql immutable
set search_path = ''
as $$
declare
  expected text := regexp_replace(coalesce(p_key, ''), '\s', '', 'g');
  answer text := regexp_replace(coalesce(p_answer, ''), '\s', '', 'g');
  missing_digits integer;
  extra_digits integer;
begin
  if p_task in (6, 10, 15, 17) then
    if expected !~ '^[1-5]{2}$' then return null; end if;
    if answer !~ '^[0-9]{2}$' then return 0; end if;
    return (substr(answer, 1, 1) = substr(expected, 1, 1))::integer
         + (substr(answer, 2, 1) = substr(expected, 2, 1))::integer;
  end if;

  if p_task in (5, 9, 14, 18) then
    if expected !~ '^[1-5]{2,3}$' then return null; end if;
    if answer !~ '^[0-9]{1,4}$' then return 0; end if;

    -- A substitution removes one expected digit and adds one extra digit.
    -- Count it once. A repeated digit is counted for each occurrence.
    with frequencies as (
      select d::text as digit from generate_series(0, 9) d
    ), differences as (
      select length(expected) - length(replace(expected, digit, ''))
           - length(answer) + length(replace(answer, digit, '')) as frequency_diff
        from frequencies
    )
    select sum(greatest(frequency_diff, 0)), sum(greatest(-frequency_diff, 0))
      into missing_digits, extra_digits
      from differences;
    return greatest(0, 2 - greatest(missing_digits, extra_digits));
  end if;
  return null;
end;
$$;

revoke all on function public.score_mock_exam_physics_partial(integer, text, text) from public, anon;
grant execute on function public.score_mock_exam_physics_partial(integer, text, text) to authenticated;

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
  select me.group_id, me.starts_at, t.max_points, t.part1_last,
         (t.subject::text = 'physics' and t.exam_type::text = 'ege'
           and t.year in (2026, 2027) and t.part1_last = 20) as use_physics_partial
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
        if v_exam.use_physics_partial and v_exam.max_points[i] = 2 and i in (5, 6, 9, 10, 14, 15, 17, 18) then
          v_a := public.score_mock_exam_physics_partial(i, v_skey[i], v_sheet.answers[i]);
        else
          v_verdict := public.variant_answer_verdict(
            public.normalize_variant_answer(v_skey[i]),
            public.normalize_variant_answer(coalesce(v_sheet.answers[i], '')));
          v_a := case when v_verdict then v_exam.max_points[i] when not v_verdict then 0 end;
        end if;
        if v_a is not null and (v_cur_p[i] is null or v_cur_p[i] = v_cur_a[i]) then
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
