-- §262. Страховка 262b: неизвестная invoker-функция или представление, читающие ответ, — 262b падает целиком (откат).
\pset footer off
\set ON_ERROR_STOP off
\echo '== G1. Invoker-функция, исполнимая authenticated, читает answer_html → 262b: ERROR, ничего не применено'
begin;
create function public.leak_probe_262() returns text language sql stable as $$ select answer_html from public.catalog_tasks limit 1 $$;
grant execute on function public.leak_probe_262() to authenticated;
\ir ../../migrations/PENDING_262b.sql
rollback;
\echo '== G2. Представление с answer_html, читаемое authenticated → 262b: ERROR'
begin;
create view public.leak_view_262 as select id, answer_html from public.catalog_tasks;
grant select on public.leak_view_262 to authenticated;
\ir ../../migrations/PENDING_262b.sql
rollback;
\echo '== G3. После откатов функции и представления нет, права на колонки — как после 262b'
select to_regprocedure('public.leak_probe_262()') is null and to_regclass('public.leak_view_262') is null as ok_rolled_back,
       not has_column_privilege('authenticated', 'public.catalog_tasks', 'answer_html', 'select') as ok_still_closed;
