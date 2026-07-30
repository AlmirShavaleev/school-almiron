-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260730213917
--   name    = course_curators_see_course_roster
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- ============================================================
-- Куратор курса видит учеников курса (2026-07-30)
-- ============================================================
-- Владелец спросил: «куратор курса видит ли домашки курса у учеников?»
-- Ответ был «частично» — и это тот же по устройству баг, что чинили в
-- 20260728210341 для владельца курса.
--
-- Права на курс разъезжались по двум несвязанным веткам:
--   * course_is_staff(course_id) — ЗНАЕТ про course_curators (кураторы по
--     ссылке, миграция 20260727203959). Через него закрыты материалы, ДЗ,
--     попытки, файлы, ревью и рамки — их куратор видел и мог проверять.
--   * ручные проверки в политиках и хелперах — смотрели только на
--     groups.teacher_id / groups.curator_id (legacy-слоты) и в лучшем случае
--     на владельца курса. Про course_curators не знала НИ ОДНА.
--
-- Из-за этого куратор не видел ни курс, ни группу, ни членство, ни учеников,
-- ни их имена. А ростер на вкладках «Ученики», «Домашние задания» и
-- «Результаты тестов» строится одним запросом с !inner-джойном
-- group_students → groups → students → profiles: не видя таблиц, джойн молча
-- выбрасывает все строки, и вкладки показывают «В курсе пока нет учеников».
-- В очереди проверки работы были видны, но вместо фамилий стояло «Ученик» —
-- запрос имён закрыт теми же политиками.
--
-- Решение владельца по рамкам: курс сейчас = одна группа (§9.1), поэтому
-- куратор курса видит учеников КУРСА. Если появятся многогрупповые курсы и
-- понадобится сузить куратора до конкретных групп — нужна отдельная связь
-- курато́р↔группа, сейчас её в модели нет вовсе (course_curators — членство
-- уровня курса по определению).
--
-- Фикс: всюду, где спрашивается «персонал ли этот человек по данному курсу»,
-- зовём одну course_is_staff вместо трёх ручных проверок. Она уже знает про
-- админа, владельца курса, преподавателя группы, куратора группы И куратора
-- курса — и дальше будет знать про любые новые роли, без правки пяти мест.
--
-- Побочно закрывается остаток бага 20260728210341: у групп с пустым
-- teacher_id владелец курса (не платформенный админ) не видел ни группу, ни
-- членство — политики groups_select_all и group_students_select_teacher
-- fallback на владельца тогда не получили. Теперь получают, через ту же
-- course_is_staff.
--
-- Рекурсии нет: course_is_staff — SECURITY DEFINER, внутри RLS не применяется,
-- поэтому её вызов из политики на groups/courses безопасен.
--
-- Проверено на локальном Postgres 16 (set role authenticated +
-- request.jwt.claim.sub): до фикса куратор курса видел 0 из 5 сущностей и
-- 0 строк ростера; после — все 5 и 1 строку. Контроли: посторонний куратор
-- по-прежнему 0; владелец курса как видел, так и видит; ученик видит себя,
-- но НЕ видит однокурсника (ни строку students, ни профиль).
-- На проде после применения: преподаватель демо-курса видит своего ученика
-- (true), посторонний преподаватель — нет (false).

create or replace function public.auth_is_staff_of_student(stu_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from group_students gs
      join groups g on g.id = gs.group_id
    where gs.student_id = stu_id
      and public.course_is_staff(g.course_id)
  )
$$;

comment on function public.auth_is_staff_of_student(uuid) is
  'Является ли вызывающий персоналом курса, в котором учится этот ученик. Единая проверка через course_is_staff — включая кураторов курса (course_curators).';

create or replace function public.auth_is_staff_of_profile(pid uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from students s
      join group_students gs on gs.student_id = s.id
      join groups g on g.id = gs.group_id
    where s.profile_id = pid
      and public.course_is_staff(g.course_id)
  )
$$;

comment on function public.auth_is_staff_of_profile(uuid) is
  'То же, что auth_is_staff_of_student, но по profile_id ученика — для политики на profiles.';

drop policy courses_select_scoped on public.courses;
create policy courses_select_scoped on public.courses
  for select using (
    owner_id = auth.uid()
    or is_admin_or_owner()
    or public.course_is_staff(id)
    or exists (select 1 from groups g
                where g.course_id = courses.id and auth_is_student_in_group(g.id))
  );

drop policy groups_select_all on public.groups;
create policy groups_select_all on public.groups
  for select using (
    is_admin_or_owner()
    or public.course_is_staff(course_id)
    or auth_is_teacher_of_group(id)
    or auth_is_curator_of_group(id)
    or auth_is_student_in_group(id)
  );

drop policy group_students_select_teacher on public.group_students;
create policy group_students_select_teacher on public.group_students
  for select using (
    is_admin_or_owner()
    or auth_is_teacher_of_group(group_id)
    or auth_is_curator_of_group(group_id)
    or exists (select 1 from groups g
                where g.id = group_students.group_id
                  and public.course_is_staff(g.course_id))
  );
