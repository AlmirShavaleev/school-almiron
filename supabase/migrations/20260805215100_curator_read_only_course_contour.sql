-- Куратору положено ТОЛЬКО проверять работы и читать. Клик-проверка владельца
-- нашла обратное: через course_is_staff куратор получал управление половиной
-- контура курса.
--
-- Причина общая: `course_is_staff` отвечает на вопрос «этот человек — персонал
-- курса», и с §29 в её ответ входят кураторы. Но политики управления задают
-- ДРУГОЙ вопрос — «может ли он это менять», — и разница между вопросами до
-- сих пор нигде не была записана.
--
-- Записываем её здесь одной функцией. Ручных копий условия не заводим: именно
-- рассинхрон копий породил §21 и §29 (правило CLAUDE.md).

CREATE OR REPLACE FUNCTION public.course_is_teacher_staff(p_course_id uuid)
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

COMMENT ON FUNCTION public.course_is_teacher_staff(uuid) IS
  'Кто ВЕДЁТ курс: админ, владелец курса, преподаватель группы. Куратор сюда '
  'НЕ входит — он проверяет работы и читает, но ничего не меняет. '
  'Отличать от course_is_staff («персонал курса», кураторы включены): та '
  'отвечает на вопрос о доступе к чтению и проверке, эта — об управлении. '
  'Новых копий условия не заводить.';

REVOKE ALL ON FUNCTION public.course_is_teacher_staff(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.course_is_teacher_staff(uuid) TO authenticated;

-- Правило назначения кураторов задавало тот же вопрос и было записано
-- отдельно (§86). Сводим: одно условие — одна функция.
CREATE OR REPLACE FUNCTION public.course_can_assign_curator(p_course_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.course_is_teacher_staff(p_course_id);
$function$;

-- Управление содержимым темы. Пара к topic_material_can_manage, которая
-- остаётся ответом на вопрос «может смотреть и проверять».
CREATE OR REPLACE FUNCTION public.topic_material_can_edit(p_topic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.course_is_teacher_staff(public.course_of_topic(p_topic_id));
$function$;

REVOKE ALL ON FUNCTION public.topic_material_can_edit(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.topic_material_can_edit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.topic_homework_can_edit(p_homework_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.topic_material_can_edit(public.topic_homework_topic(p_homework_id));
$function$;

REVOKE ALL ON FUNCTION public.topic_homework_can_edit(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.topic_homework_can_edit(uuid) TO authenticated;

-- ── темы и модули: убираем ручные копии условия ─────────────────────────────
-- Куратора эти политики и раньше не пускали (проба: update тем под куратором
-- меняет 0 строк). Но условие было выписано руками в двух местах, и заготовка
-- §59.8 предлагала дописать в него кураторов — решение владельца 2026-08-05
-- прямо обратное. Заменяем копии вызовом, чтобы дописывать было некуда.
DROP POLICY IF EXISTS topics_manage_teacher ON public.topics;
CREATE POLICY topics_manage_teacher ON public.topics
  FOR ALL
  USING (EXISTS (select 1 from modules m
                  where m.id = topics.module_id
                    and public.course_is_teacher_staff(m.course_id)))
  WITH CHECK (EXISTS (select 1 from modules m
                       where m.id = topics.module_id
                         and public.course_is_teacher_staff(m.course_id)));

DROP POLICY IF EXISTS modules_manage_teacher ON public.modules;
CREATE POLICY modules_manage_teacher ON public.modules
  FOR ALL
  USING (public.course_is_teacher_staff(course_id))
  WITH CHECK (public.course_is_teacher_staff(course_id));

-- ── содержимое темы: чтение персоналу, запись преподавателю ─────────────────
-- Одну ALL-политику разбиваем на SELECT и три пишущие команды. Куратор обязан
-- ЧИТАТЬ: без строки topic_homework `!inner`-джойн очереди проверки выбросил
-- бы все работы, и страница показала бы пустоту вместо ошибки (симптом из
-- CLAUDE.md). Условие `created_by = auth.uid()` в пишущих ветках сохранено
-- дословно — оно про авторство, а не про роль, и трогать его не за чем.

DROP POLICY IF EXISTS topic_homework_staff_all ON public.topic_homework;
CREATE POLICY topic_homework_staff_select ON public.topic_homework
  FOR SELECT USING (public.topic_material_can_manage(topic_id));
CREATE POLICY topic_homework_teacher_insert ON public.topic_homework
  FOR INSERT WITH CHECK (public.topic_material_can_edit(topic_id) AND created_by = auth.uid());
CREATE POLICY topic_homework_teacher_update ON public.topic_homework
  FOR UPDATE USING (public.topic_material_can_edit(topic_id))
  WITH CHECK (public.topic_material_can_edit(topic_id) AND created_by = auth.uid());
CREATE POLICY topic_homework_teacher_delete ON public.topic_homework
  FOR DELETE USING (public.topic_material_can_edit(topic_id));

DROP POLICY IF EXISTS topic_material_items_staff_all ON public.topic_material_items;
CREATE POLICY topic_material_items_staff_select ON public.topic_material_items
  FOR SELECT USING (public.topic_material_can_manage(topic_id));
CREATE POLICY topic_material_items_teacher_insert ON public.topic_material_items
  FOR INSERT WITH CHECK (public.topic_material_can_edit(topic_id) AND created_by = auth.uid());
CREATE POLICY topic_material_items_teacher_update ON public.topic_material_items
  FOR UPDATE USING (public.topic_material_can_edit(topic_id))
  WITH CHECK (public.topic_material_can_edit(topic_id) AND created_by = auth.uid());
CREATE POLICY topic_material_items_teacher_delete ON public.topic_material_items
  FOR DELETE USING (public.topic_material_can_edit(topic_id));

DROP POLICY IF EXISTS topic_test_assignments_staff_all ON public.topic_test_assignments;
CREATE POLICY topic_test_assignments_staff_select ON public.topic_test_assignments
  FOR SELECT USING (public.topic_material_can_manage(topic_id));
CREATE POLICY topic_test_assignments_teacher_insert ON public.topic_test_assignments
  FOR INSERT WITH CHECK (public.topic_material_can_edit(topic_id) AND assigned_by = auth.uid());
CREATE POLICY topic_test_assignments_teacher_update ON public.topic_test_assignments
  FOR UPDATE USING (public.topic_material_can_edit(topic_id))
  WITH CHECK (public.topic_material_can_edit(topic_id) AND assigned_by = auth.uid());
CREATE POLICY topic_test_assignments_teacher_delete ON public.topic_test_assignments
  FOR DELETE USING (public.topic_material_can_edit(topic_id));

DROP POLICY IF EXISTS course_lessons_staff_all ON public.course_lessons;
CREATE POLICY course_lessons_staff_select ON public.course_lessons
  FOR SELECT USING (public.course_is_staff(public.course_of_topic(topic_id)));
CREATE POLICY course_lessons_teacher_insert ON public.course_lessons
  FOR INSERT WITH CHECK (public.topic_material_can_edit(topic_id) AND created_by = auth.uid());
CREATE POLICY course_lessons_teacher_update ON public.course_lessons
  FOR UPDATE USING (public.topic_material_can_edit(topic_id))
  WITH CHECK (public.topic_material_can_edit(topic_id) AND created_by = auth.uid());
CREATE POLICY course_lessons_teacher_delete ON public.course_lessons
  FOR DELETE USING (public.topic_material_can_edit(topic_id));

-- Файлы САМОГО задания (условие, приложенное преподавателем) — не файлы
-- сдачи. Куратор их читает при проверке, но не подменяет.
DROP POLICY IF EXISTS topic_homework_files_staff_all ON public.topic_homework_files;
CREATE POLICY topic_homework_files_staff_select ON public.topic_homework_files
  FOR SELECT USING (public.topic_homework_can_manage(homework_id));
CREATE POLICY topic_homework_files_teacher_insert ON public.topic_homework_files
  FOR INSERT WITH CHECK (public.topic_homework_can_edit(homework_id));
CREATE POLICY topic_homework_files_teacher_update ON public.topic_homework_files
  FOR UPDATE USING (public.topic_homework_can_edit(homework_id))
  WITH CHECK (public.topic_homework_can_edit(homework_id));
CREATE POLICY topic_homework_files_teacher_delete ON public.topic_homework_files
  FOR DELETE USING (public.topic_homework_can_edit(homework_id));

-- ── приглашения: куратор не набирает курс ──────────────────────────────────
-- Ссылки перестают быть ему видны и на уровне строки.
DROP POLICY IF EXISTS course_join_links_staff_select ON public.course_join_links;
CREATE POLICY course_join_links_staff_select ON public.course_join_links
  FOR SELECT USING (public.course_is_teacher_staff(course_id));

CREATE OR REPLACE FUNCTION public.course_join_link_get(p_course_id uuid, p_role text DEFAULT 'student'::text)
 RETURNS TABLE(token text, short_code text, is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row course_join_links%rowtype;
  v_try int := 0;
begin
  -- Набор на курс ведёт тот, кто курс ведёт. Куратора не пускаем ни к
  -- ученической ссылке, ни к кураторской: иначе он приводил бы на курс и
  -- учеников, и других кураторов (решение владельца 2026-08-05).
  if not public.course_is_teacher_staff(p_course_id) then
    raise exception 'Нет прав приглашать на этот курс' using errcode = 'insufficient_privilege';
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
end $function$;

CREATE OR REPLACE FUNCTION public.course_join_link_rotate(p_course_id uuid, p_role text DEFAULT 'student'::text)
 RETURNS TABLE(token text, short_code text, is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row course_join_links%rowtype;
  v_try int := 0;
begin
  if not public.course_is_teacher_staff(p_course_id) then
    raise exception 'Нет прав менять ссылки этого курса' using errcode = 'insufficient_privilege';
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
end $function$;

CREATE OR REPLACE FUNCTION public.course_join_link_set_active(p_course_id uuid, p_active boolean, p_role text DEFAULT 'student'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.course_is_teacher_staff(p_course_id) then
    raise exception 'Нет прав менять набор на этот курс' using errcode = 'insufficient_privilege';
  end if;
  update course_join_links set is_active = p_active
   where course_id = p_course_id and link_role = p_role;
  if not found then
    raise exception 'Ссылка курса ещё не создана';
  end if;
end $function$;

-- ── состав курса: куратор им не управляет ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.course_member_remove(p_course_id uuid, p_student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.course_is_teacher_staff(p_course_id) then
    raise exception 'Нет прав менять состав этого курса' using errcode = 'insufficient_privilege';
  end if;

  delete from group_students gs
   using groups g
   where g.id = gs.group_id
     and g.course_id = p_course_id
     and gs.student_id = p_student_id;

  if not found then
    raise exception 'Ученик не найден на этом курсе';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.course_member_rename(p_student_id uuid, p_full_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  if not exists (
    select 1
      from group_students gs
      join groups g on g.id = gs.group_id
     where gs.student_id = p_student_id
       and public.course_is_teacher_staff(g.course_id)
  ) then
    raise exception 'Нет прав: ученик не из вашего курса' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from profiles p where p.id = v_profile and p.role = 'student') then
    raise exception 'Можно переименовывать только учеников' using errcode = 'check_violation';
  end if;

  update profiles set full_name = v_name where id = v_profile;
end $function$;

-- ── копирование темы: это правка программы ────────────────────────────────
-- Сторона-ИСТОЧНИК остаётся на course_is_staff: там только чтение, и куратор
-- вправе прочесть тему своего курса. Ужимаем сторону-ПРИЁМНИК.
CREATE OR REPLACE FUNCTION public.topic_copy_stage(p_source_topic_id uuid, p_target_module_id uuid, p_mode text DEFAULT 'clear'::text, p_shift_days integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me uuid := auth.uid();
  v_src topics%rowtype;
  v_target_course uuid;
  v_new_topic uuid;
  v_files jsonb;
  v_job uuid;
begin
  if v_me is null then raise exception 'Требуется вход в аккаунт' using errcode='insufficient_privilege'; end if;
  if p_mode not in ('clear','keep','shift') then raise exception 'Неизвестный режим дат' using errcode='check_violation'; end if;

  select * into v_src from topics where id = p_source_topic_id;
  if not found then raise exception 'Тема не найдена'; end if;

  select course_id into v_target_course from modules where id = p_target_module_id;
  if v_target_course is null then raise exception 'Модуль-приёмник не найден'; end if;

  -- Права проверяем с ОБЕИХ сторон: читать исходную тему и добавлять в
  -- целевой курс. Одной проверки мало — иначе можно было бы утащить чужой
  -- материал в свой курс или, наоборот, засорить чужой своим.
  if not public.topic_material_can_manage(p_source_topic_id) then
    raise exception 'Нет прав на исходную тему' using errcode='insufficient_privilege';
  end if;
  if not public.course_is_teacher_staff(v_target_course) then
    raise exception 'Нет прав добавлять темы в курс-приёмник' using errcode='insufficient_privilege';
  end if;

  insert into topics (module_id, title, order_index, max_score, available_from)
  values (
    p_target_module_id, v_src.title,
    (select coalesce(max(t.order_index), -1) + 1 from topics t where t.module_id = p_target_module_id),
    v_src.max_score,
    public.course_copy_shift_date(v_src.available_from, p_mode, p_shift_days)
  ) returning id into v_new_topic;

  v_files := public.course_copy_topic_content(p_source_topic_id, v_new_topic, p_mode, p_shift_days);

  insert into course_copy_jobs (requested_by, source_topic_id, target_course_id, target_topic_id, kind, files)
  values (v_me, p_source_topic_id, v_target_course, v_new_topic, 'topic', v_files)
  returning id into v_job;

  return jsonb_build_object('job_id', v_job, 'topic_id', v_new_topic, 'course_id', v_target_course, 'files', v_files);
end $function$;
