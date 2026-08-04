-- Кураторство — назначение ПОВЕРХ аккаунта, а не роль профиля.
-- Решение владельца 2026-08-04: любой ученик может курировать чужой курс,
-- оставаясь учеником в своих. Регистрация по-прежнему одна — ученическая.
--
-- До этой миграции кураторская ветка course_join_accept делала ровно
-- обратное: ученику, уже состоящему в группе, отвечала «Этот аккаунт уже
-- используется как ученический. Для кураторства зарегистрируйте отдельный
-- аккаунт», а всем остальным переписывала profiles.role в 'curator'. Это и
-- есть отказ «роль не подходит», на который жаловался владелец.
--
-- Ученическая ветка не трогается ни строкой.

CREATE OR REPLACE FUNCTION public.course_join_accept(p_value text)
 RETURNS TABLE(group_id uuid, course_id uuid, course_title text, joined_as text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Роль профиля НЕ проверяется и НЕ меняется: кураторство живёт строкой в
  -- course_curators, а не в profiles.role. Ученик из группы этого же курса
  -- тоже проходит — отказывать ему было бы возвратом к отменённой модели.
  insert into course_curators (course_id, profile_id)
  values (v_link.course_id, v_profile)
  on conflict (course_id, profile_id) do nothing;

  return query select null::uuid, v_link.course_id, v_title, 'curator'::text;
end $function$;

-- Исключение «вступление куратором по ссылке» в стороже ролей стало
-- недостижимым: единственный писавший в profiles.role путь только что убран.
-- Оставлять его — держать открытой дверь, в которую больше некому входить.
CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.role is distinct from old.role and not coalesce(is_admin_or_owner(), false) then
    new.role := old.role;
  end if;
  return new;
end $function$;
