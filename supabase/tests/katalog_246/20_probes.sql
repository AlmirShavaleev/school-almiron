-- §246. Пробы catalog_my_overview(). Каждая — под ролью authenticated с request.jwt.claims
-- (set_config отдельным оператором, §29.4), записи — в откатываемых блоках.
\pset footer off
\pset tuples_only on
\set VERBOSITY terse

-- Помощники печати: по строке на экзамен «предмет экзамен mine total solved 7d solvers pct | №:решено/всего».
create or replace function probe.s(v jsonb) returns text language sql immutable as $$
  select string_agg(format('%s %s mine=%s total=%s solved=%s 7d=%s solvers=%s pct=%s | %s',
           e->>'subject', e->>'exam_type', e->>'is_mine', e->>'total',
           coalesce(e->>'solved', '-'), coalesce(e->>'solved_7d', '-'),
           coalesce(e->>'solvers', '-'), coalesce(e->>'better_pct', '-'),
           (select string_agg(format('%s:%s/%s', x->>'n', coalesce(x->>'solved', '-'), x->>'total'), ' ' order by (x->>'n')::int)
              from jsonb_array_elements(e->'numbers') x)),
         E'\n' order by e->>'subject', e->>'exam_type')
    from jsonb_array_elements(v->'exams') e $$;
create or replace function probe.o(v jsonb) returns text language sql immutable as $$
  select format('viewer=%s overall: %s', v->>'viewer',
    case when jsonb_typeof(v->'overall') = 'object'
         then format('solved=%s 7d=%s solvers=%s pct=%s', v->'overall'->>'solved', v->'overall'->>'solved_7d',
                     v->'overall'->>'solvers', coalesce(v->'overall'->>'better_pct', '-'))
         else '-' end) $$;
create or replace function probe.chk(name text, got text, want text) returns text language sql immutable as $$
  select case when got is not distinct from want then 'ok   ' || name
              else 'FAIL ' || name || E'\n  got:  ' || coalesce(got, '<null>') || E'\n  want: ' || coalesce(want, '<null>') end $$;
grant execute on all functions in schema probe to authenticated, anon;

\echo '== P1. Ученик A: свои цифры = ручной подсчёт (10_data_246.sql), 9 решающих → сравнения нет'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', probe.id('pA'), 'role', 'authenticated')::text, true) \g /dev/null
select probe.o(catalog_my_overview());
select probe.s(catalog_my_overview());
select probe.chk('P1 итог A', probe.o(catalog_my_overview()), 'viewer=student overall: solved=7 7d=3 solvers=9 pct=-');
select probe.chk('P1 экзамены A', probe.s(catalog_my_overview()),
  E'Математика ЕГЭ mine=true total=12 solved=5 7d=2 solvers=9 pct=- | 1:3/5 2:1/3 12:1/4\n'
  'Математика ОГЭ mine=false total=2 solved=0 7d=0 solvers=- pct=- | 1:0/2\n'
  'Физика ЕГЭ mine=false total=3 solved=1 7d=1 solvers=2 pct=- | 1:1/3\n'
  'Физика ОГЭ mine=false total=7 solved=1 7d=0 solvers=1 pct=- | 1:0/2 20:1/5');
\echo '-- №20 физики ОГЭ = три раздела (0 + 2 + 3 задачи); столбик ведёт в первый НЕпустой (sO20b)'
select probe.chk('P1 раздел №20', (select x->>'section_id' from jsonb_array_elements(catalog_my_overview()->'exams') e,
         jsonb_array_elements(e->'numbers') x where e->>'subject' = 'Физика' and e->>'exam_type' = 'ОГЭ' and x->>'n' = '20'),
  probe.id('sO20b')::text);
\echo '-- Пустой №0 физики ЕГЭ, снятый раздел №5, раздел без номера и снятая задача в выдачу не попадают'
select probe.chk('P1 нет №0 и №5', (select string_agg(e->>'subject' || ' ' || (e->>'exam_type') || ' №' || (x->>'n'), ',')
         from jsonb_array_elements(catalog_my_overview()->'exams') e, jsonb_array_elements(e->'numbers') x
        where (x->>'n')::int in (0, 5)), null);
\echo '-- Таблицы вариантов закрыты RLS: напрямую A не видит даже своих ответов — функция читает сама (definer)'
select probe.chk('P1 RLS вариантов', (select count(*) from test_variant_answers)::text, '0');
rollback;

\echo '== P2. Отметка + верный ответ по одной задаче = 1 (B: m1a отмечена и решена в варианте)'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', probe.id('pB'), 'role', 'authenticated')::text, true) \g /dev/null
select probe.s(catalog_my_overview());
select probe.chk('P2 B математика ЕГЭ', (select e->>'solved' from jsonb_array_elements(catalog_my_overview()->'exams') e
         where e->>'subject' = 'Математика' and e->>'exam_type' = 'ЕГЭ'), '1');
select probe.chk('P2 B свой экзамен — физика ОГЭ', (select string_agg(e->>'subject' || ' ' || (e->>'exam_type'), ',')
         from jsonb_array_elements(catalog_my_overview()->'exams') e where (e->>'is_mine')::boolean), 'Физика ОГЭ');
rollback;

\echo '== P3. Порог 10: добавляем десятого решающего J (1 задача) — у A появляется доля'
begin;
insert into catalog_task_progress (user_id, task_id, is_completed, completed_at) values (probe.id('pJ'), probe.id('m1c'), true, now());
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', probe.id('pA'), 'role', 'authenticated')::text, true) \g /dev/null
select probe.o(catalog_my_overview());
select probe.s(catalog_my_overview());
-- математика ЕГЭ: решающих 10, меньше 5 у B1 C1 D2 E3 J1 = 5 → 50 %;
-- объединение (мат. ЕГЭ + физ. ЕГЭ + физ. ОГЭ): у A 7, меньше у B1 C1 D2 E3 F5 J1 = 6 (у G 6+1 = 7) → 60 %.
select probe.chk('P3 итог A', probe.o(catalog_my_overview()), 'viewer=student overall: solved=7 7d=3 solvers=10 pct=60');
select probe.chk('P3 мат. ЕГЭ A', (select format('%s/%s', e->>'solvers', e->>'better_pct') from jsonb_array_elements(catalog_my_overview()->'exams') e
         where e->>'subject' = 'Математика' and e->>'exam_type' = 'ЕГЭ'), '10/50');
rollback;

\echo '== P4. «0 %» → null: при 10 решающих у B (1 задача) меньше ни у кого'
begin;
insert into catalog_task_progress (user_id, task_id, is_completed, completed_at) values (probe.id('pJ'), probe.id('m1c'), true, now());
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', probe.id('pB'), 'role', 'authenticated')::text, true) \g /dev/null
select probe.o(catalog_my_overview());
select probe.chk('P4 итог B', probe.o(catalog_my_overview()), 'viewer=student overall: solved=1 7d=1 solvers=10 pct=-');
select probe.chk('P4 мат. ЕГЭ B', (select format('%s/%s', e->>'solvers', coalesce(e->>'better_pct', '-')) from jsonb_array_elements(catalog_my_overview()->'exams') e
         where e->>'subject' = 'Математика' and e->>'exam_type' = 'ЕГЭ'), '10/-');
rollback;

\echo '== P5. Новичок X: ноль везде, сравнения нет, структура каталога та же'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', probe.id('pX'), 'role', 'authenticated')::text, true) \g /dev/null
select probe.o(catalog_my_overview());
select probe.chk('P5 итог X', probe.o(catalog_my_overview()), 'viewer=student overall: solved=0 7d=0 solvers=0 pct=-');
select probe.chk('P5 экзамены X', probe.s(catalog_my_overview()),
  E'Математика ЕГЭ mine=false total=12 solved=0 7d=0 solvers=- pct=- | 1:0/5 2:0/3 12:0/4\n'
  'Математика ОГЭ mine=false total=2 solved=0 7d=0 solvers=- pct=- | 1:0/2\n'
  'Физика ЕГЭ mine=false total=3 solved=0 7d=0 solvers=- pct=- | 1:0/3\n'
  'Физика ОГЭ mine=false total=7 solved=0 7d=0 solvers=- pct=- | 1:0/2 20:0/5');
rollback;

\echo '== P6. W: только неверные/непроверенные ответы — решённого нет'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', probe.id('pW'), 'role', 'authenticated')::text, true) \g /dev/null
select probe.chk('P6 итог W', probe.o(catalog_my_overview()), 'viewer=student overall: solved=0 7d=0 solvers=0 pct=-');
rollback;

\echo '== P7. Преподаватель T: только число задач по номерам, без «решено», без сравнения (его 10 отметок не видны и не считаются)'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', probe.id('pT'), 'role', 'authenticated')::text, true) \g /dev/null
select probe.o(catalog_my_overview());
select probe.s(catalog_my_overview());
select probe.chk('P7 итог T', probe.o(catalog_my_overview()), 'viewer=staff overall: -');
select probe.chk('P7 экзамены T', probe.s(catalog_my_overview()),
  E'Математика ЕГЭ mine=false total=12 solved=- 7d=- solvers=- pct=- | 1:-/5 2:-/3 12:-/4\n'
  'Математика ОГЭ mine=false total=2 solved=- 7d=- solvers=- pct=- | 1:-/2\n'
  'Физика ЕГЭ mine=false total=3 solved=- 7d=- solvers=- pct=- | 1:-/3\n'
  'Физика ОГЭ mine=false total=7 solved=- 7d=- solvers=- pct=- | 1:-/2 20:-/5');
rollback;

\echo '== P8. Чужое не утекает: в ответе A нет ни id, ни имён других людей; набор ключей фиксирован'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', probe.id('pA'), 'role', 'authenticated')::text, true) \g /dev/null
select probe.chk('P8 нет чужих id/имён', (select string_agg(k, ',') from unnest(array['B','C','D','E','F','G','H','I','J','W','X','T']) k
         where position(probe.id('p' || k)::text in catalog_my_overview()::text) > 0
            or position(probe.id('s' || k)::text in catalog_my_overview()::text) > 0
            or position('Ученик' in catalog_my_overview()::text) > 0), null);
select probe.chk('P8 ключи верха', (select string_agg(k, ',' order by k) from jsonb_object_keys(catalog_my_overview()) k), 'exams,min_solvers,overall,viewer');
select probe.chk('P8 ключи экзамена', (select string_agg(k, ',' order by k) from jsonb_object_keys(catalog_my_overview()->'exams'->0) k),
  'better_pct,exam_type,is_mine,numbers,solved,solved_7d,solvers,subject,total');
select probe.chk('P8 ключи номера', (select string_agg(k, ',' order by k) from jsonb_object_keys(catalog_my_overview()->'exams'->0->'numbers'->0) k),
  'n,section_id,solved,total');
rollback;

\echo '== P9. Аноним — отказ (execute отозван)'
begin;
set local role anon;
select catalog_my_overview();
rollback;

\echo '== P10. authenticated без sub — отказ функцией'
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) \g /dev/null
select catalog_my_overview();
rollback;

\echo '== P11. Повторный вызов в той же транзакции (stable) — тот же ответ'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', probe.id('pA'), 'role', 'authenticated')::text, true) \g /dev/null
select probe.chk('P11 повтор = первый', (catalog_my_overview() = catalog_my_overview())::text, 'true');
rollback;
