-- §266. Пробы прав и поведения задач с автопроверкой. Пишущие пробы прав — в откатываемых блоках;
-- «путь ученика» (ответы, итог в журнал) идёт по шагам и остаётся — следующие блоки опираются на него.
\set ON_ERROR_STOP 0
\pset null '∅'
\set O   '00000000-0000-4000-8000-0000000000a0'
\set A   '00000000-0000-4000-8000-0000000000a1'
\set X   '00000000-0000-4000-8000-0000000000a9'
\set S1  '00000000-0000-4000-8000-0000000000b1'
\set S2  '00000000-0000-4000-8000-0000000000b2'
\set S3  '00000000-0000-4000-8000-0000000000b3'
\set S4  '00000000-0000-4000-8000-0000000000b4'
\set TT0 '00000000-0000-4000-8000-000000070001'
\set TQ0 '00000000-0000-4000-8000-000000070002'
\set TT1 '00000000-0000-4000-8000-0000007a0001'
\set LH  '00000000-0000-4000-8000-0000007a0002'
\set LE  '00000000-0000-4000-8000-0000007a0003'
\set TX  '00000000-0000-4000-8000-0000007a0009'
\set M1  '00000000-0000-4000-8000-0000000e0001'
\set C1  '00000000-0000-4000-8000-0000000c0001'

\echo '=== 0. Сравнение ответа (чистые функции): число — запятая/точка, пробелы, «−», допуск; цифры — порядок'
select x.raw, public.autocheck_number_of(x.raw) as number_of
  from (values ('100'), ('100,0'), (' 1 200,5 '), (E'− 12,5'), ('-12.5'), ('+3'), ('.5'), ('5.'), ('1e3'), ('12 м'), (''), ('abc')) as x(raw);
select x.raw, public.autocheck_digits_of(x.raw) as digits_of
  from (values ('13'), ('1 3'), ('1,3;4'), ('1.3'), ('13а'), ('')) as x(raw);
select x.typ, x.val, x.tol, x.txt, x.any_order, x.raw,
       public.autocheck_answer_correct(x.typ, x.val, x.tol, x.txt, x.any_order, x.raw) as correct
  from (values
    ('number', 100::numeric, 0::numeric, null::text, false, '100,0'),
    ('number', 100, 0, null, false, '100,01'),
    ('number', 2.5, 0.05, null, false, '2,54'),
    ('number', 2.5, 0.05, null, false, '2,56'),
    ('number', 2.5, 0.05, null, false, '2,45'),
    ('number', -12.5, 0, null, false, E'−12,5'),
    ('number', 100, 0, null, false, 'сто'),
    ('digits', null, 0, '31', true,  '13'),
    ('digits', null, 0, '31', false, '13'),
    ('digits', null, 0, '31', false, '3 1'),
    ('digits', null, 0, '122', true, '212'),
    ('digits', null, 0, '122', true, '12'),
    ('digits', null, 0, '31', true,  'тридцать')
  ) as x(typ, val, tol, txt, any_order, raw);

\echo '=== 1. Загрузка в урок КАРКАСА под сервисным ключом (без auth.uid): задачи уезжают в урок-копию класса'
select set_config('request.jwt.claims', '{"role":"service_role"}', false) \g /dev/null
select public.topic_autocheck_import(:'TT0', '[
  {"code":"1.4.1-Д-01","position":1,"statement_path":"physics-new/1.4.1/01-statement.svg","solution_path":"physics-new/1.4.1/01-solution.svg","answer_type":"number","answer_value":100,"answer_tol":0,"unit":"м"},
  {"code":"1.4.1-Д-02","position":2,"statement_path":"physics-new/1.4.1/02-statement.svg","solution_path":"physics-new/1.4.1/02-solution.svg","answer_type":"number","answer_value":8,"unit":"мин"},
  {"code":"1.4.1-Д-03","position":3,"statement_path":"physics-new/1.4.1/03-statement.svg","solution_path":"physics-new/1.4.1/03-solution.svg","answer_type":"number","answer_value":-12.5,"answer_tol":0.05,"unit":"м/с"},
  {"code":"1.4.1-Д-04","position":4,"statement_path":"physics-new/1.4.1/04-statement.svg","solution_path":"physics-new/1.4.1/04-solution.svg","answer_type":"digits","answer_text":"31","digits_any_order":true}
]'::jsonb) as import_template;
select set_config('request.jwt.claims', '{}', false) \g /dev/null
select c.title as course, t.title, t.lesson_format,
       (select count(*) from topic_autocheck_tasks k where k.topic_id = t.id) as tasks,
       (select count(*) from topic_autocheck_tasks k where k.topic_id = t.id and k.source_task_id is not null) as with_lineage
  from topics t join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 where t.id in (:'TT0', :'TT1') order by c.is_template desc;
\echo '--- ДЗ-носитель: в каркасе не выдан (каркас не выдаётся), в классе выдан сразу (тема открыта) — §243'
select c.is_template, h.title, h.autocheck, h.grade_scale, h.is_published, h.published_via,
       (h.source_homework_id is not null) as has_source
  from topic_homework h join topics t on t.id = h.topic_id join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 where h.topic_id in (:'TT0', :'TT1') order by c.is_template desc;
select count(*) as digest_queued_for_class from topic_homework_digest d
  join topic_homework h on h.id = d.homework_id where h.topic_id = :'TT1';
\echo '--- повтор той же загрузки: ничего не меняется'
select public.topic_autocheck_import(:'TT0', '[
  {"code":"1.4.1-Д-01","position":1,"statement_path":"physics-new/1.4.1/01-statement.svg","solution_path":"physics-new/1.4.1/01-solution.svg","answer_type":"number","answer_value":100,"answer_tol":0,"unit":"м"}
]'::jsonb) as import_again;

\echo '=== 2. Загрузка: отказы (anon, ученик, посторонний; урок с настоящим ДЗ; проверочная; кривые ответы)'
begin;
set role anon;
select public.topic_autocheck_import(:'TT1', '[{"code":"x","statement_path":"p","answer_type":"number","answer_value":1}]'::jsonb);
rollback;
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', false) \g /dev/null
select public.topic_autocheck_import(:'TT1', '[{"code":"x","statement_path":"p","answer_type":"number","answer_value":1}]'::jsonb);
rollback;
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', false) \g /dev/null
select public.topic_autocheck_import(:'TT1', '[{"code":"x","statement_path":"p","answer_type":"number","answer_value":1}]'::jsonb);
rollback;
begin;
select public.topic_autocheck_import(:'LH', '[{"code":"x","statement_path":"p","answer_type":"number","answer_value":1}]'::jsonb);
rollback;
begin;
select public.topic_autocheck_import(:'TQ0', '[{"code":"x","statement_path":"p","answer_type":"number","answer_value":1}]'::jsonb);
rollback;
begin;
select public.topic_autocheck_import(:'LE', '[{"code":"x","statement_path":"p","answer_type":"digits","answer_text":"3a"}]'::jsonb);
rollback;
begin;
select public.topic_autocheck_import(:'LE', '[{"code":"x","statement_path":"p","answer_type":"number"}]'::jsonb);
rollback;
\echo '--- персонал курса (преподаватель класса) может загрузить в свой урок'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
select public.topic_autocheck_import(:'LE', '[{"code":"x","position":1,"statement_path":"p","answer_type":"number","answer_value":1}]'::jsonb) as teacher_import;
rollback;

\echo '=== 3. Ученик 1 ДО ответов: видит условия своего урока, эталона и решения — нет'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', false) \g /dev/null
select code, position, answer_type, unit, statement_path from topic_autocheck_tasks order by topic_id, position;
select answer_value from topic_autocheck_tasks limit 1;
select solution_path from topic_autocheck_tasks limit 1;
select * from topic_autocheck_tasks limit 1;
select x->>'code' as code, x->>'answer_value' as answer_value, x->>'answer_text' as answer_text,
       x->>'solution_path' as solution_path, x->>'attempts_left' as left, x->>'closed' as closed
  from jsonb_array_elements(public.topic_autocheck_state(:'TT1')->'tasks') x;
select public.topic_autocheck_object_visible('physics-new/1.4.1/01-statement.svg') as statement_visible,
       public.topic_autocheck_object_visible('physics-new/1.4.1/01-solution.svg') as solution_visible;
\echo '--- каркас и чужой урок — отказ'
select public.topic_autocheck_state(:'TT0');
select public.topic_autocheck_state(:'TX');
\echo '--- писать в таблицы напрямую нельзя'
insert into topic_autocheck_answers (task_id, profile_id, attempt_no, answer_raw, is_correct)
select id, :'S1', 1, '100', true from topic_autocheck_tasks where topic_id = :'TT1' limit 1;
update topic_autocheck_tasks set answer_value = 1;
select public._topic_autocheck_finish(:'TT1', :'S1');
select public.topic_autocheck_task_closed((select id from topic_autocheck_tasks where topic_id = :'TT1' limit 1), :'S1');

\echo '=== 4. Ученик 1 решает: № 1 — ошибка, «не число» (попытка не тратится), верно (запятая); решение открылось'
select id as t1 from topic_autocheck_tasks where topic_id = :'TT1' and code = '1.4.1-Д-01' \gset
select id as t2 from topic_autocheck_tasks where topic_id = :'TT1' and code = '1.4.1-Д-02' \gset
select id as t3 from topic_autocheck_tasks where topic_id = :'TT1' and code = '1.4.1-Д-03' \gset
select id as t4 from topic_autocheck_tasks where topic_id = :'TT1' and code = '1.4.1-Д-04' \gset
select r->>'correct' as correct, r->>'attempts_left' as left, r->>'closed' as closed
  from (select public.topic_autocheck_check(:'t1', '99') as r) q;
select public.topic_autocheck_check(:'t1', 'сто метров');
select r->>'correct' as correct, r->>'attempts_left' as left, r->>'closed' as closed, r->>'grade' as grade
  from (select public.topic_autocheck_check(:'t1', ' 100,0 ') as r) q;
select x->>'code' as code, x->>'answer_value' as answer_value, x->>'solution_path' as solution_path,
       x->>'attempts_used' as used, x->>'closed' as closed, x->'answers' as answers
  from jsonb_array_elements(public.topic_autocheck_state(:'TT1')->'tasks') x where x->>'id' = :'t1';
select public.topic_autocheck_object_visible('physics-new/1.4.1/01-solution.svg') as sol1_visible_now,
       public.topic_autocheck_object_visible('physics-new/1.4.1/02-solution.svg') as sol2_visible;
\echo '--- закрытая задача: ещё ответ — отказ'
select public.topic_autocheck_check(:'t1', '100');
\echo '--- № 2: три ошибки → закрыта, ЧЕТВЁРТОЙ попытки нет'
select r->>'correct' as correct, r->>'attempts_left' as left, r->>'closed' as closed
  from (select public.topic_autocheck_check(:'t2', '7') as r) q;
select r->>'correct' as correct, r->>'attempts_left' as left, r->>'closed' as closed
  from (select public.topic_autocheck_check(:'t2', '9') as r) q;
select r->>'correct' as correct, r->>'attempts_left' as left, r->>'closed' as closed
  from (select public.topic_autocheck_check(:'t2', '480') as r) q;
select public.topic_autocheck_check(:'t2', '8');
select x->>'answer_value' as answer_after_fail, x->>'solution_path' as solution_after_fail
  from jsonb_array_elements(public.topic_autocheck_state(:'TT1')->'tasks') x where x->>'id' = :'t2';
\echo '--- итога ещё нет (закрыты 2 из 4): попытки ДЗ-носителя нет'
select count(*) as carrier_attempts from topic_homework_attempts a join topic_homework h on h.id = a.homework_id where h.topic_id = :'TT1';
\echo '--- № 3: «−12,54» при допуске 0,05 — верно;  № 4: «13» при эталоне «31», порядок не важен — верно → итог'
select r->>'correct' as correct from (select public.topic_autocheck_check(:'t3', E'−12,54') as r) q;
select r->>'correct' as correct, r->>'closed' as closed, r->>'grade' as grade,
       r->'state'->>'finished' as finished, r->'state'->>'solved' as solved, r->'state'->>'total' as total
  from (select public.topic_autocheck_check(:'t4', '1 3') as r) q;

\echo '=== 5. Итог в журнале: принятая попытка ДЗ-носителя, 100-балльная, балл 75 = round(100 × 3/4)'
reset role;
select a.attempt_number, a.status, (a.submitted_at is not null) as submitted, r.decision, r.score, r.comment,
       (r.reviewer_id = :'S1') as reviewer_is_student
  from topic_homework_attempts a
  join topic_homework h on h.id = a.homework_id
  join topic_homework_reviews r on r.attempt_id = a.id
 where h.topic_id = :'TT1';
\echo '--- журнал ДЗ §250 (course_homework_grades) у преподавателя класса — без единой правки функции'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
select x->>'topic_title' as topic, x->>'hw_title' as hw, x->>'grade_scale' as scale, x->>'topic_open' as open
  from jsonb_array_elements(public.course_homework_grades(:'C1')->'homeworks') x;
select c->>'status' as status, c->>'score' as score
  from jsonb_array_elements(public.course_homework_grades(:'C1')->'cells') c
 where c->>'topic_id' = :'TT1';
\echo '--- §243: сводка «новые ДЗ» сдавшему больше не нужна (digest_enqueue пропускает сдавших)'
reset role;
select s.profile_id = :'S1' as is_s1, (a.status <> 'draft') as submitted
  from topic_homework_attempts a join students s on s.id = a.student_id
  join topic_homework h on h.id = a.homework_id where h.topic_id = :'TT1';

\echo '=== 6. Подделать оценку нельзя (ученик 1)'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', false) \g /dev/null
select id as carrier from topic_homework where topic_id = :'TT1' \gset
select id as s1_att from topic_homework_attempts where homework_id = :'carrier' \gset
insert into topic_homework_reviews (attempt_id, reviewer_id, decision, score) values (:'s1_att', :'S1', 'accepted', 100);
update topic_homework_reviews set score = 100 where attempt_id = :'s1_att';
select public.topic_homework_start_attempt(:'carrier');
insert into topic_homework_attempts (homework_id, student_id, attempt_number) values (:'carrier', '00000000-0000-4000-8000-0000000001b1', 2);
update topic_homework set autocheck = false where id = :'carrier';
select public.topic_autocheck_check(:'t4', '31');
select public._topic_autocheck_regrade(:'TT1');
select set_config('app.topic_autocheck', :'carrier' || ':00000000-0000-4000-8000-0000000001b1', false) \g /dev/null
insert into topic_homework_reviews (attempt_id, reviewer_id, decision, score) values (:'s1_att', :'S1', 'accepted', 100);
select set_config('app.topic_autocheck', '', false) \g /dev/null
reset role;
select count(*) as reviews_on_s1_attempt, max(score) as max_score from topic_homework_reviews where attempt_id = :'s1_att';

\echo '=== 7. Преподаватель класса: видит всё (эталон, решения), таблицу результатов; балл формулы не переписать'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
\echo '--- ученик 2 ответил на № 1 неверно (одна попытка) — для таблицы'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
select r->>'correct' as s2_correct from (select public.topic_autocheck_check(:'t1', '25') as r) q;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
select x->>'code' as code, x->>'answer_value' as answer_value, x->>'answer_tol' as tol, x->>'answer_text' as text,
       x->>'solution_path' as solution_path
  from jsonb_array_elements(public.topic_autocheck_state(:'TT1')->'tasks') x;
select s->>'name' as name, s->>'attempts' as attempts, s->>'solved' as solved, s->>'closed' as closed,
       s->>'finished' as finished, s->>'grade' as grade
  from jsonb_array_elements(public.topic_autocheck_results(:'TT1')->'students') s;
select count(*) as answers_visible_to_teacher from topic_autocheck_answers;
select public.topic_autocheck_object_visible('physics-new/1.4.1/04-solution.svg') as teacher_sees_solution;
insert into topic_homework_reviews (attempt_id, reviewer_id, decision, score) values (:'s1_att', :'A', 'accepted', 100);
select public.topic_homework_review_attempt(:'s1_att', 'accepted', 'Перепроверил', 100);
update topic_homework set autocheck = false where id = :'carrier' returning autocheck as autocheck_after_teacher_update;
select public.topic_autocheck_check(:'t1', '100');
\echo '--- владелец курса (персонал, его строка ДЗ): флаг носителя правкой не снять — сторож молча оставляет true'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a0","role":"authenticated"}', false) \g /dev/null
begin;
update topic_homework set autocheck = false where id = :'carrier' returning autocheck as autocheck_after_owner_update;
rollback;

\echo '=== 8. Посторонний преподаватель и ученик чужого курса: ничего не видят'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a9","role":"authenticated"}', false) \g /dev/null
select public.topic_autocheck_results(:'TT1');
select public.topic_autocheck_state(:'TT1');
select count(*) as tasks_seen from topic_autocheck_tasks;
select count(*) as answers_seen from topic_autocheck_answers;
select public.topic_autocheck_object_visible('physics-new/1.4.1/01-statement.svg') as statement_visible;
select public.topic_autocheck_reorder(:'TT1', array[:'t4', :'t3', :'t2', :'t1']::uuid[]);
select public.topic_autocheck_delete(:'t4');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b4","role":"authenticated"}', false) \g /dev/null
select count(*) as s4_tasks_seen from topic_autocheck_tasks;
select public.topic_autocheck_check(:'t1', '100');
select public.topic_autocheck_object_visible('physics-new/1.4.1/01-statement.svg') as s4_statement_visible;
reset role;
set role anon;
select public.topic_autocheck_state(:'TT1');
select count(*) from topic_autocheck_tasks;
reset role;

\echo '=== 9. Задачу добавили после итога: ученик 1 снова «в работе»; закрыл новую верно — итог 80 (4/5) второй строкой вердикта'
select set_config('request.jwt.claims', '{"role":"service_role"}', false) \g /dev/null
select public.topic_autocheck_import(:'TT0', '[
  {"code":"1.4.1-Д-05","position":5,"statement_path":"physics-new/1.4.1/05-statement.svg","solution_path":"physics-new/1.4.1/05-solution.svg","answer_type":"number","answer_value":510,"unit":"м"}
]'::jsonb)->>'copies' as copies;
select set_config('request.jwt.claims', '{}', false) \g /dev/null
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', false) \g /dev/null
select id as t5 from topic_autocheck_tasks where topic_id = :'TT1' and code = '1.4.1-Д-05' \gset
select (public.topic_autocheck_state(:'TT1'))->>'finished' as finished_before, (public.topic_autocheck_state(:'TT1'))->>'grade' as grade_before;
select r->>'grade' as grade from (select public.topic_autocheck_check(:'t5', '510') as r) q;
reset role;
select r.score, r.comment from topic_homework_reviews r where r.attempt_id = :'s1_att' order by r.created_at, r.id;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
select c->>'status' as status, c->>'score' as journal_score
  from jsonb_array_elements(public.course_homework_grades(:'C1')->'cells') c where c->>'topic_id' = :'TT1';

\echo '=== 10. Порядок и удаление (преподаватель класса)'
select public.topic_autocheck_reorder(:'TT1', array[:'t5', :'t1', :'t2', :'t3', :'t4']::uuid[]) as reordered;
select code, position from topic_autocheck_tasks where topic_id = :'TT1' order by position;
select public.topic_autocheck_delete(:'t1');
begin;
select set_config('request.jwt.claims', '{}', false) \g /dev/null
reset role;
select public.topic_autocheck_import(:'TT1', '[{"code":"лишняя","position":9,"statement_path":"p9","answer_type":"number","answer_value":1}]'::jsonb)->>'total' as total_with_extra;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
select public.topic_autocheck_delete((select id from topic_autocheck_tasks where topic_id = :'TT1' and code = 'лишняя')) as deleted_unanswered;
select count(*) as tasks_left from topic_autocheck_tasks where topic_id = :'TT1';
rollback;
reset role;

\echo '=== 11. Копирование урока (topic_copy_stage → course_copy_topic_content): пометка, задачи, носитель; ответов нет'
begin;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a0","role":"authenticated"}', false) \g /dev/null
select (topic_copy_stage(:'TT1', :'M1', 'clear', 0))->>'topic_id' as tt_copy \gset
reset role;
select t.lesson_format, (select count(*) from topic_autocheck_tasks k where k.topic_id = t.id) as tasks,
       (select count(*) from topic_autocheck_tasks k where k.topic_id = t.id and k.source_task_id is not null) as with_lineage,
       (select count(*) from topic_autocheck_answers a join topic_autocheck_tasks k on k.id = a.task_id where k.topic_id = t.id) as answers,
       h.autocheck, h.grade_scale, h.is_published
  from topics t join topic_homework h on h.topic_id = t.id where t.id = :'tt_copy';
rollback;

\echo '=== 12. Пометка урока каркаса уезжает в копию; клиент меняет её обычной правкой темы'
begin;
update topics set lesson_format = 'ege' where id = :'TT0';
select id = :'TT0' as is_template, lesson_format from topics where id in (:'TT0', :'TT1') order by 1 desc;
update topics set lesson_format = 'bad' where id = :'TT0';
rollback;

\echo '=== 13. Повторный прогон PENDING не задел данные: задачи и ответы на месте'
select (select count(*) from topic_autocheck_tasks) as tasks_total, (select count(*) from topic_autocheck_answers) as answers_total,
       (select count(*) from topic_homework where autocheck) as carriers;
\echo '=== 14. Прямая вставка 4-й попытки даже владельцем таблицы — CHECK attempt_no 1..3'
begin;
insert into topic_autocheck_answers (task_id, profile_id, attempt_no, answer_raw, is_correct) values (:'t2', :'S1', 4, '8', true);
rollback;
