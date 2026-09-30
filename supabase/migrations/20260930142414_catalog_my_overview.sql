-- §246. Главная «Каталога заданий»: решённое по номерам и сравнение со школой.
--
-- НЕ ПРИМЕНЕНА. Применяет оркестратор (MCP apply_migration), после применения
-- файл переименовывается по версии из schema_migrations. Только добавление:
-- одна функция и один индекс, существующее не меняется.
--
-- catalog_my_overview() — один вызов на экран /catalog.
--
--   Ученику (profiles.role = 'student'), по каждому экзамену (subject + exam_type
--   каталога) и каждому номеру (exam_number ≥ 1 опубликованного раздела):
--     total    — опубликованных задач в номере (сумма всех разделов номера:
--                у физики ОГЭ у №20 три раздела);
--     solved   — решено мной;
--     section_id — куда ведёт столбик: первый по position раздел номера, в
--                котором есть задачи (пустой раздел не открываем).
--   По экзамену: total, solved, solved_7d, is_mine (экзамен курса моей группы),
--   solvers (учеников школы, решивших в этом экзамене хоть одну задачу) и
--   better_pct — доля решающих, у кого решено МЕНЬШЕ, чем у меня, в процентах
--   вниз до целого; только если решающих ≥ 10 (я среди них), иначе null;
--   0 % → null (правило §223: ноль не показываем). Сверху — overall: то же по
--   объединению экзаменов, в которых я решаю.
--
--   Персоналу (и любому не-ученику) — только total по номерам: solved/сравнение
--   null, overall null. Анониму — execute отозван, без auth.uid() — отказ.
--
-- «Решено» (решение владельца 30.09): задача отмечена «Выполнено»
-- (catalog_task_progress.is_completed) ИЛИ на неё дан верный ответ в варианте
-- (test_variant_answers.is_correct через test_variant_items.task_id и
-- test_variant_student_assignments.student_id = students.id). Одна задача
-- считается один раз. Время решения — самое раннее из двух (отметка:
-- completed_at, иначе updated_at; ответ: время сдачи ответа/работы, иначе
-- проверки/изменения) — по нему «+за 7 дней».
-- Считаются только опубликованные задачи опубликованных разделов с номером ≥ 1 —
-- ровно то, из чего сложено «из Y», поэтому «решено» не бывает больше «всего».
--
-- Индекс: счётчик решённого по школе идёт от task_id к section_id; без
-- покрытия это чтение широких строк catalog_tasks (в них контент задачи —
-- та же беда, что §20260730 catalog_counts_covering_index). После применения
-- прогнать отдельно (вне транзакции): vacuum (analyze) public.catalog_tasks;

create index if not exists catalog_tasks_id_section_covering_idx
  on public.catalog_tasks (id) include (section_id, is_published);

comment on index public.catalog_tasks_id_section_covering_idx is
  '§246: task_id → section_id без чтения широких строк (catalog_my_overview).';

create or replace function public.catalog_my_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c_min_solvers constant int := 10;
  v_uid        uuid := auth.uid();
  v_is_student boolean;
  v_result     jsonb;
begin
  if v_uid is null then
    raise exception 'catalog_my_overview: нужен вход' using errcode = '42501';
  end if;

  select coalesce(p.role::text = 'student', false) into v_is_student
    from public.profiles p where p.id = v_uid;
  v_is_student := coalesce(v_is_student, false);

  with
  -- ── Структура каталога: номера и число задач ─────────────────────────────
  sec as (
    select s.id, s.subject, s.exam_type, s.exam_number as n, s.position,
           (select count(*) from public.catalog_tasks t
             where t.section_id = s.id and t.is_published)::int as total
      from public.catalog_sections s
     where s.is_published and s.exam_number >= 1
  ),
  nums as (
    select subject, exam_type, n,
           sum(total)::int as total,
           (array_agg(id order by (total > 0) desc, position, id))[1] as section_id
      from sec
     group by subject, exam_type, n
    having sum(total) > 0
  ),

  -- ── Моё решённое (только ученику) ────────────────────────────────────────
  my_raw as (
    select p.task_id, coalesce(p.completed_at, p.updated_at) as at
      from public.catalog_task_progress p
     where v_is_student and p.user_id = v_uid and p.is_completed
    union all
    select i.task_id,
           coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at)
      from public.students st
      join public.test_variant_student_assignments sa on sa.student_id = st.id
      join public.test_variant_answers a on a.student_assignment_id = sa.id
      join public.test_variant_items i on i.id = a.variant_item_id
     where v_is_student and st.profile_id = v_uid and a.is_correct
  ),
  my_solved as (
    select r.task_id, s.subject, s.exam_type, s.n, min(r.at) as at
      from my_raw r
      join public.catalog_tasks t on t.id = r.task_id and t.is_published
      join sec s on s.id = t.section_id
     group by r.task_id, s.subject, s.exam_type, s.n
  ),
  my_exams as (
    select subject, exam_type,
           count(*)::int as solved,
           count(*) filter (where at >= now() - interval '7 days')::int as solved_7d
      from my_solved
     group by subject, exam_type
  ),
  my_nums as (
    select subject, exam_type, n, count(*)::int as solved
      from my_solved
     group by subject, exam_type, n
  ),
  -- «Свои» экзамены — курсы групп ученика.
  mine as (
    select distinct
           case c.subject::text when 'math' then 'Математика' when 'physics' then 'Физика' end as subject,
           case c.exam_type::text when 'ege' then 'ЕГЭ' when 'oge' then 'ОГЭ' end as exam_type
      from public.students st
      join public.group_students gs on gs.student_id = st.id
      join public.groups g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where v_is_student and st.profile_id = v_uid
  ),

  -- ── Школа: решённое учениками в МОИХ экзаменах (только числа) ────────────
  school_raw as (
    select p.user_id as profile_id, p.task_id
      from public.catalog_task_progress p
     where v_is_student and p.is_completed
    union
    select st.profile_id, i.task_id
      from public.test_variant_answers a
      join public.test_variant_student_assignments sa on sa.id = a.student_assignment_id
      join public.students st on st.id = sa.student_id
      join public.test_variant_items i on i.id = a.variant_item_id
     where v_is_student and a.is_correct
  ),
  school as (
    select r.profile_id, s.subject, s.exam_type, r.task_id
      from school_raw r
      join public.profiles pr on pr.id = r.profile_id and pr.role = 'student'
      join public.catalog_tasks t on t.id = r.task_id and t.is_published
      join sec s on s.id = t.section_id
      join my_exams e on e.subject = s.subject and e.exam_type = s.exam_type
  ),
  per_exam as (
    select profile_id, subject, exam_type, count(distinct task_id)::int as solved
      from school
     group by profile_id, subject, exam_type
  ),
  exam_cmp as (
    select pe.subject, pe.exam_type,
           count(*)::int as solvers,
           count(*) filter (where pe.solved < me.solved)::int as lower
      from per_exam pe
      join my_exams me on me.subject = pe.subject and me.exam_type = pe.exam_type
     group by pe.subject, pe.exam_type
  ),
  per_all as (
    select profile_id, count(distinct task_id)::int as solved
      from school
     group by profile_id
  ),
  my_total as (
    select count(*)::int as solved,
           count(*) filter (where at >= now() - interval '7 days')::int as solved_7d
      from my_solved
  ),
  all_cmp as (
    select count(*)::int as solvers,
           count(*) filter (where pa.solved < (select solved from my_total))::int as lower
      from per_all pa
  ),

  -- ── Сборка ───────────────────────────────────────────────────────────────
  exam_rows as (
    select n.subject, n.exam_type,
           sum(n.total)::int as total,
           jsonb_agg(jsonb_build_object(
             'n',          n.n,
             'total',      n.total,
             'solved',     case when v_is_student then coalesce(mn.solved, 0) end,
             'section_id', n.section_id
           ) order by n.n) as numbers
      from nums n
      left join my_nums mn on mn.subject = n.subject and mn.exam_type = n.exam_type and mn.n = n.n
     group by n.subject, n.exam_type
  )
  select jsonb_build_object(
           'viewer',      case when v_is_student then 'student' else 'staff' end,
           'min_solvers', c_min_solvers,
           'overall', case when v_is_student then (
              select jsonb_build_object(
                       'solved',     mt.solved,
                       'solved_7d',  mt.solved_7d,
                       'solvers',    ac.solvers,
                       'better_pct', case when mt.solved > 0 and ac.solvers >= c_min_solvers
                                          then nullif(floor(100.0 * ac.lower / ac.solvers)::int, 0) end)
                from my_total mt cross join all_cmp ac) end,
           'exams', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'subject',    er.subject,
                       'exam_type',  er.exam_type,
                       'is_mine',    v_is_student and exists (
                                       select 1 from mine m
                                        where m.subject = er.subject and m.exam_type = er.exam_type),
                       'total',      er.total,
                       'solved',     case when v_is_student then coalesce(me.solved, 0) end,
                       'solved_7d',  case when v_is_student then coalesce(me.solved_7d, 0) end,
                       'solvers',    case when v_is_student then ec.solvers end,
                       'better_pct', case when ec.solvers >= c_min_solvers
                                          then nullif(floor(100.0 * ec.lower / ec.solvers)::int, 0) end,
                       'numbers',    er.numbers
                     ) order by er.subject, er.exam_type)
                from exam_rows er
                left join my_exams me on me.subject = er.subject and me.exam_type = er.exam_type
                left join exam_cmp ec on ec.subject = er.subject and ec.exam_type = er.exam_type
           ), '[]'::jsonb)
         )
    into v_result;

  return v_result;
end;
$$;

comment on function public.catalog_my_overview() is
  '§246: главная каталога. Ученику — решено по номерам/экзаменам, +7 дней, доля решающих школы с меньшим числом (≥10 решающих, 0 % → null); персоналу — только число задач по номерам.';

revoke all on function public.catalog_my_overview() from public, anon;
grant execute on function public.catalog_my_overview() to authenticated;
