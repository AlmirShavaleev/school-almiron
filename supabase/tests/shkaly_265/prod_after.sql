-- §265. Проверка на проде ПОСЛЕ PENDING_265 и PENDING_265_backfill — только чтение (блок 4 — в откате).
\pset footer off

\echo '=== 1. Триггеры §265 на месте и включены (ожидается 3 строки, enabled = O)'
select tgrelid::regclass as tbl, tgname, tgenabled as enabled
  from pg_trigger
 where tgname in ('topic_homework_grade_scale_trg', 'topics_kind_grade_scale_trg', 'topic_homework_reviews_scale_trg')
 order by 1, 2;

\echo '=== 2. Триггеры, выключавшиеся на время пересчёта, снова включены (ожидается enabled = O у обоих)'
select tgrelid::regclass as tbl, tgname, tgenabled as enabled
  from pg_trigger
 where tgname in ('topic_homework_reviews_immutable_trg', 'template_sync_homework_write')
 order by 1, 2;

\echo '=== 3. grade_scale NOT NULL; шкалы по типу темы (ожидается: lesson — hundred (и five, если учитель выбрал после §265), check/control — five)'
select attnotnull as grade_scale_not_null from pg_attribute
 where attrelid = 'public.topic_homework'::regclass and attname = 'grade_scale';
select t.kind, h.grade_scale, count(*) as homeworks
  from topic_homework h join topics t on t.id = h.topic_id
 group by 1, 2 order by 1, 2;

\echo '=== 4. Оценка 1 у 5-балльной проверочной — отказ (в откате). Подставьте id любой попытки 5-балльной работы:'
\echo '    \set att ''<uuid попытки>''   и запустите блок ниже вручную'
-- begin;
-- insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score)
-- select a.id, h.created_by, 'accepted', 'проба §265', 1
--   from topic_homework_attempts a join topic_homework h on h.id = a.homework_id where a.id = :'att';
-- -- ожидается: ERROR  У 5-балльной работы оценка — 2, 3, 4 или 5 (поставлено 1)
-- rollback;
