-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260805130129
--   name    = catalog_multi_choice_type_for_oge19_statements
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- ============================================================
-- «Какие утверждения верны»: тип multi_choice + канонический эталон (2026-08-05)
-- ============================================================
-- Задание: 57 задач ОГЭ №19 вида «Какие из следующих утверждений верны?» —
-- множественный выбор, но partial_type не проставлен, автопроверка сравнивает
-- ответ строкой.
--
-- ПОЧЕМУ ОДНОЙ РАЗМЕТКИ МАЛО (проверено запросами на проде до правки).
-- Эталон у этих задач хранит СРАЗУ ДВА варианта записи: «13 31», «23 32»,
-- «12 21», «32 23» — одно и то же множество цифр в двух порядках. Дальше
-- контуры расходятся:
--
--   submit_variant: ветка partial_type ПЕРЕБИВАЕТ variant_answer_verdict.
--     Сегодня (partial_type is null) verdict видит «любое из» и засчитывает
--     и «13», и «31» — тут всё правильно.
--     Если проставить только тип: score_partial_multi_choice сравнивает
--     МУЛЬТИМНОЖЕСТВА цифр эталона «13 31» → {1:2,3:2} против ответа «13»
--     → {1:1,3:1}, расхождение 2 → 0 баллов. Проверено:
--       score_auto_answer('13','13 31','multi_choice') = 0
--       score_auto_answer('31','13 31','multi_choice') = 0
--       score_auto_answer('1331','13 31','multi_choice') = 2  (!)
--     То есть разметка сама по себе сломала бы 57 задач в вариантах.
--
--   topic_test_score_item: partial_type нет → ветка «строкой», и именно она
--     сломана уже сейчас:
--       score_auto_answer('13','13 31',null) = 0
--       score_auto_answer('31','13 31',null) = 0
--       score_auto_answer('1331','13 31',null) = 1  (!)
--
-- Поэтому правка парная: тип multi_choice И эталон, схлопнутый до ОДНОГО
-- варианта (цифры по возрастанию). Мультивыбор сравнивает множества, поэтому
-- порядок ответа ученика перестаёт иметь значение в обоих контурах:
--   score_auto_answer('13','13','multi_choice') = 2
--   score_auto_answer('31','13','multi_choice') = 2
--   score_auto_answer('1','13','multi_choice')  = 1  (половина за одну цифру)
--
-- Половинный балл за одну верную цифру — поведение существующего механизма
-- multi_choice, общее для всех таких задач. На самом ОГЭ №19 балл всё или
-- ничего; если владелец захочет так же, это правится в
-- score_partial_multi_choice, а не разметкой.
--
-- ГРАНИЦЫ. Условие ниже пересчитывается прямо в запросе, список id не зашит:
-- ровно два токена по две цифры, оба — перестановки одного набора. Под него
-- попадают 57 задач ОГЭ №19 по математике. Задача 1937 (ЕГЭ №16, эталон
-- «468 000» — это число 468000 с пробелом-разделителем разрядов) под условие
-- НЕ подходит: у её токенов разные наборы цифр. Она остаётся нетронутой и
-- уходит в ручную проверку, как и раньше (variant_answer_can_auto_check = false).
--
-- БЕЗОПАСНОСТЬ. На момент правки ни одна из 57 задач не скопирована ни в один
-- topic_test_items (0 из 24), ни в test_variant_items (0 из 89), ответов
-- учеников по ним нет (0). Пересчёт уже выставленных баллов не требуется.
--
-- ПРОВЕРЕНО ПОСЛЕ ПРИМЕНЕНИЯ: 57 строк в снимке, 57 с partial_type =
-- 'multi_choice', эталоны стали «12», «13», «23»; на задачах 43936/37289/44279
-- оба порядка ответа дают 2, чужой набор и «1331» — 0.
--
-- ОТКАТ:
--   update public.catalog_tasks t
--      set answer_html = b.answer_html, partial_type = b.partial_type
--     from public.catalog_tasks_multichoice_backup_20260805 b
--    where b.id = t.id;
--   drop table public.catalog_tasks_multichoice_backup_20260805;

create table if not exists public.catalog_tasks_multichoice_backup_20260805 as
select id, external_id, answer_html, partial_type
  from public.catalog_tasks
 where false;

revoke all on public.catalog_tasks_multichoice_backup_20260805 from public, anon, authenticated;

with candidate as (
  select t.id,
         btrim(regexp_replace(regexp_replace(coalesce(t.answer_html,''),'<[^>]+>',' ','g'),'\s+',' ','g')) as ans
    from public.catalog_tasks t
   where t.is_published
     and t.partial_type is null
),
parsed as (
  select c.id, c.ans,
         string_to_array(c.ans, ' ') as toks
    from candidate c
   where c.ans ~ '^\d{2} \d{2}$'
),
checked as (
  select p.id, p.toks,
         (select string_agg(ch, '' order by ch) from unnest(string_to_array(p.toks[1], null)) ch) as set1,
         (select string_agg(ch, '' order by ch) from unnest(string_to_array(p.toks[2], null)) ch) as set2
    from parsed p
)
insert into public.catalog_tasks_multichoice_backup_20260805 (id, external_id, answer_html, partial_type)
select t.id, t.external_id, t.answer_html, t.partial_type
  from public.catalog_tasks t
  join checked c on c.id = t.id
 where c.set1 = c.set2;

update public.catalog_tasks t
   set partial_type = 'multi_choice',
       answer_html  = c.canonical,
       updated_at   = now()
  from (
    select b.id,
           (select string_agg(ch, '' order by ch)
              from unnest(string_to_array(
                     split_part(btrim(regexp_replace(regexp_replace(b.answer_html,'<[^>]+>',' ','g'),'\s+',' ','g')), ' ', 1),
                     null)) ch) as canonical
      from public.catalog_tasks_multichoice_backup_20260805 b
  ) c
 where c.id = t.id;
