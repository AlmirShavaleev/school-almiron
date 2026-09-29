-- §242.1 (оркестратор, 29.09). «Открыл файлов X из Y» — только основная дорожка курса (track = ege).
-- На проде у «Физика ЕГЭ 11А» видимых файлов 1246, из них ~910 — тренировка задачника: знаменатель
-- «0 из 1177» ничего не говорил. Тренировочные открытия по-прежнему идут в «занимался» и «открыли файлов».
create or replace function public.course_stats_files_internal(p_course_id uuid)
returns table (student_id uuid, item_id uuid, topic_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with roster as (
    select * from public.course_stats_roster_internal(p_course_id)
  ),
  items as (
    select i.id, i.topic_id, i.section, i.track, i.subtopic_code
      from public.topic_material_items i
      join public.topics t  on t.id = i.topic_id
      join public.modules m on m.id = t.module_id
     where m.course_id = p_course_id
       and i.kind = 'file'
       and i.is_visible
       and i.track = 'ege'
       and public.topic_open_now(t.is_open, t.available_from)
  )
  select r.student_id, i.id, i.topic_id
    from roster r
    cross join items i
   where (i.section is distinct from 'solution'
          or not exists (select 1 from public.topic_homework h where h.topic_id = i.topic_id)
          or exists (select 1 from public.topic_homework_attempts a
                       join public.topic_homework h on h.id = a.homework_id
                      where h.topic_id = i.topic_id and a.student_id = r.student_id and a.status = 'accepted'))
     and (i.section is distinct from 'criteria'
          or not exists (select 1 from public.topic_homework h where h.topic_id = i.topic_id)
          or exists (select 1 from public.topic_homework_attempts a
                       join public.topic_homework h on h.id = a.homework_id
                      where h.topic_id = i.topic_id and a.student_id = r.student_id and a.status = 'accepted'))
     and (i.section is distinct from 'worksheet_homework'
          or not public.topic_is_timed(i.topic_id)
          or exists (select 1 from public.topic_homework h
                      where h.topic_id = i.topic_id
                        and public.topic_homework_condition_open(h.id, r.student_id)));
$$;
comment on function public.course_stats_files_internal(uuid) is
  '§242.1. Доступные ученику файлы курса для «Открыл файлов X из Y» — только основная дорожка (track = ege): файлы тренировки задачника (~900 на курс) делали знаменатель бессмысленным. Видимость — как у ученика (гейт решения/критериев, условие работы по времени).';
revoke all on function public.course_stats_files_internal(uuid) from public, anon, authenticated;
