-- §258. Проба ДО PENDING_258: прежнее тело topic_solution_state (три поля) и права.
\pset footer off
\set ON_ERROR_STOP 0
\echo '=== B0. До §258: права на функцию (anon получает EXECUTE через PUBLIC, явного revoke не было)'
select has_function_privilege('anon', 'public.topic_solution_state(uuid)', 'execute') as anon_exec,
       has_function_privilege('authenticated', 'public.topic_solution_state(uuid)', 'execute') as auth_exec;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
\echo '=== B1. До §258: S2, тема K — только has_solution / has_homework / unlocked'
select topic_solution_state('00000000-0000-4000-8000-0000007a0002');
reset role;
