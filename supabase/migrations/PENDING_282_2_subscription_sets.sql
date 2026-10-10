-- §282.2 — проверка подписки без нагрузки на базу (после сбоя 10.10, §284).
--
-- Причина. В §282 подписка проверялась в course_student_has_access, а та
-- стоит в RLS построчно (через course_student_can_see_topic): на страницу
-- курса — тысячи вложенных SECURITY DEFINER-вызовов. §284 убрал подписку из
-- ворот и перевёл topic_material_items на наборы тем, считаемые один раз на
-- запрос (initplan). Здесь подписка возвращается так, чтобы стоить O(курсов):
--
--   1. student_access_courses() — курсы, к которым у ученика доступ СЕЙЧАС
--      (группа / student_courses, как в course_student_has_access, + подписка
--      по правилу subscription_access_ok — по одному вызову на курс ученика).
--      От него строятся все наборы тем: student_candidate_topics(),
--      student_visible_topics() (= course_student_can_see_topic по множеству),
--      и через них — student_tmi_*; политики topic_material_items получают
--      подписку бесплатно.
--   2. course_student_has_access (одиночные вызовы из RPC и storage) — дешёвый
--      выход «у курса нет тарифов» одной пробой индекса, без вложенных
--      definer-вызовов; правило подписки зовётся только для платного курса.
--   3. Ворота «на один вызов» (пробник, автопроверка, файлы course-materials) —
--      подписка как в §282, с тем же дешёвым выходом.
--   4. Все политики, где course_student_has_access / course_student_can_see_topic
--      стояли построчно, переведены на initplan-наборы: course_lessons,
--      topic_homework, topic_homework_files, topic_tests, topic_test_assignments,
--      topic_autocheck_tasks, topic_catalog_topics, topic_subtopic_hidden,
--      course_study_plans, course_study_plan_items. Множества видимых строк те же
--      (проверено md5 на учениках прода, отчёт §282.2).
--   5. Политики персонала на course_lessons, topic_homework,
--      topic_test_assignments — на staff_manageable_topics() (§284 C).
--      Сам набор теперь перебирает course_id модулей, а не строки courses:
--      иначе темы модулей удалённых курсов выпадали у админа (на проде —
--      2 ДЗ), и множество не совпадало с course_is_staff(course_of_topic()).
--   6. Политики topic_material_items из §284 (p284b/p284c, применены через SQL
--      Editor, в миграциях их не было) — записаны здесь теми же телами, чтобы
--      схема в репозитории совпадала с продом.
--
-- Роли политик, бывших `to public` (study_plans, catalog_topics, staff_select), стали
-- `to authenticated`: анониму они и раньше не отдавали строк (ворота ученика и
-- персонала для него ложны), а новые наборы анониму не выданы.

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Наборы ученика
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.student_access_courses()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  with me as (select public.auth_student_id() as id),
  c as (
    select g.course_id
      from group_students gs
      join groups g on g.id = gs.group_id
      join me on gs.student_id = me.id
    union
    select sc.course_id
      from student_courses sc
      join me on sc.student_id = me.id
     where sc.status in ('active', 'trial')
       and (sc.expires_at is null or sc.expires_at > now())
  )
  select coalesce(array_agg(c.course_id), '{}'::uuid[])
    from c, me
   where c.course_id is not null
     and public.subscription_access_ok(me.id, c.course_id);
$$;

-- Темы курсов с доступом (без учёта открытия темы). Раньше — все курсы групп и
-- student_courses любого статуса; лишние темы всё равно отсекались пересечением
-- со student_tmi_visible_topics, так что множества строк политик не меняются.
create or replace function public.student_candidate_topics()
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select tp.id
    from topics tp
    join modules m on m.id = tp.module_id
   where m.course_id = any((select public.student_access_courses())::uuid[]);
$$;

-- = { t : course_student_can_see_topic(t) }, одним проходом.
create or replace function public.student_visible_topics()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(tp.id), '{}'::uuid[])
    from topics tp
    join modules m on m.id = tp.module_id
   where m.course_id = any((select public.student_access_courses())::uuid[])
     and public.topic_open_now(tp.is_open, tp.available_from);
$$;

create or replace function public.student_tmi_visible_topics()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.student_visible_topics();
$$;

-- = { h : topic_homework_student_can_see(h) }
create or replace function public.student_visible_homework()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(h.id), '{}'::uuid[])
    from topic_homework h
   where h.is_published
     and h.topic_id = any((select public.student_visible_topics())::uuid[]);
$$;

-- = { t : topic_test_student_can_see(t) }
create or replace function public.student_visible_tests()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct a.test_id), '{}'::uuid[])
    from topic_test_assignments a
   where a.test_id is not null
     and a.topic_id = any((select public.student_visible_topics())::uuid[]);
$$;

-- Набор персонала (§284 C) перебирал строки courses, а course_is_staff(course_of_topic(t))
-- берёт course_id модуля как есть. Модули удалённых курсов (на проде есть) админ видел
-- раньше и не видел после §284 — теперь множество снова равно построчному правилу.
create or replace function public.staff_manageable_topics()
returns uuid[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(tp.id), '{}'::uuid[])
    from topics tp
    join modules m on m.id = tp.module_id
   where m.course_id in (select distinct m2.course_id from modules m2
                          where public.course_is_staff(m2.course_id));
$$;

revoke all on function public.student_access_courses()    from public, anon;
revoke all on function public.student_visible_topics()    from public, anon;
revoke all on function public.student_visible_homework()  from public, anon;
revoke all on function public.student_visible_tests()     from public, anon;
grant execute on function public.student_access_courses()   to authenticated;
grant execute on function public.student_visible_topics()   to authenticated;
grant execute on function public.student_visible_homework() to authenticated;
grant execute on function public.student_visible_tests()    to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Ворота одиночных вызовов: подписка с дешёвым выходом
--    «нет тарифов» — одна проба subscription_tariffs_course_idx; правило
--    subscription_access_ok зовётся только для платного курса.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.course_student_has_access(p_course_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_course_id is not null and (
    exists (select 1 from group_students gs
              join groups g on g.id = gs.group_id
             where gs.student_id = public.auth_student_id()
               and g.course_id = p_course_id)
    or exists (select 1 from student_courses sc
                where sc.student_id = public.auth_student_id()
                  and sc.course_id = p_course_id
                  and sc.status in ('active', 'trial')
                  and (sc.expires_at is null or sc.expires_at > now()))
  )
  and (not exists (select 1 from subscription_tariffs t where t.course_id = p_course_id)
       or public.subscription_access_ok(public.auth_student_id(), p_course_id));
$$;

create or replace function public.mock_exam_my_student_id(p_mock_exam_id uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id
    from public.mock_exams me
    join public.group_students gs on gs.group_id = me.group_id
    join public.students s on s.id = gs.student_id
    join public.groups g on g.id = me.group_id
   where me.id = p_mock_exam_id and s.profile_id = auth.uid()
     and (not exists (select 1 from public.subscription_tariffs t where t.course_id = g.course_id)
          or public.subscription_access_ok(s.id, g.course_id))
   limit 1;
$$;

create or replace function public._topic_autocheck_student_of(p_topic_id uuid, p_profile_id uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id
    from students s
    join group_students gs on gs.student_id = s.id
    join groups g          on g.id = gs.group_id
   where s.profile_id = p_profile_id
     and g.course_id = public.course_of_topic(p_topic_id)
     and (not exists (select 1 from subscription_tariffs t where t.course_id = g.course_id)
          or public.subscription_access_ok(s.id, g.course_id))
   order by s.id
   limit 1;
$$;

create or replace function public.auth_is_student_of_topic(p_topic_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from topics tp
    join modules m on m.id = tp.module_id
    join groups g  on g.course_id = m.course_id
    join group_students gs on gs.group_id = g.id
    join students s on s.id = gs.student_id
    where tp.id = p_topic_id and s.profile_id = auth.uid()
      and (not exists (select 1 from subscription_tariffs t where t.course_id = g.course_id)
           or public.subscription_access_ok(s.id, g.course_id))
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Политики: построчные ворота → initplan-наборы
--    `(select f())` — подзапрос без ссылок на строку: считается один раз.
-- ─────────────────────────────────────────────────────────────────────────

-- 3.1 topic_material_items — тела §284 (p284b/p284c) как на проде.
drop policy if exists topic_material_items_student_select on public.topic_material_items;
create policy topic_material_items_student_select on public.topic_material_items
  for select to authenticated
  using (
    is_visible
    and topic_id = any((select public.student_tmi_visible_topics())::uuid[])
    and (section is distinct from 'solution' or track = 'training'
         or topic_id = any((select public.student_tmi_solution_topics())::uuid[]))
    and (section is distinct from 'criteria' or track = 'training'
         or topic_id = any((select public.student_tmi_solution_topics())::uuid[]))
    and (section is distinct from 'worksheet_homework' or track = 'training'
         or topic_id = any((select public.student_tmi_condition_topics())::uuid[]))
    and (track <> 'training' or not public.topic_subtopic_is_hidden(topic_id, subtopic_code))
  );

drop policy if exists topic_material_items_staff_select on public.topic_material_items;
create policy topic_material_items_staff_select on public.topic_material_items
  for select to authenticated
  using (topic_id = any((select public.staff_manageable_topics())::uuid[]));

-- 3.2 Уроки темы. Было: is_published AND course_student_can_see_topic(topic_id)
drop policy if exists course_lessons_student_select on public.course_lessons;
create policy course_lessons_student_select on public.course_lessons
  for select to authenticated
  using (is_published and topic_id = any((select public.student_visible_topics())::uuid[]));

-- 3.3 ДЗ темы. Было: is_published AND course_student_can_see_topic(topic_id)
drop policy if exists topic_homework_student_select on public.topic_homework;
create policy topic_homework_student_select on public.topic_homework
  for select to authenticated
  using (is_published and topic_id = any((select public.student_visible_topics())::uuid[]));

-- 3.4 Файлы ДЗ. Было: topic_homework_student_can_see(homework_id)
--     AND topic_homework_condition_open(homework_id, auth_student_id())
drop policy if exists topic_homework_files_student_select on public.topic_homework_files;
create policy topic_homework_files_student_select on public.topic_homework_files
  for select to authenticated
  using (homework_id = any((select public.student_visible_homework())::uuid[])
         and public.topic_homework_condition_open(homework_id, (select public.auth_student_id())));

-- 3.5 Тесты. Было: topic_test_student_can_see(id)
drop policy if exists topic_tests_student_select on public.topic_tests;
create policy topic_tests_student_select on public.topic_tests
  for select to authenticated
  using (id = any((select public.student_visible_tests())::uuid[]));

-- 3.6 Назначения тестов. Было: course_student_can_see_topic(topic_id)
drop policy if exists topic_test_assignments_student_select on public.topic_test_assignments;
create policy topic_test_assignments_student_select on public.topic_test_assignments
  for select to authenticated
  using (topic_id = any((select public.student_visible_topics())::uuid[]));

-- 3.7 Задачи автопроверки. Было: topic_material_can_manage(topic_id) OR
--     course_student_can_see_topic(topic_id); topic_material_can_manage(t) ≡
--     course_is_staff(course_of_topic(t)) ≡ t ∈ staff_manageable_topics().
drop policy if exists topic_autocheck_tasks_select on public.topic_autocheck_tasks;
create policy topic_autocheck_tasks_select on public.topic_autocheck_tasks
  for select to authenticated
  using (topic_id = any((select public.student_visible_topics())::uuid[])
         or topic_id = any((select public.staff_manageable_topics())::uuid[]));

-- 3.8 Темы каталога. Было (to public): course_student_can_see_topic(topic_id)
drop policy if exists tct_student_select on public.topic_catalog_topics;
create policy tct_student_select on public.topic_catalog_topics
  for select to authenticated
  using (topic_id = any((select public.student_visible_topics())::uuid[]));

-- 3.9 Скрытые подтемы. Было: course_is_staff(course_of_topic(topic_id)) OR
--     course_student_has_access(course_of_topic(topic_id))
drop policy if exists topic_subtopic_hidden_read on public.topic_subtopic_hidden;
create policy topic_subtopic_hidden_read on public.topic_subtopic_hidden
  for select to authenticated
  using (topic_id in (select public.student_candidate_topics())
         or topic_id = any((select public.staff_manageable_topics())::uuid[]));

-- 3.10 План занятий. Было (to public): course_is_staff(course_id) OR
--      course_student_has_access(course_id). Набор ученика — первым: для
--      своих строк персональная проверка не нужна.
drop policy if exists course_study_plans_select on public.course_study_plans;
create policy course_study_plans_select on public.course_study_plans
  for select to authenticated
  using (course_id = any((select public.student_access_courses())::uuid[])
         or public.course_is_staff(course_id));

drop policy if exists course_study_plan_items_select on public.course_study_plan_items;
create policy course_study_plan_items_select on public.course_study_plan_items
  for select to authenticated
  using (course_id = any((select public.student_access_courses())::uuid[])
         or public.course_is_staff(course_id));

-- 3.11 Политики персонала на тех же таблицах. Разрешающие политики
--      объединяются через OR, и для ученика staff-условие тоже считается
--      на каждой строке. topic_material_can_manage(t) ≡
--      course_is_staff(course_of_topic(t)) ≡ t ∈ staff_manageable_topics()
--      (§284 C). Было `to public`; анониму строк не отдавали
--      (course_is_staff = false), а набор анониму не выдан — отсюда
--      `to authenticated`.
drop policy if exists course_lessons_staff_select on public.course_lessons;
create policy course_lessons_staff_select on public.course_lessons
  for select to authenticated
  using (topic_id = any((select public.staff_manageable_topics())::uuid[]));

drop policy if exists topic_homework_staff_select on public.topic_homework;
create policy topic_homework_staff_select on public.topic_homework
  for select to authenticated
  using (topic_id = any((select public.staff_manageable_topics())::uuid[]));

drop policy if exists topic_test_assignments_staff_select on public.topic_test_assignments;
create policy topic_test_assignments_staff_select on public.topic_test_assignments
  for select to authenticated
  using (topic_id = any((select public.staff_manageable_topics())::uuid[]));
