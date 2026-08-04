-- Починка 42702 «column reference "course_id" is ambiguous».
--
-- Функция объявлена как RETURNS TABLE(group_id, course_id, …) — а это OUT-
-- параметры, то есть переменные plpgsql с теми же именами, что и колонки
-- таблиц. В списке колонок `on conflict (…)` plpgsql подставляет переменные
-- раньше, чем Postgres выводит индекс, и падает.
--
-- Мина была не только в новой кураторской вставке: `insert into groups …
-- on conflict (course_id) do nothing` из ученической ветки (страховка §21 для
-- курсов старше триггера) ломается ровно так же. Она просто не срабатывала —
-- ветка выполняется, только если у курса ещё нет группы, а с §61/§64 группу
-- заводит триггер. Чиню обе разом: пробуждение старой мины при живой
-- кураторской ссылке — вопрос времени.
--
-- `#variable_conflict use_column` действует на всю функцию и безопасен здесь:
-- ВСЕ собственные переменные названы с префиксом `v_`, пересечься с колонками
-- им нечем.

CREATE OR REPLACE FUNCTION public.course_join_accept(p_value text)
 RETURNS TABLE(group_id uuid, course_id uuid, course_title text, joined_as text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
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
