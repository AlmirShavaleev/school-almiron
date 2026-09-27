-- §238. ИИ-проверка ДЗ: недельная точность черновика ИИ против вердикта преподавателя.
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration; после применения
-- файл переименовать по версии из supabase_migrations.schema_migrations (MIGRATIONS.md).
--
-- Зачем. Светофор §238 (жёлтые/зелёные строки таблицы проверки) выведен из
-- ручной выгрузки: 34 работы, 336 заданий. Правила надо проверять теми же
-- числами каждую неделю, без ощущений: стало ли меньше правок в зелёных,
-- ловит ли «частично при совпавшем ответе» ложные претензии. Функция отдаёт
-- ту же таблицу, что была в выгрузке, — по свежим проверкам.
--
-- Что считается.
--   * Работа — попытка ДЗ темы, по которой преподаватель вынес вердикт
--     (строка topic_homework_reviews) не раньше p_since.
--   * Черновик ИИ — ПОСЛЕДНЯЯ завершённая проверка этой попытки с таблицей
--     (status = 'done', tasks не null) — та же, из которой заполняется таблица
--     преподавателя (topic_homework_review_tasks_seed, §199).
--   * Задание — строка таблицы ИИ, у которой нашлась строка таблицы
--     преподавателя с тем же номером (номер сравнивается как normalizeTaskNo:
--     нижний регистр, без пробелов, «№» и точек). Строки без пары не
--     считаются: их удалили или добавили руками, сравнивать не с чем.
--   * «Изменено преподавателем» — вердикт в таблице преподавателя не равен
--     вердикту ИИ. С §238 «частично» при совпавшем ответе ложится в таблицу
--     сразу «верно» — такая строка считается ИЗМЕНЁННОЙ: ИИ ошиблась, а
--     преподаватель согласился с предложением. Это и есть мера ошибки ИИ.
--   * Ответ совпал — нормализация как `normalizeAnswer` в
--     check-homework-ai/findings.ts: нижний регистр, юникодные минусы и тире →
--     «-», пробелы убраны целиком, запятая → точка, конечная пунктуация и
--     ведущий «+» убраны, число — к канонической записи («0.20» = «0.2»).
--     РАСХОЖДЕНИЕ С JS (допустимо, описано в PROJECT_STATE §238): второй шаг
--     `compareAnswers` — сверка ЧИСЛОМ с единицами («в 144 раза» = «144»,
--     «3,6 куб. см» = «3,6») — здесь не повторён. Такие строки SQL относит к
--     «ответ записан иначе», клиент — к «совпал». Сдвиг небольшой и в одну
--     сторону: строк «верно, ответ совпал» в SQL чуть меньше.
--
-- Права. security definer, внутри — проверка is_admin_or_owner(): отчёт по
-- всей школе, преподавателю курса он не нужен и не положен. Ученик и
-- преподаватель без роли admin/owner получают исключение (пробы — в
-- supabase/tests/ai_check_accuracy_238/probes.out).

create or replace function public.ai_check_normalize_answer(p_raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with s as (
    select regexp_replace(
             regexp_replace(
               replace(
                 regexp_replace(
                   translate(lower(coalesce(p_raw, '')), U&'\2212\2013\2014\2012', '----'),
                   E'[[:space:] ]+', '', 'g'),
                 ',', '.'),
               '[.;:!?]+$', ''),
             '^\+', '') as v
  )
  select case
           when v ~ '^-?[0-9]+(\.[0-9]+)?$'
             then trim_scale((v)::numeric)::text
           else v
         end
    from s;
$$;

comment on function public.ai_check_normalize_answer(text) is
  '§238. Нормализация ответа для ai_check_accuracy — как normalizeAnswer в check-homework-ai/findings.ts (регистр, минусы, пробелы, запятая, конечная пунктуация, каноническое число). Сверки числом с единицами (второй шаг compareAnswers) нет.';

create or replace function public.ai_check_accuracy(p_since timestamptz default now() - interval '7 days')
returns table (
  ai_verdict text,
  answer_match boolean,
  tasks bigint,
  changed bigint,
  works bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.is_admin_or_owner(), false) then
    raise exception 'Только для администратора школы' using errcode = '42501';
  end if;

  return query
  with reviewed as (
    select distinct r.attempt_id
      from topic_homework_reviews r
     where r.created_at >= p_since
  ), last_job as (
    select distinct on (j.attempt_id) j.attempt_id, j.tasks
      from topic_homework_ai_jobs j
      join reviewed rv on rv.attempt_id = j.attempt_id
     where j.status = 'done'
       and j.tasks is not null
       and jsonb_typeof(j.tasks) = 'array'
     order by j.attempt_id, j.completed_at desc nulls last, j.created_at desc
  ), ai_rows as (
    select lj.attempt_id,
           lower(regexp_replace(coalesce(e->>'no', ''), '[[:space:]№.]', '', 'g')) as no_key,
           case when e->>'verdict' in ('correct', 'wrong', 'partial', 'unchecked')
                then e->>'verdict' else 'unchecked' end as verdict,
           e->>'student_answer'  as student_answer,
           e->>'expected_answer' as expected_answer
      from last_job lj
      cross join lateral jsonb_array_elements(lj.tasks) e
     where jsonb_typeof(e) = 'object'
  ), paired as (
    select a.attempt_id,
           a.verdict as ai_verdict,
           t.verdict as teacher_verdict,
           (public.ai_check_normalize_answer(a.student_answer) <> ''
             and public.ai_check_normalize_answer(a.student_answer)
                 = public.ai_check_normalize_answer(a.expected_answer)) as answer_match
      from ai_rows a
      join topic_homework_review_tasks t
        on t.attempt_id = a.attempt_id
       and lower(regexp_replace(t.no, '[[:space:]№.]', '', 'g')) = a.no_key
     where a.no_key <> ''
  )
  select p.ai_verdict,
         p.answer_match,
         count(*)::bigint,
         count(*) filter (where p.teacher_verdict <> p.ai_verdict)::bigint,
         count(distinct p.attempt_id)::bigint
    from paired p
   group by p.ai_verdict, p.answer_match
   order by case p.ai_verdict when 'correct' then 0 when 'partial' then 1 when 'wrong' then 2 else 3 end,
            p.answer_match desc;
end $$;

comment on function public.ai_check_accuracy(timestamptz) is
  '§238. Точность черновика ИИ-проверки ДЗ против таблицы преподавателя по работам с вердиктом с p_since: строка на (вердикт ИИ × ответ совпал), заданий, изменено преподавателем, работ. Только admin/owner. Блок «ИИ-проверка: точность за 7 дней» во вкладке «Учёба» админки.';

revoke all on function public.ai_check_accuracy(timestamptz) from public, anon;
grant execute on function public.ai_check_accuracy(timestamptz) to authenticated;
revoke all on function public.ai_check_normalize_answer(text) from public, anon;
grant execute on function public.ai_check_normalize_answer(text) to authenticated;
