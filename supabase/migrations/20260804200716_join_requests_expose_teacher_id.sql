-- Вкладка «Новые ученики» в режиме учителя показывала заявки всей школы.
--
-- Причина: `get_my_join_requests` фильтрует
-- `r.teacher_id = _current_teacher_id() OR is_admin_or_owner()` — админу она
-- отдаёт ВСЁ, — а в возвращаемых колонках `teacher_id` не было, поэтому клиент
-- не мог отличить свою заявку от чужой даже при желании.
--
-- Правим МИНИМАЛЬНО: только добавляем колонку в выдачу. Условие отбора не
-- трогаем — настоящему преподавателю функция и так отдаёт ровно его заявки, и
-- менять это ради режима представления нельзя. Сужение для владельца делает
-- клиент по этому полю.
--
-- Через drop/create, а не create or replace: меняется RETURNS TABLE, замена на
-- месте это не умеет. Грант выдаётся заново — при drop он теряется.
-- Вызывающий один: src/lib/teacherJoinRequests.ts.

drop function if exists public.get_my_join_requests(text);

create function public.get_my_join_requests(p_status text default null)
returns table (
  id          uuid,
  student_id  uuid,
  teacher_id  uuid,
  full_name   text,
  email       text,
  status      text,
  created_at  timestamptz,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select r.id, r.student_id, r.teacher_id, p.full_name, p.email, r.status, r.created_at, r.reviewed_at
  from public.teacher_join_requests r
  join public.students s on s.id = r.student_id
  join public.profiles p on p.id = s.profile_id
  where (r.teacher_id = public._current_teacher_id() or public.is_admin_or_owner())
    and (p_status is null or r.status = p_status)
  order by r.created_at desc;
$$;

revoke all on function public.get_my_join_requests(text) from public, anon;
grant execute on function public.get_my_join_requests(text) to authenticated;
