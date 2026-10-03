-- §261, часть 1/4. Применено оркестратором 03.10 (MCP apply_migration, версия 20261003114402); применённый текст — без строк-комментариев, comment on и хвостовых комментариев.
-- §261 — «Ученик целиком»: карточка ученика у учителя + отчёт родителю с прогнозом, проверочными и стараем.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration одной транзакцией, после чего файл
-- переименовывается в <version>_<name>.sql точно по записи в supabase_migrations.schema_migrations
-- (MIGRATIONS.md). Повторяемая: только `create or replace function`, ни одного drop, таблицы и
-- политики не меняются.
--
-- Что здесь:
--   1. student_forecast_evidence_of(profile, as_of)  — НОВАЯ внутренняя: тело student_exam_forecast_evidence()
--      (§255/§256, 20261002174501) с параметром «чей» и «на какой момент». Сама
--      student_exam_forecast_evidence() — create or replace С ПРЕЖНИМ КОНТРАКТОМ: тот же ответ, теперь
--      одной строкой вызывает внутреннюю от auth.uid() на now(). Копии логики нет — учитель и отчёт
--      родителю получают ровно те же свидетельства, что ученик на главной.
--   2. student_school_points_of(profile)             — НОВАЯ внутренняя: тело student_school_points()
--      (§257, 20261002194103) с параметром «чей». student_school_points() — create or replace с прежним
--      контрактом (обёртка от auth.uid()). Правила баллов и уровни остаются ОДНОЙ таблицей констант.
--   3. student_work_rows(student)                    — НОВАЯ внутренняя: работы ученика по курсам его
--      групп — проверочные/контрольные (тема kind check/control, как §249) и ДЗ уроков (как §250), с
--      первой сдачей (правило §259), вердиктом учителя, баллами по критериям (§260, таблица
--      преподавателя topic_homework_review_tasks.points — НЕ предложение ИИ из topic_homework_ai_jobs)
--      и средней по классу для проверочных. Одно место для карточки и для отчёта.
--   4. student_overview_for_staff(student, subject)  — НОВАЯ definer: всё для карточки ученика одним
--      вызовом. Только персонал курса ученика (auth_is_staff_of_student → course_is_staff) или админ,
--      иначе 42501; anon — нет execute.
--   5. student_progress_report(student, from, to)    — create or replace С СОВМЕСТИМЫМ ОТВЕТОМ (§217,
--      20260925184917): все прежние поля и их расчёт дословно; добавлены только новые поля —
--      subjects[].exam_goal, subjects[].assessments, subjects[].homeworks, forecast, diligence.
--
-- Почему отчёт — расширением student_progress_report, а карточка — новой функцией: у отчёта есть
-- период, «что делать» на паре «ученик + период» и правило «среднее по группе только от шести»; у
-- карточки периода нет («сейчас»), зато есть серия, задача дня, цель недели, награды. Общее (свидетельства,
-- работы, баллы школы) вынесено во внутренние функции 1–3, поэтому двух копий расчёта нет.
--
-- Каждая колонка, которую читают новые функции, — в миграциях репозитория (см. supabase/tests/uchenik_261/
-- 05_slice_261.sql: таблица «колонка → миграция»).

-- ══ 1. Свидетельства прогноза — одно место для ученика, учителя и отчёта ═══════════════════════════
-- То же, что 20261002174501 (student_exam_forecast_evidence, §256), с двумя параметрами:
--   p_profile_id — чей (profiles.id ученика), p_as_of — на какой момент (ученик и учитель — now();
--   отчёт за прошлый период — конец периода). Окно — 180 дней ДО p_as_of; свидетельства позже p_as_of
--   не берутся; зона номера считается на p_as_of; «решено» каталога — не позже p_as_of.
-- Внутренняя: execute ни у кого из клиентских ролей; зовут definer-функции ниже (они уже проверили права).
create or replace function public.student_forecast_evidence_of(p_profile_id uuid, p_as_of timestamptz)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with st as (
    select s.id from public.students s where s.profile_id = p_profile_id
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
  ev as (
    select e.* from public.student_exam_evidence_rows(p_profile_id, p_as_of - interval '180 days') e
     where e.subject in (select subject from my_subjects) and e.at <= p_as_of
  ),
  titles as (
    select distinct on (1, 2)
           case cs.subject when 'Математика' then 'math' when 'Физика' then 'physics' end as subject,
           cs.exam_number::int as n, cs.title, cs.id as section_id
      from public.catalog_sections cs
     where cs.is_published and cs.exam_type = 'ЕГЭ'
       and cs.subject in ('Математика', 'Физика') and cs.exam_number >= 1
     order by 1, 2, cs.position, cs.id
  ),
  nums as (
    select ti.subject, ti.n, ti.section_id from titles ti where ti.subject in (select subject from my_subjects)
  ),
  arr as (
    select array_agg(subject order by subject, n) as s, array_agg(n order by subject, n) as ns,
           array_agg(p_as_of order by subject, n) as ats
      from nums
  ),
  zones as (
    select arr.s[z.idx] as subject, arr.ns[z.idx] as n, z.share, z.zone
      from arr, lateral public.student_kim_zone_shares(p_profile_id, arr.s, arr.ns, arr.ats) z
     where arr.s is not null
  ),
  solved as (
    select s.subject, s.n, count(*)::int as k
      from public.catalog_counted_solutions(p_profile_id) s
     where s.at <= p_as_of
     group by 1, 2
  )
  select jsonb_build_object(
    'today', (p_as_of at time zone 'Europe/Moscow')::date,
    'now', p_as_of,
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'subject', ms.subject,
               'goal', g.goal,
               'goal_updated_at', g.updated_at,
               'teacher_goal', (
                 select tg.target_score from public.student_subject_targets tg
                  where tg.student_id in (select id from st)
                    and tg.subject::text = ms.subject and tg.exam_type::text = 'ege'
                  order by tg.updated_at desc limit 1)
             ) order by ms.subject)
        from my_subjects ms
        left join public.student_exam_goals g
          on g.profile_id = p_profile_id and g.subject::text = ms.subject
    ), '[]'::jsonb),
    'titles', coalesce((
      select jsonb_agg(jsonb_build_object('subject', ti.subject, 'n', ti.n, 'title', ti.title, 'section_id', ti.section_id) order by ti.subject, ti.n)
        from titles ti where ti.subject in (select subject from my_subjects)
    ), '[]'::jsonb),
    'numbers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'subject', z.subject, 'n', z.n, 'zone', z.zone, 'share', z.share,
               'solved', coalesce(so.k, 0)) order by z.subject, z.n)
        from zones z left join solved so on so.subject = z.subject and so.n = z.n
    ), '[]'::jsonb),
    'catalog_rules', public.catalog_reward_rules(),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
               'subject', e.subject, 'ns', to_jsonb(e.ns), 'source', e.source,
               'score', round(e.score, 3), 'at', e.at, 'item', e.item, 'kim_total', e.kim_total)
             order by e.at)
        from ev e
    ), '[]'::jsonb)
  );
$$;

comment on function public.student_forecast_evidence_of(uuid, timestamptz) is
  '§261. Свидетельства «Примерного балла на ЕГЭ» ученика p_profile_id на момент p_as_of (180 дней до него): то же, что §255/§256 student_exam_forecast_evidence() — цели, названия и разделы номеров, зона и засчитанное по номеру, правила каталога, свидетельства student_exam_evidence_rows. Одно место для главной ученика, карточки учителя и отчёта родителю. Внутренняя.';

revoke all on function public.student_forecast_evidence_of(uuid, timestamptz) from public, anon, authenticated;

-- Прежний контракт: тот же ответ, от auth.uid() на now().
create or replace function public.student_exam_forecast_evidence()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'student_exam_forecast_evidence: нужен вход' using errcode = '42501';
  end if;
  return public.student_forecast_evidence_of(v_uid, now());
end;
$$;

comment on function public.student_exam_forecast_evidence() is
  '§255/§256/§261. Свидетельства для «Примерного балла на ЕГЭ» за 180 дней по ЕГЭ-предметам ученика + цели, названия и разделы номеров, зона и засчитанное по каждому номеру, правила наград каталога. Только свои данные — от auth.uid(). Расчёт — student_forecast_evidence_of (§261, одно место с карточкой учителя и отчётом). Модель считает клиент (egeForecast.ts).';

revoke all on function public.student_exam_forecast_evidence() from public, anon;
grant execute on function public.student_exam_forecast_evidence() to authenticated;
