-- §284 (часть C): темы, которыми текущий пользователь управляет как персонал курса.
-- Считается один раз на запрос (по курсам), а не на каждую строку. Только добавление функции.
create or replace function public.staff_manageable_topics()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(tp.id), '{}'::uuid[])
    from topics tp
    join modules m on m.id = tp.module_id
   where m.course_id in (select c.id from courses c where public.course_is_staff(c.id));
$$;
revoke all on function public.staff_manageable_topics() from public, anon;
grant execute on function public.staff_manageable_topics() to authenticated;
