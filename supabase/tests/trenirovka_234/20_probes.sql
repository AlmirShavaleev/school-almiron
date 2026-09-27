-- §234. Пробы после PENDING_234 (дважды). Каждая запись — в откатываемом
-- блоке; роль authenticated + request.jwt.claims отдельным оператором (§29.4).
\pset footer off
\set O  '00000000-0000-4000-8000-0000000000a0'
\set T1 '00000000-0000-4000-8000-000000070001'
\set T2 '00000000-0000-4000-8000-000000070002'

\echo '=== 0. Старые строки прошли новые CHECK: все материалы на дорожке ege'
select track, count(*) from topic_material_items group by track;

\echo '=== 1. Загрузка тренировки в каркас (как загрузчик: service role, по подтеме за запрос)'
insert into topic_material_items (topic_id, kind, title, storage_path, file_name, mime_type, position, section, created_by, track, subtopic_code, subtopic_title)
select t.topic_id, 'file', r.label || ' · ' || t.code, 'tpl/' || t.code || '/' || r.pos || '.pdf', r.pos || '.pdf', 'application/pdf',
       r.pos, r.section, :'O', 'training', t.code, t.title
  from (values (:'T1'::uuid, '1.14', 'Свободное падение'), (:'T1'::uuid, '1.15', 'Путь в n-ю секунду'),
               (:'T1'::uuid, '1.17', 'Горизонтальный бросок'), (:'T2'::uuid, '1.5', 'Сложение скоростей')) t(topic_id, code, title),
       (values (0, 'theory', 'Теория'), (1, 'tasks', 'Список задач'), (2, 'worksheet_tasks', 'Рабочий лист'),
               (3, 'task_solution', 'Решения'), (4, 'homework_tasks', 'ДЗ · список задач'),
               (5, 'worksheet_homework', 'ДЗ · рабочий лист'), (6, 'solution', 'ДЗ · решения')) r(pos, section, label);

\echo '=== 2. Синхронизация донесла дорожку и подтему до обеих копий (по 21 + 7 строк тренировки в каждом курсе)'
select c.title as course, i.track, count(*) as rows, count(distinct i.subtopic_code) as subtopics,
       count(*) filter (where i.source_item_id is not null) as from_template
  from topic_material_items i join topics t on t.id = i.topic_id join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 group by 1, 2 order by 1, 2;

\echo '=== 3. Правка подтемы в каркасе уезжает в копии (UPDATE + IS DISTINCT FROM)'
begin;
update topic_material_items set subtopic_title = 'Горизонтальный бросок (новое)' where topic_id = :'T1' and subtopic_code = '1.17' and section = 'theory';
select c.title, i.subtopic_title from topic_material_items i join topics t on t.id = i.topic_id join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 where i.subtopic_code = '1.17' and i.section = 'theory' order by 1;
rollback;

\echo '=== 4. CHECK: тренировка без номера подтемы — отказ'
insert into topic_material_items (topic_id, kind, title, storage_path, section, created_by, track) values (:'T1', 'file', 'x', 'x', 'theory', :'O', 'training');
\echo '=== 4b. CHECK: «ДЗ · список задач» на дорожке ege — отказ'
insert into topic_material_items (topic_id, kind, title, storage_path, section, created_by) values (:'T1', 'file', 'x', 'x', 'homework_tasks', :'O');
\echo '=== 4c. CHECK: неизвестная дорожка — отказ'
insert into topic_material_items (topic_id, kind, title, storage_path, section, created_by, track, subtopic_code) values (:'T1', 'file', 'x', 'x', 'theory', :'O', 'extra', '1.1');

\echo '=== 5. «Тема пройдена»: тема 2 класса 1 — у ученика 1 отметки Теория+Урок, ДЗ нет.'
\echo '       Тренировка добавила теме рабочий лист ДЗ и решения — пройдена всё равно (track=ege в topic_done_events)'
select c.title, t.title, e.student_id is not null as done
  from topics t join modules m on m.id = t.module_id join courses c on c.id = m.course_id
  left join topic_done_events() e on e.topic_id = t.id and e.student_id = '00000000-0000-4000-8000-0000000001b1'
 where c.id = '00000000-0000-4000-8000-0000000c0001' order by t.order_index;
\echo '=== 5b. Контроль: если бы тренировка считалась (те же строки на ege), тема 2 пройденной бы НЕ была'
begin;
alter table topic_material_items drop constraint topic_material_items_homework_tasks_training_check;
alter table topic_material_items disable trigger template_sync_material_write;
update topic_material_items set track = 'ege' where track = 'training';
select t.title, e.student_id is not null as done
  from topics t join modules m on m.id = t.module_id
  left join topic_done_events() e on e.topic_id = t.id and e.student_id = '00000000-0000-4000-8000-0000000001b1'
 where m.course_id = '00000000-0000-4000-8000-0000000c0001' order by t.order_index;
rollback;

-- ── под учеником 1 ──────────────────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', false) \g /dev/null

\echo '=== 6. Ученик 1 (ДЗ курса не принято): решение ДЗ курса закрыто гейтом, решения тренировки видны сразу'
select i.track, i.section, count(*) from topic_material_items i
  join topics t on t.id = i.topic_id where t.source_topic_id = :'T1'
 group by 1, 2 order by 1, 2;
\echo '=== 6b. Файлы: решение тренировки — виден, решение ДЗ курса — нет (topic_material_object_visible)'
select public.topic_material_object_visible('tpl/1.14/6.pdf') as training_solution,
       public.topic_material_object_visible('tpl1/reshenie.pdf') as course_solution,
       public.topic_material_object_visible('tpl/1.14/0.pdf') as training_theory;
\echo '=== 6c. topic_solution_state: плашка «закрыто» — только про решение ДЗ курса (тема 2: решение есть лишь у тренировки)'
select t.title, public.topic_solution_state(t.id) from topics t join modules m on m.id = t.module_id
 where m.course_id = '00000000-0000-4000-8000-0000000c0001' order by t.order_index;

\echo '=== 7. Ученик 1 скрыть подтему не может (RLS insert)'
begin;
insert into topic_subtopic_hidden (topic_id, subtopic_code)
select t.id, '1.15' from topics t where t.source_topic_id = :'T1' and t.module_id in (select id from modules where course_id = '00000000-0000-4000-8000-0000000c0001');
rollback;
\echo '=== 7b. …и снять чужое скрытие тоже (строк удалено — 0; скрытий пока нет, проверяется в 9b)'
reset role;

-- ── под преподавателем класса 1 ─────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
\echo '=== 8. Преподаватель 1 скрывает 1.15 в теме своего класса — можно'
insert into topic_subtopic_hidden (topic_id, subtopic_code)
select t.id, '1.15' from topics t join modules m on m.id = t.module_id
 where t.source_topic_id = :'T1' and m.course_id = '00000000-0000-4000-8000-0000000c0001'
returning subtopic_code, hidden_by;
\echo '=== 8b. hidden_by чужим именем — отказ'
begin;
insert into topic_subtopic_hidden (topic_id, subtopic_code, hidden_by)
select t.id, '1.14', '00000000-0000-4000-8000-0000000000a0' from topics t join modules m on m.id = t.module_id
 where t.source_topic_id = :'T1' and m.course_id = '00000000-0000-4000-8000-0000000c0001';
rollback;
\echo '=== 8c. Преподаватель 1 не может скрыть подтему в классе 2'
begin;
insert into topic_subtopic_hidden (topic_id, subtopic_code)
select t.id, '1.15' from topics t join modules m on m.id = t.module_id
 where t.source_topic_id = :'T1' and m.course_id = '00000000-0000-4000-8000-0000000c0002';
rollback;
reset role;

-- ── снова ученик 1 и ученик 2 ───────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', false) \g /dev/null
\echo '=== 9. Ученик 1: подтема 1.15 скрыта — её строк нет; скрытие он читает'
select i.subtopic_code, count(*) from topic_material_items i join topics t on t.id = i.topic_id
 where t.source_topic_id = :'T1' and i.track = 'training' group by 1 order by 1;
select subtopic_code from topic_subtopic_hidden;
\echo '=== 9b. Ученик 1 снять скрытие не может (удалено строк)'
with d as (delete from topic_subtopic_hidden returning 1) select count(*) as deleted from d;
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
\echo '=== 10. Ученик 2 (класс 2): скрытие класса 1 его не касается — 1.15 видна; чужого скрытия не читает'
select i.subtopic_code, count(*) from topic_material_items i join topics t on t.id = i.topic_id
 where t.source_topic_id = :'T1' and i.track = 'training' group by 1 order by 1;
select count(*) as hidden_rows_visible from topic_subtopic_hidden;
reset role;

-- ── посторонний преподаватель ───────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', false) \g /dev/null
\echo '=== 11. Посторонний преподаватель: не читает, не пишет, не удаляет'
select count(*) as hidden_rows_visible from topic_subtopic_hidden;
begin;
insert into topic_subtopic_hidden (topic_id, subtopic_code)
select t.id, '1.14' from topics t join modules m on m.id = t.module_id
 where t.source_topic_id = :'T1' and m.course_id = '00000000-0000-4000-8000-0000000c0001';
rollback;
with d as (delete from topic_subtopic_hidden returning 1) select count(*) as deleted from d;
reset role;

\echo '=== 12. Синхронизация каркаса скрытие не трогает: правка в каркасе, скрытие класса 1 на месте'
update topic_material_items set title = title || ' ' where topic_id = :'T1' and subtopic_code = '1.15' and section = 'theory';
select count(*) as hidden_after_sync from topic_subtopic_hidden;
update topic_material_items set title = rtrim(title) where topic_id = :'T1' and subtopic_code = '1.15' and section = 'theory';

\echo '=== 13. Преподаватель 1 снимает скрытие — можно'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
begin;
with d as (delete from topic_subtopic_hidden returning subtopic_code) select * from d;
rollback;
reset role;

\echo '=== 14. Копирование темы (course_copy_topic_content, тема 2 каркаса в чужой курс) несёт дорожку и подтему'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a0","role":"authenticated"}', true) \g /dev/null
insert into modules (id, course_id, title) values ('00000000-0000-4000-8000-0000000e00ff', '00000000-0000-4000-8000-0000000c000f', 'М');
insert into topics (id, module_id, title) values ('00000000-0000-4000-8000-0000000700ff', '00000000-0000-4000-8000-0000000e00ff', 'копия');
select public.course_copy_topic_content(:'T2', '00000000-0000-4000-8000-0000000700ff', 'clear', 0) \g /dev/null
select track, count(*), count(distinct subtopic_code) as subtopics, count(*) filter (where section = 'homework_tasks') as hw_tasks
  from topic_material_items where topic_id = '00000000-0000-4000-8000-0000000700ff' group by 1 order by 1;
rollback;

\echo '=== 15. «Неоткрытые материалы» у владельца считают только материалы курса (без 1 449 файлов задачника)'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a0","role":"authenticated"}', false) \g /dev/null
select topic_title, course_title, total_items from public.school_unopened_materials(20) order by course_title, topic_title;
reset role;
