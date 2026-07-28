-- Курс-владелец (role='teacher', не платформенный admin/owner) не видел
-- учеников, вступивших по ссылке-приглашению в курс без явно назначенных
-- групп: RLS-хелперы auth_is_staff_of_student/auth_is_staff_of_profile
-- проверяли только teacher_id/curator_id конкретной группы, без fallback
-- на владельца курса (в отличие от course_is_staff, где такой fallback уже есть).
-- course_join_accept при первом вступлении лениво создаёт группу "Группа курса"
-- без teacher_id/curator_id — отсюда и дыра.
--
-- Проверено на локальном Postgres 16 (эмуляция RLS через set role authenticated +
-- request.jwt.claim.sub): владелец теперь видит ученика, посторонний учитель —
-- по-прежнему нет, ранее назначенный учитель своего ученика видит как и раньше.
-- Также проверена идемпотентность course_join_accept и что auto-created группа
-- получает teacher_id = teachers.id владельца курса.

create or replace function public.auth_is_staff_of_student(stu_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from group_students gs
      join groups g    on g.id = gs.group_id
      left join teachers t on t.id = g.teacher_id
      left join curators c on c.id = g.curator_id
    where gs.student_id = stu_id
      and (
        t.profile_id = auth.uid()
        or c.profile_id = auth.uid()
        or public.auth_is_course_owner(g.course_id)
      )
  )
$$;

create or replace function public.auth_is_staff_of_profile(pid uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from students s
      join group_students gs on gs.student_id = s.id
      join groups g          on g.id = gs.group_id
      left join teachers t   on t.id = g.teacher_id
      left join curators c   on c.id = g.curator_id
    where s.profile_id = pid
      and (
        t.profile_id = auth.uid()
        or c.profile_id = auth.uid()
        or public.auth_is_course_owner(g.course_id)
      )
  )
$$;

-- Тело функции идентично текущему боевому (роль ссылки student/curator,
-- joined_as), изменена только ленивая вставка группы: teacher_id теперь
-- по умолчанию — teachers.id владельца курса, если у него есть запись
-- в teachers.
create or replace function public.course_join_accept(p_value text)
returns table (group_id uuid, course_id uuid, course_title text, joined_as text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_link course_join_links%rowtype;
  v_profile uuid := auth.uid();
  v_role text;
  v_student uuid;
  v_group uuid;
  v_title text;
begin
  if v_profile is null then
    raise exception 'Требуется вход в аккаунт' using errcode = 'insufficient_privilege';
  end if;

  select * into v_link from course_join_links l
   where l.token = p_value
      or l.short_code = upper(regexp_replace(coalesce(p_value, ''), '[\s-]+', '', 'g'));
  if not found then
    raise exception 'Ссылка или код не найдены. Проверьте код у преподавателя.';
  end if;
  if not v_link.is_active then
    raise exception 'Набор закрыт. Обратитесь к преподавателю.';
  end if;

  select p.role into v_role from profiles p where p.id = v_profile;
  select c.title into v_title from courses c where c.id = v_link.course_id;

  if v_link.link_role = 'student' then
    if v_role is distinct from 'student' then
      raise exception 'По этой ссылке присоединяются только ученики' using errcode = 'check_violation';
    end if;

    select s.id into v_student from students s where s.profile_id = v_profile;
    if v_student is null then
      insert into students (profile_id) values (v_profile) returning id into v_student;
    end if;

    select g.id into v_group from groups g
     where g.course_id = v_link.course_id
     order by g.created_at limit 1;
    if v_group is null then
      insert into groups (course_id, name, teacher_id)
      values (
        v_link.course_id,
        'Группа курса',
        (select t.id from courses c left join teachers t on t.profile_id = c.owner_id where c.id = v_link.course_id)
      )
      returning id into v_group;
    end if;

    insert into group_students (group_id, student_id)
    values (v_group, v_student)
    on conflict do nothing;

    return query select v_group, v_link.course_id, v_title, 'student'::text;
    return;
  end if;

  -- ── кураторская ссылка ──
  if v_role = 'student' then
    if exists (select 1 from students s join group_students gs on gs.student_id = s.id
                where s.profile_id = v_profile) then
      raise exception 'Этот аккаунт уже используется как ученический. Для кураторства зарегистрируйте отдельный аккаунт.'
        using errcode = 'check_violation';
    end if;
    perform set_config('app.course_join_curator', 'on', true);
    update profiles set role = 'curator' where id = v_profile;
    perform set_config('app.course_join_curator', '', true);
  elsif v_role not in ('curator', 'teacher', 'admin', 'owner') then
    raise exception 'Эта ссылка для кураторов' using errcode = 'check_violation';
  end if;

  insert into course_curators (course_id, profile_id)
  values (v_link.course_id, v_profile)
  on conflict do nothing;

  return query select null::uuid, v_link.course_id, v_title, 'curator'::text;
end $$;

comment on function public.course_join_accept(text) is
  'Вступление по ссылке/коду курса: ученик — в группу (teacher_id по умолчанию = владелец курса), куратор — в course_curators (+ повышение student->curator через калитку в страже ролей). Идемпотентно.';
