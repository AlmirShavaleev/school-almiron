-- §269. Пробы после PENDING_269 (применена дважды). Роль и claims — отдельными операторами, записи — в откатываемых
-- блоках. Каждая проба печатает ok = t или «OK: …»; «FAIL» / ok = f — провал.
\pset footer off
\set ON_ERROR_STOP off

\echo '== 1. catalog_answer_spec_verdict: число (запятая, «−», допуск), цифры (порядок / любой), слова, значение+погрешность'
select v.spec, v.raw, public.catalog_answer_spec_verdict(v.spec::jsonb, v.raw) as got, v.want,
       public.catalog_answer_spec_verdict(v.spec::jsonb, v.raw) is not distinct from v.want as ok
  from (values
    ('{"type":"number","value":"-8","tol":0}', '-8', true),
    ('{"type":"number","value":"-8","tol":0}', '−8', true),
    ('{"type":"number","value":"-8","tol":0}', '–8', true),
    ('{"type":"number","value":"-8","tol":0}', ' -8,0 ', true),
    ('{"type":"number","value":"-8","tol":0}', '8', false),
    ('{"type":"number","value":"-8","tol":0}', '-7,99', false),
    ('{"type":"number","value":"-8","tol":0}', '-8 м/с', false),
    ('{"type":"number","value":"2.5","tol":0.1}', '2,45', true),
    ('{"type":"number","value":"2.5","tol":0.1}', '2.6', true),
    ('{"type":"number","value":"2.5","tol":0.1}', '2,4', true),
    ('{"type":"number","value":"2.5","tol":0.1}', '2,61', false),
    ('{"type":"number","value":"2.5","tol":0.1}', 'abc', false),
    ('{"type":"number","value":"0.06","tol":0}', '0,06', true),
    ('{"type":"number","value":"0.06","tol":0}', ',06', true),
    ('{"type":"digits","text":"145","any_order":true}', '541', true),
    ('{"type":"digits","text":"145","any_order":true}', '1 4 5', true),
    ('{"type":"digits","text":"145","any_order":true}', '14', false),
    ('{"type":"digits","text":"145","any_order":true}', '1455', false),
    ('{"type":"digits","text":"235","any_order":false}', '235', true),
    ('{"type":"digits","text":"235","any_order":false}', '253', false),
    ('{"type":"digits","text":"4,40,2","any_order":false}', '4,40,2', true),
    ('{"type":"digits","text":"4,40,2","any_order":false}', '4,4 0,2', true),
    ('{"type":"digits","text":"4,40,2","any_order":false}', '4.4;0.2', true),
    ('{"type":"digits","text":"4,40,2","any_order":false}', '4,4', false),
    ('{"type":"text","text":"к наблюдателю"}', 'к наблюдателю', true),
    ('{"type":"text","text":"к наблюдателю"}', 'Кнаблюдателю', true),
    ('{"type":"text","text":"к наблюдателю"}', 'К НАБЛЮДАТЕЛЮ.', true),
    ('{"type":"text","text":"к наблюдателю"}', 'от наблюдателя', false),
    ('{"type":"text","text":"отражённый"}', 'Отраженный', true),
    ('{"type":"text","text":"к наблюдателю"}', '', false),
    ('{"type":"text","text":"к наблюдателю"}', '!!!', false)
  ) v(spec, raw, want);

\echo '== 2. Ограничения: битый answer_spec и неизвестный формат не записываются'
begin;
do $$ begin
  update public.catalog_tasks set answer_spec = '{"type":"number","value":"1,5"}' where id = '69200000-0000-4000-8000-000000000001';
  raise notice 'FAIL: битый answer_spec записан';
exception when check_violation then raise notice 'OK: answer_spec с запятой — %', sqlerrm; end $$;
do $$ begin
  update public.catalog_tasks set content_format = 'latex' where id = '69200000-0000-4000-8000-000000000001';
  raise notice 'FAIL: content_format latex записан';
exception when check_violation then raise notice 'OK: content_format — %', sqlerrm; end $$;
rollback;

\echo '== 3. Права колонок: ученик НЕ читает answer_spec; новые служебные колонки читает; anon — ничего'
select has_column_privilege('authenticated', 'public.catalog_tasks', 'answer_spec', 'select') = false as ok_spec_closed,
       has_column_privilege('authenticated', 'public.catalog_tasks', 'content_format', 'select') as ok_format_open,
       has_column_privilege('authenticated', 'public.catalog_tasks', 'replaced_by_task_id', 'select') as ok_replaced_open,
       has_column_privilege('authenticated', 'public.catalog_tasks', 'origin_external_id', 'select') as ok_origin_open,
       not has_column_privilege('anon', 'public.catalog_tasks', 'content_format', 'select') as ok_anon_closed,
       has_column_privilege('service_role', 'public.catalog_tasks', 'answer_spec', 'select') as ok_service_role;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform answer_spec from public.catalog_tasks limit 1; raise notice 'FAIL: ученик читает answer_spec';
exception when insufficient_privilege then raise notice 'OK: ученик answer_spec — %', sqlerrm; end $$;
do $$ begin perform 1 from public.catalog_tasks where answer_spec->>'value' = '-8'; raise notice 'FAIL: подбор по answer_spec';
exception when insufficient_privilege then raise notice 'OK: where answer_spec — %', sqlerrm; end $$;
select count(*) = 6 as ok_md_rows_visible, bool_and(content_format = 'md') as ok_format
  from public.catalog_tasks where id::text like '69200000-%';
rollback;

\echo '== 4. Допуск персоналу: ученик — 42501, учитель — эталон, anon — нет права'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform * from public.catalog_task_answer_specs(array['69200000-0000-4000-8000-000000000002'::uuid]); raise notice 'FAIL: ученик получил эталон';
exception when insufficient_privilege then raise notice 'OK: ученик — %', sqlerrm; end $$;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select s.answer_spec, s.answer_spec = '{"type":"number","value":"2.5","tol":0.1}'::jsonb as ok
  from public.catalog_task_answer_specs(array['69200000-0000-4000-8000-000000000002'::uuid, '69100000-0000-4000-8000-0000000000a2'::uuid]) s;
rollback;
begin;
set local role anon;
do $$ begin perform * from public.catalog_task_answer_specs(array[]::uuid[]); raise notice 'FAIL: anon';
exception when insufficient_privilege then raise notice 'OK: anon — %', sqlerrm; end $$;
rollback;
select has_function_privilege('authenticated', 'public.catalog_answer_spec_verdict(jsonb, text)', 'execute') = false as ok_verdict_not_callable,
       has_function_privilege('authenticated', 'public.catalog_replace_task_v2(uuid, jsonb)', 'execute') = false as ok_replace_not_callable,
       has_function_privilege('service_role', 'public.catalog_replace_task_v2(uuid, jsonb)', 'execute') as ok_replace_service_role;

\echo '== 5. catalog_check_answer (каталог) по answer_spec: допуск, «−», цифры без порядка; эталон до верного ответа не отдаётся'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select r->>'verdict' as verdict, r->>'counted' as counted, r->>'answer_html' as answer_html,
       r->>'verdict' = 'wrong' and r->>'answer_html' is null as ok
  from public.catalog_check_answer('69200000-0000-4000-8000-000000000002', '2,7') r;
select r->>'verdict' as verdict, r->>'counted' as counted, r->>'answer_html' as answer_html,
       r->>'verdict' = 'correct' and (r->>'counted')::boolean and r->>'answer_html' = '2,5' as ok
  from public.catalog_check_answer('69200000-0000-4000-8000-000000000002', '2,45') r;
select r->>'verdict' = 'correct' as ok_minus from public.catalog_check_answer('69200000-0000-4000-8000-000000000001', '−8') r;
select r->>'verdict' = 'correct' as ok_any_order from public.catalog_check_answer('69200000-0000-4000-8000-000000000003', '5 1 4') r;
select r->>'verdict' = 'wrong' as ok_order from public.catalog_check_answer('69200000-0000-4000-8000-000000000004', '253') r;
select r->>'verdict' = 'correct' as ok_pair from public.catalog_check_answer('69200000-0000-4000-8000-000000000006', '4,4 0,2') r;
-- старая HTML-задача — прежнее правило (answer_html '7')
select r->>'verdict' = 'correct' as ok_legacy from public.catalog_check_answer('69100000-0000-4000-8000-0000000000a2', '7') r;
-- часть 2 (слова) — без проверки, как раньше
do $$ begin perform public.catalog_check_answer('69200000-0000-4000-8000-000000000005', 'к наблюдателю'); raise notice 'FAIL';
exception when others then raise notice 'OK: часть 2 — %', sqlerrm; end $$;
rollback;

\echo '== 6. Ответ-раскрытие ученику — как раньше (answer_html — строка показа с «−»), допуска в ответе нет'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select t.task_id, t.allowed, t.answer_html, t.allowed = false and t.answer_html is null as ok_closed_before_reveal
  from public.catalog_task_texts(array['69200000-0000-4000-8000-000000000001'::uuid]) t;
select t.allowed and t.answer_html = '−8' and t.reason = 'revealed' as ok
  from public.catalog_reveal_answers(array['69200000-0000-4000-8000-000000000001'::uuid]) t;
rollback;

\echo '== 7. submit_variant: m2 «2,45» (допуск), m1 «−8», m6 «4,4 0,2» — все верно по answer_spec'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select r->>'correct_count' as correct, r->>'score' as score, (r->>'correct_count')::int = 3 as ok
  from public.submit_variant('69520000-0000-4000-8000-000000000002') r;
reset role;
select a.variant_item_id, a.is_correct, a.points_earned from public.test_variant_answers a
 where a.student_assignment_id = '69520000-0000-4000-8000-000000000002' order by a.variant_item_id;
rollback;

\echo '== 8. answer_topic_task (задача урока) и preview_task_verdict (учитель) — по answer_spec'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select (r->>'is_correct')::boolean as ok_lesson_tol
  from public.answer_topic_task('69600000-0000-4000-8000-000000000001', '69510000-0000-4000-8000-000000000005', '2,58') r;
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select public.preview_task_verdict('69200000-0000-4000-8000-000000000002', '2,55') as ok_preview_tol,
       public.preview_task_verdict('69200000-0000-4000-8000-000000000002', '2,7') = false as ok_preview_wrong,
       public.preview_task_verdict('69100000-0000-4000-8000-0000000000a2', '7') as ok_preview_legacy;
rollback;

\echo '== 9. Замена задачи из варианта (h1) новой строкой; повтор — без изменений; ученик — нет права'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
do $$ begin perform public.catalog_replace_task_v2('69100000-0000-4000-8000-0000000000a1', '{}'); raise notice 'FAIL: ученик заменил задачу';
exception when insufficient_privilege then raise notice 'OK: ученик — %', sqlerrm; end $$;
rollback;

-- Замена — без отката: дальше пробы истории и видимости по ней.
set role service_role;
select r->>'created' as created, r->>'archived_external_id' as archived_ext,
       (r->>'created')::boolean and (r->>'archived_external_id')::bigint = 1000096090 as ok
  from public.catalog_replace_task_v2('69100000-0000-4000-8000-0000000000a1', jsonb_build_object(
    'content_format', 'md', 'statement_html', E'<!--md-->\nНовое условие $x$.', 'solution_html', E'<!--md-->\nНовое решение.',
    'answer_html', '−8', 'answer_spec', '{"type":"number","value":"-8","tol":0}'::jsonb, 'has_answer', true, 'has_solution', true)) r;
select r->>'created' = 'false' as ok_repeat_noop,
       (r->>'new_task_id')::uuid = (select replaced_by_task_id from public.catalog_tasks where id = '69100000-0000-4000-8000-0000000000a1') as ok_same_new
  from public.catalog_replace_task_v2('69100000-0000-4000-8000-0000000000a1', '{"content_format":"md"}') r;
do $$ begin perform public.catalog_replace_task_v2('69100000-0000-4000-8000-0000000000a2', '{"content_format":"md","statement_html":"x"}');
  raise notice 'FAIL: без answer_spec заменилось';
exception when others then raise notice 'OK: плохое содержимое — %', sqlerrm; end $$;
reset role;
select o.external_id as old_ext, o.origin_external_id, o.is_published as old_published,
       n.external_id as new_ext, n.is_published as new_published, n.position = o.position and n.section_id = o.section_id as same_place,
       n.content_format, n.answer_spec, n.solution_plan_html is null as no_plan,
       o.external_id = 1000096090 and o.origin_external_id = 96090 and not o.is_published and n.external_id = 96090
         and n.is_published and n.content_format = 'md' as ok
  from public.catalog_tasks o join public.catalog_tasks n on n.id = o.replaced_by_task_id
 where o.id = '69100000-0000-4000-8000-0000000000a1';
select (select count(*) from public.catalog_task_topics t join public.catalog_tasks o on o.replaced_by_task_id = t.task_id
         where o.id = '69100000-0000-4000-8000-0000000000a1') = 2 as ok_topics_copied,
       (select catalog_task_id from public.task_collection_items where collection_id = '69400000-0000-4000-8000-000000000001')
         = (select replaced_by_task_id from public.catalog_tasks where id = '69100000-0000-4000-8000-0000000000a1') as ok_collection_moved,
       (select task_id from public.test_variant_items where id = '69510000-0000-4000-8000-000000000001')
         = '69100000-0000-4000-8000-0000000000a1' as ok_variant_untouched;

\echo '== 10. Видимость: ученик видит скрытую старую строку по id (вариант) и её рисунки, но не в списке раздела; скрытая НЕ заменённая — не видна'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select count(*) = 1 as ok_archived_by_id from public.catalog_tasks where id = '69100000-0000-4000-8000-0000000000a1';
select count(*) = 1 as ok_archived_assets from public.catalog_task_assets where task_id = '69100000-0000-4000-8000-0000000000a1';
select count(*) as listed, bool_and(external_id <> 1000096090) as ok_list_has_no_archived,
       count(*) filter (where external_id = 96090) = 1 as ok_new_listed
  from public.catalog_tasks where section_id = '69000000-0000-4000-8000-000000000001' and is_published;
select count(*) = 0 as ok_unpublished_hidden from public.catalog_tasks where id = 'a6210000-0000-4000-8000-000000000008';
rollback;
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select count(*) = 1 as ok_teacher_archived_by_id from public.catalog_tasks where id = '69100000-0000-4000-8000-0000000000a1';
select t.reason = 'staff' and t.answer_html = '12' as ok_teacher_old_answer
  from public.catalog_task_texts(array['69100000-0000-4000-8000-0000000000a1'::uuid]) t;
rollback;

\echo '== 11. История ученика A по скрытой строке засчитывается за новую: решённые каталога, прогноз, обзор'
select s.task_id = (select replaced_by_task_id from public.catalog_tasks where id = '69100000-0000-4000-8000-0000000000a1') as ok_counted_mapped,
       s.subject, s.n
  from public.catalog_counted_solutions('00000000-0000-4000-8000-0000000000a1') s
 where s.section_id = '69000000-0000-4000-8000-000000000001';
select e.source, e.item, e.ns, e.score
  from public.student_exam_evidence_rows('00000000-0000-4000-8000-0000000000a1', now() - interval '30 days') e
 where e.item = 'catalog:69100000-0000-4000-8000-0000000000a1'
    or e.item in (select 'variant:' || a.id from public.test_variant_answers a
                   where a.student_assignment_id = '69520000-0000-4000-8000-000000000001')
 order by e.item;
select count(*) = 2 as ok_evidence_both
  from public.student_exam_evidence_rows('00000000-0000-4000-8000-0000000000a1', now() - interval '30 days') e
 where e.item = 'catalog:69100000-0000-4000-8000-0000000000a1'
    or e.item in (select 'variant:' || a.id from public.test_variant_answers a
                   where a.student_assignment_id = '69520000-0000-4000-8000-000000000001');
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
select x->>'n' as n, x->>'total' as total, x->>'solved' as solved,
       (x->>'solved')::int = 1 and (x->>'total')::int = 8 as ok
  from public.catalog_my_overview() o, jsonb_array_elements(o->'exams') e, jsonb_array_elements(e->'numbers') x
 where e->>'subject' = 'Физика' and x->>'n' = '1';
rollback;

\echo '== 12. Правки текста функций на месте (метка §269) — student_school_points_of, submit_variant, answer_topic_task'
select p.proname,
       strpos(pg_get_functiondef(p.oid), '§269') > 0 as has_marker,
       case p.proname
         when 'student_school_points_of' then strpos(pg_get_functiondef(p.oid), 'group by coalesce(ct.replaced_by_task_id, vi.task_id)') > 0
         when 'submit_variant' then strpos(pg_get_functiondef(p.oid), 'catalog_answer_spec_verdict(v_item.answer_spec, v_student_norm)') > 0
         when 'answer_topic_task' then strpos(pg_get_functiondef(p.oid), 'catalog_answer_spec_verdict(v_task.answer_spec, p_answer_raw)') > 0
         else true end as ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('catalog_check_answer', 'submit_variant', 'answer_topic_task', 'preview_task_verdict',
       'catalog_counted_solutions', 'student_school_points_of', 'student_exam_evidence_rows', 'catalog_my_overview')
 order by 1;

\echo '== 13. Подсчёт каталога учеником: план с новыми политиками и без них (откат) — index-only scan сохраняется (§268)'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true) \g /dev/null
set local role authenticated;
explain (costs off) select count(*) from public.catalog_tasks where is_published and subject = 'Математика' and exam_type = 'ЕГЭ';
select count(*) as math_published from public.catalog_tasks where is_published and subject = 'Математика' and exam_type = 'ЕГЭ';
reset role;
drop policy catalog_tasks_select_archived on public.catalog_tasks;
set local role authenticated;
\echo '-- без политики §269:'
explain (costs off) select count(*) from public.catalog_tasks where is_published and subject = 'Математика' and exam_type = 'ЕГЭ';
rollback;

\echo '== 14. Бакет рисунков'
select id, public, file_size_limit, allowed_mime_types,
       public and file_size_limit = 2097152 and 'image/svg+xml' = any (allowed_mime_types) as ok
  from storage.buckets where id = 'catalog-figures';
select count(*) = 3 as ok_admin_policies from pg_policies where schemaname = 'storage' and policyname like 'catalog_figures_admin_%';
