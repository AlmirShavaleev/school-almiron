-- §174 (применено оркестратором 14.09, версия 20260914122309). Матрица «ученик × тема с задачами» для вкладки «Результаты тестов» курса.
--
-- Одна RPC на весь курс вместо N вызовов `topic_task_progress_for_staff` по
-- темам: у живого курса 40–170 тем, и вкладка не может делать по запросу на
-- каждую. Считается ТАК ЖЕ, как `topic_task_progress_for_staff` (§164,
-- миграция 20260912212817): число задач — по варианту-носителю
-- (`test_variants.topic_id`), а не по выдаче (при ленивой выдаче её может не
-- быть), «трогал» — по строкам ответов, «закрыто» — по `closed_by`. Иначе число
-- в окне темы («решают 12 из 16») и в таблице разошлись бы, и владелец заметит
-- это первым.
--
-- Что возвращает: по строке на пару «ученик курса × тема с задачами». Ученик без
-- выдачи (тему ещё не открывал) присутствует с `touched = 0` — ростер берётся
-- из `group_students`, а не из выдач. Темы без набора задач не возвращаются:
-- пустые столбцы — шум.
--
-- Особый случай: в курсе есть темы с задачами, но нет ни одного ученика. Тогда
-- на каждую такую тему возвращается ОДНА строка с `student_id = null` — чтобы
-- клиент отличил «учеников нет» от «задачи не прикреплены» без второго запроса.
--
-- Права: `course_is_staff` (CLAUDE.md — любая новая проверка «персонал ли»
-- только через неё). Не персонал → ноль строк, как у соседних RPC курса.

create or replace function public.course_topic_tasks_matrix(p_course_id uuid)
returns table (
  student_id   uuid,
  full_name    text,
  topic_id     uuid,
  topic_title  text,
  module_order integer,
  topic_order  integer,
  tasks_total  integer,
  touched      integer,
  closed_auto  integer,
  closed_self  integer
)
language sql
stable
security definer
set search_path to ''
as $$
  with roster as (
    -- Один курс = одна группа (§61/§64), но distinct на случай двух зачислений.
    select distinct
           s.id as student_id,
           coalesce(p.full_name, p.email, '—') as full_name
    from public.group_students gs
    join public.groups   g on g.id = gs.group_id
    join public.students s on s.id = gs.student_id
    join public.profiles p on p.id = s.profile_id
    where g.course_id = p_course_id
  ),
  topics_with_tasks as (
    -- Порядок программы: модуль → тема; ничья по order_index решается
    -- created_at — так же, как сортирует клиент (§172).
    select t.id          as topic_id,
           t.title       as topic_title,
           m.order_index as module_order,
           t.order_index as topic_order,
           m.created_at  as module_created,
           t.created_at  as topic_created,
           count(tvi.id)::integer as tasks_total
    from public.topics t
    join public.modules m on m.id = t.module_id
    join public.test_variants v on v.topic_id = t.id
    join public.test_variant_items tvi on tvi.variant_id = v.id
    where m.course_id = p_course_id
    group by t.id, t.title, m.order_index, t.order_index, m.created_at, t.created_at
  ),
  per_student as (
    -- Тот же счёт, что в topic_task_progress_for_staff: ответы по выдаче темы.
    select tva.topic_id,
           tvsa.student_id,
           count(a.id)::integer                                    as touched,
           count(a.id) filter (where a.closed_by = 'auto')::integer as c_auto,
           count(a.id) filter (where a.closed_by = 'self')::integer as c_self
    from public.test_variant_assignments tva
    join public.test_variant_student_assignments tvsa on tvsa.assignment_id = tva.id
    left join public.test_variant_answers a on a.student_assignment_id = tvsa.id
    where tva.topic_id in (select tw.topic_id from topics_with_tasks tw)
    group by tva.topic_id, tvsa.student_id
  )
  select r.student_id,
         r.full_name,
         tw.topic_id,
         tw.topic_title,
         tw.module_order,
         tw.topic_order,
         tw.tasks_total,
         coalesce(ps.touched, 0),
         coalesce(ps.c_auto, 0),
         coalesce(ps.c_self, 0)
  from topics_with_tasks tw
  left join roster r on true
  left join per_student ps on ps.topic_id = tw.topic_id and ps.student_id = r.student_id
  where public.course_is_staff(p_course_id)
  order by tw.module_order, tw.module_created, tw.topic_order, tw.topic_created,
           r.full_name, r.student_id;
$$;

comment on function public.course_topic_tasks_matrix(uuid) is
  'Задачи к уроку по всему курсу: ученик × тема с задачами, сколько закрыто ответом/разбором. Считает как topic_task_progress_for_staff. §174';

revoke all on function public.course_topic_tasks_matrix(uuid) from public, anon;
grant execute on function public.course_topic_tasks_matrix(uuid) to authenticated;

-- Проверка прав при применении (словами, см. отчёт §174): под учеником курса и
-- под посторонним преподавателем вызов обязан вернуть 0 строк; под владельцем
-- курса — по строке на каждую пару «ученик × тема с задачами». Пример:
--   select set_config('role','authenticated',true),
--          set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}',true);
--   select count(*) from public.course_topic_tasks_matrix('<course_id>');
-- (set_config — отдельным оператором, не в одном списке выборки с функцией, §29.4).
