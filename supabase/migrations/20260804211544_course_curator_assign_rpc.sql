-- Назначение куратора курса: политика + RPC.
--
-- До этой миграции у course_curators не было INSERT-политики ВООБЩЕ — строку
-- умела вставить только definer-функция course_join_accept. Кнопки
-- «Назначить куратора» не могло существовать в принципе.

-- Кто имеет право назначать. Отдельная функция, а НЕ course_is_staff:
-- вопрос здесь другой — не «персонал ли», а «может ли раздавать
-- кураторство». course_is_staff отвечает «да» и самому куратору, а кураторы
-- других кураторов не назначают (решение владельца 2026-08-05).
-- Правило живёт здесь в единственном экземпляре: политики и RPC зовут его,
-- а не переписывают условия руками (урок §21/§29).
CREATE OR REPLACE FUNCTION public.course_can_assign_curator(p_course_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_course_id is not null and (
    public.course_is_admin()
    or exists (select 1 from courses c
                where c.id = p_course_id and c.owner_id = auth.uid())
    or exists (select 1 from groups g
                join teachers t on t.id = g.teacher_id
               where g.course_id = p_course_id and t.profile_id = auth.uid())
  );
$function$;

COMMENT ON FUNCTION public.course_can_assign_curator(uuid) IS
  'Кто раздаёт кураторство курса: админ, владелец курса, преподаватель группы. '
  'Сознательно НЕ course_is_staff — куратор не назначает кураторов.';

REVOKE ALL ON FUNCTION public.course_can_assign_curator(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.course_can_assign_curator(uuid) TO authenticated;

-- ── политики ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS course_curators_assign_insert ON public.course_curators;
CREATE POLICY course_curators_assign_insert ON public.course_curators
  FOR INSERT TO authenticated
  WITH CHECK (public.course_can_assign_curator(course_id));

-- Снятие — симметрично назначению. Раньше снимать могли только админ и
-- владелец курса; преподаватель группы, получив право назначать, обязан
-- уметь и отменить своё назначение.
DROP POLICY IF EXISTS course_curators_owner_delete ON public.course_curators;
DROP POLICY IF EXISTS course_curators_assign_delete ON public.course_curators;
CREATE POLICY course_curators_assign_delete ON public.course_curators
  FOR DELETE TO authenticated
  USING (public.course_can_assign_curator(course_id));

-- ── RPC ─────────────────────────────────────────────────────────────────────
-- Зачем RPC поверх политики: отказ должен быть виден ОШИБКОЙ, а не пустотой
-- (уроки §47/§54). Голая вставка под RLS отвечает 42501 без объяснения, а
-- отсутствие строки читается как «получилось».
CREATE OR REPLACE FUNCTION public.course_curator_assign(p_course_id uuid, p_profile_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
begin
  if not public.course_can_assign_curator(p_course_id) then
    raise exception 'Нет прав назначать кураторов этого курса'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from profiles p where p.id = p_profile_id) then
    raise exception 'Пользователь не найден' using errcode = 'check_violation';
  end if;

  insert into course_curators (course_id, profile_id)
  values (p_course_id, p_profile_id)
  on conflict (course_id, profile_id) do nothing
  returning id into v_id;

  if v_id is null then
    select cc.id into v_id from course_curators cc
     where cc.course_id = p_course_id and cc.profile_id = p_profile_id;
  end if;

  return v_id;
end $function$;

REVOKE ALL ON FUNCTION public.course_curator_assign(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.course_curator_assign(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.course_curator_remove(p_course_id uuid, p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.course_can_assign_curator(p_course_id) then
    raise exception 'Нет прав снимать кураторов этого курса'
      using errcode = 'insufficient_privilege';
  end if;

  delete from course_curators
   where course_id = p_course_id and profile_id = p_profile_id;
end $function$;

REVOKE ALL ON FUNCTION public.course_curator_remove(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.course_curator_remove(uuid, uuid) TO authenticated;

-- Кандидаты в кураторы. Без definer тут не обойтись: profiles видны по
-- profiles_select_* только «своим», а куратором можно назначить ЛЮБОЙ профиль
-- (решение владельца) — ученика чужого курса в том числе.
-- Плата за это — окно во всю школу, поэтому оно узкое: минимум два символа
-- запроса, не более 20 строк, и только тому, кто вправе назначать.
CREATE OR REPLACE FUNCTION public.course_curator_candidates(p_course_id uuid, p_query text)
 RETURNS TABLE(profile_id uuid, full_name text, email text, role text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_needle text := btrim(coalesce(p_query, ''));
begin
  if not public.course_can_assign_curator(p_course_id) then
    raise exception 'Нет прав назначать кураторов этого курса'
      using errcode = 'insufficient_privilege';
  end if;
  if length(v_needle) < 2 then
    return;
  end if;

  return query
    select p.id, p.full_name, p.email, p.role::text
      from profiles p
     where (p.full_name ilike '%' || v_needle || '%'
         or p.email     ilike '%' || v_needle || '%')
       and not exists (select 1 from course_curators cc
                        where cc.course_id = p_course_id and cc.profile_id = p.id)
     order by p.full_name
     limit 20;
end $function$;

REVOKE ALL ON FUNCTION public.course_curator_candidates(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.course_curator_candidates(uuid, text) TO authenticated;
