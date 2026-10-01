-- §249. Данные для проб журнала — ПОВЕРХ 10_data_241.sql (выдуманные, не прод).
-- Новая проверочная R в 10А (пятибалльная, закрылась два дня назад) — пересдачи и возвраты:
--   S1 — 1-я попытка возвращена, 2-я принята на 4          → reviewed 4, попытка №2
--   S2 — 1-я попытка возвращена, новой нет                 → returned, балла нет
--   S3 — 1-я возвращена, 2-я — черновик                    → draft («—»)
--   S4 — одна попытка: вернули, потом приняли как есть на 3 → reviewed 3 (последний вердикт)
--   S5 — 1-я возвращена, 2-я сдана, вердикта нет            → submitted («ждёт»), попытка №2
--   S6 — не сдавал                                          → none
-- Плюс тема-урок с ДЗ и оценкой (в журнал не попадает) — уже есть: L (без попыток);
-- U — контрольная с НЕопубликованным ДЗ (в журнал не попадает).
insert into topics (id, module_id, title, order_index) values
  ('00000000-0000-4000-8000-0000007a0009', '00000000-0000-4000-8000-0000000e0002', 'R: Проверочная с пересдачами', 9);
insert into topic_homework (id, topic_id, title, is_published, created_by, grade_scale) values
  ('00000000-0000-4000-8000-0000000d0009', '00000000-0000-4000-8000-0000007a0009', 'Работа R', true, '00000000-0000-4000-8000-0000000000a1', 'five');

-- Первые попытки S1..S5, сданы.
insert into topic_homework_attempts (id, homework_id, student_id)
select ('00000000-0000-4000-8000-0000009a000' || n)::uuid, '00000000-0000-4000-8000-0000000d0009',
       ('00000000-0000-4000-8000-0000000001b' || n)::uuid
  from generate_series(1, 5) n;
update topic_homework_attempts set status = 'submitted', submitted_at = now() - interval '3 days'
 where homework_id = '00000000-0000-4000-8000-0000000d0009';

-- Возврат всем пятерым (отдельная строка вердикта, балла нет).
insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score, created_at)
select a.id, '00000000-0000-4000-8000-0000000000a1', 'returned_for_revision', 'Перепиши №3', null, now() - interval '2 days 20 hours'
  from topic_homework_attempts a where a.homework_id = '00000000-0000-4000-8000-0000000d0009';
update topic_homework_attempts set status = 'returned_for_revision'
 where homework_id = '00000000-0000-4000-8000-0000000d0009';

-- S4: приняли возвращённую как есть — вторая строка вердикта у той же попытки.
select set_config('app.topic_homework_revise', '00000000-0000-4000-8000-0000009a0004', false);
insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score, created_at) values
  ('00000000-0000-4000-8000-0000009a0004', '00000000-0000-4000-8000-0000000000a1', 'accepted', null, 3, now() - interval '2 days');
update topic_homework_attempts set status = 'accepted' where id = '00000000-0000-4000-8000-0000009a0004';
select set_config('app.topic_homework_revise', '', false);

-- Вторые попытки: S1 (примут на 4), S3 (черновик), S5 (сдана, ждёт).
insert into topic_homework_attempts (id, homework_id, student_id) values
  ('00000000-0000-4000-8000-0000009b0001', '00000000-0000-4000-8000-0000000d0009', '00000000-0000-4000-8000-0000000001b1'),
  ('00000000-0000-4000-8000-0000009b0003', '00000000-0000-4000-8000-0000000d0009', '00000000-0000-4000-8000-0000000001b3'),
  ('00000000-0000-4000-8000-0000009b0005', '00000000-0000-4000-8000-0000000d0009', '00000000-0000-4000-8000-0000000001b5');
update topic_homework_attempts set status = 'submitted', submitted_at = now() - interval '1 day'
 where id in ('00000000-0000-4000-8000-0000009b0001', '00000000-0000-4000-8000-0000009b0005');
insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score, created_at) values
  ('00000000-0000-4000-8000-0000009b0001', '00000000-0000-4000-8000-0000000000a1', 'accepted', null, 4, now() - interval '12 hours');
update topic_homework_attempts set status = 'accepted' where id = '00000000-0000-4000-8000-0000009b0001';

-- Тип и окно (после попыток — как в 10_data_241).
update topics set kind = 'check' where id = '00000000-0000-4000-8000-0000007a0009';
update topic_homework set opens_at = now() - interval '3 days 1 hour', closes_at = now() - interval '3 days'
 where id = '00000000-0000-4000-8000-0000000d0009';
