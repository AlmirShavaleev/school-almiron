-- Гонка первого обращения к ссылке курса.
--
-- Старый обработчик unique_violation был написан под коллизию short_code
-- (случайные 6 символов) и просто повторял INSERT с новым кодом. Но тот же
-- обработчик ловит и конфликт по UNIQUE(course_id, link_role) — когда ссылку
-- этой роли только что создал ПАРАЛЛЕЛЬНЫЙ вызов. Повторный INSERT в этом
-- случае обречён всегда: после 5 попыток RPC падала, а фронт молча прятал
-- карточку приглашения (JoinLinkCard при ошибке рендерит null).
--
-- Наблюдалось в реальности: React StrictMode дважды запускает эффект
-- CourseStudentsSection, два конкурентных course_join_link_get на свежем
-- курсе сталкивались, вкладка «Ученики» оставалась без карточек ссылок.
-- Тем же образом столкнутся и два преподавателя, открывшие вкладку
-- одновременно.
--
-- Фикс: при unique_violation сначала перечитываем строку роли — если её
-- создал конкурент, отдаём её (обе стороны получают одну и ту же ссылку).
-- Нет строки — значит это была коллизия short_code, перегенерируем как раньше.
--
-- Прогнано на локальном Postgres 16 двумя конкурентными сессиями:
-- старая версия — duplicate key после 5 повторов, новая — обе сессии получают
-- одну и ту же строку, в таблице ровно одна ссылка.

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
        -- Конкурент успел первым? Его строка — тоже правильный ответ.
        select * into v_row from course_join_links l
         where l.course_id = p_course_id and l.link_role = p_role;
        if found then exit; end if;
        -- Иначе столкнулись short_code двух разных курсов — пробуем ещё раз.
        if v_try > 5 then raise; end if;
      end;
    end loop;
  end if;

  return query select v_row.token, v_row.short_code, v_row.is_active;
end $$;
