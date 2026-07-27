-- get_my_students: фронт (StudentsPage) ждёт groups/courses/class_grade/added_at,
-- старая версия возвращала только связи teacher_students без групп и курсов
-- (на карточках учеников всегда были прочерки).
-- Видимость: admin/owner — все ученики; преподаватель — его teacher_students
-- + ученики групп его курсов (course.owner_id = auth.uid()).
-- Применена через MCP 2026-07-27 (ЧАТ А, обкатка), version 20260727153802.

drop function if exists public.get_my_students();

create function public.get_my_students()
returns table(
  student_id uuid,
  profile_id uuid,
  full_name text,
  class_grade text,
  groups jsonb,
  courses jsonb,
  relation_status text,
  added_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  with me as (
    select t.id as teacher_id from public.teachers t where t.profile_id = auth.uid()
  ),
  base as (
    select s.id, s.profile_id, s.grade, s.created_at
    from public.students s
    where public.is_admin_or_owner()
       or exists (select 1 from public.teacher_students ts join me on ts.teacher_id = me.teacher_id
                  where ts.student_id = s.id)
       or exists (select 1 from public.group_students gs
                  join public.groups g on g.id = gs.group_id
                  join public.courses c on c.id = g.course_id
                  where gs.student_id = s.id and c.owner_id = auth.uid())
  )
  select
    b.id as student_id,
    p.id as profile_id,
    p.full_name,
    b.grade::text as class_grade,
    coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
              from public.group_students gs join public.groups g on g.id = gs.group_id
              where gs.student_id = b.id), '[]'::jsonb) as groups,
    coalesce((select jsonb_agg(distinct jsonb_build_object('id', c.id, 'title', c.title))
              from public.group_students gs join public.groups g on g.id = gs.group_id
              join public.courses c on c.id = g.course_id
              where gs.student_id = b.id), '[]'::jsonb) as courses,
    (select ts.status from public.teacher_students ts join me on ts.teacher_id = me.teacher_id
      where ts.student_id = b.id limit 1) as relation_status,
    coalesce((select min(gs.joined_at) from public.group_students gs where gs.student_id = b.id), b.created_at) as added_at
  from base b
  join public.profiles p on p.id = b.profile_id;
$fn$;

revoke execute on function public.get_my_students() from anon, public;
grant execute on function public.get_my_students() to authenticated;
