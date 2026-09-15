-- §182 (НЕ применена; применяет оркестратор через MCP и переименовывает файл по фактической версии из schema_migrations).
-- Задачи к уроку по всему курсу глазами САМОГО ученика: «N закрыто из M» для
-- каждой темы курса, одной RPC.
--
-- Зачем отдельная функция, если есть §164 и §174. `topic_task_progress_for_staff`
-- отвечает на вопрос преподавателя («сколько учеников решают») и закрыта
-- `topic_material_can_manage`; `course_topic_tasks_matrix` — вся матрица курса
-- под `course_is_staff`. Ученику нужна третья форма: только свои числа, по всем
-- темам курса сразу. Запрос на тему не годится — в живом курсе 40–170 тем, а
-- список курса рисует их все.
--
-- Считается ТОЙ ЖЕ формулой, что обе соседние функции (иначе «3 из 7» в списке
-- курса и в ленте задач темы разойдутся, и владелец заметит это первым):
--   всего  — по варианту-носителю темы (`test_variants.topic_id`), а не по
--            выдаче: при ленивой выдаче (§164) строк выдачи может не быть вовсе;
--   закрыто — `test_variant_answers.closed_by is not null` у строк ВЫЗЫВАЮЩЕГО
--            ученика (ответом `auto` или по разбору `self`, §162/§176).
--
-- Права: строки только по курсу, где вызывающий — ученик (`group_students` →
-- `groups.course_id`). У персонала — ноль строк: этот экран ему не нужен, а в
-- предпросмотре «глазами ученика» (§178) прогресс честно пустой, и клиент RPC
-- там не зовёт вовсе. Темы без задач не возвращаются: «Задачи 0 из 0» — шум.

create or replace function public.course_topic_tasks_progress_for_student(p_course_id uuid)
returns table (
  topic_id    uuid,
  tasks_total integer,
  closed      integer
)
language sql
stable
security definer
set search_path to ''
as $$
  with me as (
    -- Один источник «кто я как ученик» — та же функция, что у всех ученических
    -- политик и RPC; своей копии `students.profile_id = auth.uid()` не заводим.
    select public.auth_student_id() as student_id
  ),
  enrolled as (
    -- Ученик курса? Один курс = одна группа (§61/§64), но exists — на случай
    -- двух зачислений.
    select 1
    from public.group_students gs
    join public.groups g on g.id = gs.group_id
    where g.course_id = p_course_id
      and gs.student_id = (select student_id from me)
  ),
  topics_with_tasks as (
    select t.id as topic_id,
           count(tvi.id)::integer as tasks_total
    from public.topics t
    join public.modules m on m.id = t.module_id
    join public.test_variants v on v.topic_id = t.id
    join public.test_variant_items tvi on tvi.variant_id = v.id
    where m.course_id = p_course_id
    group by t.id
  ),
  mine as (
    select tva.topic_id,
           count(a.id) filter (where a.closed_by is not null)::integer as closed
    from public.test_variant_assignments tva
    join public.test_variant_student_assignments tvsa on tvsa.assignment_id = tva.id
    left join public.test_variant_answers a on a.student_assignment_id = tvsa.id
    where tvsa.student_id = (select student_id from me)
      and tvsa.status <> 'cancelled'
      and tva.topic_id in (select tw.topic_id from topics_with_tasks tw)
    group by tva.topic_id
  )
  select tw.topic_id,
         tw.tasks_total,
         coalesce(mn.closed, 0)
  from topics_with_tasks tw
  left join mine mn on mn.topic_id = tw.topic_id
  where exists (select 1 from enrolled);
$$;

comment on function public.course_topic_tasks_progress_for_student(uuid) is
  'Задачи к уроку по всему курсу глазами ученика: сколько закрыто из скольких по каждой теме. Считает как topic_task_progress_for_staff и course_topic_tasks_matrix. §182';

revoke all on function public.course_topic_tasks_progress_for_student(uuid) from public, anon;
grant execute on function public.course_topic_tasks_progress_for_student(uuid) to authenticated;

-- Проверка прав при применении (§29.4: set_config — ОТДЕЛЬНЫМ оператором, не в
-- одном списке выборки с проверяемой функцией; под владельцем таблиц RLS не
-- проверяется вовсе):
--   select set_config('role','authenticated',true);
--   select set_config('request.jwt.claims','{"sub":"<profile_id ученика курса>","role":"authenticated"}',true);
--   select * from public.course_topic_tasks_progress_for_student('<course_id>');
-- Ожидается:
--   • ученик курса        → по строке на каждую тему С ЗАДАЧАМИ, `closed` — его
--                           собственный (сверить с лентой задач темы, §175);
--   • ученик ДРУГОГО курса → 0 строк;
--   • владелец курса / преподаватель / куратор → 0 строк (это не их экран).
