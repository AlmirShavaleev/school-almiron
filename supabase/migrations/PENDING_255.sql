-- §255. Главная ученика, этап 2: «Примерный балл на ЕГЭ» и «Баллы школы».
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор (MCP apply_migration), затем файл
-- переименовывается по версии из schema_migrations (MIGRATIONS.md).
-- Только добавление: новая таблица student_exam_goals (+ политика чтения) и три
-- новые функции; существующие таблицы, политики и функции не меняются.
--
-- Все три функции — definer и считают ОТ auth.uid(): параметра «чей» нет,
-- чужое получить нечем. grant execute — только authenticated.
--
--   1. student_exam_forecast_evidence() — СВИДЕТЕЛЬСТВА для прогноза балла
--      (строки; модель считает клиент, src/lib/egeForecast.ts) + цель ученика.
--   2. set_my_exam_goal(subject, goal)  — ученик ставит себе цель 1..100.
--   3. student_school_points()          — «Баллы школы»: сумма, уровень,
--      лента «за что», данные значков. Без записи в таблицы — из истории.
--
-- Повторное применение безопасно (create … if not exists / or replace,
-- drop policy if exists): пробы гоняют файл дважды.

-- ── Цель ученика: своя таблица student_exam_goals, а не student_subject_targets ─
-- Цель по предмету уже есть — student_subject_targets (§216), но её ставит
-- ПРЕПОДАВАТЕЛЬ, и на ней стоит отчёт родителю (student_progress_report); §216
-- прямо закрыл ученику запись: «ученик, правящий себе цель, обессмыслил бы её в
-- отчёте родителю». Решение владельца 02.10 — цель на главной ставит САМ
-- ученик, учитель её видит. Писать ученика в ту же строку значит молча менять
-- отчёт родителю и устраивать перетягивание (учитель 70 → ученик 90 → учитель
-- 70). Поэтому цель ученика — отдельная таблица; учительская цель не тронута, а
-- в карточке ученика у учителя обе рядом («цель ученика — 80»).
--
-- Запись — только definer-функцией set_my_exam_goal (проверка 1..100, «предмет
-- вашего ЕГЭ-курса», понятные ошибки); прямых прав insert/update/delete на
-- таблицу нет ни у кого из клиентских ролей. Чтение — RLS: сам ученик, админ
-- платформы, персонал курса ученика (auth_is_staff_of_student → course_is_staff,
-- одно определение «персонала» на проект). Посторонний преподаватель не видит.

create table if not exists public.student_exam_goals (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  subject    public.subject_type not null check (subject in ('math', 'physics')),
  goal       smallint not null check (goal between 1 and 100),
  updated_at timestamptz not null default now(),
  primary key (profile_id, subject)
);

comment on table public.student_exam_goals is
  '§255. Цель ЕГЭ, которую ученик поставил себе сам (главная, «Примерный балл»). Пишет только set_my_exam_goal; читают сам ученик, админ и персонал курса ученика. Учительская цель для отчёта родителю — отдельно, student_subject_targets (§216).';

alter table public.student_exam_goals enable row level security;
revoke all on table public.student_exam_goals from public, anon, authenticated;
grant select on table public.student_exam_goals to authenticated;

drop policy if exists student_exam_goals_select on public.student_exam_goals;
create policy student_exam_goals_select
  on public.student_exam_goals
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_admin_or_owner()
    or exists (
      select 1 from public.students s
       where s.profile_id = student_exam_goals.profile_id
         and public.auth_is_staff_of_student(s.id)
    )
  );

-- ── 1. Свидетельства для прогноза ────────────────────────────────────────
-- Строка: subject ('math' | 'physics'), ns (номера КИМ, к которым относится
-- свидетельство), source, score 0..1, at, item (ключ «одной задачи»),
-- kim_total (только пробник: число заданий шаблона — сверка нумерации года).
-- Доля строки (подсказка веса) = 1 / cardinality(ns): тема «№22-23» делит
-- задачу на два номера. Сколько номеров у темы допустимо и какие веса у
-- источников — решает клиент (egeForecast.ts), здесь только факты.
--
--   * hw — таблица проверки (topic_homework_review_tasks) работ С ВЕРДИКТОМ
--     (есть строка topic_homework_reviews; до вердикта таблица — черновик, §199):
--     верно 1, частично 0,5, неверно / не решал 0; «не сверено» пропускается.
--     Задание ДЗ — один раз: по последней сдаче, где у него есть вердикт (после
--     доработки берётся свежий результат). Дата — сдача работы. Номера — у темы
--     (topics.ege_task_numbers, §216); тема без номеров не участвует.
--   * test — ответы завершённых попыток тестов тем: балл / максимум задания
--     (без балла — верно 1 / неверно 0). Номер — раздел каталога задачи
--     (catalog_sections.exam_number), если задача из каталога ЕГЭ, иначе номера темы.
--   * mock — mock_exam_task_scores: балл / максимум номера по шаблону пробника;
--     дата — день пробника (starts_at, у старых date).
--   * catalog — решённые задачи каталога ровно по определению §246
--     («Выполнено» или верный ответ варианта; задача один раз, по раннему;
--     опубликованные задачи и разделы) в разделах ЕГЭ с exam_number. Только
--     успехи — ошибок каталог не хранит; поэтому клиент даёт им малый вес.
-- Окно — 180 дней. Предметы — ЕГЭ-курсы групп ученика (профильная математика и
-- физика); остальные предметы и ОГЭ не отдаются вовсе.
create or replace function public.student_exam_forecast_evidence()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_from timestamptz := now() - interval '180 days';
begin
  if v_uid is null then
    raise exception 'student_exam_forecast_evidence: нужен вход' using errcode = '42501';
  end if;

  return (
    with st as (
      select s.id from public.students s where s.profile_id = v_uid
    ),
    my_subjects as (
      select distinct c.subject::text as subject
        from public.group_students gs
        join public.groups g on g.id = gs.group_id
        join public.courses c on c.id = g.course_id
       where gs.student_id in (select id from st)
         and c.exam_type::text = 'ege'
         and c.subject::text in ('math', 'physics')
    ),
    -- ДЗ: последняя сдача с вердиктом по каждому заданию работы.
    hw_last as (
      select distinct on (a.homework_id, lower(btrim(rt.no)))
             a.homework_id, h.topic_id, lower(btrim(rt.no)) as no, rt.verdict, a.submitted_at
        from public.topic_homework_review_tasks rt
        join public.topic_homework_attempts a on a.id = rt.attempt_id
        join public.topic_homework h on h.id = a.homework_id
       where a.student_id in (select id from st)
         and a.submitted_at is not null
         and rt.verdict in ('correct', 'partial', 'wrong', 'unsolved')
         and exists (select 1 from public.topic_homework_reviews r where r.attempt_id = a.id)
       order by a.homework_id, lower(btrim(rt.no)), a.submitted_at desc, a.attempt_number desc
    ),
    hw_rows as (
      select c.subject::text as subject,
             t.ege_task_numbers::int[] as ns,
             'hw'::text as source,
             case x.verdict when 'correct' then 1.0 when 'partial' then 0.5 else 0.0 end::numeric as score,
             x.submitted_at as at,
             'hw:' || x.homework_id::text || ':' || x.no as item,
             null::int as kim_total
        from hw_last x
        join public.topics t on t.id = x.topic_id
        join public.modules m on m.id = t.module_id
        join public.courses c on c.id = m.course_id
       where x.submitted_at >= v_from
         and cardinality(t.ege_task_numbers) > 0
         and c.exam_type::text = 'ege'
         and c.subject::text in ('math', 'physics')
    ),
    test_rows as (
      select c.subject::text as subject,
             coalesce(
               (select array[cs.exam_number::int]
                  from public.catalog_tasks ct
                  join public.catalog_sections cs on cs.id = ct.section_id
                 where ct.id = i.task_id and cs.exam_type = 'ЕГЭ' and cs.exam_number >= 1
                   and cs.subject = case c.subject::text when 'math' then 'Математика' when 'physics' then 'Физика' end),
               t.ege_task_numbers::int[]) as ns,
             'test'::text as source,
             case
               when i.max_points > 0 and ans.awarded_points is not null
                 then least(1.0, ans.awarded_points::numeric / i.max_points)
               when coalesce(ans.is_correct, false) then 1.0
               else 0.0
             end::numeric as score,
             att.completed_at as at,
             'test:' || ans.id::text as item,
             null::int as kim_total
        from public.topic_test_answers ans
        join public.topic_test_attempts att on att.id = ans.attempt_id
        join public.topic_test_items i on i.id = ans.item_id
        join public.topic_tests tt on tt.id = att.test_id
        join public.topics t on t.id = tt.topic_id
        join public.modules m on m.id = t.module_id
        join public.courses c on c.id = m.course_id
       where att.student_id in (select id from st)
         and att.status = 'completed'
         and att.completed_at >= v_from
         and c.exam_type::text = 'ege'
         and c.subject::text in ('math', 'physics')
    ),
    mock_rows as (
      select me.subject::text as subject,
             array[s.task_number::int] as ns,
             'mock'::text as source,
             least(1.0, s.points::numeric / tpl.max_points[s.task_number]) as score,
             coalesce(me.starts_at, me.date) as at,
             'mock:' || me.id::text as item,
             array_length(tpl.max_points, 1) as kim_total
        from public.mock_exam_task_scores s
        join public.mock_exams me on me.id = s.mock_exam_id
        join public.mock_exam_templates tpl on tpl.id = me.template_id
       where s.student_id in (select id from st)
         and me.exam_type::text = 'ege'
         and me.subject::text in ('math', 'physics')
         and coalesce(tpl.max_points[s.task_number], 0) > 0
         and coalesce(me.starts_at, me.date) >= v_from
    ),
    cat_raw as (
      select p.task_id, coalesce(p.completed_at, p.updated_at) as at
        from public.catalog_task_progress p
       where p.user_id = v_uid and p.is_completed
      union all
      select vi.task_id,
             coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at)
        from public.test_variant_student_assignments sa
        join public.test_variant_answers a on a.student_assignment_id = sa.id
        join public.test_variant_items vi on vi.id = a.variant_item_id
       where sa.student_id in (select id from st) and a.is_correct
    ),
    cat_rows as (
      select case cs.subject when 'Математика' then 'math' when 'Физика' then 'physics' end as subject,
             array[cs.exam_number::int] as ns,
             'catalog'::text as source,
             1.0::numeric as score,
             min(r.at) as at,
             'catalog:' || r.task_id::text as item,
             null::int as kim_total
        from cat_raw r
        join public.catalog_tasks ct on ct.id = r.task_id and ct.is_published
        join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published
       where cs.exam_type = 'ЕГЭ'
         and cs.subject in ('Математика', 'Физика')
         and cs.exam_number >= 1
       group by cs.subject, cs.exam_number, r.task_id
      having min(r.at) >= v_from
    ),
    ev as (
      select * from hw_rows
      union all select * from test_rows
      union all select * from mock_rows
      union all select * from cat_rows
    ),
    titles as (
      select distinct on (1, 2)
             case cs.subject when 'Математика' then 'math' when 'Физика' then 'physics' end as subject,
             cs.exam_number::int as n, cs.title
        from public.catalog_sections cs
       where cs.is_published and cs.exam_type = 'ЕГЭ'
         and cs.subject in ('Математика', 'Физика') and cs.exam_number >= 1
       order by 1, 2, cs.position, cs.id
    )
    select jsonb_build_object(
      'today', (now() at time zone 'Europe/Moscow')::date,
      'now', now(),
      'subjects', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'subject', ms.subject,
                 'goal', g.goal,
                 'goal_updated_at', g.updated_at,
                 -- цель учителя (§216) — только для подсказки «учитель поставил 70»
                 'teacher_goal', (
                   select tg.target_score from public.student_subject_targets tg
                    where tg.student_id in (select id from st)
                      and tg.subject::text = ms.subject and tg.exam_type::text = 'ege'
                    order by tg.updated_at desc limit 1)
               ) order by ms.subject)
          from my_subjects ms
          left join public.student_exam_goals g
            on g.profile_id = v_uid and g.subject::text = ms.subject
      ), '[]'::jsonb),
      'titles', coalesce((
        select jsonb_agg(jsonb_build_object('subject', ti.subject, 'n', ti.n, 'title', ti.title) order by ti.subject, ti.n)
          from titles ti where ti.subject in (select subject from my_subjects)
      ), '[]'::jsonb),
      'evidence', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'subject', e.subject, 'ns', to_jsonb(e.ns), 'source', e.source,
                 'score', round(e.score, 3), 'at', e.at, 'item', e.item, 'kim_total', e.kim_total)
               order by e.at)
          from ev e
         where e.subject in (select subject from my_subjects)
           and e.at <= now()
      ), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.student_exam_forecast_evidence() is
  '§255. Свидетельства для «Примерного балла на ЕГЭ» за 180 дней (hw — таблица проверки работ с вердиктом по номерам темы; test — ответы тестов тем; mock — баллы пробника / максимум номера; catalog — решённое каталога §246) по ЕГЭ-предметам ученика (math, physics) + цель ученика (student_exam_goals), цель учителя (student_subject_targets, только своя) и названия номеров из каталога. Только свои данные — от auth.uid(). Модель считает клиент (egeForecast.ts).';

revoke all on function public.student_exam_forecast_evidence() from public, anon;
grant execute on function public.student_exam_forecast_evidence() to authenticated;

-- ── 2. Цель ученика ───────────────────────────────────────────────────────
-- Пишет student_exam_goals (своя строка). p_goal null — «цели нет»: строка
-- удаляется (на шкале нет отметки, у учителя — прочерк, а не ноль). Предмет —
-- только ЕГЭ-курс групп ученика.
create or replace function public.set_my_exam_goal(p_subject text, p_goal integer)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'set_my_exam_goal: нужен вход' using errcode = '42501';
  end if;
  if p_subject is null or p_subject not in ('math', 'physics') then
    raise exception 'Цель ставится только по профильной математике и физике' using errcode = '22023';
  end if;
  if p_goal is not null and (p_goal < 1 or p_goal > 100) then
    raise exception 'Цель — целое число от 1 до 100' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.students s
      join public.group_students gs on gs.student_id = s.id
      join public.groups g on g.id = gs.group_id
      join public.courses c on c.id = g.course_id
     where s.profile_id = v_uid
       and c.exam_type::text = 'ege'
       and c.subject::text = p_subject
  ) then
    raise exception 'Цель можно поставить только по предмету своего курса ЕГЭ' using errcode = '42501';
  end if;

  if p_goal is null then
    delete from public.student_exam_goals where profile_id = v_uid and subject::text = p_subject;
    return null;
  end if;

  insert into public.student_exam_goals (profile_id, subject, goal, updated_at)
  values (v_uid, p_subject::public.subject_type, p_goal, now())
  on conflict (profile_id, subject)
  do update set goal = excluded.goal, updated_at = now();
  return p_goal;
end;
$$;

comment on function public.set_my_exam_goal(text, integer) is
  '§255. Ученик ставит себе цель ЕГЭ (1..100; null — снять) по предмету своего ЕГЭ-курса (math | physics). Пишет student_exam_goals; учитель видит её в карточке ученика рядом со своей целью (§216).';

revoke all on function public.set_my_exam_goal(text, integer) from public, anon;
grant execute on function public.set_my_exam_goal(text, integer) to authenticated;

-- ── 3. Баллы школы ────────────────────────────────────────────────────────
-- leaderboard_points НЕ используется: её политика select = true (все видят
-- всех), а рейтинга у нас нет (решение владельца 02.10, п. 4). Баллы —
-- производные из истории, ничего не записывается, видны только свои.
create or replace function public.student_school_points()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Moscow')::date;

  -- ══ ПРАВИЛА — одна таблица. Владелец меняет числа ЗДЕСЬ; клиент читает их
  --    из ответа ('rules', 'levels', need у значков) и своих копий не держит. ══
  c_hw_ontime  constant int := 10;  -- ДЗ сдано до срока (первая сдача; срока нет — тоже вовремя)
  c_hw_late    constant int := 4;   -- ДЗ сдано после срока
  c_grade5     constant int := 10;  -- работа принята с оценкой 5 (пятибалльная шкала)
  c_grade4     constant int := 6;   -- принята с оценкой 4
  c_accepted   constant int := 6;   -- принята без пятибалльной шкалы (без баллов или стобалльная)
  c_catalog    constant int := 2;   -- задача каталога решена (как «решено» §246)
  c_mock_point constant int := 1;   -- пробник: за каждый первичный балл
  c_streak_day constant int := 3;   -- день серии заходов, если он второй подряд и дальше
  -- Уровни: порог (баллы) и короткое название; уровень N — с c_levels[N].
  c_levels     constant int[]  := array[0, 100, 200, 300, 450, 600, 800, 1000, 1250, 1500];
  c_names      constant text[] := array['Старт', 'Разгон', 'Ритм', 'Упорство', 'Система',
                                        'Уверенность', 'Опыт', 'Глубина', 'Мастерство', 'Вершина'];
  -- Значки: сколько нужно.
  c_badge_streak  constant int := 7;    -- «Неделя без пропусков»: серия заходов 7 дней (рекорд)
  c_badge_ontime  constant int := 10;   -- «10 ДЗ вовремя»
  c_badge_mock    constant int := 1;    -- «Первый пробник»
  c_badge_catalog constant int := 100;  -- «100 задач каталога»
  -- ══════════════════════════════════════════════════════════════════════

begin
  if v_uid is null then
    raise exception 'student_school_points: нужен вход' using errcode = '42501';
  end if;

  return (
    with st as (
      select s.id from public.students s where s.profile_id = v_uid
    ),
    first_sub as (
      select h.id as homework_id, t.title as topic_title, h.due_at, min(a.submitted_at) as at
        from public.topic_homework_attempts a
        join public.topic_homework h on h.id = a.homework_id
        join public.topics t on t.id = h.topic_id
       where a.student_id in (select id from st) and a.submitted_at is not null
       group by h.id, t.title, h.due_at
    ),
    last_accept as (
      select distinct on (a.homework_id)
             a.homework_id, r.created_at as at, r.score, h.grade_scale, t.title
        from public.topic_homework_reviews r
        join public.topic_homework_attempts a on a.id = r.attempt_id
        join public.topic_homework h on h.id = a.homework_id
        join public.topics t on t.id = h.topic_id
       where a.student_id in (select id from st) and r.decision = 'accepted'
       order by a.homework_id, r.created_at desc
    ),
    cat_raw as (
      select p.task_id, coalesce(p.completed_at, p.updated_at) as at
        from public.catalog_task_progress p
       where p.user_id = v_uid and p.is_completed
      union all
      select vi.task_id,
             coalesce(a.submitted_at, sa.submitted_at, a.graded_at, a.last_changed_at, a.created_at)
        from public.test_variant_student_assignments sa
        join public.test_variant_answers a on a.student_assignment_id = sa.id
        join public.test_variant_items vi on vi.id = a.variant_item_id
       where sa.student_id in (select id from st) and a.is_correct
    ),
    cat as (
      select r.task_id, min(r.at) as at
        from cat_raw r
        join public.catalog_tasks ct on ct.id = r.task_id and ct.is_published
        join public.catalog_sections cs on cs.id = ct.section_id and cs.is_published and cs.exam_number >= 1
       group by r.task_id
    ),
    mock as (
      select me.id, me.title, coalesce(me.starts_at, me.date) as at, sum(s.points)::int as pts
        from public.mock_exam_task_scores s
        join public.mock_exams me on me.id = s.mock_exam_id
       where s.student_id in (select id from st)
       group by me.id, me.title, coalesce(me.starts_at, me.date)
    ),
    visits as (
      select v.visited_on,
             coalesce(v.visited_at, (v.visited_on::timestamp + interval '12 hours') at time zone 'Europe/Moscow') as at,
             v.visited_on - (row_number() over (order by v.visited_on))::int as grp
        from public.app_visits v
       where v.profile_id = v_uid and v.visited_on <= v_today
    ),
    runs as (
      select at, visited_on, row_number() over (partition by grp order by visited_on)::int as day_in_run
        from visits
    ),
    -- Все начисления: kind, когда, сколько, подпись, число (оценка / баллы / день серии).
    ev as (
      select case when f.due_at is null or (f.at at time zone 'Europe/Moscow')::date <= f.due_at
                  then 'hw_ontime' else 'hw_late' end as kind,
             f.at,
             case when f.due_at is null or (f.at at time zone 'Europe/Moscow')::date <= f.due_at
                  then c_hw_ontime else c_hw_late end as points,
             f.topic_title as title, null::int as n
        from first_sub f
      union all
      select 'hw_grade', la.at,
             case when la.grade_scale = 'five' and la.score = 5 then c_grade5
                  when la.grade_scale = 'five' and la.score = 4 then c_grade4
                  when la.grade_scale = 'five' and la.score is not null then 0
                  else c_accepted end,
             la.title, case when la.grade_scale = 'five' then la.score end
        from last_accept la
      union all
      select 'catalog', c.at, c_catalog, null, 1 from cat c
      union all
      select 'mock', m.at, c_mock_point * m.pts, m.title, m.pts from mock m where m.pts > 0
      union all
      select 'streak', r.at, c_streak_day, null, r.day_in_run from runs r where r.day_in_run >= 2
    ),
    tot as (
      select coalesce(sum(points), 0)::int as total from ev
    ),
    lvl as (
      select max(i) as n from tot, generate_subscripts(c_levels, 1) i where c_levels[i] <= tot.total
    ),
    -- Лента: последние 6 начислений; каталог — одной строкой на день (Москва).
    feed as (
      select x.kind, x.at, x.points, x.title, x.n
        from (
          select kind, at, points, title, n from ev where kind <> 'catalog' and points > 0
          union all
          select 'catalog', max(at), sum(points)::int, null, count(*)::int
            from ev where kind = 'catalog'
           group by (at at time zone 'Europe/Moscow')::date
        ) x
       order by x.at desc
       limit 6
    )
    select jsonb_build_object(
      'total', tot.total,
      'level', jsonb_build_object(
        'n', lvl.n,
        'name', c_names[lvl.n],
        'from', c_levels[lvl.n],
        'next', case when lvl.n < array_length(c_levels, 1) then c_levels[lvl.n + 1] end,
        'next_name', case when lvl.n < array_length(c_names, 1) then c_names[lvl.n + 1] end),
      'levels', to_jsonb(c_levels),
      'rules', jsonb_build_object(
        'hw_ontime', c_hw_ontime, 'hw_late', c_hw_late, 'grade5', c_grade5, 'grade4', c_grade4,
        'accepted', c_accepted, 'catalog', c_catalog, 'mock_point', c_mock_point, 'streak_day', c_streak_day),
      'feed', coalesce((select jsonb_agg(to_jsonb(f) order by f.at desc) from feed f), '[]'::jsonb),
      'badges', jsonb_build_array(
        jsonb_build_object('key', 'streak7', 'need', c_badge_streak,
          'have', coalesce((select s.record from public.student_visit_streak(v_uid, v_today) s), 0)),
        jsonb_build_object('key', 'ontime10', 'need', c_badge_ontime,
          'have', (select count(*)::int from ev where kind = 'hw_ontime')),
        jsonb_build_object('key', 'mock1', 'need', c_badge_mock,
          'have', (select count(distinct s.mock_exam_id)::int from public.mock_exam_task_scores s
                    where s.student_id in (select id from st))),
        jsonb_build_object('key', 'catalog100', 'need', c_badge_catalog,
          'have', (select count(*)::int from cat)))
    )
    from tot, lvl
  );
end;
$$;

comment on function public.student_school_points() is
  '§255. «Баллы школы» ученика из истории (без записи): ДЗ вовремя/после срока, принято 5/4/без шкалы, каталог (§246), первичные баллы пробников, дни серии ≥ 2 подряд. Сумма, уровень, лента последних 6 начислений, данные значков. Правила — константы в начале функции. Только свои — от auth.uid(); leaderboard_points не используется.';

revoke all on function public.student_school_points() from public, anon;
grant execute on function public.student_school_points() to authenticated;
