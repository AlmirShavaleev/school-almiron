-- §217. Отчёт об успеваемости: расчёт ОДНОЙ функцией.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration, после чего
-- файл переименовывается в <version>_<name>.sql точно по записи в
-- supabase_migrations.schema_migrations (MIGRATIONS.md).
--
-- Идёт ПОСЛЕ §216 (PENDING_216.sql): функция читает student_subject_targets и
-- topics.ege_task_numbers, без них она не создастся.
--
-- Миграция только добавляющая: новая таблица, новая функция. Ничего
-- существующего не удаляется, не переименовывается и не сужается.
--
-- ──────────────────────────────────────────────────────────────────────────
-- Зачем расчёт в базе, а не в клиенте
-- ──────────────────────────────────────────────────────────────────────────
-- Отчёт живёт в двух видах: экран в кабинете и лист, который родитель уносит
-- домой. Если считать его десятком запросов из клиента, два вида начинают
-- расходиться при первой же правке — и первым это заметит родитель, у
-- которого на руках бумага с одной цифрой, а на экране другая. Поэтому вход
-- один: ученик + границы периода → готовые числа, а клиент их только
-- раскладывает.
--
-- ──────────────────────────────────────────────────────────────────────────
-- 1. «Что делать до следующей встречи» — три строки преподавателя
-- ──────────────────────────────────────────────────────────────────────────
-- Хранятся ВМЕСТЕ С ОТЧЁТОМ, то есть на паре «ученик + период»: тот же отчёт,
-- открытый через месяц, обязан показать то, о чём договаривались тогда, а не
-- то, что написано сейчас.
--
-- Отдельная таблица, а НЕ новый kind в student_feedback_notes. Там лежит
-- внутренняя заметка преподавателя — ровно то, что на лист родителю попасть
-- не должно. Класть парентский текст в ту же таблицу значит завести один
-- запрос, из которого однажды вытечет и соседняя строка.

create table if not exists public.student_report_next_steps (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  period_from date not null,
  period_to   date not null,
  -- Три строки. Массив, а не три колонки: строк ровно столько, сколько
  -- преподаватель написал, и пустая вторая строка не должна печататься
  -- пустым пунктом списка.
  steps       text[] not null default '{}'::text[],
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint student_report_next_steps_period check (period_to >= period_from),
  constraint student_report_next_steps_steps_len check (coalesce(array_length(steps, 1), 0) <= 3),
  constraint student_report_next_steps_steps_no_nulls check (array_position(steps, null) is null),
  constraint student_report_next_steps_unique unique (student_id, period_from, period_to)
);

comment on table public.student_report_next_steps is
  '§217. «Что делать до следующей встречи» — до трёх строк преподавателя, привязанных к ученику и периоду отчёта. Печатается на листе для родителя. Внутренняя заметка преподавателя живёт в student_feedback_notes и на лист не попадает — это РАЗНЫЕ таблицы намеренно.';

create index if not exists student_report_next_steps_student_idx
  on public.student_report_next_steps (student_id, period_from desc);

alter table public.student_report_next_steps enable row level security;

grant select, insert, update, delete on public.student_report_next_steps to authenticated;

-- Права — чужие, не свои: тот же рисунок, что у student_subject_targets
-- (§216) и student_feedback_notes (20260809114728).
--
-- Ученику здесь не дано НИЧЕГО, даже чтения: это заметки преподавателя к
-- разговору с родителем, а не обратная связь ученику. Лист для родителя
-- ученику тоже не показываем (приёмка §217).

drop policy if exists student_report_next_steps_staff_select on public.student_report_next_steps;
create policy student_report_next_steps_staff_select
  on public.student_report_next_steps
  for select to authenticated
  using (
    public.is_admin_or_owner()
    or public.auth_is_staff_of_student(student_id)
  );

drop policy if exists student_report_next_steps_staff_insert on public.student_report_next_steps;
create policy student_report_next_steps_staff_insert
  on public.student_report_next_steps
  for insert to authenticated
  with check (
    (public.is_admin_or_owner() or public.auth_is_staff_of_student(student_id))
    and updated_by = auth.uid()
  );

drop policy if exists student_report_next_steps_staff_update on public.student_report_next_steps;
create policy student_report_next_steps_staff_update
  on public.student_report_next_steps
  for update to authenticated
  using (
    public.is_admin_or_owner()
    or public.auth_is_staff_of_student(student_id)
  )
  with check (
    (public.is_admin_or_owner() or public.auth_is_staff_of_student(student_id))
    and updated_by = auth.uid()
  );

drop policy if exists student_report_next_steps_staff_delete on public.student_report_next_steps;
create policy student_report_next_steps_staff_delete
  on public.student_report_next_steps
  for delete to authenticated
  using (
    public.is_admin_or_owner()
    or public.auth_is_staff_of_student(student_id)
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Сам отчёт
-- ──────────────────────────────────────────────────────────────────────────
-- security definer — потому что функции нужно посчитать СРЕДНЕЕ ПО ГРУППЕ, а
-- это чужие строки. Под RLS вызывающего они частью отфильтруются, и среднее
-- молча посчиталось бы не по всей группе (симптом «нет данных» из CLAUDE.md).
-- Наружу при этом не уходит ни одной чужой фамилии и ни одного чужого балла —
-- только агрегат и размер группы.
--
-- Раз definer, проверка прав делается руками и ПЕРВЫМ делом. Вопрос «видит ли
-- этот человек этого ученика» в проекте уже отвечен на таблице students:
-- is_admin_or_owner() OR auth_is_staff_of_student(id). Берём ровно его, своей
-- копии «преподаватель ли он» не пишем (урок §21/§29).
--
-- Ученик получает отказ намеренно: лист для родителя ученику не показываем.
--
-- ─── Три правила, ради которых всё это и считается ────────────────────────
--
--   1. Средний балл всегда едет ВМЕСТЕ с числом работ (graded_works). Без
--      него «100 %» по одной работе читается как готовность к экзамену.
--   2. Среднее по группе отдаётся, только если в группе шесть человек и
--      больше (REPORT_MIN_GROUP ниже). В группе из трёх среднее рядом с
--      баллом сына позволяет родителю вычислить остальных. Меньше шести —
--      null, а размер группы отдаётся всегда: клиент печатает пояснение.
--   3. Прогноза балла на экзамене здесь НЕТ и быть не должно. Цель и текущий
--      средний рядом — этого достаточно; прогноз на бумаге в руках родителя
--      превращается в обещание.
--
-- Тема попадает в списки сильных/слабых от трёх засчитанных заданий: на двух
-- это шум, а не знание.
--
-- Посещаемости в отчёте нет: таблица attendance пуста (§111).

create or replace function public.student_progress_report(
  p_student_id uuid,
  p_from       date,
  p_to         date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- Порог «печатать ли среднее по группе». Живёт здесь и, вторым рубежом, в
  -- клиенте (src/lib/parentReport.ts, MIN_GROUP_FOR_AVG). Менять только
  -- вместе — число одно, и оно про приватность чужих детей.
  c_min_group    constant int := 6;
  -- Тема идёт в списки сильных/слабых от трёх засчитанных заданий.
  c_min_tasks    constant int := 3;
  -- По пять тем в каждом списке — как на утверждённом макете.
  c_topic_limit  constant int := 5;
  -- Сколько пробников показываем в истории. Пробники НЕ режутся периодом:
  -- на макете их шесть при периоде в месяц, а прирост к предыдущему без
  -- истории не посчитать.
  c_mock_limit   constant int := 8;

  v_profile_id uuid;
  v_result     jsonb;
begin
  if p_student_id is null or p_from is null or p_to is null then
    raise exception 'student_progress_report: нужны ученик и границы периода'
      using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'student_progress_report: конец периода раньше начала'
      using errcode = '22023';
  end if;

  if not (public.is_admin_or_owner() or public.auth_is_staff_of_student(p_student_id)) then
    raise exception 'Нет доступа к отчёту этого ученика'
      using errcode = '42501';
  end if;

  select s.profile_id into v_profile_id from public.students s where s.id = p_student_id;
  if v_profile_id is null then
    raise exception 'Ученик не найден' using errcode = 'P0002';
  end if;

  with
  -- ── Группы и курсы ученика ───────────────────────────────────────────────
  my_groups as (
    select g.id            as group_id,
           g.name          as group_name,
           c.id            as course_id,
           c.title         as course_title,
           c.subject::text as subject,
           c.exam_type::text as exam_type,
           (select count(*) from public.group_students gs2 where gs2.group_id = g.id)::int as group_size
      from public.group_students gs
      join public.groups  g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where gs.student_id = p_student_id
  ),
  -- Один предмет может идти сразу несколькими группами (редко, но бывает).
  -- Размер группы для предмета берём максимальный — среднее считается по
  -- тому же набору людей.
  subject_groups as (
    select subject, exam_type,
           max(group_size)                  as group_size,
           string_agg(distinct course_title, ' · ') as course_titles
      from my_groups
     group by subject, exam_type
  ),

  -- ── Работы ученика за период ─────────────────────────────────────────────
  -- Период считается по дате СДАЧИ работы, а не по дате проверки: разговор
  -- на собрании идёт про то, что ученик делал в эти недели.
  my_works as (
    select c.subject::text as subject,
           c.exam_type::text as exam_type,
           a.id             as attempt_id,
           a.status::text   as status,
           t.id             as topic_id,
           th.due_at,
           coalesce(a.submitted_at, a.created_at) as at,
           r.score,
           -- Пятёрка и сотня в одной средней — это сложение разных величин,
           -- поэтому всё приводится к доле от максимума СВОЕЙ шкалы. Тот же
           -- расчёт, что scorePercent в src/lib/studentInsights.ts. Шкалы нет
           -- — процента нет, а не ноль.
           -- Скобка least/greatest — не украшение: балл выше максимума своей
           -- шкалы (в базе такое лежит) давал бы «1100 %» на листе в руках
           -- родителя. Пусть лучше упрётся в 100, чем напечатает бред.
           least(100, greatest(0, case
             when r.score is null then null
             when th.grade_scale = 'five'    then round(r.score / 5.0  * 100)::int
             when th.grade_scale = 'hundred' then round(r.score / 100.0 * 100)::int
             else null
           end)) as percent
      from public.topic_homework_attempts a
      join public.topic_homework th on th.id = a.homework_id
      join public.topics  t on t.id = th.topic_id
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
      left join lateral (
        select rv.score
          from public.topic_homework_reviews rv
         where rv.attempt_id = a.id
         order by rv.created_at desc
         limit 1
      ) r on true
     where a.student_id = p_student_id
       and a.status <> 'draft'
       and coalesce(a.submitted_at, a.created_at) >= p_from::timestamptz
       and coalesce(a.submitted_at, a.created_at) <  (p_to + 1)::timestamptz
  ),
  work_stats as (
    select subject, exam_type,
           count(*)::int                                           as submitted,
           count(*) filter (where status = 'accepted')::int         as accepted,
           count(*) filter (where status = 'returned_for_revision')::int as revision,
           count(*) filter (where status = 'submitted')::int        as pending,
           count(percent)::int                                      as graded_works,
           case when count(percent) > 0 then round(avg(percent))::int end as avg_percent,
           count(*) filter (where due_at is not null)::int           as with_due,
           count(*) filter (where due_at is not null and at::date <= due_at)::int as on_time,
           count(*) filter (where due_at is not null and at::date >  due_at)::int as late
      from my_works
     group by subject, exam_type
  ),
  -- Средний балл по неделям — для маленького графика. Неделя по понедельнику.
  week_stats as (
    select subject, exam_type,
           date_trunc('week', at)::date as week_start,
           round(avg(percent))::int     as avg_percent,
           count(percent)::int          as works
      from my_works
     where percent is not null
     group by subject, exam_type, date_trunc('week', at)::date
  ),
  weeks_by_subject as (
    select subject, exam_type,
           jsonb_agg(jsonb_build_object(
             'week_start', week_start,
             'avg_percent', avg_percent,
             'works', works
           ) order by week_start) as weeks
      from week_stats
     group by subject, exam_type
  ),

  -- ── Среднее по группе за тот же период ───────────────────────────────────
  -- Считается по ВСЕМ ученикам группы, включая самого. Чужие фамилии и баллы
  -- наружу не выходят: отсюда уезжает только среднее и размер группы.
  peer_works as (
    select mg.subject, mg.exam_type,
           least(100, greatest(0, case
             when r.score is null then null
             when th.grade_scale = 'five'    then round(r.score / 5.0  * 100)::int
             when th.grade_scale = 'hundred' then round(r.score / 100.0 * 100)::int
             else null
           end)) as percent
      from my_groups mg
      join public.group_students gs on gs.group_id = mg.group_id
      join public.modules m on m.course_id = mg.course_id
      join public.topics  t on t.module_id = m.id
      join public.topic_homework th on th.topic_id = t.id
      join public.topic_homework_attempts a
        on a.homework_id = th.id and a.student_id = gs.student_id
      left join lateral (
        select rv.score
          from public.topic_homework_reviews rv
         where rv.attempt_id = a.id
         order by rv.created_at desc
         limit 1
      ) r on true
     where a.status <> 'draft'
       and coalesce(a.submitted_at, a.created_at) >= p_from::timestamptz
       and coalesce(a.submitted_at, a.created_at) <  (p_to + 1)::timestamptz
  ),
  peer_stats as (
    select subject, exam_type, round(avg(percent))::int as group_avg_percent
      from peer_works
     where percent is not null
     group by subject, exam_type
  ),

  -- ── Пробники ─────────────────────────────────────────────────────────────
  -- Периодом НЕ режем (см. c_mock_limit): нужна история и прирост.
  my_mocks as (
    select me.id, me.date, me.title,
           me.subject::text   as subject,
           me.exam_type::text as exam_type,
           me.group_id,
           mr.score, mr.part1_score, mr.part2_score
      from public.mock_exam_results mr
      join public.mock_exams me on me.id = mr.mock_exam_id
     where mr.student_id = p_student_id
       and me.date <= p_to
     order by me.date desc
     limit c_mock_limit
  ),
  mock_group as (
    select m.id,
           (select count(*) from public.group_students gs where gs.group_id = m.group_id)::int as group_size,
           (select round(avg(mr2.score))::int
              from public.mock_exam_results mr2
              join public.group_students gs2 on gs2.student_id = mr2.student_id
             where mr2.mock_exam_id = m.id
               and gs2.group_id = m.group_id) as group_avg
      from my_mocks m
  ),
  mock_rows as (
    select m.*,
           mg.group_size,
           -- Правило 2: меньше шести человек — среднего нет вовсе.
           case when coalesce(mg.group_size, 0) >= c_min_group then mg.group_avg end as group_avg,
           m.score - lag(m.score) over (partition by m.subject, m.exam_type order by m.date) as delta
      from my_mocks m
      left join mock_group mg on mg.id = m.id
  ),

  -- ── Темы: доля верных заданий ────────────────────────────────────────────
  -- Формула — ЗЕРКАЛО reviewTasksScore (src/lib/homeworkReviewTasks.ts):
  -- (correct + 0,5·partial) / (correct + partial + wrong + unsolved).
  -- `unchecked` («не сверено») из знаменателя выкинут: про это задание мы
  -- просто ничего не знаем, и считать незнание ошибкой нельзя.
  task_rows as (
    select t.id as topic_id, t.title, t.ege_task_numbers,
           c.subject::text as subject,
           rt.verdict
      from public.topic_homework_review_tasks rt
      join public.topic_homework_attempts a on a.id = rt.attempt_id
      join public.topic_homework th on th.id = a.homework_id
      join public.topics  t on t.id = th.topic_id
      join public.modules m on m.id = t.module_id
      join public.courses c on c.id = m.course_id
     where a.student_id = p_student_id
       and coalesce(a.submitted_at, a.created_at) >= p_from::timestamptz
       and coalesce(a.submitted_at, a.created_at) <  (p_to + 1)::timestamptz
       and rt.verdict <> 'unchecked'
  ),
  topic_stats as (
    select topic_id, title, subject, ege_task_numbers,
           count(*)::int as tasks_counted,
           round(
             sum(case verdict when 'correct' then 1.0 when 'partial' then 0.5 else 0 end)
             / count(*) * 100
           )::int as correct_percent
      from task_rows
     group by topic_id, title, subject, ege_task_numbers
    having count(*) >= c_min_tasks
  ),
  topic_json as (
    select topic_id, correct_percent,
           jsonb_build_object(
             'topic_id',        topic_id,
             'title',           title,
             'subject',         subject,
             'ege_numbers',     to_jsonb(coalesce(ege_task_numbers, '{}'::smallint[])),
             'tasks_counted',   tasks_counted,
             'correct_percent', correct_percent
           ) as js
      from topic_stats
  ),
  -- Тема не может стоять в обоих списках сразу: «проседает» и «получается»
  -- с одним и тем же названием — это не отчёт, а насмешка. Поэтому списки
  -- РЕЖУТСЯ пополам, а не берут по пять сверху и снизу независимо: при
  -- четырёх темах пять слабых забрали бы все четыре, и тема с 75 % уехала бы
  -- в «проседает» при пустом «получается».
  topic_ranked as (
    select topic_id, js, correct_percent,
           row_number() over (order by correct_percent asc,  topic_id) as rank_low,
           count(*)    over ()                                          as total
      from topic_json
  ),
  weak as (
    select topic_id, js, correct_percent
      from topic_ranked
     where rank_low <= least(c_topic_limit, ceil(total / 2.0))
  ),
  strong as (
    select topic_id, js, correct_percent
      from topic_ranked
     where topic_id not in (select topic_id from weak)
     order by correct_percent desc, topic_id
     limit c_topic_limit
  ),

  -- ── Разрез по номерам заданий ЕГЭ ────────────────────────────────────────
  -- Тема может относиться к нескольким номерам (§216) — задание считается
  -- КАЖДОМУ из них. Тема без номера в этот разрез не идёт вовсе.
  number_rows as (
    select n::int as ege_number, tr.verdict
      from task_rows tr
      cross join lateral unnest(tr.ege_task_numbers) as n
  ),
  number_stats as (
    select ege_number,
           count(*)::int as tasks_counted,
           round(
             sum(case verdict when 'correct' then 1.0 when 'partial' then 0.5 else 0 end)
             / count(*) * 100
           )::int as correct_percent
      from number_rows
     group by ege_number
    having count(*) >= c_min_tasks
  ),

  -- ── Активность ───────────────────────────────────────────────────────────
  video as (
    select coalesce(sum(seconds), 0)::int as seconds,
           coalesce(sum(seconds) filter (where day > p_to - 7), 0)::int as seconds_last_week
      from public.video_watch_daily
     where student_id = v_profile_id
       and day between p_from and p_to
  ),
  materials as (
    select count(*)::int as views
      from public.material_views
     where profile_id = v_profile_id
       and viewed_on between p_from and p_to
  ),
  catalog as (
    select count(*)::int as solved
      from public.catalog_task_progress
     where user_id = v_profile_id
       and is_completed
       and completed_at is not null
       and completed_at >= p_from::timestamptz
       and completed_at <  (p_to + 1)::timestamptz
  ),

  -- ── Цели по предметам (§216) ─────────────────────────────────────────────
  targets as (
    select subject::text as subject, exam_type::text as exam_type, target_score
      from public.student_subject_targets
     where student_id = p_student_id
  ),

  -- Предметы отчёта: курсы ученика + всё, где есть цель или работы. Цель со
  -- снятого с ведения курса не должна исчезать (§216).
  subject_keys as (
    select subject, exam_type from subject_groups
    union select subject, exam_type from targets
    union select subject, exam_type from work_stats
  ),
  subjects as (
    select jsonb_agg(jsonb_build_object(
             'subject',        k.subject,
             'exam_type',      k.exam_type,
             'course_titles',  sg.course_titles,
             -- Цели нет — null, и клиент печатает прочерк. НЕ ноль: ноль
             -- читался бы как «цель — ноль баллов».
             'target',         tg.target_score,
             'avg_percent',    ws.avg_percent,
             -- Правило 1: число проверенных работ едет ВМЕСТЕ со средним.
             'graded_works',   coalesce(ws.graded_works, 0),
             'group_size',     coalesce(sg.group_size, 0),
             'group_avg_percent',
               case when coalesce(sg.group_size, 0) >= c_min_group then ps.group_avg_percent end,
             'works', jsonb_build_object(
               'submitted', coalesce(ws.submitted, 0),
               'accepted',  coalesce(ws.accepted, 0),
               'revision',  coalesce(ws.revision, 0),
               'pending',   coalesce(ws.pending, 0),
               'with_due',  coalesce(ws.with_due, 0),
               'on_time',   coalesce(ws.on_time, 0),
               'late',      coalesce(ws.late, 0)
             ),
             'weeks', coalesce(wk.weeks, '[]'::jsonb),
             'last_mock', (
               select jsonb_build_object(
                        'date', mr.date, 'title', mr.title, 'score', mr.score,
                        'part1', mr.part1_score, 'part2', mr.part2_score,
                        'group_avg', mr.group_avg, 'group_size', mr.group_size,
                        'delta', mr.delta)
                 from mock_rows mr
                where mr.subject = k.subject and mr.exam_type = k.exam_type
                order by mr.date desc
                limit 1
             )
           ) order by k.subject, k.exam_type) as rows
      from subject_keys k
      left join subject_groups sg on sg.subject = k.subject and sg.exam_type = k.exam_type
      left join work_stats     ws on ws.subject = k.subject and ws.exam_type = k.exam_type
      left join weeks_by_subject wk on wk.subject = k.subject and wk.exam_type = k.exam_type
      left join peer_stats     ps on ps.subject = k.subject and ps.exam_type = k.exam_type
      left join targets        tg on tg.subject = k.subject and tg.exam_type = k.exam_type
  )

  select jsonb_build_object(
    'student', jsonb_build_object(
      'id',        p_student_id,
      'full_name', (select p.full_name from public.profiles p where p.id = v_profile_id),
      'grade',     (select s.grade from public.students s where s.id = p_student_id),
      'groups',    coalesce((select jsonb_agg(group_name order by group_name) from my_groups), '[]'::jsonb)
    ),
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'generated_at', now(),
    'min_group_for_avg', c_min_group,
    'min_tasks_for_topic', c_min_tasks,
    'subjects', coalesce((select rows from subjects), '[]'::jsonb),
    'mocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', date, 'title', title, 'subject', subject, 'exam_type', exam_type,
               'score', score, 'part1', part1_score, 'part2', part2_score,
               'group_avg', group_avg, 'group_size', group_size, 'delta', delta
             ) order by date)
        from mock_rows), '[]'::jsonb),
    'topics', jsonb_build_object(
      'weak',   coalesce((select jsonb_agg(js order by correct_percent asc,  topic_id) from weak),   '[]'::jsonb),
      'strong', coalesce((select jsonb_agg(js order by correct_percent desc, topic_id) from strong), '[]'::jsonb),
      -- Сколько тем вообще не имеют проставленного номера ЕГЭ: клиент
      -- печатает это пояснением под списками, а не молчит.
      'without_number', coalesce((
        select count(*) from topic_stats
         where coalesce(array_length(ege_task_numbers, 1), 0) = 0), 0)
    ),
    'ege_numbers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'number', ege_number,
               'tasks_counted', tasks_counted,
               'correct_percent', correct_percent
             ) order by ege_number)
        from number_stats), '[]'::jsonb),
    'activity', jsonb_build_object(
      'video_seconds',           (select seconds from video),
      'video_seconds_last_week', (select seconds_last_week from video),
      'materials',               (select views from materials),
      'catalog_tasks',           (select solved from catalog),
      'with_due', coalesce((select sum(with_due) from work_stats), 0),
      'on_time',  coalesce((select sum(on_time)  from work_stats), 0),
      'late',     coalesce((select sum(late)     from work_stats), 0)
    ),
    'next_steps', coalesce((
      select to_jsonb(steps) from public.student_report_next_steps
       where student_id = p_student_id and period_from = p_from and period_to = p_to
    ), '[]'::jsonb),
    -- Внутренняя заметка преподавателя. Она едет ТОЛЬКО на экран в кабинете;
    -- на листе для родителя её не рисуют вовсе — не прячут стилем
    -- (src/components/report/ParentReportSheet.tsx о ней не знает).
    'teacher_note', (
      select jsonb_build_object('body', n.body, 'created_at', n.created_at)
        from public.student_feedback_notes n
       where n.student_id = p_student_id and n.kind = 'saved'
       order by n.created_at desc
       limit 1
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.student_progress_report(uuid, date, date) is
  '§217. Отчёт об успеваемости одним вызовом: ученик + границы периода → готовые числа для экрана и листа родителю. Средний балл всегда с числом проверенных работ; среднее по группе только от шести человек; тема идёт в списки от трёх заданий. Прогноза балла на экзамене здесь нет намеренно. Только персонал курса ученика — ученику отказ.';

revoke all on function public.student_progress_report(uuid, date, date) from public, anon;
grant execute on function public.student_progress_report(uuid, date, date) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Пробы прав — выполнять ОТДЕЛЬНО, в откатываемом блоке
-- ──────────────────────────────────────────────────────────────────────────
-- Ниже комментарием, а не кодом: миграция не должна ничего писать и ничего
-- проверять. Прогонять руками, подставив настоящие uuid, обязательно под
-- ролью `authenticated` — под владельцем таблиц RLS не проверяется вовсе
-- (ловушка §29.4), а security definer под ним вдобавок не показывает, что
-- ручная проверка прав вообще срабатывает.
--
-- Прогонялись на локальном Postgres 16 с уменьшенным слепком схемы (те же
-- редакции course_is_staff, auth_is_staff_of_student, auth_student_id,
-- is_admin_or_owner, что в supabase/migrations) и на выдуманном наборе
-- данных. НА ПРОДЕ НЕ ПРОГОНЯЛИСЬ: облачный агент к проду не ходит.
-- Фактический вывод локального прогона:
--
--   преподаватель курса        → отчёт приходит
--   чужой преподаватель        → ERROR 42501 «Нет доступа к отчёту этого ученика»
--   сам ученик                 → ERROR 42501 (лист для родителя ученику не показываем)
--   владелец платформы         → отчёт приходит
--   конец периода < начала     → ERROR 22023
--   next_steps: свой пишет; чужой преподаватель видит 0; ученик видит 0 и не
--   пишет; четвёртая строка отклоняется check'ом; подделка updated_by
--   отклоняется политикой
--
--   группа из 4  → group_size 4, group_avg_percent null
--   группа из 5  → group_size 5, group_avg_percent null
--   группа из 6  → group_size 6, group_avg_percent 80
--   тема с 2 засчитанными заданиями → ни в списках, ни в разрезе по номерам
--   тема с 3     → и в списках, и в разрезе
--   тема с {6,7} → вклад И в номер 6, И в номер 7 (по 4 задания каждому)
--   тема с {}    → в разрез не идёт, считается в topics.without_number
--   нет строки в student_subject_targets → target null (не 0)
--   avg_percent всегда приходит парой с graded_works
--
-- begin;
-- set role authenticated;
--
-- -- преподаватель курса: отчёт приходит
-- set local request.jwt.claims = '{"sub":"<uuid преподавателя курса>","role":"authenticated"}';
-- select jsonb_pretty(public.student_progress_report('<uuid ученика>', date '2026-09-01', date '2026-09-25'));
--   -- ожидание: объект; в каждом предмете graded_works стоит рядом с avg_percent;
--   --           group_avg_percent = null там, где group_size < 6.
--
-- -- чужой преподаватель: отказ
-- set local request.jwt.claims = '{"sub":"<uuid ЧУЖОГО преподавателя>","role":"authenticated"}';
-- select public.student_progress_report('<uuid ученика>', date '2026-09-01', date '2026-09-25');
--   -- ожидание: ERROR 42501 «Нет доступа к отчёту этого ученика»
--
-- -- сам ученик: тоже отказ, лист для родителя ученику не показываем
-- set local request.jwt.claims = '{"sub":"<uuid ученика>","role":"authenticated"}';
-- select public.student_progress_report('<uuid ученика>', date '2026-09-01', date '2026-09-25');
--   -- ожидание: ERROR 42501
--
-- -- «что делать до следующей встречи»: пишет персонал, ученик не видит
-- set local request.jwt.claims = '{"sub":"<uuid преподавателя курса>","role":"authenticated"}';
-- insert into public.student_report_next_steps (student_id, period_from, period_to, steps, updated_by)
--   values ('<uuid ученика>', date '2026-09-01', date '2026-09-25',
--           array['Разобрать термодинамику','Отбор корней','Договориться о дне сдачи'],
--           '<uuid преподавателя курса>');                       -- ожидание: INSERT 0 1
-- insert into public.student_report_next_steps (student_id, period_from, period_to, steps, updated_by)
--   values ('<uuid ученика>', date '2026-09-01', date '2026-09-25', array['a','b','c','d'],
--           '<uuid преподавателя курса>');                       -- ожидание: нарушение check (не больше трёх)
--
-- set local request.jwt.claims = '{"sub":"<uuid ученика>","role":"authenticated"}';
-- select count(*) from public.student_report_next_steps;         -- ожидание: 0
-- insert into public.student_report_next_steps (student_id, period_from, period_to, steps, updated_by)
--   values ('<uuid ученика>', date '2026-09-01', date '2026-09-25', array['своё'], auth.uid());
--                                                                -- ожидание: отказ политикой
-- rollback;
--
-- ── Проверки расчёта, которые стоит прогнать глазами на живых данных ──────
-- 1. Группа из пяти человек → group_avg_percent = null, group_size = 5.
--    Группа из шести → число. Это правило про приватность: в группе из трёх
--    среднее рядом с баллом сына позволяет родителю вычислить остальных.
-- 2. Тема с двумя засчитанными заданиями в topics.weak/strong не попадает,
--    с тремя — попадает.
-- 3. Тема с ege_task_numbers = {6,7} даёт вклад И в номер 6, И в номер 7.
-- 4. Тема с ege_task_numbers = {} в ege_numbers не попадает совсем и
--    считается в topics.without_number.
-- 5. Нет строки в student_subject_targets → target = null (не 0).
-- 6. avg_percent и graded_works приходят парой; при одной проверенной работе
--    graded_works = 1, и клиент обязан это напечатать.
