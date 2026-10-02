-- §258. Пробы после PENDING_258 (дважды). Роль authenticated + request.jwt.claims
-- отдельным оператором (§29.4); записи — в откатываемых блоках. Под владельцем
-- таблиц (postgres) RLS не проверяется — пробы прав только под authenticated/anon.
\pset footer off
\set ON_ERROR_STOP 0
\set ON_ERROR_ROLLBACK on
\set TL '00000000-0000-4000-8000-0000007a0001'
\set TK '00000000-0000-4000-8000-0000007a0002'
\set TF '00000000-0000-4000-8000-0000007a0003'
\set TC '00000000-0000-4000-8000-0000007a0004'
\set TN '00000000-0000-4000-8000-0000007a0005'
\set TT '00000000-0000-4000-8000-000000070001'
\set C3 '00000000-0000-4000-8000-00000c0a0003'

\echo '=== 0. Права: anon — нет, authenticated — есть; тело — одна редакция (create or replace, без drop)'
select has_function_privilege('anon', 'public.topic_solution_state(uuid)', 'execute') as anon_exec,
       has_function_privilege('authenticated', 'public.topic_solution_state(uuid)', 'execute') as auth_exec,
       (select count(*) from pg_proc where proname = 'topic_solution_state') as versions,
       (select prosecdef from pg_proc where proname = 'topic_solution_state') as security_definer;

\echo '=== 1. anon: вызов — отказ (permission denied)'
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false) \g /dev/null
select topic_solution_state(:'TK');
reset role;

-- ═══ Ученик S2 (10А) ════════════════════════════════════════════════════════
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
\echo '=== 2. S2: флаги по темам. Ожидается: has_criteria — K, C, N (у F критерии скрыты учителем, у L их нет); has_condition — у всех пяти; unlocked — везде false (принятой работы у S2 нет; возврат на доработку в N гейт не открывает, правило 20260805220729)'
select t.code,
       (s->>'has_solution')::bool  as has_solution,
       (s->>'has_homework')::bool  as has_homework,
       (s->>'unlocked')::bool      as unlocked,
       (s->>'has_criteria')::bool  as has_criteria,
       (s->>'has_condition')::bool as has_condition
  from (values ('L', :'TL'::uuid), ('K', :'TK'::uuid), ('F', :'TF'::uuid), ('C', :'TC'::uuid), ('N', :'TN'::uuid)) t(code, id),
       lateral (select topic_solution_state(t.id) as s) x
 order by t.code;
\echo '=== 2a. S2: строки, которые ученик реально получает (criteria / worksheet_homework): флаг говорит «есть», строк может не быть'
select t.code,
       count(i.id) filter (where i.section = 'criteria')           as criteria_rows,
       count(i.id) filter (where i.section = 'worksheet_homework') as condition_rows
  from (values ('L', :'TL'::uuid), ('K', :'TK'::uuid), ('F', :'TF'::uuid), ('C', :'TC'::uuid), ('N', :'TN'::uuid)) t(code, id)
  left join topic_material_items i on i.topic_id = t.id
 group by t.code order by t.code;
\echo '=== 2b. B1 и после — прежние три поля S2 по теме K совпадают (old = new без has_criteria/has_condition)'
select topic_solution_state(:'TK') - 'has_criteria' - 'has_condition' as old_fields;
reset role;

\echo '=== 3. S3 (C: сдал, ждёт проверки): unlocked=false, has_criteria=true, строк критериев 0'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', false) \g /dev/null
select (s->>'unlocked')::bool as unlocked, (s->>'has_criteria')::bool as has_criteria,
       (select count(*) from topic_material_items where topic_id = :'TC' and section = 'criteria') as criteria_rows
  from (select topic_solution_state(:'TC') as s) x;
reset role;

\echo '=== 3a. После «Принято» у S3 (откатываемо): unlocked=true, has_criteria=true, строка критериев видна (1)'
begin;
update topic_homework_attempts set status = 'accepted' where id = :'C3';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true) \g /dev/null
select (s->>'unlocked')::bool as unlocked, (s->>'has_criteria')::bool as has_criteria,
       (select count(*) from topic_material_items where topic_id = :'TC' and section = 'criteria') as criteria_rows,
       (select count(*) from topic_material_items where topic_id = :'TC' and section = 'solution') as solution_rows
  from (select topic_solution_state(:'TC') as s) x;
rollback;

\echo '=== 4. Преподаватель 10А (A): флаги те же, unlocked=false (своей попытки нет) — на этом стоит предпросмотр; строки ему видны все'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
select (s->>'unlocked')::bool as unlocked, (s->>'has_criteria')::bool as has_criteria, (s->>'has_condition')::bool as has_condition
  from (select topic_solution_state(:'TK') as s) x;
reset role;

\echo '=== 5. Каркас: правка названия темы шаблона уходит в копии триггером template_sync_topic_write (откатываемо, под postgres — RLS topics в слепке нет)'
begin;
select c.title as course, t.title from topics t join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 where t.id = :'TT' or t.source_topic_id = :'TT' order by c.title;
update topics set title = 'Контрольная. Кинематика (новое название)' where id = :'TT';
select c.title as course, t.title from topics t join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 where t.id = :'TT' or t.source_topic_id = :'TT' order by c.title;
rollback;
