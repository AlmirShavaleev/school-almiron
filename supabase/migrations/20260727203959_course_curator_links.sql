-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260727203959
--   name    = course_curator_links
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
-- ============================================================
-- Кураторы курса по ссылке/коду (решение владельца, 2026-07-28)
-- ============================================================
-- У курса появляется ВТОРАЯ постоянная ссылка/код — для кураторов.
-- Кураторов на курсе неограниченно: членство в course_curators (m2m),
-- а не слот groups.curator_id (легаси, не трогаем). Куратор получает
-- права персонала курса (course_is_staff) — проверка ДЗ, результаты.

-- 1. Членство кураторов
create table public.course_curators (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (course_id, profile_id)
);

comment on table public.course_curators is
  'Кураторы курса (без ограничения количества). Даёт права персонала через course_is_staff.';

alter table public.course_curators enable row level security;
grant select, delete on public.course_curators to authenticated;

create policy course_curators_staff_select on public.course_curators
  for select to authenticated
  using (public.course_is_staff(course_id));

-- убрать куратора может владелец курса/админ (но не куратор сам себя коллег)
create policy course_curators_owner_delete on public.course_curators
  for delete to authenticated
  using (
    public.course_is_admin()
    or exists (select 1 from courses c where c.id = course_id and c.owner_id = auth.uid())
  );

-- 2. Роль у ссылки: student | curator, по одной на курс на роль
alter table public.course_join_links
  add column link_role text not null default 'student'
  check (link_role in ('student', 'curator'));

alter table public.course_join_links drop constraint course_join_links_course_id_key;
alter table public.course_join_links add constraint course_join_links_course_role_key unique (course_id, link_role);

-- 3. course_is_staff: + кураторы курса
create or replace function public.course_is_staff(p_course_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select p_course_id is not null and (
    public.course_is_admin()
    or exists (select 1 from courses c
                where c.id = p_course_id and c.owner_id = auth.uid())
    or exists (select 1 from groups g
                join teachers t on t.id = g.teacher_id
               where g.course_id = p_course_id and t.profile_id = auth.uid())
    or exists (select 1 from groups g
                join curators cu on cu.id = g.curator_id
               where g.course_id = p_course_id and cu.profile_id = auth.uid())
    or exists (select 1 from course_curators cc
                where cc.course_id = p_course_id and cc.profile_id = auth.uid())
  );
$$;

-- 4. Страж ролей: узкая калитка student -> curator только под флагом RPC
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if new.role is distinct from old.role and not coalesce(is_admin_or_owner(), false) then
    -- единственное исключение: вступление куратором по ссылке курса
    -- (course_join_accept ставит флаг на время транзакции)
    if old.role = 'student' and new.role = 'curator'
       and coalesce(current_setting('app.course_join_curator', true), '') = 'on' then
      return new;
    end if;
    new.role := old.role;
  end if;
  return new;
end $$;

-- 5. RPC ссылок: добавляем роль (старые 1-арговые убираем — PostgREST перегрузки)
drop function public.course_join_link_get(uuid);
drop function public.course_join_link_rotate(uuid);
drop function public.course_join_link_set_active(uuid, boolean);

create or replace function public.course_join_link_get(p_course_id uuid, p_role text default 'student')
returns table (token text, short_code text, is_active boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row course_join_links%rowtype;
  v_try int := 0;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('student', 'curator') then
    raise exception 'Неизвестная роль ссылки' using errcode = 'check_violation';
  end if;

  select * into v_row from course_join_links l
   where l.course_id = p_course_id and l.link_role = p_role;
  if not found then
    loop
      v_try := v_try + 1;
      begin
        insert into course_join_links (course_id, link_role, token, short_code, created_by)
        values (p_course_id, p_role, public.course_join_gen_token(), public.course_join_gen_code(), auth.uid())
        returning * into v_row;
        exit;
      exception when unique_violation then
        if v_try > 5 then raise; end if;
      end;
    end loop;
  end if;

  return query select v_row.token, v_row.short_code, v_row.is_active;
end $$;

create or replace function public.course_join_link_rotate(p_course_id uuid, p_role text default 'student')
returns table (token text, short_code text, is_active boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row course_join_links%rowtype;
  v_try int := 0;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = 'insufficient_privilege';
  end if;

  loop
    v_try := v_try + 1;
    begin
      update course_join_links l
         set token = public.course_join_gen_token(),
             short_code = public.course_join_gen_code(),
             is_active = true,
             rotated_at = now()
       where l.course_id = p_course_id and l.link_role = p_role
       returning * into v_row;
      exit;
    exception when unique_violation then
      if v_try > 5 then raise; end if;
    end;
  end loop;

  if v_row.id is null then
    raise exception 'Ссылка курса ещё не создана';
  end if;

  return query select v_row.token, v_row.short_code, v_row.is_active;
end $$;

create or replace function public.course_join_link_set_active(p_course_id uuid, p_active boolean, p_role text default 'student')
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = 'insufficient_privilege';
  end if;
  update course_join_links set is_active = p_active
   where course_id = p_course_id and link_role = p_role;
  if not found then
    raise exception 'Ссылка курса ещё не создана';
  end if;
end $$;

-- 6. Вступление: одна RPC на обе роли; возвращаем joined_as
drop function public.course_join_accept(text);

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
      insert into groups (course_id, name)
      values (v_link.course_id, 'Группа курса')
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
    -- ученический аккаунт с членствами не превращаем в куратора
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
  'Вступление по ссылке/коду курса: ученик — в группу, куратор — в course_curators (+ повышение student->curator через калитку в страже ролей). Идемпотентно.';

-- 7. Гранты
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'course\_join%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

grant execute on function public.course_join_link_get(uuid, text)                 to authenticated;
grant execute on function public.course_join_link_rotate(uuid, text)              to authenticated;
grant execute on function public.course_join_link_set_active(uuid, boolean, text) to authenticated;
grant execute on function public.course_join_accept(text)                         to authenticated;
grant execute on function public.course_join_info(text)                           to anon, authenticated;

-- 8. Результаты тестов видит персонал курса привязки (в т.ч. кураторы),
--    а не только автор теста.
create or replace function public.topic_test_assignment_can_view(p_assignment_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_test_assignments a
     where a.id = p_assignment_id
       and public.topic_material_can_manage(a.topic_id)
  );
$$;

create or replace function public.topic_test_attempt_can_view(p_attempt_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from topic_test_attempts a
     where a.id = p_attempt_id
       and (public.topic_test_can_manage(a.test_id)
            or public.topic_test_assignment_can_view(a.assignment_id))
  );
$$;

drop policy topic_test_attempts_select on public.topic_test_attempts;
create policy topic_test_attempts_select on public.topic_test_attempts
  for select to authenticated
  using (
    student_id = public.auth_student_id()
    or public.topic_test_can_manage(test_id)
    or public.topic_test_assignment_can_view(assignment_id)
  );

revoke all on function public.topic_test_assignment_can_view(uuid) from public, anon, authenticated;
grant execute on function public.topic_test_assignment_can_view(uuid) to authenticated, service_role;
