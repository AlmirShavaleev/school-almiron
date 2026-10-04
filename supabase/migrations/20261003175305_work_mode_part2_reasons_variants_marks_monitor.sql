-- §263, часть 2/2. Применено оркестратором 03.10 (MCP apply_migration, версия 20261003175305); применённый текст — без строк-комментариев, comment on и хвостовых комментариев. Начало и пояснения — в части 1.
-- 3.5. ПРАВИЛО §262 (catalog_answer_reasons). Тело — из 20261003155843_catalog_answers_server_part_a_functions.sql,
-- добавлено: (а) идёт работа у ученика → null по всем задачам (catalog_task_texts / catalog_reveal_answers
-- отдают allowed = false и пустые тексты); персонал — как был; (б) ветка variant — только у выдачи, где учитель
-- оставил ОБА флажка (ответы и решения после сдачи): каталог отдаёт ответ и решение вместе, поэтому выдача
-- «только ответы» или «ничего» задачу в каталоге не открывает (раскрыть её там ученик может — §52, ценой
-- баллов каталога). Флажок null (не бывает при not null) читается как «показывать» — прежнее поведение.
create or replace function public.catalog_answer_reasons(p_uid uuid, p_task_ids uuid[])
returns table (task_id uuid, reason text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ids as (
    select distinct x.id
      from unnest(coalesce(p_task_ids, '{}'::uuid[])) as x(id)
     where p_uid is not null and x.id is not null
  ),
  who as (
    select exists (select 1 from public.profiles p
                    where p.id = p_uid and p.role in ('teacher', 'curator', 'admin', 'owner')) as staff,
           public.work_mode_active_for_profile(p_uid) as in_work
  ),
  mine as (
    select s.id from public.students s where s.profile_id = p_uid
  ),
  by_variant as (
    select distinct tvi.task_id
      from public.test_variant_student_assignments tvsa
      join public.test_variant_items tvi on tvi.variant_id = tvsa.variant_id
      left join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
     where tvsa.student_id in (select m.id from mine m)
       and tvsa.status in ('submitted', 'completed')
       and coalesce(tva.show_answers_after_submit, true)
       and coalesce(tva.show_solutions_after_submit, true)
       and tvi.task_id in (select i.id from ids i)
  ),
  by_lesson as (
    select distinct tvi.task_id
      from public.test_variant_assignments tva
      join public.test_variant_student_assignments tvsa on tvsa.assignment_id = tva.id
      join public.test_variant_items tvi on tvi.variant_id = tva.variant_id
      join public.test_variant_answers ans on ans.student_assignment_id = tvsa.id and ans.variant_item_id = tvi.id
     where tva.topic_id is not null
       and tvsa.student_id in (select m.id from mine m)
       and tvsa.status <> 'cancelled'
       and ans.solution_shown_at is not null
       and tvi.task_id in (select i.id from ids i)
  ),
  by_test as (
    select distinct ti.task_id
      from public.topic_test_attempts att
      join public.topic_test_items ti on ti.test_id = att.test_id
     where att.student_id in (select m.id from mine m)
       and att.status = 'completed'
       and ti.task_id in (select i.id from ids i)
  )
  select ct.id,
         case
           when who.staff then 'staff'
           when who.in_work then null
           when not ct.is_published then null
           when not public.catalog_task_checkable(ct.exam_part, ct.answer_html, ct.partial_type) then 'not_checkable'
           when exists (select 1 from public.catalog_task_attempts a
                         where a.profile_id = p_uid and a.task_id = ct.id and a.verdict = 'correct') then 'solved'
           when exists (select 1 from public.catalog_task_reveals rv
                         where rv.profile_id = p_uid and rv.task_id = ct.id) then 'revealed'
           when ct.id in (select v.task_id from by_variant v) then 'variant'
           when ct.id in (select l.task_id from by_lesson l) then 'lesson'
           when ct.id in (select t.task_id from by_test t) then 'test'
         end
    from public.catalog_tasks ct
    join ids on ids.id = ct.id
   cross join who;
$$;

revoke all on function public.catalog_answer_reasons(uuid, uuid[]) from public, anon, authenticated;

-- 3.6. Задачи варианта ученику. Тело — из 20260802233144_variant_student_items_hide_task_number_until_submit.sql
-- (последняя редакция), сигнатура и столбцы результата прежние. Добавлено: эталон (и номер задачи — он ссылка
-- на готовый ответ, §52) — только если у выдачи show_answers_after_submit; решение, план, критерии — только если
-- show_solutions_after_submit; и то и другое — не во время работы по времени / пробника.
CREATE OR REPLACE FUNCTION public.get_variant_items_for_student(p_student_assignment_id uuid)
 RETURNS TABLE(
   item_id uuid, variant_id uuid, task_id uuid, item_position integer, points integer,
   grading_type text, statement_html text, has_answer boolean, has_solution boolean,
   task_ext_id bigint, subject text, exam_type text, exam_part smallint,
   max_points smallint, partial_type text, source_type text,
   solution_html text, solution_plan_html text, grade_criteria_html text, answer_html text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tvsa      record;
  v_after     boolean;
  v_answers   boolean;
  v_solutions boolean;
BEGIN
  SELECT tvsa.id, tvsa.variant_id, tvsa.status, tvsa.student_id,
         tva.show_answers_after_submit AS show_answers,
         tva.show_solutions_after_submit AS show_solutions
  INTO v_tvsa
  FROM public.test_variant_student_assignments tvsa
  JOIN public.students s ON s.id = tvsa.student_id
  LEFT JOIN public.test_variant_assignments tva ON tva.id = tvsa.assignment_id
  WHERE tvsa.id = p_student_assignment_id
    AND s.profile_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESS_DENIED: assignment not found or not owned by caller';
  END IF;

  IF v_tvsa.status = 'not_started' THEN
    RAISE EXCEPTION 'NOT_STARTED: start the assignment first';
  END IF;

  v_after := v_tvsa.status IN ('submitted','completed')
             AND NOT EXISTS (SELECT 1 FROM public.student_active_works(v_tvsa.student_id));
  v_answers   := v_after AND coalesce(v_tvsa.show_answers, true);
  v_solutions := v_after AND coalesce(v_tvsa.show_solutions, true);

  RETURN QUERY
  SELECT
    tvi.id, tvi.variant_id, tvi.task_id, tvi.position, tvi.points, tvi.grading_type,
    ct.statement_html, ct.has_answer, ct.has_solution,
    CASE WHEN v_answers   THEN ct.external_id         ELSE NULL END,
    ct.subject, ct.exam_type, ct.exam_part, ct.max_points, ct.partial_type, tv.source_type,
    CASE WHEN v_solutions THEN ct.solution_html       ELSE NULL END,
    CASE WHEN v_solutions THEN ct.solution_plan_html  ELSE NULL END,
    CASE WHEN v_solutions THEN ct.grade_criteria_html ELSE NULL END,
    CASE WHEN v_answers   THEN ct.answer_html         ELSE NULL END
  FROM public.test_variant_items tvi
  JOIN public.catalog_tasks ct ON ct.id = tvi.task_id
  JOIN public.test_variants tv ON tv.id = tvi.variant_id
  WHERE tvi.variant_id = v_tvsa.variant_id
  ORDER BY tvi.position;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_variant_items_for_student(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_variant_items_for_student(uuid) TO authenticated;

-- Флажки своей выдачи — странице варианта, чтобы вместо пустых клеток сказать «учитель не показывает ответы».
create or replace function public.my_variant_answer_flags(p_student_assignment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'show_answers',   coalesce(tva.show_answers_after_submit, true),
           'show_solutions', coalesce(tva.show_solutions_after_submit, true),
           'work_mode',      exists (select 1 from public.student_active_works(tvsa.student_id)))
    from public.test_variant_student_assignments tvsa
    join public.students s on s.id = tvsa.student_id
    left join public.test_variant_assignments tva on tva.id = tvsa.assignment_id
   where tvsa.id = p_student_assignment_id
     and s.profile_id = auth.uid();
$$;

revoke all on function public.my_variant_answer_flags(uuid) from public, anon;
grant execute on function public.my_variant_answer_flags(uuid) to authenticated;

-- ══ 4. Ученик: «открыл условие» и уходы со страницы ═══════════════════════════════════════════════════
-- Только про себя (auth_student_id) и только пока идёт ЕГО работа (student_active_works); вне работы —
-- ничего не пишется и не ошибка (вкладка, оставленная после конца, не должна сыпать ошибками; как mock_exam_ping).
create or replace function public.work_mark_opened(p_homework_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid := public.auth_student_id();
  v_at      timestamptz;
begin
  if v_student is null then
    raise exception 'Отметку ставит только ученик' using errcode = '42501';
  end if;
  if not exists (select 1 from public.student_active_works(v_student) w where w.homework_id = p_homework_id) then
    return jsonb_build_object('marked', false, 'reason', 'not_live', 'server_now', now());
  end if;
  insert into public.work_activity as wa (student_id, homework_id, opened_at)
  values (v_student, p_homework_id, now())
  on conflict (homework_id, student_id) where homework_id is not null
  do update set opened_at = coalesce(wa.opened_at, excluded.opened_at),
                updated_at = case when wa.opened_at is null then now() else wa.updated_at end
  returning wa.opened_at into v_at;
  return jsonb_build_object('marked', true, 'opened_at', v_at, 'server_now', now());
end;
$$;

comment on function public.work_mark_opened(uuid) is
  '§263. Ученик открыл условие идущей работы по времени: первая отметка времени (повтор не сдвигает). Только про себя и только в своём окне; вне окна — no-op {marked:false}.';

-- Пачка уходов: сколько раз ушёл и сколько секунд был вне страницы с прошлой пачки. Значения за вызов
-- ограничены (уходов ≤ 50, секунд ≤ 4 ч) — клиент шлёт раз в 15–30 с и при возврате.
create or replace function public.work_report_away(
  p_homework_id uuid, p_mock_exam_id uuid, p_leaves integer, p_away_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid := public.auth_student_id();
  v_leaves  integer := least(greatest(coalesce(p_leaves, 0), 0), 50);
  v_seconds integer := least(greatest(coalesce(p_away_seconds, 0), 0), 14400);
begin
  if v_student is null then
    raise exception 'Отметку ставит только ученик' using errcode = '42501';
  end if;
  if num_nonnulls(p_homework_id, p_mock_exam_id) <> 1 then
    raise exception 'Нужна ровно одна работа: проверочная или пробник' using errcode = '22023';
  end if;
  if not exists (select 1 from public.student_active_works(v_student) w
                  where (p_homework_id is not null and w.homework_id = p_homework_id)
                     or (p_mock_exam_id is not null and w.mock_exam_id = p_mock_exam_id)) then
    return jsonb_build_object('saved', false, 'reason', 'not_live', 'server_now', now());
  end if;
  if v_leaves = 0 and v_seconds = 0 then
    return jsonb_build_object('saved', false, 'reason', 'empty', 'server_now', now());
  end if;

  if p_homework_id is not null then
    insert into public.work_activity as wa (student_id, homework_id, opened_at, away_count, away_seconds, last_away_at)
    values (v_student, p_homework_id, now(), v_leaves, v_seconds, now())
    on conflict (homework_id, student_id) where homework_id is not null
    do update set away_count   = wa.away_count + excluded.away_count,
                  away_seconds = wa.away_seconds + excluded.away_seconds,
                  opened_at    = coalesce(wa.opened_at, excluded.opened_at),
                  last_away_at = now(),
                  updated_at   = now();
  else
    insert into public.work_activity as wa (student_id, mock_exam_id, away_count, away_seconds, last_away_at)
    values (v_student, p_mock_exam_id, v_leaves, v_seconds, now())
    on conflict (mock_exam_id, student_id) where mock_exam_id is not null
    do update set away_count   = wa.away_count + excluded.away_count,
                  away_seconds = wa.away_seconds + excluded.away_seconds,
                  last_away_at = now(),
                  updated_at   = now();
  end if;
  return jsonb_build_object('saved', true, 'server_now', now());
end;
$$;

comment on function public.work_report_away(uuid, uuid, integer, integer) is
  '§263. Пачка уходов со страницы идущей работы (по времени или пробника): +уходы, +секунды вне страницы. Только про себя и только пока идёт своя работа; вне — no-op {saved:false}. Ученику счётчик не возвращается.';

revoke all on function public.work_mark_opened(uuid) from public, anon;
revoke all on function public.work_report_away(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.work_mark_opened(uuid) to authenticated;
grant execute on function public.work_report_away(uuid, uuid, integer, integer) to authenticated;

-- ══ 5. Учитель: монитор работы по времени («Проверочная вживую») ══════════════════════════════════════
-- Только персонал курса темы (course_is_staff), иначе 42501. Класс — ученики групп курса (как
-- topic_homework_timed_summary §240). По ученику — сырые факты; статусы и счётчики считает клиент
-- (src/lib/liveWork.ts), чтобы монитор и «итог» были одним правилом с тестами.
create or replace function public.timed_work_live(p_homework_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hw     record;
  v_rows   jsonb;
begin
  select h.id, h.topic_id, h.opens_at, h.closes_at, h.is_published, h.grade_scale,
         t.title, t.kind, m.course_id
    into v_hw
    from public.topic_homework h
    join public.topics t on t.id = h.topic_id
    join public.modules m on m.id = t.module_id
   where h.id = p_homework_id;
  if v_hw.id is null or not public.course_is_staff(v_hw.course_id) then
    raise exception 'Нет прав на эту работу' using errcode = '42501';
  end if;
  if v_hw.kind not in ('check', 'control') then
    raise exception 'Монитор — только у проверочной и контрольной работы' using errcode = '22023';
  end if;

  with roster as (
    select distinct on (gs.student_id) gs.student_id, g.id as group_id, g.name as group_name
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
     where g.course_id = v_hw.course_id
     order by gs.student_id, g.name
  ),
  last_attempt as (
    select distinct on (a.student_id) a.student_id, a.id, a.status, a.submitted_at, a.auto_submitted, a.created_at
      from public.topic_homework_attempts a
     where a.homework_id = p_homework_id
     order by a.student_id, a.attempt_number desc
  ),
  files as (
    select la.student_id, count(f.id)::int as photos, max(f.created_at) as last_photo_at
      from last_attempt la
      join public.topic_homework_attempt_files f on f.attempt_id = la.id
     group by la.student_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'student_id',      r.student_id,
           'full_name',       coalesce(nullif(btrim(p.full_name), ''), 'Ученик'),
           'group_name',      r.group_name,
           'opened_at',       case when wa.opened_at is null then la.created_at
                                   when la.created_at is null then wa.opened_at
                                   else least(wa.opened_at, la.created_at) end,
           'attempt_status',  la.status,
           'submitted_at',    la.submitted_at,
           'auto_submitted',  coalesce(la.auto_submitted, false),
           'photos',          coalesce(fl.photos, 0),
           'last_photo_at',   fl.last_photo_at,
           'away_count',      coalesce(wa.away_count, 0),
           'away_seconds',    coalesce(wa.away_seconds, 0),
           'window_opens_at', w.opens_at,
           'window_closes_at', w.closes_at,
           'personal',        coalesce(w.personal, false)
         ) order by coalesce(nullif(btrim(p.full_name), ''), 'Ученик'), r.student_id), '[]'::jsonb)
    into v_rows
    from roster r
    join public.students s on s.id = r.student_id
    left join public.profiles p on p.id = s.profile_id
    left join last_attempt la on la.student_id = r.student_id
    left join files fl on fl.student_id = r.student_id
    left join public.work_activity wa on wa.homework_id = p_homework_id and wa.student_id = r.student_id
    left join lateral public.topic_homework_student_window(p_homework_id, r.student_id) w on true;

  return jsonb_build_object(
    'homework_id', v_hw.id,
    'topic_id',    v_hw.topic_id,
    'course_id',   v_hw.course_id,
    'title',       v_hw.title,
    'kind',        v_hw.kind,
    'published',   v_hw.is_published,
    'group_name',  (select string_agg(distinct g.name, ' · ') from public.groups g where g.course_id = v_hw.course_id),
    'opens_at',    v_hw.opens_at,
    'closes_at',   v_hw.closes_at,
    'server_now',  now(),
    'students',    v_rows
  );
end;
$$;

comment on function public.timed_work_live(uuid) is
  '§263. Монитор проверочной/контрольной для персонала курса: окно, серверное время, по ученику класса — открыл условие (work_activity.opened_at или начало попытки), статус попытки, фото (число, последнее), уходы со страницы, действующее окно (личное). Чужому — 42501.';

revoke all on function public.timed_work_live(uuid) from public, anon;
grant execute on function public.timed_work_live(uuid) to authenticated;

-- Главная учителя: работы по времени его курсов, у которых окно идёт сейчас (общее или чьё-то личное),
-- — кнопка «Следить». Курсы — где вызывающий персонал (course_is_staff); шаблонов среди них нет (окна нет).
create or replace function public.my_live_timed_works()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x.j order by x.closes_at, x.title), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'homework_id', h.id,
               'topic_id',    t.id,
               'course_id',   m.course_id,
               'title',       t.title,
               'kind',        t.kind,
               'group_name',  (select string_agg(distinct g.name, ' · ') from public.groups g where g.course_id = m.course_id),
               'opens_at',    h.opens_at,
               'closes_at',   h.closes_at,
               'personal_live', (select count(*) from public.topic_homework_personal_windows pw
                                  where pw.homework_id = h.id and pw.opens_at <= now() and now() < pw.closes_at)::int,
               'server_now',  now()
             ) as j,
             coalesce(h.closes_at, now()) as closes_at,
             t.title
        from public.topic_homework h
        join public.topics t on t.id = h.topic_id and t.kind in ('check', 'control')
        join public.modules m on m.id = t.module_id
       where h.is_published
         and ((h.opens_at <= now() and now() < h.closes_at)
              or exists (select 1 from public.topic_homework_personal_windows pw
                          where pw.homework_id = h.id and pw.opens_at <= now() and now() < pw.closes_at))
         and public.course_is_staff(m.course_id)
    ) x;
$$;

comment on function public.my_live_timed_works() is
  '§263. Идущие сейчас проверочные/контрольные курсов, где вызывающий — персонал (course_is_staff): для кнопки «Следить» на главной учителя.';

revoke all on function public.my_live_timed_works() from public, anon;
grant execute on function public.my_live_timed_works() to authenticated;

-- Уходы со страницы пробника — для монитора пробника §224 (только персонал курса группы).
create or replace function public.mock_exam_away(p_mock_exam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.mock_exam_is_staff(p_mock_exam_id) then
    raise exception 'Нет прав на этот пробник' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('student_id', wa.student_id, 'away_count', wa.away_count,
                                        'away_seconds', wa.away_seconds) order by wa.student_id)
      from public.work_activity wa
     where wa.mock_exam_id = p_mock_exam_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.mock_exam_away(uuid) from public, anon;
grant execute on function public.mock_exam_away(uuid) to authenticated;
