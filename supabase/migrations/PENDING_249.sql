-- §249. Журнал оценок вкладки курса «Проверочные и контрольные».
--
-- Только добавление: одна новая definer-функция, таблицы и политики не
-- меняются. Повторяемая (create or replace), применять одной транзакцией.
--
-- course_assessment_grades(p_course_id) — для персонала курса
-- (course_is_staff, иначе 42501): по каждой работе по времени курса (тема
-- kind check/control с ОПУБЛИКОВАННЫМ ДЗ) и каждому ученику групп курса —
-- статус ПОСЛЕДНЕЙ попытки и оценка из ПОСЛЕДНЕГО вердикта этой попытки.
--
-- Статусы клетки:
--   none      — попыток нет;
--   draft     — последняя попытка — черновик (в журнале «—»: не сдавал);
--   submitted — сдано, вердикта нет («ждёт»);
--   reviewed  — принято, score — балл последнего вердикта (шкала ДЗ);
--   returned  — последняя попытка возвращена на доработку, новой ещё нет
--               (балла нет: при возврате база его не пишет, §198).
-- Пересданная работа: первая попытка возвращена, вторая сдана/принята —
-- клетка по второй (последней по attempt_number). «Вернул, потом принял как
-- есть» — две строки вердикта у одной попытки, берётся последняя (accepted).
--
-- Почему одной функцией и одним запросом: журнал — ученики × работы, по
-- строке на клетку; клиент не ходит по ученикам/работам (без N+1).
-- Почему отдельно от course_assessments_summary (§241): та отдаёт агрегаты,
-- её контракт уже читают экраны; здесь — поклеточно, для таблицы.

create or replace function public.course_assessment_grades(p_course_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_template boolean;
  v_group    record;
  v_result   jsonb;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = '42501';
  end if;

  select coalesce(c.is_template, false) into v_template from public.courses c where c.id = p_course_id;
  select g.id, g.name into v_group
    from public.groups g where g.course_id = p_course_id order by g.name limit 1;

  with roster as (
    select distinct on (s.id) s.id as student_id,
           coalesce(nullif(btrim(p.full_name), ''), 'Без имени') as name
      from public.group_students gs
      join public.groups g   on g.id = gs.group_id
      join public.students s on s.id = gs.student_id
      left join public.profiles p on p.id = s.profile_id
     where g.course_id = p_course_id
     order by s.id
  ),
  w as (
    select t.id as topic_id, t.title, t.kind, t.order_index as topic_order,
           m.title as module_title, m.order_index as module_order,
           h.id as homework_id, h.opens_at, h.closes_at, h.grade_scale
      from public.topics t
      join public.modules m on m.id = t.module_id
      join public.topic_homework h on h.topic_id = t.id
     where m.course_id = p_course_id
       and t.kind in ('check', 'control')
       and h.is_published
  ),
  last_att as (
    select distinct on (a.homework_id, a.student_id)
           a.id, a.homework_id, a.student_id, a.status::text as status, a.attempt_number,
           a.submitted_at, a.auto_submitted
      from public.topic_homework_attempts a
      join roster r on r.student_id = a.student_id
     where a.homework_id in (select w.homework_id from w)
     order by a.homework_id, a.student_id, a.attempt_number desc
  ),
  last_review as (
    select distinct on (rv.attempt_id) rv.attempt_id, rv.decision::text as decision, rv.score
      from public.topic_homework_reviews rv
     where rv.attempt_id in (select la.id from last_att la)
     order by rv.attempt_id, rv.created_at desc, rv.id desc
  ),
  cells as (
    select w.topic_id, r.student_id,
           case
             when la.id is null                      then 'none'
             when la.status = 'draft'                then 'draft'
             when la.status = 'submitted'            then 'submitted'
             when la.status = 'accepted'             then 'reviewed'
             when la.status = 'returned_for_revision' then 'returned'
             else 'none'
           end as status,
           case when la.status = 'accepted' then lr.score end as score,
           la.id as attempt_id,
           la.attempt_number,
           la.submitted_at,
           coalesce(la.auto_submitted, false) as auto_submitted
      from w
      cross join roster r
      left join last_att la on la.homework_id = w.homework_id and la.student_id = r.student_id
      left join last_review lr on lr.attempt_id = la.id
  )
  select jsonb_build_object(
           'server_now',  now(),
           'is_template', coalesce(v_template, false),
           'group_id',    v_group.id,
           'group_name',  v_group.name,
           'students', coalesce((
             select jsonb_agg(jsonb_build_object('student_id', r.student_id, 'name', r.name)
                              order by r.name, r.student_id)
               from roster r), '[]'::jsonb),
           'works', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'topic_id',     w.topic_id,
                      'homework_id',  w.homework_id,
                      'kind',         w.kind,
                      'title',        w.title,
                      'module_title', w.module_title,
                      'opens_at',     w.opens_at,
                      'closes_at',    w.closes_at,
                      'grade_scale',  w.grade_scale
                    ) order by w.opens_at nulls last, w.module_order, w.topic_order, w.title)
               from w), '[]'::jsonb),
           'cells', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'topic_id',       c.topic_id,
                      'student_id',     c.student_id,
                      'status',         c.status,
                      'score',          c.score,
                      'attempt_id',     c.attempt_id,
                      'attempt_number', c.attempt_number,
                      'submitted_at',   c.submitted_at,
                      'auto_submitted', c.auto_submitted
                    ) order by c.topic_id, c.student_id)
               from cells c), '[]'::jsonb)
         )
    into v_result;

  return v_result;
end;
$$;

comment on function public.course_assessment_grades(uuid) is
  '§249. Журнал оценок вкладки «Проверочные и контрольные» для персонала курса (course_is_staff, иначе 42501): ученики групп курса × работы по времени (темы check/control с опубликованным ДЗ); клетка — статус последней попытки (none/draft/submitted/reviewed/returned), балл последнего вердикта принятой попытки, attempt_id.';

revoke all on function public.course_assessment_grades(uuid) from public, anon;
grant execute on function public.course_assessment_grades(uuid) to authenticated;
