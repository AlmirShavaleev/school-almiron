-- §263. Пробы ПОСЛЕ применения PENDING_263 на проде (MCP execute_sql). Всё, что пишет, — в begin … rollback.
-- Подставить: <S> — profile_id ученика класса с проверочной/КР; <S_STUDENT> — его students.id; <T> — профиль
-- преподавателя этого класса; <X> — профиль постороннего преподавателя; <HW> — topic_homework.id проверочной/КР
-- его курса (topics.kind in ('check','control')); <TASK> — id опубликованной задачи каталога части 1.
-- set_config — отдельным оператором (ловушка §29.4).

-- ── 1. Структура и права ─────────────────────────────────────────────────────────────────────────────
select f, has_function_privilege('authenticated', f, 'execute') as authenticated, has_function_privilege('anon', f, 'execute') as anon
  from unnest(array['public.student_active_works(uuid)', 'public.work_mode_active_for_profile(uuid)', 'public.my_work_mode()',
                    'public.work_mark_opened(uuid)', 'public.work_report_away(uuid,uuid,integer,integer)', 'public.timed_work_live(uuid)',
                    'public.my_live_timed_works()', 'public.mock_exam_away(uuid)', 'public.my_variant_answer_flags(uuid)',
                    'public.catalog_answer_reasons(uuid,uuid[])']) f;
-- ожидается: первые две и catalog_answer_reasons — false/false; остальные — true/false.
select tablename, policyname, permissive, cmd from pg_policies
 where policyname in ('catalog_tasks_work_mode', 'topic_material_items_work_mode', 'work_activity_staff_select');
-- ожидается: две RESTRICTIVE (select) и одна PERMISSIVE.
select tgname from pg_trigger where tgname in ('catalog_task_attempts_work_mode', 'catalog_task_reveals_work_mode');

-- ── 2. Флажки варианта: выданным — как было ─────────────────────────────────────────────────────────
select count(*) filter (where not show_answers_after_submit or not show_solutions_after_submit) as hidden_after_migration,
       count(*) as total
  from public.test_variant_assignments;
-- ожидается hidden_after_migration = 0 сразу после применения (потом учитель может снять флажки сам).
select column_name, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'test_variant_assignments' and column_name like 'show_%';

-- ── 3. Вне работы — всё как раньше (ученик <S>) ─────────────────────────────────────────────────────
begin;
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"<S>","role":"authenticated"}', true);
select public.my_work_mode();                                  -- {"active": false, ...}
select count(*) > 0 as catalog_visible from public.catalog_tasks; -- true
rollback;

-- ── 4. Работа идёт (окно <HW> сдвинуто на «сейчас» в откатываемом блоке) ─────────────────────────────
begin;
update public.topic_homework set opens_at = now() - interval '5 minutes', closes_at = now() + interval '30 minutes'
 where id = '<HW>';
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"<S>","role":"authenticated"}', true);
select public.my_work_mode();                                  -- active: true, homework_id = <HW> (если нет сданной попытки)
select count(*) as catalog_rows from public.catalog_tasks;     -- 0
select allowed from public.catalog_task_texts(array['<TASK>'::uuid]); -- false
select section, count(*) from public.topic_material_items group by section; -- только worksheet_homework темы работы
select public.work_mark_opened('<HW>');                        -- marked: true
select public.work_report_away('<HW>', null, 1, 30);           -- saved: true
-- раскрытие ответа каталога — ожидается ERROR 42501 WORK_MODE:
-- select * from public.catalog_reveal_answers(array['<TASK>'::uuid]);
rollback;

-- ── 5. Монитор: свой учитель — да, посторонний — 42501 ─────────────────────────────────────────────
begin;
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"<T>","role":"authenticated"}', true);
select jsonb_array_length(public.timed_work_live('<HW>')->'students') as students;
select public.my_live_timed_works();
rollback;
begin;
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"<X>","role":"authenticated"}', true);
select public.timed_work_live('<HW>');                         -- ERROR 42501
rollback;

-- ── 6. Цена ограничительной политики каталога (ученик, одна страница каталога) ───────────────────────
begin;
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"<S>","role":"authenticated"}', true);
explain (analyze, buffers) select id from public.catalog_tasks where is_published limit 50;
-- в плане — InitPlan work_mode_active() один раз на запрос, не на строку.
rollback;
