-- §269. Функции ПРОДА дословно (pg_get_functiondef, снято MCP 08.10.2026, только чтение), поверх цепочки §262:
-- PENDING_269 правит их по образцам, и образцы должны совпасть с телами прода, а не с ранними редакциями из
-- supabase/migrations (часть тел на проде правилась DO-блоками и после). Тела не проверяются при создании
-- (check_function_bodies = off): student_school_points_of ссылается на таблицы, которых в слепке нет, —
-- она здесь только для проверки правки текста.
set check_function_bodies = off;

-- normalize_variant_answer (md5 prosrc 9939a53013f31976b299e7e891b5285e)
CREATE OR REPLACE FUNCTION public.normalize_variant_answer(raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT lower(
    btrim(
      regexp_replace(
        replace(translate(raw, E'−–— ', '--- '), ',', '.'),
        '\s+', ' ', 'g'
      )
    )
  );
$function$;

-- strip_html_simple (md5 prosrc 1d7d8602763e56daac7347d96cb0f5b4)
CREATE OR REPLACE FUNCTION public.strip_html_simple(html text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$ SELECT trim(regexp_replace(html, '<[^>]+>', '', 'g')); $function$;

-- normalize_answer_digits (md5 prosrc 4cdeb859c89d388987e579a28e4a88f7)
CREATE OR REPLACE FUNCTION public.normalize_answer_digits(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select regexp_replace(coalesce(p_value, ''), '\D', '', 'g')
$function$;

-- variant_answer_alternatives (md5 prosrc 1e4c5137fece637df613179c56d885d8)
CREATE OR REPLACE FUNCTION public.variant_answer_alternatives(p_correct_norm text)
 RETURNS numeric[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    -- Одно число — единственная альтернатива.
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?$'
      then array[p_correct_norm::numeric]
    -- Перечисление через пробел, и только если значения эквивалентны.
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?( +-?[0-9]+(\.[0-9]+)?)+$'
     and (
       select count(distinct (
         select string_agg(c, '' order by c)
         from regexp_split_to_table(replace(replace(el, '-', ''), '.', ''), '') c
       ))
       from regexp_split_to_table(p_correct_norm, ' +') el
     ) = 1
      then (select array_agg(el::numeric) from regexp_split_to_table(p_correct_norm, ' +') el)
    else null
  end;
$function$;

-- variant_answer_required_set (md5 prosrc de63c50d156dd6687c3087a10f8498a2)
CREATE OR REPLACE FUNCTION public.variant_answer_required_set(p_correct_norm text)
 RETURNS numeric[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?( *; *-?[0-9]+(\.[0-9]+)?)+$'
      then (select array_agg(el::numeric order by el::numeric)
            from regexp_split_to_table(p_correct_norm, ' *; *') el)
    else null
  end;
$function$;

-- variant_answer_student_set (md5 prosrc 512ed82a456b58ef7ac6a152bc3e8d6a)
CREATE OR REPLACE FUNCTION public.variant_answer_student_set(p_student_norm text)
 RETURNS numeric[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_student_norm ~ '^-?[0-9]+(\.[0-9]+)?$'
      then array[p_student_norm::numeric]
    when p_student_norm ~ '^-?[0-9]+(\.[0-9]+)?([ ;]+-?[0-9]+(\.[0-9]+)?)+$'
      then (select array_agg(el::numeric order by el::numeric)
            from regexp_split_to_table(p_student_norm, '[ ;]+') el)
    else null
  end;
$function$;

-- variant_answer_value_error_pair (md5 prosrc 67c1012e53332edf0fc7a263b61ea96e)
CREATE OR REPLACE FUNCTION public.variant_answer_value_error_pair(p_correct_norm text)
 RETURNS numeric[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  with valid as (
    select left(p_correct_norm, i) lft, substr(p_correct_norm, i + 1) rgt
    from generate_series(1, coalesce(length(p_correct_norm), 0) - 1) i
    -- Каноническая запись обеих частей: «00,005» не число, а след неверного реза.
    where left(p_correct_norm, i)       ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      and substr(p_correct_norm, i + 1) ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      -- Погрешность не бывает больше самого значения.
      and left(p_correct_norm, i)::numeric >= substr(p_correct_norm, i + 1)::numeric
  )
  select case
    -- Одиночное число разбирать нечего: им занимается variant_answer_alternatives.
    -- Проверка стоит здесь, а не в порядке ветвей, чтобы перестановка ветвей
    -- когда-нибудь не превратила ответ «125» в «12 ± 5».
    when p_correct_norm ~ '^-?[0-9]+(\.[0-9]+)?$' then null
    when count(*) = 1 then array[min(lft)::numeric, min(rgt)::numeric]
    else null
  end
  from valid;
$function$;

-- variant_answer_can_auto_check (md5 prosrc 0751ddb8bb0dfc1cc7113ec2561c4a8a)
CREATE OR REPLACE FUNCTION public.variant_answer_can_auto_check(p_correct_norm text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_correct_norm is not null
     and (public.variant_answer_alternatives(p_correct_norm)     is not null
       or public.variant_answer_required_set(p_correct_norm)     is not null
       or public.variant_answer_value_error_pair(p_correct_norm) is not null
       or p_correct_norm in ('да', 'нет'));
$function$;

-- variant_answer_is_auto_checkable (md5 prosrc c3738b094b12e66ab63e7aae741bc9b2)
CREATE OR REPLACE FUNCTION public.variant_answer_is_auto_checkable(p_answer_html text, p_partial_type text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_answer_html is null or p_answer_html = '' then false
    when p_partial_type is not null then true
    else public.variant_answer_can_auto_check(
           public.normalize_variant_answer(public.strip_html_simple(p_answer_html)))
  end;
$function$;

-- variant_answer_verdict (md5 prosrc f7260f364a96d74615ffe12f69e6dd56)
CREATE OR REPLACE FUNCTION public.variant_answer_verdict(p_correct_norm text, p_student_norm text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    -- Любое из эквивалентных значений («13 31», «0.004 -0.004», одно число).
    when public.variant_answer_alternatives(p_correct_norm) is not null then
      coalesce(
        p_student_norm ~ '^-?[0-9]+(\.[0-9]+)?$'
        and p_student_norm::numeric = any (public.variant_answer_alternatives(p_correct_norm)),
        false)
    -- Все значения обязательны, порядок не важен («19; 11», «-6; 7»).
    when public.variant_answer_required_set(p_correct_norm) is not null then
      coalesce(
        public.variant_answer_student_set(p_student_norm)
          = public.variant_answer_required_set(p_correct_norm),
        false)
    -- Значение и погрешность: нужны ОБЕ части и именно в этом порядке.
    -- Разделитель у ученика любой разумный — пробел, точка с запятой, «±», —
    -- либо слитно, как в эталоне.
    when public.variant_answer_value_error_pair(p_correct_norm) is not null then
      coalesce(
        p_student_norm = p_correct_norm
        or (
          p_student_norm ~ '^[0-9]+(\.[0-9]+)?[ ;±]+[0-9]+(\.[0-9]+)?$'
          and (regexp_split_to_array(p_student_norm, '[ ;±]+'))[1]::numeric
              = (public.variant_answer_value_error_pair(p_correct_norm))[1]
          and (regexp_split_to_array(p_student_norm, '[ ;±]+'))[2]::numeric
              = (public.variant_answer_value_error_pair(p_correct_norm))[2]
        ),
        false)
    -- Да/нет: точное совпадение, регистр уже снят нормализацией.
    when p_correct_norm in ('да', 'нет') then
      (p_student_norm = p_correct_norm)
    else null
  end;
$function$;

-- score_partial_multi_choice (md5 prosrc 6a896a7e5fef4ad3fa7a7efa9ee8420d)
CREATE OR REPLACE FUNCTION public.score_partial_multi_choice(p_student_raw text, p_correct_raw text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_student text := public.normalize_answer_digits(p_student_raw);
  v_correct text := public.normalize_answer_digits(p_correct_raw);
  v_symdiff_count integer;
begin
  if v_student = '' or v_correct = '' then
    return 0;
  end if;

  with student_digits as (
    select ch, count(*) as cnt
    from regexp_split_to_table(v_student, '') ch
    where ch <> ''
    group by ch
  ),
  correct_digits as (
    select ch, count(*) as cnt
    from regexp_split_to_table(v_correct, '') ch
    where ch <> ''
    group by ch
  ),
  merged as (
    select
      coalesce(s.ch, c.ch) as ch,
      coalesce(s.cnt, 0) as student_cnt,
      coalesce(c.cnt, 0) as correct_cnt
    from student_digits s
    full join correct_digits c using (ch)
  )
  select coalesce(sum(abs(student_cnt - correct_cnt)), 0)
    into v_symdiff_count
  from merged;

  if v_symdiff_count = 0 then
    return 2;
  elsif v_symdiff_count = 1 then
    return 1;
  else
    return 0;
  end if;
end;
$function$;

-- score_partial_matching (md5 prosrc 238161bfb30c29852e42bb94f0bcfd83)
CREATE OR REPLACE FUNCTION public.score_partial_matching(p_student_raw text, p_correct_raw text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_student text := public.normalize_answer_digits(p_student_raw);
  v_correct text := public.normalize_answer_digits(p_correct_raw);
  v_len_student integer := char_length(v_student);
  v_len_correct integer := char_length(v_correct);
  v_mismatches integer := 0;
  i integer;
begin
  if v_student = '' or v_correct = '' then
    return 0;
  end if;

  if v_len_student > v_len_correct then
    return 0;
  end if;

  for i in 1..v_len_correct loop
    if substr(v_student, i, 1) is distinct from substr(v_correct, i, 1) then
      v_mismatches := v_mismatches + 1;
    end if;
  end loop;

  if v_mismatches = 0 then
    return 2;
  elsif v_mismatches = 1 then
    return 1;
  else
    return 0;
  end if;
end;
$function$;

-- score_auto_answer (md5 prosrc 582fc14671e80a31bb8e9e957678d9db)
CREATE OR REPLACE FUNCTION public.score_auto_answer(p_student_raw text, p_correct_raw text, p_partial_type text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
begin
  case p_partial_type
    when 'multi_choice' then
      return public.score_partial_multi_choice(p_student_raw, p_correct_raw);
    when 'matching' then
      return public.score_partial_matching(p_student_raw, p_correct_raw);
    else
      if public.normalize_answer_digits(p_student_raw) = public.normalize_answer_digits(p_correct_raw)
         and public.normalize_answer_digits(p_correct_raw) <> '' then
        return 1;
      else
        return 0;
      end if;
  end case;
end;
$function$;

-- catalog_task_verdict (md5 prosrc eb4384d6287731ea0181556ecc593d5b)
CREATE OR REPLACE FUNCTION public.catalog_task_verdict(p_answer_html text, p_partial_type text, p_answer_raw text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
           when p_partial_type is not null then
             coalesce(public.score_auto_answer(
               public.normalize_variant_answer(p_answer_raw),
               public.normalize_variant_answer(public.strip_html_simple(p_answer_html)),
               p_partial_type) = 2, false)
           else
             coalesce(public.variant_answer_verdict(
               public.normalize_variant_answer(public.strip_html_simple(p_answer_html)),
               public.normalize_variant_answer(p_answer_raw)), false)
         end;
$function$;

-- catalog_task_checkable (md5 prosrc c92b9206638b42c171b7c46663cfc53d)
CREATE OR REPLACE FUNCTION public.catalog_task_checkable(p_exam_part integer, p_answer_html text, p_partial_type text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(p_exam_part, 1) <> 2
     and public.variant_answer_is_auto_checkable(p_answer_html, p_partial_type);
$function$;

-- autocheck_sorted_chars (md5 prosrc 36541df0f0ae466ec86ac568306f0e5a)
CREATE OR REPLACE FUNCTION public.autocheck_sorted_chars(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select string_agg(c, '' order by c) from regexp_split_to_table(p, '') as c;
$function$;

-- autocheck_digits_of (md5 prosrc 0c11562bc24fb0c2a7f2b5d22077db9c)
CREATE OR REPLACE FUNCTION public.autocheck_digits_of(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when x.s ~ '^[0-9]+$' then x.s end
    from (select regexp_replace(coalesce(p_raw, ''), E'[\\s   ,;.]', '', 'g') as s) x;
$function$;

-- autocheck_number_of (md5 prosrc a46f612a05ecb56eae4de2dd74439bc3)
CREATE OR REPLACE FUNCTION public.autocheck_number_of(p_raw text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when x.s ~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$' then x.s::numeric end
    from (
      select regexp_replace(
               translate(public.normalize_variant_answer(coalesce(p_raw, '')), E'−–—', '---'),
               E'[\\s   ]', '', 'g') as s
    ) x;
$function$;

-- autocheck_answer_correct (md5 prosrc 819b6e3631650ea952a937e8de359b3a)
CREATE OR REPLACE FUNCTION public.autocheck_answer_correct(p_type text, p_value numeric, p_tol numeric, p_text text, p_any_order boolean, p_raw text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_type
    when 'number' then
      case when public.autocheck_number_of(p_raw) is null then null
           else abs(public.autocheck_number_of(p_raw) - p_value) <= coalesce(p_tol, 0) end
    when 'digits' then
      case when public.autocheck_digits_of(p_raw) is null then null
           when p_any_order then public.autocheck_sorted_chars(public.autocheck_digits_of(p_raw))
                                 = public.autocheck_sorted_chars(p_text)
           else public.autocheck_digits_of(p_raw) = p_text end
    else null
  end;
$function$;

-- catalog_check_answer (md5 prosrc 45011301242154b22cf749807e114acc)
CREATE OR REPLACE FUNCTION public.catalog_check_answer(p_task_id uuid, p_answer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_rules    jsonb := public.catalog_reward_rules();
  v_today    date := (now() at time zone 'Europe/Moscow')::date;
  v_week     date := date_trunc('week', (now() at time zone 'Europe/Moscow'))::date;
  v_task     record;
  v_answer   text;
  v_subject  text;
  v_n        integer;
  v_revealed boolean;
  v_correct  boolean;
  v_counted  boolean;
  v_zone     text;
  v_share    numeric;
  v_points   integer := 0;
  v_solved   integer := 0;
  v_mile     integer := 0;
  v_daily    integer := 0;
  v_gsubj    text;
  v_gnums    integer[];
  v_gstart   date;
  v_gtarget  integer;
  v_wprog    integer;
  v_wbonus   integer := 0;
  v_prev     record;
begin
  if v_uid is null then
    raise exception 'catalog_check_answer: нужен вход' using errcode = '42501';
  end if;

  select ct.id, ct.answer_html, ct.partial_type, ct.exam_part, cs.subject, cs.exam_type, cs.exam_number
    into v_task
    from public.catalog_tasks ct
    join public.catalog_sections cs on cs.id = ct.section_id
   where ct.id = p_task_id and ct.is_published and cs.is_published;
  if not found then
    raise exception 'NOT_FOUND: задача не найдена' using errcode = 'P0002';
  end if;
  if not public.catalog_task_checkable(v_task.exam_part, v_task.answer_html, v_task.partial_type) then
    raise exception 'NOT_CHECKABLE: у этой задачи нет короткого ответа для проверки' using errcode = '22023';
  end if;

  v_answer := left(btrim(coalesce(p_answer, '')), 200);
  if v_answer = '' then
    raise exception 'EMPTY_ANSWER: введите ответ' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('catalog_check:' || v_uid::text || ':' || p_task_id::text));

  if (select count(*) from public.catalog_task_attempts a
       where a.profile_id = v_uid and a.created_at > now() - interval '1 minute')
     >= (v_rules->>'checks_per_minute')::int then
    raise exception 'RATE_LIMIT: не больше % проверок в минуту', v_rules->>'checks_per_minute' using errcode = '54000';
  end if;

  v_correct := public.catalog_task_verdict(v_task.answer_html, v_task.partial_type, v_answer);
  v_subject := public.catalog_subject_key(v_task.subject, v_task.exam_type);
  v_n := case when v_task.exam_number >= 1 then v_task.exam_number::int end;

  select a.revealed_before into v_prev
    from public.catalog_task_attempts a
   where a.profile_id = v_uid and a.task_id = p_task_id and a.verdict = 'correct'
   order by a.created_at limit 1;
  if found then
    return jsonb_build_object(
      'verdict', case when v_correct then 'correct' else 'wrong' end,
      'already_solved', true,
      'counted', false,
      'revealed_before', v_prev.revealed_before,
      'points', 0, 'milestone_bonus', 0, 'daily_bonus', 0, 'weekly_bonus', 0,
      'subject', v_subject, 'n', v_n,
      'answer_html', case when v_correct then v_task.answer_html end);
  end if;

  v_revealed := exists (select 1 from public.catalog_task_reveals rv where rv.profile_id = v_uid and rv.task_id = p_task_id);

  if v_subject is not null and v_n is not null then
    select z.share, z.zone into v_share, v_zone
      from public.student_kim_zone_shares(v_uid, array[v_subject], array[v_n], array[now()]) z;
  end if;

  insert into public.catalog_task_attempts (profile_id, task_id, answer, verdict, revealed_before)
  values (v_uid, p_task_id, v_answer, case when v_correct then 'correct' else 'wrong' end, v_revealed);

  v_counted := v_correct and not v_revealed;

  if v_correct then
    update public.catalog_task_progress
       set is_completed = true, completed_at = coalesce(completed_at, now()), updated_at = now()
     where user_id = v_uid and task_id = p_task_id;
    if not found then
      insert into public.catalog_task_progress (user_id, task_id, is_completed, completed_at, updated_at)
      values (v_uid, p_task_id, true, now(), now());
    end if;
  end if;

  if v_subject is not null and v_n is not null then
    select count(*)::int into v_solved
      from public.catalog_counted_solutions(v_uid) s
     where s.subject = v_subject and s.n = v_n;
    if v_counted then
      v_points := public.catalog_zone_points(v_zone);
      v_mile := public.catalog_zone_milestone(v_zone, v_solved);
    end if;
  end if;

  if v_counted then
    if exists (select 1 from public.student_daily_tasks d
                where d.profile_id = v_uid and d.day = v_today and d.task_id = p_task_id) then
      v_daily := (v_rules->>'daily_task')::int;
    end if;
    select g.subject, g.numbers, g.week_start, g.target into v_gsubj, v_gnums, v_gstart, v_gtarget
      from public.student_weekly_goals g
     where g.profile_id = v_uid and g.week_start = v_week and g.subject = v_subject and v_n = any (g.numbers);
    if v_gsubj is not null then
      select count(*)::int into v_wprog
        from public.catalog_counted_solutions(v_uid) s
       where s.subject = v_gsubj and s.n = any (v_gnums)
         and (s.at at time zone 'Europe/Moscow')::date between v_gstart and v_gstart + 6;
      if v_wprog = v_gtarget then
        v_wbonus := (v_rules->>'weekly_goal')::int;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'verdict', case when v_correct then 'correct' else 'wrong' end,
    'already_solved', false,
    'counted', v_counted,
    'revealed_before', v_revealed,
    'subject', v_subject,
    'n', v_n,
    'zone', v_zone,
    'share', v_share,
    'points', v_points,
    'solved', v_solved,
    'milestone_bonus', v_mile,
    'daily_bonus', v_daily,
    'weekly_bonus', v_wbonus,
    'weekly', case when v_gsubj is not null then
      jsonb_build_object('progress', v_wprog, 'target', v_gtarget) end,
    'answer_html', case when v_correct then v_task.answer_html end
  );
end;
$function$;

-- submit_variant (md5 prosrc 127dd59cc0dc7371652f76f051979720)
CREATE OR REPLACE FUNCTION public.submit_variant(p_student_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tvsa             record;
  v_item             record;
  v_student_norm     text;
  v_correct_norm     text;
  v_auto_check       boolean;
  v_is_correct       boolean;
  v_points_earned    numeric(10,2);
  v_partial_score    integer;
  v_answered_cnt     integer       := 0;
  v_correct_cnt      integer       := 0;
  v_auto_score       numeric(10,2) := 0;
  v_total_max        numeric(10,2) := 0;
  v_manual_rev_cnt   integer       := 0;
  v_percentage       numeric(5,2);
  v_has_attach       boolean;
  v_grading_status   text;
BEGIN
  SELECT tvsa.id, tvsa.status, tvsa.variant_id, tvsa.started_at,
         tvsa.submitted_at, tvsa.completed_at,
         tvsa.answered_count, tvsa.correct_count,
         tvsa.score, tvsa.max_score, tvsa.percentage,
         tvsa.grading_status
  INTO v_tvsa
  FROM public.test_variant_student_assignments tvsa
  JOIN public.students s ON s.id = tvsa.student_id
  WHERE tvsa.id = p_student_assignment_id
    AND s.profile_id = auth.uid()
  FOR UPDATE OF tvsa;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESS_DENIED: assignment not found or not owned by caller';
  END IF;

  IF v_tvsa.status = 'cancelled' THEN
    RAISE EXCEPTION 'ACCESS_DENIED: assignment is cancelled';
  END IF;

  IF v_tvsa.status IN ('submitted', 'completed') THEN
    RETURN jsonb_build_object(
      'status',               v_tvsa.status,
      'answered_count',       v_tvsa.answered_count,
      'correct_count',        v_tvsa.correct_count,
      'score',                v_tvsa.score,
      'max_score',            v_tvsa.max_score,
      'percentage',           v_tvsa.percentage,
      'grading_status',       v_tvsa.grading_status,
      'manual_review_count',  0,
      'submitted_at',         v_tvsa.submitted_at,
      'completed_at',         v_tvsa.completed_at
    );
  END IF;

  IF v_tvsa.started_at IS NULL THEN
    RAISE EXCEPTION 'NOT_STARTED: cannot submit a variant that was never started';
  END IF;

  FOR v_item IN (
    SELECT tvi.id AS item_id, tvi.points, tvi.grading_type,
           ct.answer_html, ct.has_answer, ct.partial_type
    FROM public.test_variant_items tvi
    JOIN public.catalog_tasks ct ON ct.id = tvi.task_id
    WHERE tvi.variant_id = v_tvsa.variant_id
    ORDER BY tvi.position
  ) LOOP
    v_total_max := v_total_max + v_item.points;

    SELECT tva.answer_normalized, tva.has_attachment
    INTO v_student_norm, v_has_attach
    FROM public.test_variant_answers tva
    WHERE tva.student_assignment_id = p_student_assignment_id
      AND tva.variant_item_id = v_item.item_id;

    v_student_norm := COALESCE(v_student_norm, '');
    v_has_attach   := COALESCE(v_has_attach, false);

    IF v_student_norm != '' OR v_has_attach THEN
      v_answered_cnt := v_answered_cnt + 1;
    END IF;

    -- ── MANUAL task ────────────────────────────────────────────────────────
    IF v_item.grading_type = 'manual' THEN
      IF v_student_norm != '' OR v_has_attach THEN
        v_manual_rev_cnt := v_manual_rev_cnt + 1;

        INSERT INTO public.test_variant_answers (
          student_assignment_id, variant_item_id,
          answer_raw, answer_normalized,
          is_correct, points_earned, points_max,
          has_attachment,
          grading_status, submitted_at
        ) VALUES (
          p_student_assignment_id, v_item.item_id,
          v_student_norm, v_student_norm,
          NULL, NULL, v_item.points,
          v_has_attach,
          'pending_review', now()
        )
        ON CONFLICT (student_assignment_id, variant_item_id)
        DO UPDATE SET
          is_correct    = NULL,
          points_earned = NULL,
          points_max    = v_item.points,
          has_attachment = EXCLUDED.has_attachment,
          grading_status = 'pending_review',
          submitted_at  = now();
      ELSE
        UPDATE public.test_variant_answers
        SET is_correct     = false,
            points_earned  = 0,
            points_max     = v_item.points,
            grading_status = 'not_answered',
            submitted_at   = now()
        WHERE student_assignment_id = p_student_assignment_id
          AND variant_item_id = v_item.item_id;
      END IF;
      CONTINUE;
    END IF;

    -- ── AUTO task ───────────────────────────────────────────────────────────
    IF v_item.has_answer
       AND v_item.answer_html IS NOT NULL
       AND v_item.answer_html != ''
    THEN
      v_correct_norm := public.normalize_variant_answer(
        public.strip_html_simple(v_item.answer_html)
      );
      v_auto_check := public.variant_answer_can_auto_check(v_correct_norm);
    ELSE
      v_correct_norm := NULL;
      v_auto_check   := false;
    END IF;

    IF v_item.partial_type IS NOT NULL AND v_correct_norm IS NOT NULL THEN
      v_partial_score := public.score_auto_answer(v_student_norm, v_correct_norm, v_item.partial_type);
      v_is_correct    := (v_partial_score = 2);
      v_points_earned := ROUND((v_partial_score::numeric / 2) * v_item.points, 2);
    ELSIF v_auto_check THEN
      v_is_correct    := COALESCE(public.variant_answer_verdict(v_correct_norm, v_student_norm), false);
      v_points_earned := CASE WHEN v_is_correct THEN v_item.points::numeric ELSE 0 END;
    ELSE
      v_is_correct    := NULL;
      v_points_earned := NULL;
    END IF;

    IF v_is_correct IS TRUE THEN
      v_correct_cnt := v_correct_cnt + 1;
    END IF;
    v_auto_score := v_auto_score + COALESCE(v_points_earned, 0);

    UPDATE public.test_variant_answers
    SET is_correct     = v_is_correct,
        points_earned  = v_points_earned,
        points_max     = v_item.points,
        grading_status = 'auto_graded',
        submitted_at   = now()
    WHERE student_assignment_id = p_student_assignment_id
      AND variant_item_id = v_item.item_id;
  END LOOP;

  IF v_manual_rev_cnt > 0 THEN
    v_grading_status := 'needs_review';
    v_percentage := NULL;
  ELSE
    v_grading_status := 'auto_graded';
    IF v_total_max > 0 THEN
      v_percentage := ROUND(v_auto_score / v_total_max * 100, 2);
    ELSE
      v_percentage := NULL;
    END IF;
  END IF;

  UPDATE public.test_variant_student_assignments
  SET status              = 'submitted',
      submitted_at        = now(),
      completed_at        = now(),
      answered_count      = v_answered_cnt,
      correct_count       = v_correct_cnt,
      score               = v_auto_score,
      max_score           = v_total_max,
      percentage          = v_percentage,
      auto_score          = v_auto_score,
      manual_review_count = v_manual_rev_cnt,
      grading_status      = v_grading_status,
      attempts_used       = attempts_used + 1,
      updated_at          = now()
  WHERE id = p_student_assignment_id;

  RETURN jsonb_build_object(
    'status',               'submitted',
    'answered_count',       v_answered_cnt,
    'correct_count',        v_correct_cnt,
    'score',                v_auto_score,
    'max_score',            v_total_max,
    'percentage',           v_percentage,
    'grading_status',       v_grading_status,
    'manual_review_count',  v_manual_rev_cnt,
    'submitted_at',         now(),
    'completed_at',         now()
  );
END;
$function$;

-- answer_topic_task (md5 prosrc 3670128570ba1d97134c91eed105b185)
CREATE OR REPLACE FUNCTION public.answer_topic_task(p_topic_id uuid, p_item_id uuid, p_answer_raw text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sa_id    uuid;
  v_task     record;
  v_closed   text;
  v_shown    timestamptz;
  v_norm     text;
  v_correct  boolean;
  v_attempts integer;
  v_points   integer;
BEGIN
  SELECT tvsa.id INTO v_sa_id
  FROM public.test_variant_assignments tva
  JOIN public.test_variant_student_assignments tvsa ON tvsa.assignment_id = tva.id
  JOIN public.students s ON s.id = tvsa.student_id
  JOIN public.test_variant_items tvi ON tvi.variant_id = tva.variant_id AND tvi.id = p_item_id
  WHERE tva.topic_id = p_topic_id
    AND s.profile_id = auth.uid()
    AND tvsa.status <> 'cancelled'
    AND public.course_student_can_see_topic(p_topic_id);

  IF v_sa_id IS NULL THEN
    RAISE EXCEPTION 'ACCESS_DENIED: task not found for this student';
  END IF;

  SELECT ct.answer_html, ct.partial_type, tvi.points,
         public.variant_answer_is_auto_checkable(ct.answer_html, ct.partial_type) AS auto_ok
  INTO v_task
  FROM public.test_variant_items tvi
  JOIN public.catalog_tasks ct ON ct.id = tvi.task_id
  WHERE tvi.id = p_item_id;

  IF NOT v_task.auto_ok THEN
    RAISE EXCEPTION 'NOT_AUTO_CHECKABLE: this task is closed by self-check after the solution is shown';
  END IF;

  SELECT closed_by, solution_shown_at INTO v_closed, v_shown
  FROM public.test_variant_answers
  WHERE student_assignment_id = v_sa_id AND variant_item_id = p_item_id;

  IF v_closed IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_SOLVED: task is already closed';
  END IF;

  -- После подсмотренного разбора ответ не засчитывается «по ответу»: задача
  -- закрывается отметкой «Разобрал» (§176).
  IF v_shown IS NOT NULL THEN
    RAISE EXCEPTION 'SOLUTION_SHOWN: answer after solution is self-check';
  END IF;

  UPDATE public.test_variant_student_assignments
  SET status     = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = v_sa_id;

  v_norm := public.normalize_variant_answer(p_answer_raw);

  v_correct := COALESCE(
    public.variant_answer_verdict(
      public.normalize_variant_answer(public.strip_html_simple(v_task.answer_html)),
      v_norm),
    false);

  v_points := CASE WHEN v_correct THEN COALESCE(v_task.points, 1) ELSE 0 END;

  INSERT INTO public.test_variant_answers (
    student_assignment_id, variant_item_id, answer_raw, answer_normalized,
    is_correct, points_earned, points_max, attempts_count, closed_by,
    grading_status, first_answered_at, last_changed_at
  ) VALUES (
    v_sa_id, p_item_id, p_answer_raw, v_norm,
    v_correct, v_points, COALESCE(v_task.points, 1), 1,
    CASE WHEN v_correct THEN 'auto' END,
    'auto_graded', now(), now()
  )
  ON CONFLICT (student_assignment_id, variant_item_id) DO UPDATE
    SET answer_raw        = EXCLUDED.answer_raw,
        answer_normalized = EXCLUDED.answer_normalized,
        is_correct        = EXCLUDED.is_correct,
        points_earned     = EXCLUDED.points_earned,
        points_max        = EXCLUDED.points_max,
        attempts_count    = public.test_variant_answers.attempts_count + 1,
        closed_by         = EXCLUDED.closed_by,
        grading_status    = 'auto_graded',
        last_changed_at   = now()
  RETURNING attempts_count INTO v_attempts;

  RETURN jsonb_build_object(
    'is_correct',     v_correct,
    'attempts_count', v_attempts,
    'solved',         (SELECT count(*) FROM public.test_variant_answers a
                        WHERE a.student_assignment_id = v_sa_id AND a.closed_by IS NOT NULL),
    'total',          (SELECT count(*) FROM public.test_variant_items i
                        JOIN public.test_variant_student_assignments x ON x.id = v_sa_id
                       WHERE i.variant_id = x.variant_id)
  );
END;
$function$;

-- preview_task_verdict (md5 prosrc 75dc6a3b79c2227f796936644f592450)
CREATE OR REPLACE FUNCTION public.preview_task_verdict(p_task_id uuid, p_answer_raw text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_answer_html  text;
  v_partial_type text;
begin
  if not (
    exists (select 1 from public.teachers t where t.profile_id = auth.uid())
    or public.is_admin_or_owner()
  ) then
    raise exception 'STAFF_ONLY: preview verdict is available to platform staff only';
  end if;

  select ct.answer_html, ct.partial_type
    into v_answer_html, v_partial_type
    from public.catalog_tasks ct
   where ct.id = p_task_id;

  if not found then
    raise exception 'ACCESS_DENIED: task not found';
  end if;

  if not public.variant_answer_is_auto_checkable(v_answer_html, v_partial_type) then
    return null;
  end if;

  return coalesce(
    public.variant_answer_verdict(
      public.normalize_variant_answer(public.strip_html_simple(v_answer_html)),
      public.normalize_variant_answer(p_answer_raw)),
    false);
end;
$function$;

-- catalog_counted_solutions (md5 prosrc 58792cf260399691964cbfe7f816c99b)
CREATE OR REPLACE FUNCTION public.catalog_counted_solutions(p_profile_id uuid)
 RETURNS TABLE(task_id uuid, attempt_id uuid, at timestamp with time zone, subject text, n integer, section_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select distinct on (a.task_id)
         a.task_id, a.id, a.created_at,
         public.catalog_subject_key(cs.subject, cs.exam_type), cs.exam_number::int, cs.id
    from public.catalog_task_attempts a
    join public.catalog_tasks ct on ct.id = a.task_id and ct.is_published
    join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published
   where a.profile_id = p_profile_id
     and a.verdict = 'correct'
     and not a.revealed_before
     and cs.exam_number >= 1
     and public.catalog_subject_key(cs.subject, cs.exam_type) is not null
   order by a.task_id, a.created_at, a.id;
$function$;

-- student_exam_evidence_rows (md5 prosrc 87a749d992f49da55b4172ca63713c0b)
CREATE OR REPLACE FUNCTION public.student_exam_evidence_rows(p_profile_id uuid, p_from timestamp with time zone)
 RETURNS TABLE(subject text, ns integer[], source text, score numeric, at timestamp with time zone, item text, kim_total integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with st as (
    select s.id from public.students s where s.profile_id = p_profile_id
  ),
  hw_last as (
    select distinct on (a.homework_id, lower(btrim(rt.no)))
           a.homework_id, h.topic_id, lower(btrim(rt.no)) as no, rt.verdict, a.submitted_at
      from public.topic_homework_review_tasks rt
      join public.topic_homework_attempts a on a.id = rt.attempt_id
      join public.topic_homework h on h.id = a.homework_id
     where a.student_id in (select id from st)
       and a.submitted_at is not null
       and rt.verdict in ('correct', 'partial', 'wrong', 'unsolved')
       and exists (select 1 from public.topic_homework_reviews r where r.attempt_id = a.id)
     order by a.homework_id, lower(btrim(rt.no)), a.submitted_at desc, a.attempt_number desc
  ),
  hw_rows as (
    select c.subject::text as subject,
           t.ege_task_numbers::int[] as ns,
           'hw'::text as source,
           case x.verdict when 'correct' then 1.0 when 'partial' then 0.5 else 0.0 end::numeric as score,
           x.submitted_at as at,
           'hw:' || x.homework_id::text || ':' || x.no as item,
           null::int as kim_total
      from hw_last x
      join public.topics t on t.id = x.topic_id
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
     where x.submitted_at >= p_from
       and cardinality(t.ege_task_numbers) > 0
       and c.exam_type::text = 'ege'
       and c.subject::text in ('math', 'physics')
  ),
  test_rows as (
    select c.subject::text as subject,
           coalesce(
             (select array[cs.exam_number::int]
                from public.catalog_tasks ct
                join public.catalog_sections cs on cs.id = ct.section_id
               where ct.id = i.task_id and cs.exam_type = 'ЕГЭ' and cs.exam_number >= 1
                 and cs.subject = case c.subject::text when 'math' then 'Математика' when 'physics' then 'Физика' end),
             t.ege_task_numbers::int[]) as ns,
           'test'::text as source,
           case
             when i.max_points > 0 and ans.awarded_points is not null
               then least(1.0, ans.awarded_points::numeric / i.max_points)
             when coalesce(ans.is_correct, false) then 1.0
             else 0.0
           end::numeric as score,
           att.completed_at as at,
           'test:' || ans.id::text as item,
           null::int as kim_total
      from public.topic_test_answers ans
      join public.topic_test_attempts att on att.id = ans.attempt_id
      join public.topic_test_items i on i.id = ans.item_id
      join public.topic_test_assignments tta on tta.id = att.assignment_id
      join public.topics t on t.id = tta.topic_id
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
     where att.student_id in (select id from st)
       and att.status = 'completed'
       and att.completed_at >= p_from
       and c.exam_type::text = 'ege'
       and c.subject::text in ('math', 'physics')
  ),
  mock_rows as (
    select me.subject::text as subject,
           array[s.task_number::int] as ns,
           'mock'::text as source,
           least(1.0, s.points::numeric / tpl.max_points[s.task_number]) as score,
           coalesce(me.starts_at, me.date) as at,
           'mock:' || me.id::text as item,
           array_length(tpl.max_points, 1) as kim_total
      from public.mock_exam_task_scores s
      join public.mock_exams me on me.id = s.mock_exam_id
      join public.mock_exam_templates tpl on tpl.id = me.template_id
     where s.student_id in (select id from st)
       and me.exam_type::text = 'ege'
       and me.subject::text in ('math', 'physics')
       and coalesce(tpl.max_points[s.task_number], 0) > 0
       and coalesce(me.starts_at, me.date) >= p_from
  ),
  cat_try as (
    select a.task_id,
           min(a.created_at) as first_at,
           min(a.created_at) filter (where a.verdict = 'correct') as correct_at,
           (array_agg(a.verdict order by a.created_at, a.id))[1] as first_verdict
      from public.catalog_task_attempts a
     where a.profile_id = p_profile_id and not a.revealed_before
     group by a.task_id
  ),
  cat_rows as (
    select public.catalog_subject_key(cs.subject, cs.exam_type) as subject,
           array[cs.exam_number::int] as ns,
           'catalog'::text as source,
           case when x.first_verdict = 'correct' then 1.0
                when x.correct_at is not null then 0.5
                else 0.0 end::numeric as score,
           coalesce(x.correct_at, x.first_at) as at,
           'catalog:' || x.task_id::text as item,
           null::int as kim_total
      from cat_try x
      join public.catalog_tasks ct on ct.id = x.task_id and ct.is_published
      join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published
     where cs.exam_number >= 1
       and public.catalog_subject_key(cs.subject, cs.exam_type) is not null
       and coalesce(x.correct_at, x.first_at) >= p_from
  ),
  var_rows as (
    select public.catalog_subject_key(cs.subject, cs.exam_type) as subject,
           array[cs.exam_number::int] as ns,
           'catalog'::text as source,
           case when a.is_correct and coalesce(a.attempts_count, 0) > 1 then 0.5
                when a.is_correct then 1.0
                else 0.0 end::numeric as score,
           coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at) as at,
           'variant:' || a.id::text as item,
           null::int as kim_total
      from public.test_variant_student_assignments sa
      join public.test_variant_answers a on a.student_assignment_id = sa.id
      join public.test_variant_items vi on vi.id = a.variant_item_id
      join public.catalog_tasks ct on ct.id = vi.task_id and ct.is_published
      join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published
     where sa.student_id in (select id from st)
       and a.is_correct is not null
       and cs.exam_number >= 1
       and public.catalog_subject_key(cs.subject, cs.exam_type) is not null
       and coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at) >= p_from
  )
  select * from hw_rows
  union all select * from test_rows
  union all select * from mock_rows
  union all select * from cat_rows
  union all select * from var_rows;
$function$;

-- catalog_my_overview (md5 prosrc 813d515ccb6b17d4d47a38673c286b80)
CREATE OR REPLACE FUNCTION public.catalog_my_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_min_solvers constant int := 10;
  v_uid        uuid := auth.uid();
  v_is_student boolean;
  v_result     jsonb;
begin
  if v_uid is null then
    raise exception 'catalog_my_overview: нужен вход' using errcode = '42501';
  end if;
  select coalesce(p.role::text = 'student', false) into v_is_student
    from public.profiles p where p.id = v_uid;
  v_is_student := coalesce(v_is_student, false);
  with
  sec as (
    select s.id, s.subject, s.exam_type, s.exam_number as n, s.position,
           (select count(*) from public.catalog_tasks t
             where t.section_id = s.id and t.is_published)::int as total
      from public.catalog_sections s
     where s.is_published and s.exam_number >= 1
  ),
  nums as (
    select subject, exam_type, n,
           sum(total)::int as total,
           (array_agg(id order by (total > 0) desc, position, id))[1] as section_id
      from sec
     group by subject, exam_type, n
    having sum(total) > 0
  ),
  my_raw as (
    select p.task_id, coalesce(p.completed_at, p.updated_at) as at
      from public.catalog_task_progress p
     where p.user_id = v_uid and p.is_completed
    union all
    select i.task_id,
           coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at)
      from public.students st
      join public.test_variant_student_assignments sa on sa.student_id = st.id
      join public.test_variant_answers a on a.student_assignment_id = sa.id
      join public.test_variant_items i on i.id = a.variant_item_id
     where st.profile_id = v_uid and a.is_correct
  ),
  my_solved as (
    select r.task_id, s.subject, s.exam_type, s.n, min(r.at) as at
      from my_raw r
      join public.catalog_tasks t on t.id = r.task_id and t.is_published
      join sec s on s.id = t.section_id
     group by r.task_id, s.subject, s.exam_type, s.n
  ),
  my_exams as (
    select subject, exam_type,
           count(*)::int as solved,
           count(*) filter (where at >= now() - interval '7 days')::int as solved_7d
      from my_solved
     group by subject, exam_type
  ),
  my_nums as (
    select subject, exam_type, n, count(*)::int as solved
      from my_solved
     group by subject, exam_type, n
  ),
  mine as (
    select distinct
           case c.subject::text when 'math' then 'Математика' when 'physics' then 'Физика' end as subject,
           case c.exam_type::text when 'ege' then 'ЕГЭ' when 'oge' then 'ОГЭ' end as exam_type
      from public.students st
      join public.group_students gs on gs.student_id = st.id
      join public.groups g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where st.profile_id = v_uid
  ),
  school_raw as (
    select p.user_id as profile_id, p.task_id
      from public.catalog_task_progress p
     where v_is_student and p.is_completed
    union
    select st.profile_id, i.task_id
      from public.test_variant_answers a
      join public.test_variant_student_assignments sa on sa.id = a.student_assignment_id
      join public.students st on st.id = sa.student_id
      join public.test_variant_items i on i.id = a.variant_item_id
     where v_is_student and a.is_correct
  ),
  school as (
    select r.profile_id, s.subject, s.exam_type, r.task_id
      from school_raw r
      join public.profiles pr on pr.id = r.profile_id and pr.role = 'student'
      join public.catalog_tasks t on t.id = r.task_id and t.is_published
      join sec s on s.id = t.section_id
      join my_exams e on e.subject = s.subject and e.exam_type = s.exam_type
  ),
  per_exam as (
    select profile_id, subject, exam_type, count(distinct task_id)::int as solved
      from school
     group by profile_id, subject, exam_type
  ),
  exam_cmp as (
    select pe.subject, pe.exam_type,
           count(*)::int as solvers,
           count(*) filter (where pe.solved < me.solved)::int as lower
      from per_exam pe
      join my_exams me on me.subject = pe.subject and me.exam_type = pe.exam_type
     group by pe.subject, pe.exam_type
  ),
  per_all as (
    select profile_id, count(distinct task_id)::int as solved
      from school
     group by profile_id
  ),
  my_total as (
    select count(*)::int as solved,
           count(*) filter (where at >= now() - interval '7 days')::int as solved_7d
      from my_solved
  ),
  all_cmp as (
    select count(*)::int as solvers,
           count(*) filter (where pa.solved < (select solved from my_total))::int as lower
      from per_all pa
  ),
  exam_rows as (
    select n.subject, n.exam_type,
           sum(n.total)::int as total,
           jsonb_agg(jsonb_build_object(
             'n',          n.n,
             'total',      n.total,
             'solved',     coalesce(mn.solved, 0),
             'section_id', n.section_id
           ) order by n.n) as numbers
      from nums n
      left join my_nums mn on mn.subject = n.subject and mn.exam_type = n.exam_type and mn.n = n.n
     group by n.subject, n.exam_type
  )
  select jsonb_build_object(
           'viewer',      case when v_is_student then 'student' else 'staff' end,
           'compare',     v_is_student,
           'min_solvers', c_min_solvers,
           'overall', (
              select jsonb_build_object(
                       'solved',     mt.solved,
                       'solved_7d',  mt.solved_7d,
                       'solvers',    case when v_is_student then ac.solvers end,
                       'better_pct', case when v_is_student and mt.solved > 0 and ac.solvers >= c_min_solvers
                                          then nullif(floor(100.0 * ac.lower / ac.solvers)::int, 0) end)
                from my_total mt cross join all_cmp ac),
           'exams', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'subject',    er.subject,
                       'exam_type',  er.exam_type,
                       'is_mine',    exists (
                                       select 1 from mine m
                                        where m.subject = er.subject and m.exam_type = er.exam_type),
                       'total',      er.total,
                       'solved',     coalesce(me.solved, 0),
                       'solved_7d',  coalesce(me.solved_7d, 0),
                       'solvers',    case when v_is_student then ec.solvers end,
                       'better_pct', case when v_is_student and ec.solvers >= c_min_solvers
                                          then nullif(floor(100.0 * ec.lower / ec.solvers)::int, 0) end,
                       'numbers',    er.numbers
                     ) order by er.subject, er.exam_type)
                from exam_rows er
                left join my_exams me on me.subject = er.subject and me.exam_type = er.exam_type
                left join exam_cmp ec on ec.subject = er.subject and ec.exam_type = er.exam_type
           ), '[]'::jsonb)
         )
    into v_result;
  return v_result;
end;
$function$;

-- student_school_points_of (md5 prosrc 2f41cf5ded5da297a392a25db379b33f)
CREATE OR REPLACE FUNCTION public.student_school_points_of(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid   uuid := p_profile_id;
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  c_hw_ontime  constant int := 10;
  c_hw_late    constant int := 4;
  c_grade5     constant int := 10;
  c_grade4     constant int := 6;
  c_accepted   constant int := 6;
  c_variant    constant int := 2;
  c_mock_point constant int := 1;
  c_streak_day constant int := 3;
  c_levels     constant int[]  := array[0, 100, 200, 300, 450, 600, 800, 1000, 1250, 1500,
                                        1800, 2150, 2550, 3000, 3500, 4100, 4800, 5600, 6500, 7500];
  c_names      constant text[] := array['Старт', 'Разгон', 'Ритм', 'Упорство', 'Система',
                                        'Уверенность', 'Опыт', 'Глубина', 'Мастерство', 'Точность',
                                        'Выдержка', 'Сила', 'Размах', 'Стратегия', 'Мудрость',
                                        'Эксперт', 'Виртуоз', 'Триумф', 'Высота', 'Вершина'];
  v_rules jsonb := public.catalog_reward_rules();
begin
  if v_uid is null then
    raise exception 'student_school_points_of: нужен ученик' using errcode = '22023';
  end if;

  return (
    with st as (
      select s.id from public.students s where s.profile_id = v_uid
    ),
    first_sub as (
      select h.id as homework_id, t.title as topic_title, h.due_at, min(a.submitted_at) as at
        from public.topic_homework_attempts a
        join public.topic_homework h on h.id = a.homework_id
        join public.topics t on t.id = h.topic_id
       where a.student_id in (select id from st) and a.submitted_at is not null
       group by h.id, t.title, h.due_at
    ),
    last_accept as (
      select distinct on (a.homework_id)
             a.homework_id, r.created_at as at, r.score, h.grade_scale, t.title
        from public.topic_homework_reviews r
        join public.topic_homework_attempts a on a.id = r.attempt_id
        join public.topic_homework h on h.id = a.homework_id
        join public.topics t on t.id = h.topic_id
       where a.student_id in (select id from st) and r.decision = 'accepted'
       order by a.homework_id, r.created_at desc
    ),
    variant as (
      select vi.task_id,
             min(coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at)) as at
        from public.test_variant_student_assignments sa
        join public.test_variant_answers a on a.student_assignment_id = sa.id
        join public.test_variant_items vi on vi.id = a.variant_item_id
        join public.catalog_tasks ct on ct.id = vi.task_id and ct.is_published
        join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published and cs.exam_number >= 1
       where sa.student_id in (select id from st) and a.is_correct
       group by vi.task_id
    ),
    sol as materialized (
      select s.*, row_number() over (partition by s.subject, s.n order by s.at, s.task_id)::int as k
        from public.catalog_counted_solutions(v_uid) s
    ),
    sol_arr as (
      select array_agg(subject order by at, task_id) as s, array_agg(n order by at, task_id) as ns,
             array_agg(at order by at, task_id) as ats, array_agg(task_id order by at, task_id) as tids
        from sol
    ),
    sol_zone as (
      select sa.tids[z.idx] as task_id, z.zone
        from sol_arr sa, lateral public.student_kim_zone_shares(v_uid, sa.s, sa.ns, sa.ats) z
       where sa.s is not null
    ),
    cat as (
      select s.task_id, s.at, s.subject, s.n, s.k, zz.zone,
             public.catalog_zone_points(zz.zone) as points,
             public.catalog_zone_milestone(zz.zone, s.k) as mile
        from sol s join sol_zone zz on zz.task_id = s.task_id
    ),
    daily as (
      select d.day, d.n, min(a.created_at) as at
        from public.student_daily_tasks d
        join public.catalog_task_attempts a
          on a.profile_id = d.profile_id and a.task_id = d.task_id
         and a.verdict = 'correct' and not a.revealed_before
         and (a.created_at at time zone 'Europe/Moscow')::date = d.day
       where d.profile_id = v_uid
       group by d.day, d.n
    ),
    weekly as (
      select g.week_start, g.numbers, g.target,
             (select x.at from (
                select s.at, row_number() over (order by s.at, s.task_id) as rn
                  from sol s
                 where s.subject = g.subject and s.n = any (g.numbers)
                   and (s.at at time zone 'Europe/Moscow')::date between g.week_start and g.week_start + 6
              ) x where x.rn = g.target) as at
        from public.student_weekly_goals g
       where g.profile_id = v_uid
    ),
    mock as (
      select me.id, me.title, coalesce(me.starts_at, me.date) as at, sum(s.points)::int as pts
        from public.mock_exam_task_scores s
        join public.mock_exams me on me.id = s.mock_exam_id
       where s.student_id in (select id from st)
       group by me.id, me.title, coalesce(me.starts_at, me.date)
    ),
    sdays as (
      select x.day, x.day - (row_number() over (order by x.day))::int as grp
        from public.student_solve_days(v_uid) x
       where x.day <= v_today
    ),
    runs as (
      select (s.day::timestamp + interval '20 hours') at time zone 'Europe/Moscow' as at, s.day,
             row_number() over (partition by s.grp order by s.day)::int as day_in_run
        from sdays s
    ),
    ach as (
      select sa.key, sa.earned_at as at, r.points, r.threshold
        from public.student_achievements sa
        join public.achievement_rules() r on r.key = sa.key
       where sa.profile_id = v_uid and r.points > 0
    ),
    ev as (
      select case when f.due_at is null or (f.at at time zone 'Europe/Moscow')::date <= f.due_at
                  then 'hw_ontime' else 'hw_late' end as kind,
             f.at,
             case when f.due_at is null or (f.at at time zone 'Europe/Moscow')::date <= f.due_at
                  then c_hw_ontime else c_hw_late end as points,
             f.topic_title as title, null::int as n
        from first_sub f
      union all
      select 'hw_grade', la.at,
             case when public.hw_grade_equiv(la.grade_scale, la.score) = 5 then c_grade5
                  when public.hw_grade_equiv(la.grade_scale, la.score) = 4 then c_grade4
                  when public.hw_grade_equiv(la.grade_scale, la.score) is not null then 0
                  else c_accepted end,
             la.title, case when la.grade_scale = 'five' then la.score end
        from last_accept la
      union all
      select 'catalog', c.at, c.points, null, 1 from cat c
      union all
      select 'catalog_milestone', c.at, c.mile, null, c.k from cat c where c.mile > 0
      union all
      select 'daily', d.at, (v_rules->>'daily_task')::int, null, d.n from daily d
      union all
      select 'weekly', w.at, (v_rules->>'weekly_goal')::int, null, w.target from weekly w where w.at is not null
      union all
      select 'variant', v.at, c_variant, null, 1 from variant v
      union all
      select 'mock', m.at, c_mock_point * m.pts, m.title, m.pts from mock m where m.pts > 0
      union all
      select 'streak', r.at, c_streak_day, null, r.day_in_run from runs r where r.day_in_run >= 2
      union all
      select 'achievement', a.at, a.points, a.key, a.threshold from ach a
    ),
    tot as (
      select coalesce(sum(points), 0)::int as total from ev
    ),
    lvl as (
      select max(i) as n from tot, generate_subscripts(c_levels, 1) i where c_levels[i] <= tot.total
    ),
    feed as (
      select x.kind, x.at, x.points, x.title, x.n
        from (
          select kind, at, points, title, n from ev where kind not in ('catalog', 'variant') and points > 0
          union all
          select kind, max(at), sum(points)::int, null, count(*)::int
            from ev where kind in ('catalog', 'variant') and points > 0
           group by kind, (at at time zone 'Europe/Moscow')::date
        ) x
       order by x.at desc
       limit 6
    )
    select jsonb_build_object(
      'total', tot.total,
      'level', jsonb_build_object(
        'n', lvl.n,
        'name', c_names[lvl.n],
        'from', c_levels[lvl.n],
        'next', case when lvl.n < array_length(c_levels, 1) then c_levels[lvl.n + 1] end,
        'next_name', case when lvl.n < array_length(c_names, 1) then c_names[lvl.n + 1] end),
      'levels', to_jsonb(c_levels),
      'level_names', to_jsonb(c_names),
      'rules', jsonb_build_object(
        'hw_ontime', c_hw_ontime, 'hw_late', c_hw_late, 'grade5', c_grade5, 'grade4', c_grade4,
        'accepted', c_accepted, 'variant', c_variant, 'mock_point', c_mock_point, 'streak_day', c_streak_day),
      'catalog_rules', v_rules,
      'achievement_points', (select coalesce(sum(points), 0)::int from ach),
      'feed', coalesce((select jsonb_agg(to_jsonb(f) order by f.at desc) from feed f), '[]'::jsonb)
    )
    from tot, lvl
  );
end;
$function$;
