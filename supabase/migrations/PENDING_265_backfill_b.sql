-- §265, пересчёт, часть B. НЕ ПРИМЕНЕНО: ждёт решения владельца по баллам школы (§255/§257) — после ×20 за «5» будет 6
-- баллов вместо 10, за «3»/«2» — 6 вместо 0. Шаги 2–4 уже применены (20261004112036).
-- §265 — пересчёт старых ДЗ под шкалы и NOT NULL на topic_homework.grade_scale.
--
-- НЕ ПРИМЕНЕНО. Применяет оркестратор через MCP apply_migration одной транзакцией СЛЕДОМ за PENDING_265.sql и
-- после пробы «что изменится» (supabase/tests/shkaly_265/prod_before.sql). Повторяемый: второй прогон находит
-- ноль строк в каждом шаге (на чистых данных — ничего не меняет) и снова ставит уже стоящий NOT NULL.
--
-- Шаги (решение владельца 04.10, вкладка «В» макета maket_bally.html):
--   1. ДЗ к уроку с 5-балльной шкалой → 100-балльная, выставленные оценки ×20 (5→100, 4→80, 3→60, 2→40).
--      Пересчитываются ВСЕ строки истории вердиктов этих ДЗ с баллом, не только последние: история должна
--      читаться в одной шкале.
--   2. ДЗ к уроку без шкалы → 100-балльная. Оценки не трогаем: «принято без балла» так и остаётся без балла
--      (в средний не входит, как и раньше).
--   3. Проверочная и контрольная без шкалы → 5-балльная.
--   4. grade_scale NOT NULL — последним шагом.
--
-- Почему триггеры выключены на время пересчёта (и включены обратно в той же транзакции):
--   * topic_homework_reviews_immutable_trg — история вердиктов неизменяема для всех, кроме этого пересчёта;
--   * topic_homework_grade_scale_trg (§265) — он запрещает менять шкалу ДЗ с оценками, а шаг 1 делает именно это
--     (вместе с пересчётом оценок, так что запрет здесь не про нас);
--   * topic_homework_reviews_scale_trg (§265) — оценки 40..100 пишутся, пока шкала ДЗ ещё five (порядок шагов
--     ниже нужен для повторяемости), а проверка 2..5 смотрит на шкалу ДЗ;
--   * template_sync_homework_write (§172) — каждая правленая строка каркаса гоняла бы синхронизацию всей темы во
--     все классы; пересчёт и так проходит по всем строкам, каркасным и классным, одним правилом.
-- ALTER TABLE ... DISABLE TRIGGER берёт короткую исключительную блокировку таблицы до конца транзакции.

alter table public.topic_homework          disable trigger topic_homework_grade_scale_trg;
alter table public.topic_homework          disable trigger template_sync_homework_write;
alter table public.topic_homework_reviews  disable trigger topic_homework_reviews_immutable_trg;
alter table public.topic_homework_reviews  disable trigger topic_homework_reviews_scale_trg;

-- ══ 1. Урок, 5-балльная → 100-балльная, оценки ×20 ═════════════════════════════════════════════════
-- Сначала оценки (их ДЗ находим по шкале five), потом сама шкала: повторный прогон шкалы five у уроков уже не
-- найдёт и второй раз оценки не умножит. Страховка от двойного умножения — ещё и «балл 0..5».
update public.topic_homework_reviews r
   set score = r.score * 20
  from public.topic_homework_attempts a
  join public.topic_homework h on h.id = a.homework_id
  join public.topics t on t.id = h.topic_id
 where a.id = r.attempt_id
   and t.kind = 'lesson'
   and h.grade_scale = 'five'
   and r.score is not null
   and r.score between 0 and 5;

update public.topic_homework h
   set grade_scale = 'hundred'
  from public.topics t
 where t.id = h.topic_id
   and t.kind = 'lesson'
   and h.grade_scale = 'five';

alter table public.topic_homework          enable trigger topic_homework_grade_scale_trg;
alter table public.topic_homework          enable trigger template_sync_homework_write;
alter table public.topic_homework_reviews  enable trigger topic_homework_reviews_immutable_trg;
alter table public.topic_homework_reviews  enable trigger topic_homework_reviews_scale_trg;

-- ══ 4. Шкала обязательна ═══════════════════════════════════════════════════════════════════════════
-- NOT NULL уже стоит (20261004112036).
