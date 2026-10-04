-- §265. Пробы после PENDING_265 (дважды) и PENDING_265_backfill (дважды). Записи — в откатываемых блоках;
-- роль authenticated + request.jwt.claims отдельным оператором (§29.4). Под владельцем таблиц (postgres)
-- RLS не проверяется — пробы прав только под authenticated.
\pset footer off
\set ON_ERROR_STOP 0
\set ON_ERROR_ROLLBACK on
\set O  '00000000-0000-4000-8000-0000000000a0'
\set A  '00000000-0000-4000-8000-0000000000a1'
\set S1 '00000000-0000-4000-8000-0000000000b1'
\set TT '00000000-0000-4000-8000-000000070001'
\set TQ '00000000-0000-4000-8000-000000070002'
\set HTT '00000000-0000-4000-8000-0000000d0000'
\set TL0 '00000000-0000-4000-8000-0000007a0001'
\set TL5 '00000000-0000-4000-8000-0000007a0002'
\set TLH '00000000-0000-4000-8000-0000007a0003'
\set TQ5 '00000000-0000-4000-8000-0000007a0004'
\set TKN '00000000-0000-4000-8000-0000007a0005'
\set TLE '00000000-0000-4000-8000-0000007a0006'
\set TQE '00000000-0000-4000-8000-0000007a0007'
\set HL0 '00000000-0000-4000-8000-0000000d0001'
\set HL5 '00000000-0000-4000-8000-0000000d0002'
\set HLH '00000000-0000-4000-8000-0000000d0003'
\set HQ5 '00000000-0000-4000-8000-0000000d0004'
\set HKN '00000000-0000-4000-8000-0000000d0005'
\set M1  '00000000-0000-4000-8000-0000000e0001'

\echo '=== 0. После пересчёта: шкала у каждого ДЗ по типу темы, grade_scale NOT NULL'
select c.is_template as tpl, t.title, t.kind, h.grade_scale
  from topic_homework h join topics t on t.id = h.topic_id
  join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 order by c.is_template desc, t.order_index, t.title;
select attnotnull as grade_scale_not_null from pg_attribute
 where attrelid = 'public.topic_homework'::regclass and attname = 'grade_scale';

\echo '=== 1. Пересчёт ×20: урок L5 — 4→80, 5→100, 3→60; «вернули на доработку» без балла; L0 «принято без балла» — без балла; Q5 — 2 и 5 как были'
select t.title, p.full_name as student, r.decision, r.score
  from topic_homework_reviews r join topic_homework_attempts a on a.id = r.attempt_id
  join topic_homework h on h.id = a.homework_id join topics t on t.id = h.topic_id
  join students s on s.id = a.student_id join profiles p on p.id = s.profile_id
 order by t.order_index, p.full_name, r.created_at;

\echo '=== 2. Новое ДЗ (преподаватель, как клиент): шкала по типу темы'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
insert into topic_homework (topic_id, title, created_by) values (:'TLE', 'урок, шкала не указана', :'A') returning title, grade_scale;
rollback;
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
insert into topic_homework (topic_id, title, created_by, grade_scale) values (:'TLE', 'урок, учитель выбрал 5-балльную', :'A', 'five') returning title, grade_scale;
rollback;
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
insert into topic_homework (topic_id, title, created_by, grade_scale) values (:'TQE', 'проверочная, прислали hundred', :'A', 'hundred') returning title, grade_scale;
rollback;
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
insert into topic_homework (topic_id, title, created_by) values (:'TQE', 'проверочная, шкала не указана', :'A') returning title, grade_scale;
rollback;

\echo '=== 3. Правка шкалы: урок без оценок — меняется; null (старый клиент «без баллов») → hundred; у проверочной — только five'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
update topic_homework set grade_scale = 'five' where id = :'HL0' returning 'L0 (принято без балла) → five' as what, grade_scale;
update topic_homework set grade_scale = null where id = :'HL0' returning 'L0 → null' as what, grade_scale;
update topic_homework set grade_scale = 'hundred' where id = :'HKN' returning 'KN (контрольная, работ нет) → hundred' as what, grade_scale;
rollback;

\echo '=== 4. Шкалу ДЗ с выставленными оценками сменить нельзя: LH (86 из 100) → five — ошибка; Q5 → hundred — остаётся five (проверочная); правка без шкалы проходит'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
update topic_homework set grade_scale = 'five' where id = :'HLH';
update topic_homework set grade_scale = 'hundred' where id = :'HQ5' returning 'Q5 → hundred' as what, grade_scale;
update topic_homework set title = 'ДЗ LH (переименовано)' where id = :'HLH' returning 'правка без шкалы проходит' as what, title, grade_scale;
rollback;

\echo '=== 5. Оценка 5-балльной: 1 и 0 → ошибка, 4 → ок (проверочная Q5, работа S3); прямая вставка 1 мимо функции → ошибка'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
select topic_homework_review_attempt('00000000-0000-4000-8000-00000c040003', 'accepted', 'Единица', 1);
select topic_homework_review_attempt('00000000-0000-4000-8000-00000c040003', 'accepted', 'Ноль', 0);
insert into topic_homework_reviews (attempt_id, reviewer_id, decision, comment, score)
values ('00000000-0000-4000-8000-00000c040003', :'A', 'accepted', 'мимо функции', 1);
select topic_homework_review_attempt('00000000-0000-4000-8000-00000c040003', 'accepted', 'Хорошо', 4) is not null as accepted_4;
select a.status, r.score from topic_homework_attempts a join topic_homework_reviews r on r.attempt_id = a.id
 where a.id = '00000000-0000-4000-8000-00000c040003';
rollback;

\echo '=== 6. Урок, учитель выбрал 5-балльную: 1 → ошибка, «на доработку» без балла → ок; 100-балльный урок: 86 → ок, 101 → ошибка'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
update topic_homework set grade_scale = 'five' where id = :'HL0' returning grade_scale;
select topic_homework_review_attempt('00000000-0000-4000-8000-00000c010002', 'accepted', 'Единица', 1);
select topic_homework_review_attempt('00000000-0000-4000-8000-00000c010002', 'returned_for_revision', 'Исправь', null) is not null as returned_ok;
rollback;
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
select topic_homework_review_attempt('00000000-0000-4000-8000-00000c010002', 'accepted', 'Слишком', 101);
select topic_homework_review_attempt('00000000-0000-4000-8000-00000c010002', 'accepted', 'Хорошо', 86) is not null as accepted_86;
rollback;

\echo '=== 7. Копирование темы (topic_copy_stage → course_copy_topic_content, путь и копирования курса): проверочная → five, урок → hundred'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a0","role":"authenticated"}', false) \g /dev/null
select (topic_copy_stage(:'TQ5', :'M1', 'clear', 0))->>'topic_id' as q_copy \gset
select (topic_copy_stage(:'TL5', :'M1', 'clear', 0))->>'topic_id' as l_copy \gset
select t.title, t.kind, h.grade_scale from topics t join topic_homework h on h.topic_id = t.id
 where t.id in (:'q_copy', :'l_copy') order by t.kind;
rollback;

\echo '=== 8. Каркас → класс: правка материалов и названия ДЗ каркаса НЕ затирает 5-балльную, выбранную в классе'
-- Правит классную копию владелец: копию ДЗ завёл он (created_by), а политика записи topic_homework требует
-- created_by = auth.uid() (20260805215100) — преподаватель класса чужую строку ДЗ не правит и до §265.
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a0","role":"authenticated"}', false) \g /dev/null
update topic_homework set grade_scale = 'five'
 where topic_id = (select id from topics where source_topic_id = :'TT' and module_id in (select id from modules where course_id = '00000000-0000-4000-8000-0000000c0001'))
returning 'класс выбрал' as what, grade_scale;
insert into topic_material_items (topic_id, kind, title, storage_path, file_name, mime_type, position, section, created_by)
values (:'TT', 'file', 'Новый конспект', 'tpl/tt/notes2.pdf', 'notes2.pdf', 'application/pdf', 5, 'notes', :'O');
update topic_homework set title = 'ДЗ каркаса (новое название)' where id = :'HTT';
select c.is_template as tpl, h.title, h.grade_scale,
       (select count(*) from topic_material_items i where i.topic_id = t.id and i.title = 'Новый конспект') as new_material
  from topic_homework h join topics t on t.id = h.topic_id join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 where t.id = :'TT' or t.source_topic_id = :'TT' order by c.is_template desc;
rollback;

\echo '=== 9. Каркас → класс: шкалу поменяли В КАРКАСЕ — доезжает до класса'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a0","role":"authenticated"}', false) \g /dev/null
update topic_homework set grade_scale = 'five' where id = :'HTT';
select c.is_template as tpl, h.grade_scale
  from topic_homework h join topics t on t.id = h.topic_id join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 where t.id = :'TT' or t.source_topic_id = :'TT' order by c.is_template desc;
rollback;

\echo '=== 10. Каркас: урок стал проверочной — шкала five в каркасе и в классе; новая тема-проверочная каркаса — копия в классе five'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a0","role":"authenticated"}', false) \g /dev/null
update topics set kind = 'check' where id = :'TT';
insert into topics (id, module_id, title, order_index, kind)
values ('00000000-0000-4000-8000-000000070003', '00000000-0000-4000-8000-0000000e0000', 'TK: Контрольная каркаса (новая)', 3, 'control');
insert into topic_homework (topic_id, title, created_by, grade_scale)
values ('00000000-0000-4000-8000-000000070003', 'Контрольная каркаса', :'O', 'hundred');
select c.is_template as tpl, t.title, t.kind, h.grade_scale
  from topic_homework h join topics t on t.id = h.topic_id join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 where t.id in (:'TT', '00000000-0000-4000-8000-000000070003')
    or t.source_topic_id in (:'TT', '00000000-0000-4000-8000-000000070003')
 order by t.title, c.is_template desc;
rollback;

\echo '=== 11. Смена типа темы в классе: без оценок — шкала следом; с оценками — остаётся'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
update topics set kind = 'check'   where id = :'TL0';   -- урок, оценок нет (принято без балла) → five
update topics set kind = 'control' where id = :'TLH';   -- урок с оценкой 86 → останется hundred
update topics set kind = 'lesson'  where id = :'TQ5';   -- проверочная с оценками 2 и 5 → останется five
update topics set kind = 'lesson'  where id = :'TKN';   -- контрольная без работ → hundred
select t.title, t.kind, h.grade_scale from topics t join topic_homework h on h.topic_id = t.id
 where t.id in (:'TL0', :'TLH', :'TQ5', :'TKN') order by t.order_index;
rollback;

\echo '=== 12. Права: ученик шкалу не меняет (0 строк), ДЗ не создаёт и оценку себе не пишет (ошибки)'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', false) \g /dev/null
update topic_homework set grade_scale = 'five' where id = :'HL0' returning id;
select count(*) as student_updated_rows from topic_homework where id = :'HL0' and grade_scale = 'five';
insert into topic_homework (topic_id, title, created_by) values (:'TLE', 'ученик', :'S1');
insert into topic_homework_reviews (attempt_id, reviewer_id, decision, score)
values ('00000000-0000-4000-8000-00000c010002', :'S1', 'accepted', 100);
rollback;
reset role;
select h.grade_scale as l0_scale_after_student from topic_homework h where h.id = :'HL0';

\echo '=== 13. Пересчёт повторяемый: второй прогон ничего не умножил (L5 — 60, 80, 100)'
select r.score from topic_homework_reviews r join topic_homework_attempts a on a.id = r.attempt_id
 where a.homework_id = :'HL5' and r.score is not null order by r.score;
