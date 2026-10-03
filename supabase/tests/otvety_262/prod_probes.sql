-- §262. Пробы для ПРОДА (MCP execute_sql). Порядок: 262a → [пробы 1] → выкладка клиента → [проба 2.0] → 262b → [пробы 3].
-- Роль и claims — ОТДЕЛЬНЫМ оператором (CLAUDE.md §29.4), всё в begin … rollback. <ученик>, <учитель>, <задача …> —
-- подставить реальные uuid (ученик без открытых ответов; задача части 1 с числовым эталоном).

-- ── 1. После 262a ─────────────────────────────────────────────────────────────────────────────────
-- 1.1 Права на функции: anon — нет; authenticated — texts/text/reveal_answers; правило — никому.
select f, has_function_privilege('anon', f, 'execute') as anon, has_function_privilege('authenticated', f, 'execute') as auth
  from unnest(array['public.catalog_task_texts(uuid[])', 'public.catalog_task_text(uuid)',
                    'public.catalog_reveal_answers(uuid[])', 'public.catalog_answer_reasons(uuid, uuid[])']) f;
-- ожидание: anon f везде; auth t, t, t, f.

-- 1.2 Ученик: закрытая задача — allowed false, поля null; задача части 2 — not_checkable, текст есть.
begin;
select set_config('request.jwt.claims', '{"sub":"<ученик>","role":"authenticated"}', true);
set local role authenticated;
select task_id, allowed, reason, answer_html is not null as has_text
  from public.catalog_task_texts(array['<задача части 1, не открыта>', '<задача части 2>']::uuid[]);
rollback;

-- 1.3 Учитель: всё, reason = staff.
begin;
select set_config('request.jwt.claims', '{"sub":"<учитель>","role":"authenticated"}', true);
set local role authenticated;
select task_id, reason, answer_html is not null as has_text from public.catalog_task_texts(array['<задача части 1, не открыта>']::uuid[]);
rollback;

-- 1.4 Раскрытие пачкой (откат): ответ пришёл, отметка есть.
begin;
select set_config('request.jwt.claims', '{"sub":"<ученик>","role":"authenticated"}', true);
set local role authenticated;
select reason, answer_html from public.catalog_reveal_answers(array['<задача части 1, не открыта>']::uuid[]);
select count(*) from public.catalog_task_reveals where profile_id = auth.uid() and task_id = '<задача части 1, не открыта>';
rollback;

-- ── 2.0 ПЕРЕД 262b: что сломается. Обе выборки должны быть ПУСТЫМИ (иначе 262b сама упадёт и ничего не применит) ──
-- invoker-функции, исполнимые anon/authenticated, читающие ответ (кроме 7 из списка 262b — их она переведёт в definer):
select p.oid::regprocedure as fn
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and not p.prosecdef and p.prokind in ('f', 'p')
   and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
   and p.prosrc ~* 'catalog_tasks'
   and p.prosrc ~* '(answer_html|solution_html|solution_plan_html|grade_criteria_html|ct\.\*|catalog_tasks\.\*|select\s+\*\s+(into\s+\w+\s+)?from\s+(public\.)?catalog_tasks|catalog_tasks%rowtype)'
   and p.oid::regprocedure::text not in ('catalog_tasks_attach_preview(uuid[])', 'preview_task_verdict(uuid,text)',
     'generate_variant_tasks_by_topic(text,text,uuid[],jsonb,text)', 'variant_selection_availability(text,text,uuid[],text)',
     'variant_topic_availability(text,text,uuid[],text)', 'topic_catalog_part1_task_count(uuid[],text)',
     'variant_section_available_counts(text,text)');
-- представления с ответом, читаемые клиентом (утечка мимо 262b):
select c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('v', 'm')
   and (has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('anon', c.oid, 'select'))
   and pg_get_viewdef(c.oid) ~* 'catalog_tasks' and pg_get_viewdef(c.oid) ~* '(answer_html|solution_html|solution_plan_html|grade_criteria_html)';
-- справочно: catalog_tasks в публикации realtime (ожидание: пусто) и копия-бэкап §113 закрыта (ожидание: f, f)
select * from pg_publication_tables where tablename = 'catalog_tasks';
select has_table_privilege('authenticated', 'public.catalog_tasks_multichoice_backup_20260805', 'select'),
       has_table_privilege('anon', 'public.catalog_tasks_multichoice_backup_20260805', 'select');
-- справочно: триггеры на catalog_tasks (invoker-триггер, читающий ответ, при правке из клиента упадёт; правок из клиента нет)
select tgname, tgfoid::regprocedure from pg_trigger where tgrelid = 'public.catalog_tasks'::regclass and not tgisinternal;

-- ── 3. После 262b ─────────────────────────────────────────────────────────────────────────────────
-- 3.1 Колонки: секретные — f, остальные — t; на таблицу select — f.
select column_name, has_column_privilege('authenticated', 'public.catalog_tasks', column_name, 'select') as auth
  from information_schema.columns where table_schema = 'public' and table_name = 'catalog_tasks' order by ordinal_position;
-- 3.2 Ученик напрямую — ERROR permission denied for table catalog_tasks; безопасные колонки читаются.
begin;
select set_config('request.jwt.claims', '{"sub":"<ученик>","role":"authenticated"}', true);
set local role authenticated;
select id, statement_html, has_answer from public.catalog_tasks where is_published limit 1;  -- строка есть
select answer_html from public.catalog_tasks limit 1;                                       -- ERROR 42501
rollback;
-- 3.3 §256 работает: проверка (верно → answer_html в ответе), раскрытие, задача дня; конструктор — счётчики разделов.
begin;
select set_config('request.jwt.claims', '{"sub":"<ученик>","role":"authenticated"}', true);
set local role authenticated;
select public.catalog_check_answer('<задача части 1, не открыта>', '<её ответ>') ->> 'verdict';  -- correct
select public.catalog_reveal_answer('<другая задача части 1>') ->> 'answer_html' is not null;     -- t
select public.student_daily_task('math') ? 'task';                                                -- t
select count(*) > 0 from public.variant_section_available_counts('Математика', 'ЕГЭ');            -- t
rollback;
-- 3.4 Учитель: прямое чтение ответа — ERROR; функция — всё; preview_task_verdict — true/false.
begin;
select set_config('request.jwt.claims', '{"sub":"<учитель>","role":"authenticated"}', true);
set local role authenticated;
select reason from public.catalog_task_texts(array['<задача части 1, не открыта>']::uuid[]);       -- staff
select public.preview_task_verdict('<задача части 1, не открыта>', '<её ответ>');                -- true
rollback;
-- Откат 262b одной строкой (если что-то сломалось у клиента): grant select on public.catalog_tasks to authenticated;
