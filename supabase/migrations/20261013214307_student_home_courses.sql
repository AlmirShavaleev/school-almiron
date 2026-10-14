-- Главная ученика «без шума» (письмо главная_ученика_без_шума.md, 14.10.2026):
-- карточка курса с % по разделам и «Продолжить урок» — ОДНИМ вызовом на все
-- курсы ученика (без N+1). Заменяет на главной student_home_activity()
-- (серия, дни решений, визиты — больше не показываются), журнал ДЗ и запросы
-- «что сдать».
--
-- % раздела = доля тем раздела С ДЗ, у которых ДЗ сдано или принято:
--   * тема «с ДЗ» — есть хотя бы одно ДЗ (в т. ч. ещё не опубликованное:
--     у школьных групп ДЗ выкладывают по ходу года, иначе раздел из
--     одной выложенной темы показывал бы 100 %);
--   * «сдано или принято» — по каждому ДЗ решает принятая попытка, иначе
--     самая свежая (как в get_student_topic_journal): returned/draft — не сдано.
-- Разделы без единой темы с ДЗ в ответ не попадают.
--
-- continue — следующая открытая тема (topic_open_with, как в журнале) с
-- опубликованным ДЗ, которое ещё не сдано и не принято; порядок — раздел,
-- затем тема. Нет такой — null.
--
-- Только свои данные: всё от auth.uid(), параметров «чей» нет.
create or replace function public.student_home_courses()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with st as (
    select s.id from public.students s where s.profile_id = auth.uid()
  ),
  my_courses as (
    select distinct g.course_id
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
     where gs.student_id in (select id from st) and g.course_id is not null
  ),
  flags as (
    select public.progress_open_by_student(null, array(select id from st)) as f
  ),
  hw_state as (
    -- Статус каждого ДЗ для ученика: принятая попытка терминальна, иначе свежая.
    select h.id as homework_id, h.topic_id, h.is_published,
           (select a.status::text
              from public.topic_homework_attempts a
             where a.homework_id = h.id and a.student_id in (select id from st)
             order by (a.status = 'accepted') desc, a.attempt_number desc
             limit 1) as status
      from public.topic_homework h
      join public.topics t on t.id = h.topic_id
      join public.modules m on m.id = t.module_id
     where m.course_id in (select course_id from my_courses)
  ),
  per_topic as (
    select m.course_id, m.id as module_id, m.title as module_title, m.order_index as m_ord,
           t.id as topic_id, t.title as topic_title, t.order_index as t_ord,
           bool_or(hs.status in ('submitted', 'accepted')) as hw_done,
           bool_or(hs.is_published) as hw_published,
           public.topic_open_with((select f from flags), (select id from st limit 1)::text || ':' || t.id::text,
                                  t.is_open, t.available_from) as open_now
      from public.topics t
      join public.modules m on m.id = t.module_id
      join hw_state hs on hs.topic_id = t.id
     where m.course_id in (select course_id from my_courses)
     group by m.course_id, m.id, m.title, m.order_index, t.id, t.title, t.order_index, t.is_open, t.available_from
  ),
  per_module as (
    select course_id, module_id, module_title, m_ord,
           count(*)::int as total,
           count(*) filter (where hw_done)::int as done
      from per_topic
     group by course_id, module_id, module_title, m_ord
  ),
  next_topic as (
    select distinct on (course_id) course_id, topic_id, topic_title, module_title
      from per_topic
     where open_now and hw_published and not coalesce(hw_done, false)
     order by course_id, m_ord, t_ord
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'course_id', c.course_id,
           'topics_total', coalesce((select sum(total) from per_module pm where pm.course_id = c.course_id), 0),
           'topics_done',  coalesce((select sum(done)  from per_module pm where pm.course_id = c.course_id), 0),
           'modules', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'module_id', pm.module_id, 'title', pm.module_title,
                       'order_index', pm.m_ord, 'total', pm.total, 'done', pm.done)
                     order by pm.m_ord)
                from per_module pm where pm.course_id = c.course_id), '[]'::jsonb),
           'continue', (
              select jsonb_build_object('topic_id', n.topic_id, 'title', n.topic_title, 'module_title', n.module_title)
                from next_topic n where n.course_id = c.course_id)
         ) order by c.course_id), '[]'::jsonb)
    from my_courses c
$$;

revoke all on function public.student_home_courses() from public, anon;
grant execute on function public.student_home_courses() to authenticated, service_role;

comment on function public.student_home_courses() is
  'Главная ученика: по каждому курсу — % тем с ДЗ сдано/принято по разделам и следующая открытая тема без сданного ДЗ. Только свои данные (auth.uid()).';
