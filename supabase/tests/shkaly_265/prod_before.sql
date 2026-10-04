-- §265. Проба «что изменится» — ТОЛЬКО ЧТЕНИЕ. Запускать на проде ДО PENDING_265_backfill.sql (можно и до
-- PENDING_265 — от него не зависит). После пересчёта тот же файл должен показать нули в блоках 2 и 4.
\pset footer off

\echo '=== 1. Сейчас: ДЗ по типу темы и шкале (оценки — строки истории вердиктов с баллом)'
select t.kind, coalesce(h.grade_scale, 'без шкалы') as scale,
       count(distinct h.id) as homeworks,
       count(r.id) filter (where r.score is not null) as scored_reviews,
       count(r.id) filter (where r.decision = 'accepted' and r.score is null) as accepted_without_score,
       min(r.score) as min_score, max(r.score) as max_score
  from topic_homework h
  join topics t on t.id = h.topic_id
  left join topic_homework_attempts a on a.homework_id = h.id
  left join topic_homework_reviews r on r.attempt_id = a.id
 group by 1, 2 order by 1, 2;

\echo '=== 2. Что сделает пересчёт (строк будет изменено)'
select 'урок, 5-балльная → 100-балльная' as step,
       (select count(*) from topic_homework h join topics t on t.id = h.topic_id
         where t.kind = 'lesson' and h.grade_scale = 'five') as homeworks,
       (select count(*) from topic_homework_reviews r join topic_homework_attempts a on a.id = r.attempt_id
          join topic_homework h on h.id = a.homework_id join topics t on t.id = h.topic_id
         where t.kind = 'lesson' and h.grade_scale = 'five' and r.score between 0 and 5) as reviews_x20
union all
select 'урок без шкалы → 100-балльная',
       (select count(*) from topic_homework h join topics t on t.id = h.topic_id
         where t.kind = 'lesson' and h.grade_scale is null), 0
union all
select 'проверочная/контрольная без шкалы → 5-балльная',
       (select count(*) from topic_homework h join topics t on t.id = h.topic_id
         where t.kind in ('check', 'control') and h.grade_scale is null), 0;

\echo '=== 3. Оценки урок/5-балльных до и после ×20'
select r.score as score_now, r.score * 20 as score_after, count(*) as reviews
  from topic_homework_reviews r join topic_homework_attempts a on a.id = r.attempt_id
  join topic_homework h on h.id = a.homework_id join topics t on t.id = h.topic_id
 where t.kind = 'lesson' and h.grade_scale = 'five' and r.score is not null
 group by 1 order by 1;

\echo '=== 4. Что пересчёт НЕ тронет и что требует глаз (ожидается 0 в каждой строке)'
select 'проверочная/контрольная со 100-балльной (останется 100)' as what, count(*) as n
  from topic_homework h join topics t on t.id = h.topic_id
 where t.kind in ('check', 'control') and h.grade_scale = 'hundred'
union all
select '5-балльная проверочная/контрольная с оценкой 0 или 1 (останется, новых таких не будет)', count(*)
  from topic_homework_reviews r join topic_homework_attempts a on a.id = r.attempt_id
  join topic_homework h on h.id = a.homework_id join topics t on t.id = h.topic_id
 where t.kind in ('check', 'control') and h.grade_scale = 'five' and r.score is not null and r.score not between 2 and 5
union all
select 'урок/5-балльная с баллом больше 5 (×20 не применится)', count(*)
  from topic_homework_reviews r join topic_homework_attempts a on a.id = r.attempt_id
  join topic_homework h on h.id = a.homework_id join topics t on t.id = h.topic_id
 where t.kind = 'lesson' and h.grade_scale = 'five' and r.score > 5
union all
select '5-балльная проверочная/контрольная с баллом больше 5 (останется как есть)', count(*)
  from topic_homework_reviews r join topic_homework_attempts a on a.id = r.attempt_id
  join topic_homework h on h.id = a.homework_id join topics t on t.id = h.topic_id
 where t.kind in ('check', 'control') and h.grade_scale = 'five' and r.score > 5;

\echo '=== 5. Побочный эффект: баллы школы (§255/§257, правило hw_grade) по последнему «принято» урок/5-балльных'
\echo '    оценка 5: было 10, станет 6 · оценка 4: было 6, останется 6 · оценки 3 и 2: было 0, станет 6'
with last_accept as (
  select distinct on (a.homework_id, a.student_id) a.student_id, r.score
    from topic_homework_reviews r
    join topic_homework_attempts a on a.id = r.attempt_id
    join topic_homework h on h.id = a.homework_id
    join topics t on t.id = h.topic_id
   where t.kind = 'lesson' and h.grade_scale = 'five' and r.decision = 'accepted'
   order by a.homework_id, a.student_id, r.created_at desc
)
select count(distinct student_id) as students,
       count(*) filter (where score = 5) as grade5,
       count(*) filter (where score = 4) as grade4,
       count(*) filter (where score is not null and score < 4) as grade_below4,
       sum(6 - case when score = 5 then 10 when score = 4 then 6 when score is not null then 0 else 6 end) as points_delta_total,
       min(6 - case when score = 5 then 10 when score = 4 then 6 when score is not null then 0 else 6 end) as worst_row_delta
  from last_accept;
