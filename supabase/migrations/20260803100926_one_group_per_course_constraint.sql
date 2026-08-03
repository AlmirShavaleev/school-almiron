-- Закон «один курс = одна группа» в схеме. Ставится ПОСЛЕ уборки данных
-- (миграция one_group_per_course_cleanup), иначе уникальность не применится.

-- ── 1. Удаление курса уносит группу ──────────────────────────────────────────
-- Было ON DELETE SET NULL: удаление курса оставляло безхозную группу с
-- course_id = null. Именно так на проде появились две группы-сироты, которые
-- уборка и снесла. Уникальность на NULL не действует, поэтому со стороны
-- удаления закон был бы дырявым.
alter table public.groups drop constraint if exists groups_course_id_fkey;
alter table public.groups
  add constraint groups_course_id_fkey
  foreign key (course_id) references public.courses(id) on delete cascade;

-- ── 2. Одна группа на курс ───────────────────────────────────────────────────
-- Это же НАВСЕГДА закрывает гонку §21: два первых ученика курса больше не
-- могут создать по своей группе — вторая вставка упрётся в уникальность.
create unique index if not exists groups_one_per_course
  on public.groups (course_id);

-- ── 3. Курс рождается со своей группой ───────────────────────────────────────
-- Триггер на courses, а не правка каждого места создания курса: так автосоздание
-- одинаково срабатывает и при обычном создании, и при копировании курса
-- (course_copy_stage вставляет строку в courses). До этой миграции копия курса
-- рождалась вообще без группы.
--
-- SECURITY DEFINER: создаёт курс преподаватель, а вставка в groups идёт под
-- политиками groups_*; своей проверки прав здесь нет — право на курс уже
-- проверено тем, что строка в courses вставилась.
create or replace function public.courses_ensure_group()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.groups (course_id, name, teacher_id)
  values (
    new.id,
    new.title,
    (select t.id from teachers t where t.profile_id = new.owner_id)
  )
  on conflict (course_id) do nothing;
  return new;
end $function$;

comment on function public.courses_ensure_group() is
  'Один курс = одна группа: группа создаётся вместе с курсом, в том числе при копировании.';

drop trigger if exists courses_ensure_group_trg on public.courses;
create trigger courses_ensure_group_trg
after insert on public.courses
for each row execute function public.courses_ensure_group();

-- ── 4. Вступление по ссылке: только присоединиться к существующей ────────────
-- Ветка «создать группу, если её нет» осталась как страховка для курсов,
-- созданных до триггера, но теперь она идемпотентна: on conflict + перечитывание
-- вместо второй группы. Кураторская ветка групп не создаёт вовсе — она
-- возвращает null вместо group_id, так и было.
create or replace function public.course_join_accept(p_value text)
 returns TABLE(group_id uuid, course_id uuid, course_title text, joined_as text)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
      -- Страховка для курсов старше триггера. on conflict важен: при гонке
      -- двух первых учеников вторая вставка не создаёт вторую группу, а
      -- уступает — id забирается перечитыванием ниже. Это и есть закрытие §21.
      insert into groups (course_id, name, teacher_id)
      values (
        v_link.course_id,
        v_title,
        (select t.id from courses c left join teachers t on t.profile_id = c.owner_id where c.id = v_link.course_id)
      )
      on conflict (course_id) do nothing
      returning id into v_group;

      if v_group is null then
        select g.id into v_group from groups g
         where g.course_id = v_link.course_id
         order by g.created_at limit 1;
      end if;
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
end $function$;
