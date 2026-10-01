-- §250. Журнал домашних заданий вкладки курса «Домашние задания» (и строка
-- класса во вкладке «Курс»).
--
-- Только добавление: одна новая definer-функция, таблицы и политики не
-- меняются. Повторяемая (create or replace), применять одной транзакцией.
--
-- course_homework_grades(p_course_id) — для персонала курса (course_is_staff,
-- иначе 42501): ученики групп курса × ОПУБЛИКОВАННЫЕ ДЗ тем-уроков (kind не
-- check/control — проверочные и контрольные живут в своей вкладке, §249) →
-- статус ПОСЛЕДНЕЙ попытки ученика и балл ПОСЛЕДНЕГО вердикта этой попытки.
--
-- Ответ:
--   server_now, today      — «сейчас» и сегодняшняя дата по Москве: срок ДЗ
--                            (topic_homework.due_at) — календарная дата, и
--                            «просрочено» клиент считает как due_at < today;
--   is_template, group_id, group_name;
--   students  [{student_id, name}]                         — по имени;
--   homeworks [{topic_id, homework_id, module_id, module_title, module_order,
--               topic_title, topic_order, hw_title, due_at, grade_scale,
--               topic_open}]                                — по разделу, потом
--               по порядку темы; topic_open — topic_open_now (единственное
--               правило открытости), «выдано» = опубликовано и тема открыта;
--   cells     [{topic_id, student_id, status, score, attempt_id,
--               attempt_number, submitted_at}]             — ТОЛЬКО там, где
--               у ученика есть попытка. Нет строки — попыток нет (none).
--
-- Статусы клетки (как в §249):
--   draft     — последняя попытка — черновик (для журнала это «не сдал»);
--   submitted — сдано, вердикта нет («ждёт»);
--   reviewed  — принято; score — балл последнего вердикта (у ДЗ без шкалы null);
--   returned  — последняя попытка возвращена на доработку, новой ещё нет.
-- Пересдача (1-я возвращена, 2-я сдана/принята) — клетка по последней попытке.
--
-- Почему только существующие попытки, а не полная сетка ученики × ДЗ, как в
-- §249: у ДЗ сетка в десятки раз больше (11А: 24 ученика × 77 ДЗ = 1848
-- клеток против 6 работ), а почти все её клетки — «нет попытки»; полная сетка
-- раздувала бы ответ без новой информации.
-- Почему одной функцией и одним запросом: журнал и строка класса во вкладке
-- «Курс» читают одно и то же; клиент не ходит по ученикам и ДЗ (без N+1).
-- Почему не course_stats_topics (§242): там агрегаты по теме за период; для
-- таблицы «ученик × ДЗ» и перехода к работе (attempt_id) нужны клетки.

create or replace function public.course_homework_grades(p_course_id uuid)
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
  hw as (
    select t.id as topic_id, t.title as topic_title, t.order_index as topic_order,
           public.topic_open_now(t.is_open, t.available_from) as topic_open,
           m.id as module_id, m.title as module_title, m.order_index as module_order,
           h.id as homework_id, h.title as hw_title, h.due_at, h.grade_scale
      from public.topics t
      join public.modules m on m.id = t.module_id
      join public.topic_homework h on h.topic_id = t.id
     where m.course_id = p_course_id
       and t.kind not in ('check', 'control')
       and h.is_published
  ),
  last_att as (
    select distinct on (a.homework_id, a.student_id)
           a.id, a.homework_id, a.student_id, a.status::text as status, a.attempt_number, a.submitted_at
      from public.topic_homework_attempts a
      join roster r on r.student_id = a.student_id
     where a.homework_id in (select hw.homework_id from hw)
     order by a.homework_id, a.student_id, a.attempt_number desc
  ),
  last_review as (
    select distinct on (rv.attempt_id) rv.attempt_id, rv.score
      from public.topic_homework_reviews rv
     where rv.attempt_id in (select la.id from last_att la)
     order by rv.attempt_id, rv.created_at desc, rv.id desc
  ),
  cells as (
    select hw.topic_id, la.student_id,
           case la.status
             when 'draft'                 then 'draft'
             when 'submitted'             then 'submitted'
             when 'accepted'              then 'reviewed'
             when 'returned_for_revision' then 'returned'
             else 'draft'
           end as status,
           case when la.status = 'accepted' then lr.score end as score,
           la.id as attempt_id,
           la.attempt_number,
           la.submitted_at
      from last_att la
      join hw on hw.homework_id = la.homework_id
      left join last_review lr on lr.attempt_id = la.id
  )
  select jsonb_build_object(
           'server_now',  now(),
           'today',       (now() at time zone 'Europe/Moscow')::date,
           'is_template', coalesce(v_template, false),
           'group_id',    v_group.id,
           'group_name',  v_group.name,
           'students', coalesce((
             select jsonb_agg(jsonb_build_object('student_id', r.student_id, 'name', r.name)
                              order by r.name, r.student_id)
               from roster r), '[]'::jsonb),
           'homeworks', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'topic_id',     hw.topic_id,
                      'homework_id',  hw.homework_id,
                      'module_id',    hw.module_id,
                      'module_title', hw.module_title,
                      'module_order', hw.module_order,
                      'topic_title',  hw.topic_title,
                      'topic_order',  hw.topic_order,
                      'hw_title',     hw.hw_title,
                      'due_at',       hw.due_at,
                      'grade_scale',  hw.grade_scale,
                      'topic_open',   hw.topic_open
                    ) order by hw.module_order, hw.module_id, hw.topic_order, hw.topic_id)
               from hw), '[]'::jsonb),
           'cells', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'topic_id',       c.topic_id,
                      'student_id',     c.student_id,
                      'status',         c.status,
                      'score',          c.score,
                      'attempt_id',     c.attempt_id,
                      'attempt_number', c.attempt_number,
                      'submitted_at',   c.submitted_at
                    ) order by c.topic_id, c.student_id)
               from cells c), '[]'::jsonb)
         )
    into v_result;

  return v_result;
end;
$$;

comment on function public.course_homework_grades(uuid) is
  '§250. Журнал ДЗ вкладки курса «Домашние задания» и строка класса во вкладке «Курс» для персонала курса (course_is_staff, иначе 42501): ученики групп курса × опубликованные ДЗ тем-уроков (раздел, порядок, due_at, grade_scale, topic_open); клетки — только где есть попытка: статус последней попытки (draft/submitted/reviewed/returned), балл последнего вердикта принятой, attempt_id. today — дата по Москве для «просрочено».';

revoke all on function public.course_homework_grades(uuid) from public, anon;
grant execute on function public.course_homework_grades(uuid) to authenticated;
