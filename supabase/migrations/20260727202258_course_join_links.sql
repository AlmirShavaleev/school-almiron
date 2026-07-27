-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260727202258
--   name    = course_join_links
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
-- ============================================================
-- Многоразовая ссылка/код курса (решение владельца, 2026-07-28)
-- ============================================================
-- Вместо персональных приглашений по ФИО: у курса ОДНА постоянная
-- ссылка (длинный token) и короткий код для диктовки. Ученик проходит
-- по ссылке или вводит код на /join, регистрируется и попадает в курс.
-- «Перевыпустить» меняет token+код (старые гаснут), «Закрыть набор» —
-- is_active=false. Персональные приглашения остаются в базе (легаси),
-- из UI убраны.

create table public.course_join_links (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null unique references public.courses(id) on delete cascade,
  token      text not null unique,
  short_code text not null unique,
  is_active  boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

comment on table public.course_join_links is
  'Многоразовая ссылка/код набора на курс. UNIQUE(course_id) — одна на курс.';

alter table public.course_join_links enable row level security;
grant select on public.course_join_links to authenticated;

create policy course_join_links_staff_select on public.course_join_links
  for select to authenticated
  using (public.course_is_staff(course_id));
-- запись только через RPC (security definer)

-- ── генерация кода без похожих символов (0/O/1/I/L) ─────────
create or replace function public.course_join_gen_code()
returns text language plpgsql volatile as $$
declare
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i int;
begin
  for i in 1..6 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;
  return v_code;
end $$;

create or replace function public.course_join_gen_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

-- ── получить (создав при первом обращении) ──────────────────
create or replace function public.course_join_link_get(p_course_id uuid)
returns table (token text, short_code text, is_active boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row course_join_links%rowtype;
  v_try int := 0;
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from course_join_links l where l.course_id = p_course_id;
  if not found then
    loop
      v_try := v_try + 1;
      begin
        insert into course_join_links (course_id, token, short_code, created_by)
        values (p_course_id, public.course_join_gen_token(), public.course_join_gen_code(), auth.uid())
        returning * into v_row;
        exit;
      exception when unique_violation then
        if v_try > 5 then raise; end if;
      end;
    end loop;
  end if;

  return query select v_row.token, v_row.short_code, v_row.is_active;
end $$;

-- ── перевыпустить: старые ссылка и код гаснут ────────────────
create or replace function public.course_join_link_rotate(p_course_id uuid)
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
       where l.course_id = p_course_id
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

-- ── открыть/закрыть набор ────────────────────────────────────
create or replace function public.course_join_link_set_active(p_course_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.course_is_staff(p_course_id) then
    raise exception 'Нет прав на этот курс' using errcode = 'insufficient_privilege';
  end if;
  update course_join_links set is_active = p_active where course_id = p_course_id;
  if not found then
    raise exception 'Ссылка курса ещё не создана';
  end if;
end $$;

-- ── инфо для лендинга до регистрации (anon) ──────────────────
create or replace function public.course_join_info(p_value text)
returns table (course_title text, is_active boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.title, l.is_active
    from course_join_links l
    join courses c on c.id = l.course_id
   where l.token = p_value
      or l.short_code = upper(regexp_replace(coalesce(p_value, ''), '[\s-]+', '', 'g'));
$$;

-- ── вступить: ссылка ИЛИ код, идемпотентно ───────────────────
create or replace function public.course_join_accept(p_value text)
returns table (group_id uuid, course_id uuid, course_title text)
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
    raise exception 'Набор на курс закрыт. Обратитесь к преподавателю.';
  end if;

  select p.role into v_role from profiles p where p.id = v_profile;
  if v_role is distinct from 'student' then
    raise exception 'Присоединяться к курсу по ссылке могут только ученики'
      using errcode = 'check_violation';
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

  select c.title into v_title from courses c where c.id = v_link.course_id;
  return query select v_group, v_link.course_id, v_title;
end $$;

comment on function public.course_join_accept(text) is
  'Вступление в курс по ссылке (token) или коду. Идемпотентно: повторный вызов не дублирует членство.';

-- ── гранты ───────────────────────────────────────────────────
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

grant execute on function public.course_join_link_get(uuid)                to authenticated;
grant execute on function public.course_join_link_rotate(uuid)             to authenticated;
grant execute on function public.course_join_link_set_active(uuid, boolean) to authenticated;
grant execute on function public.course_join_accept(text)                  to authenticated;
grant execute on function public.course_join_info(text)                    to anon, authenticated;
