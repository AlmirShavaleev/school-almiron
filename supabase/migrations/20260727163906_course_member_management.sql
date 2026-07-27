-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260727163906
--   name    = course_member_management
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
-- Управление участниками курса преподавателем (решение владельца, 2026-07-28):
-- персонал курса может переименовать ученика и отчислить его с курса.
-- Обычные RLS это запрещают (profiles/group_students правит только admin) —
-- поэтому узкие security definer RPC с проверкой course_is_staff.

-- Переименовать ученика СВОЕГО курса.
create or replace function public.course_member_rename(p_student_id uuid, p_full_name text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
begin
  if length(v_name) < 1 or length(v_name) > 200 then
    raise exception 'Имя должно быть от 1 до 200 символов' using errcode = 'check_violation';
  end if;

  select s.profile_id into v_profile from students s where s.id = p_student_id;
  if v_profile is null then
    raise exception 'Ученик не найден';
  end if;

  -- право: ученик состоит в курсе, где вызывающий — персонал
  if not exists (
    select 1
      from group_students gs
      join groups g on g.id = gs.group_id
     where gs.student_id = p_student_id
       and public.course_is_staff(g.course_id)
  ) then
    raise exception 'Нет прав: ученик не из вашего курса' using errcode = 'insufficient_privilege';
  end if;

  -- страховка: правим только учеников, не персонал
  if not exists (select 1 from profiles p where p.id = v_profile and p.role = 'student') then
    raise exception 'Можно переименовывать только учеников' using errcode = 'check_violation';
  end if;

  update profiles set full_name = v_name where id = v_profile;
end $$;

comment on function public.course_member_rename(uuid, text) is
  'Персонал курса переименовывает ученика своего курса. Только role=student.';

-- Отчислить ученика с курса (удаляет из всех групп ЭТОГО курса).
-- Аккаунт, работы и попытки ученика не удаляются.
create or replace function public.course_member_remove(p_course_id uuid, p_student_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = 'insufficient_privilege';
  end if;

  delete from group_students gs
   using groups g
   where g.id = gs.group_id
     and g.course_id = p_course_id
     and gs.student_id = p_student_id;

  if not found then
    raise exception 'Ученик не найден на этом курсе';
  end if;
end $$;

comment on function public.course_member_remove(uuid, uuid) is
  'Персонал курса отчисляет ученика (удаление из групп курса). Аккаунт и работы остаются.';

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('course_member_rename', 'course_member_remove')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

grant execute on function public.course_member_rename(uuid, text) to authenticated;
grant execute on function public.course_member_remove(uuid, uuid) to authenticated;
