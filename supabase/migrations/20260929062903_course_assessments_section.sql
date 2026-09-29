-- §241. Раздел курса «Контрольные, самостоятельные и пробники»: одна функция
-- ученику («мои работы и результаты по курсу») и одна учителю («сводка по
-- классу»).
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration, после чего
-- файл переименовывается в <version>_<name>.sql точно по записи в
-- supabase_migrations.schema_migrations (MIGRATIONS.md).
--
-- ТОЛЬКО ДОБАВЛЯЮЩАЯ: две новые definer-функции, ни таблиц, ни политик, ни
-- правок существующих функций. Файл повторяем (create or replace) — второй
-- прогон проходит без ошибок (supabase/tests/razdel_241/run.sh).
--
-- Решения владельца (29.09), из которых следует всё ниже:
--  1. Раздел собирается САМ: все темы курса с kind check/control (из любых
--     модулей) и все пробники группы. В базе для раздела ничего не заводится.
--  2. Ученик видит свои баллы и оценки, график пробников и сравнение с группой.
--  3. Правило приватности (§223, уведомление о пробнике): средний группы и
--     «лучше, чем N %» — только если результат есть ещё хотя бы у ТРОИХ других;
--     «0 %» не пишем (better_pct = 0 → null). Иначе по среднему вычисляется
--     чужой балл. У персонала правило не нужно — он и так видит всех.
--
-- Что ученику можно и когда — те же границы, что уже держит база:
--   * работа по времени (§240): оценка, баллы и отметки по заданиям
--     (topic_homework_review_tasks) — ТОЛЬКО после вердикта (строка
--     topic_homework_reviews по последней попытке), как политика
--     topic_homework_review_tasks_student_select; окно — действующее
--     (личное, если есть: topic_homework_student_window); ДЗ — только
--     опубликованное (как topic_homework_student_can_see);
--   * пробник (§221/§224): итог — только после notified_at И конца окна, как
--     my_mock_exams / my_mock_exam_result;
--   * сравнение с группой — только у работы, где у ученика уже есть свой
--     видимый результат (иначе пока учитель проверяет или не отправил
--     результаты, по среднему можно было бы подсмотреть чужое до отправки).

-- ── 1. Ученику ──────────────────────────────────────────────────────────────
-- Только ученик этой группы (иначе отказ 42501 — чужой ученик, учитель,
-- аноним). Группа = курс (groups_one_per_course), сравнение — внутри группы.
create or replace function public.my_course_assessments(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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

  -- Работы по времени курса группы.
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
  -- Последняя попытка каждого ученика группы по каждой работе.
  last_att as (
    select distinct on (a.homework_id, a.student_id)
           a.id, a.homework_id, a.student_id, a.status, a.submitted_at, a.auto_submitted
      from public.topic_homework_attempts a
      join roster r on r.student_id = a.student_id
     where a.homework_id in (select w.homework_id from w where w.homework_id is not null)
     order by a.homework_id, a.student_id, a.attempt_number desc
  ),
  -- Последний вердикт по последней попытке.
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
           'topic_open',     public.topic_open_now(w.is_open, w.available_from),
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
           -- Оценка / балл и отметки по заданиям — только после вердикта.
           'score',          case when v.decision = 'accepted' then v.score end,
           'tasks',          case when v.attempt_id is not null then (
                               select jsonb_agg(jsonb_build_object('no', rt.no, 'verdict', rt.verdict)
                                                order by rt.position, rt.no)
                                 from public.topic_homework_review_tasks rt
                                where rt.attempt_id = la.id) end,
           -- Группа — только когда у ученика есть своя оценка и оценки есть ещё
           -- хотя бы у троих других.
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

  -- Пробники группы: всё, у чего есть время (как my_mock_exams).
  with roster as (
    select gs.student_id from public.group_students gs where gs.group_id = p_group_id
  ),
  mx as (
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
           -- «+N к прошлому»: свой видимый итог предыдущего пробника группы.
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
        join roster ro on ro.student_id = r2.student_id
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
$$;

comment on function public.my_course_assessments(uuid) is
  '§241. Раздел «Контрольные, самостоятельные и пробники» ученика: работы по времени курса группы (окно с личным, статус своей попытки; оценка, баллы и отметки по заданиям — только после вердикта) и пробники группы (итог — только после notified_at и конца окна, «+N к прошлому»). Сравнение с группой — только при своём видимом результате и результатах ещё хотя бы у троих других. Только ученик этой группы.';

revoke all on function public.my_course_assessments(uuid) from public, anon;
grant execute on function public.my_course_assessments(uuid) to authenticated;

-- ── 2. Учителю ──────────────────────────────────────────────────────────────
-- Только персонал курса (course_is_staff). У шаблона курса групп нет — список
-- работ без статистики (окна у шаблона тоже нет, §240).
create or replace function public.course_assessments_summary(p_course_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
           -- Идущие сейчас личные окна («Открыть заново»): статус работы — по
           -- общему окну, а это — отдельной подписью.
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
      join public.group_students gs on gs.group_id = m.group_id
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
$$;

comment on function public.course_assessments_summary(uuid) is
  '§241. Сводка раздела «Контрольные, самостоятельные и пробники» для персонала курса (course_is_staff): по каждой работе по времени и каждому пробнику группы — окно, статус (unscheduled/planned/live/review/done), сдали, ждут проверки, средний, сколько пишут сейчас (КР — черновики внутри окна; пробник — пинг не старше 75 с, как монитор §224).';

revoke all on function public.course_assessments_summary(uuid) from public, anon;
grant execute on function public.course_assessments_summary(uuid) to authenticated;
