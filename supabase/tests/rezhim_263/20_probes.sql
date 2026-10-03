-- §263. Пробы после PENDING_263 (применён дважды; между прогонами учитель снял оба флажка у tva2).
-- Все записи — в откатываемых блоках (begin … rollback). Ошибки ожидаемы там, где написано «отказ».
\set ON_ERROR_STOP 0
\set ON_ERROR_ROLLBACK on
\set VERBOSITY verbose
\set SHOW_CONTEXT never
\pset null '∅'
\pset footer off
\set K   '''00000000-0000-4000-8000-0000000d0002'''
\set C   '''00000000-0000-4000-8000-0000000d0004'''
\set F   '''00000000-0000-4000-8000-0000000d0003'''
\set L   '''00000000-0000-4000-8000-0000000d0001'''
\set M9  '''00000000-0000-4000-8000-0000000a7e09'''
\set k1  '''00000000-0000-4000-8000-0000000ca0a1'''
\set k2  '''00000000-0000-4000-8000-0000000ca0a2'''
\set k3  '''00000000-0000-4000-8000-0000000ca0a3'''

create or replace function pg_temp.as_user(p uuid) returns text language sql as $$
  select set_config('role', 'authenticated', false)
      || set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
$$;
create or replace function pg_temp.mode(j jsonb) returns text language sql as $$
  select case when (j->>'active')::boolean
              then 'идёт: ' || (j->>'work_kind') || ' «' || (j->>'title') || '» до ' ||
                   to_char(((j->>'closes_at')::timestamptz - now()), 'MI') || ' мин' ||
                   case when (j->>'personal')::boolean then ' (личное окно)' else '' end
              else 'нет работы' end;
$$;
create or replace function pg_temp.live(j jsonb) returns table (ученик text, попытка text, открыл text, фото int, посл_фото text, уходы text, окно text)
language sql as $$
  select s->>'full_name', coalesce(s->>'attempt_status', '—') || case when (s->>'auto_submitted')::boolean then ' (авто)' else '' end,
         case when s->>'opened_at' is null then '—' else 'да' end,
         (s->>'photos')::int,
         case when s->>'last_photo_at' is null then '—' else 'есть' end,
         (s->>'away_count') || ' раз · ' || (s->>'away_seconds') || ' с',
         case when (s->>'window_closes_at')::timestamptz <= now() then 'закрыто'
              when (s->>'window_opens_at')::timestamptz > now() then 'впереди'
              else 'идёт' end || case when (s->>'personal')::boolean then ' (личное)' else '' end
    from jsonb_array_elements(j->'students') s;
$$;
grant execute on function pg_temp.mode(jsonb) to authenticated;

\echo '=== 0. Флажки варианта: после 1-го прогона уже выданные tva1 (false/false) и tva2 (true/false) стали true/true;'
\echo '===    учитель снял оба у tva2 ПОСЛЕ применения — повторный прогон его выбор не перетёр. Default колонок — true.'
select id, show_answers_after_submit as answers, show_solutions_after_submit as solutions
  from test_variant_assignments where variant_id is not null order by id;
select column_name, column_default from information_schema.columns
 where table_name = 'test_variant_assignments' and column_name like 'show_%' order by 1;

\echo '=== 1. Одно определение: my_work_mode у каждого.'
\echo '===    S1 — K идёт; S2 — K (черновик без фото); S3 — сдал K → нет; S4 — K (не открывал); S5 — личное окно K завтра → нет;'
\echo '===    S6 — K и личное C (C кончается раньше → C); S7 — пробник 11А идёт; учитель A — нет; U (ДЗ не опубликовано) не считается.'
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select 'S1' as кто, pg_temp.mode(my_work_mode());
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2') is null as _ \gset
select 'S2' as кто, pg_temp.mode(my_work_mode());
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3') is null as _ \gset
select 'S3' as кто, pg_temp.mode(my_work_mode());
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b4') is null as _ \gset
select 'S4' as кто, pg_temp.mode(my_work_mode());
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b5') is null as _ \gset
select 'S5' as кто, pg_temp.mode(my_work_mode());
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b6') is null as _ \gset
select 'S6' as кто, pg_temp.mode(my_work_mode());
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b7') is null as _ \gset
select 'S7' as кто, pg_temp.mode(my_work_mode());
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1') is null as _ \gset
select 'учитель A' as кто, pg_temp.mode(my_work_mode());
reset role;
\echo '--- внутренняя функция определения закрыта для authenticated (ожидается отказ):'
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select count(*) from student_active_works('00000000-0000-4000-8000-0000000001b1');
reset role;

\echo '=== 2. Каталог во время работы. S1 (идёт K) — строки catalog_tasks: 0; тексты: allowed=false даже у k1, ответ которого он'
\echo '===    открыл до работы; S3 (сдал) — всё как раньше; учитель A — всё.'
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select 'S1' as кто, (select count(*) from catalog_tasks) as строк_каталога,
       (select string_agg(right(task_id::text, 3) || ':' || allowed || '/' || coalesce(reason, '∅') || '/' || coalesce(answer_html, '∅'), ' ' order by task_id)
          from catalog_task_texts(array[:k1, :k2, :k3]::uuid[])) as тексты;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3') is null as _ \gset
select 'S3' as кто, (select count(*) from catalog_tasks) as строк_каталога,
       (select string_agg(right(task_id::text, 3) || ':' || allowed || '/' || coalesce(reason, '∅') || '/' || coalesce(answer_html, '∅'), ' ' order by task_id)
          from catalog_task_texts(array[:k1, :k2, :k3]::uuid[])) as тексты;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1') is null as _ \gset
select 'учитель A' as кто, (select count(*) from catalog_tasks) as строк_каталога,
       (select string_agg(right(task_id::text, 3) || ':' || allowed || '/' || coalesce(reason, '∅'), ' ' order by task_id)
          from catalog_task_texts(array[:k1, :k2, :k3]::uuid[])) as тексты;
reset role;
\echo '--- S1 раскрывает ответы (catalog_reveal_answers, §262) — отказ WORK_MODE:'
begin;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select task_id, allowed from catalog_reveal_answers(array[:k2]::uuid[]);
rollback;
\echo '--- S1 раскрывает ответ (catalog_reveal_answer, §256) — отказ WORK_MODE:'
begin;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select catalog_reveal_answer(:k2);
rollback;
\echo '--- запись попытки каталога за S1 (так пишет catalog_check_answer под definer) — отказ сторожа WORK_MODE:'
begin;
insert into catalog_task_attempts (profile_id, task_id, answer, verdict)
values ('00000000-0000-4000-8000-0000000000b1', :k2, '6', 'correct');
rollback;
\echo '--- та же запись за S3 (работа сдана) — проходит (откат):'
begin;
insert into catalog_task_attempts (profile_id, task_id, answer, verdict)
values ('00000000-0000-4000-8000-0000000000b3', :k2, '6', 'correct') returning 'записано' as итог;
rollback;
\echo '--- S3 раскрывает k2 (работы нет) — как раньше: тексты пришли (откат):'
begin;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3') is null as _ \gset
select right(task_id::text, 3) as задача, allowed, reason, answer_html, solution_html from catalog_reveal_answers(array[:k2]::uuid[]);
rollback;
reset role;

\echo '=== 3. Материалы тем. S1 (идёт K): строки — только «Условие» K; файлы — условие K да, теория L/K нет.'
\echo '===    S3 (сдал K): теория и конспект L, условие K (после сдачи условие видно), теория K. Учитель A — всё.'
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select 'S1' as кто, string_agg(title, ', ' order by title) as строки_материалов from topic_material_items
 where id::text like '%f100%';
select 'S1' as кто, topic_material_object_visible('mat/K-condition.pdf') as условие_K,
       topic_material_object_visible('mat/L-theory.pdf') as теория_L, topic_material_object_visible('mat/K-theory.pdf') as теория_K;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3') is null as _ \gset
select 'S3' as кто, string_agg(title, ', ' order by title) as строки_материалов from topic_material_items
 where id::text like '%f100%';
select 'S3' as кто, topic_material_object_visible('mat/K-condition.pdf') as условие_K,
       topic_material_object_visible('mat/L-theory.pdf') as теория_L, topic_material_object_visible('mat/K-theory.pdf') as теория_K;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1') is null as _ \gset
select 'учитель A' as кто, string_agg(title, ', ' order by title) as строки_материалов from topic_material_items
 where id::text like '%f100%';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b7') is null as _ \gset
select 'S7 (пробник 11А)' as кто, count(*) as строк_материалов_10А from topic_material_items where id::text like '%f100%';
reset role;

\echo '=== 4. Сдал — режим снимается сразу: S1 сдаёт K (в откатываемом блоке) → нет работы, каталог и теория L открыты,'
\echo '===    k1 (открыт до работы) снова allowed/revealed.'
begin;
update topic_homework_attempts set status = 'submitted', submitted_at = now()
 where id = '00000000-0000-4000-8000-00000c020001';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select pg_temp.mode(my_work_mode()) as режим, (select count(*) from catalog_tasks) as строк_каталога,
       (select count(*) from topic_material_items where id::text like '%f100%') as строк_материалов,
       (select allowed || '/' || reason from catalog_task_texts(array[:k1]::uuid[])) as k1;
rollback;
reset role;
\echo '--- конец окна — то же: K закрылась (окно сдвинуто в прошлое, откат) → у S2 работы нет.'
begin;
update topic_homework set opens_at = now() - interval '2 hours', closes_at = now() - interval '1 minute' where id = :K;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2') is null as _ \gset
select pg_temp.mode(my_work_mode()) as режим_S2, (select count(*) from catalog_tasks) as строк_каталога;
rollback;
reset role;

\echo '=== 5. Варианты и флажки (S3, работы нет): tva1 true/true → эталон, решение, номер; tva2 (снято учителем) → ничего;'
\echo '===    tva3 true/true. В каталоге k1 (tva1) и k3 (tva3) — variant; k2 (tva2 без флажков) — закрыта.'
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3') is null as _ \gset
select 'tva1' as выдача, answer_html, solution_html, task_ext_id from get_variant_items_for_student('00000000-0000-4000-8000-0000000bd031')
union all
select 'tva2', answer_html, solution_html, task_ext_id from get_variant_items_for_student('00000000-0000-4000-8000-0000000bd032')
union all
select 'tva3', answer_html, solution_html, task_ext_id from get_variant_items_for_student('00000000-0000-4000-8000-0000000bd033');
select my_variant_answer_flags('00000000-0000-4000-8000-0000000bd032') as флажки_tva2;
select string_agg(right(task_id::text, 3) || ':' || allowed || '/' || coalesce(reason, '∅'), ' ' order by task_id) as каталог_S3
  from catalog_task_texts(array[:k1, :k2, :k3]::uuid[]);
reset role;
\echo '--- «только ответы» (tva3: answers=true, solutions=false, откат): эталон есть, решения нет; в каталоге k3 закрыта (там ответ и решение вместе).'
begin;
update test_variant_assignments set show_solutions_after_submit = false where id = '00000000-0000-4000-8000-0000000bc003';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3') is null as _ \gset
select answer_html, solution_html, task_ext_id from get_variant_items_for_student('00000000-0000-4000-8000-0000000bd033');
select allowed, reason from catalog_task_texts(array[:k3]::uuid[]);
rollback;
reset role;
\echo '--- S1: вариант V1 сдан (tva1 true/true), но идёт K → эталон и решение закрыты; флажки говорят work_mode=true.'
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select answer_html, solution_html, task_ext_id from get_variant_items_for_student('00000000-0000-4000-8000-0000000bd011');
select my_variant_answer_flags('00000000-0000-4000-8000-0000000bd011') as флажки;
\echo '--- чужая выдача: флажки — пусто (null), задачи — отказ ACCESS_DENIED:'
select my_variant_answer_flags('00000000-0000-4000-8000-0000000bd031') as чужие_флажки;
select count(*) from get_variant_items_for_student('00000000-0000-4000-8000-0000000bd031');
reset role;

\echo '=== 6. Отметки ученика. S1 открыл условие K → отметка; повтор не сдвигает время. S3 (сдал), F (завтра), S5 (личное завтра) — no-op.'
begin;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select (work_mark_opened(:K))->>'opened_at' as t1 \gset
select :'t1' is not null as первая_отметка;
select pg_sleep(0.05) is null as _ \gset
select (work_mark_opened(:K))->>'opened_at' = :'t1' as повтор_не_сдвинул;
select (work_mark_opened(:F))->>'reason' as F_завтра;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3') is null as _ \gset
select (work_mark_opened(:K))->>'reason' as S3_сдал;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b5') is null as _ \gset
select (work_mark_opened(:K))->>'reason' as S5_личное_завтра;
reset role;
select right(student_id::text, 3) as ученик, opened_at is not null as открыл, away_count, away_seconds
  from work_activity where homework_id = :K order by student_id;
\echo '--- уходы: S1 шлёт пачки (2 ухода · 70 с) и (1 · 30 с) → 3 · 100; огромные значения режутся (50 · 14400 за вызов);'
\echo '---         S7 — пробник 11А (свой) → записано; S1 — про пробник 11А (не его) → no-op; S3 (сдал) → no-op; обе работы / ни одной → отказ.'
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select (work_report_away(:K, null, 2, 70))->>'saved' as пачка1, (work_report_away(:K, null, 1, 30))->>'saved' as пачка2;
select (work_report_away(:K, null, 1000, 999999))->>'saved' as огромная;
select (work_report_away(null, :M9, 1, 10))->>'reason' as S1_чужой_пробник;
select work_report_away(:K, :M9, 1, 10);
select work_report_away(null, null, 1, 10);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b7') is null as _ \gset
select (work_report_away(null, :M9, 1, 10))->>'saved' as S7_свой_пробник;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3') is null as _ \gset
select (work_report_away(:K, null, 1, 10))->>'reason' as S3_сдал;
reset role;
select coalesce(right(homework_id::text, 4), 'M9') as работа, right(student_id::text, 3) as ученик, away_count, away_seconds
  from work_activity order by 1, 2;
\echo '--- ученик не читает отметки (даже свои) и не пишет в таблицу напрямую (отказ); учитель вызвать отметку не может (42501).'
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select count(*) as видит_строк from work_activity;
insert into work_activity (student_id, homework_id, away_count) values ('00000000-0000-4000-8000-0000000001b1', :K, 0);
update work_activity set away_count = 0;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1') is null as _ \gset
select count(*) as учитель_A_видит from work_activity;
select work_mark_opened(:K);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a3') is null as _ \gset
select count(*) as посторонний_X_видит from work_activity;
reset role;
rollback;

\echo '=== 7. Монитор K (учитель A): по ученику — попытка, открыл, фото, последнее фото, уходы, окно (S5 — личное завтра).'
begin;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select work_mark_opened(:K) is null as _ \gset
select work_report_away(:K, null, 5, 240) is null as _ \gset
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b4') is null as _ \gset
select work_mark_opened(:K) is null as _ \gset
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1') is null as _ \gset
select j->>'title' as работа, j->>'kind' as тип, j->>'group_name' as класс,
       (j->>'closes_at')::timestamptz > now() as идёт, jsonb_array_length(j->'students') as учеников
  from timed_work_live(:K) j;
select * from pg_temp.live(timed_work_live(:K));
\echo '--- владелец курса O — видит; посторонний X, преподаватель другого класса B, ученик S1 — отказ 42501; урок L — отказ 22023.'
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a0') is null as _ \gset
select jsonb_array_length(timed_work_live(:K)->'students') as владелец_O;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a3') is null as _ \gset
select timed_work_live(:K);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2') is null as _ \gset
select timed_work_live(:K);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select timed_work_live(:K);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1') is null as _ \gset
select timed_work_live(:L);
reset role;
rollback;
\echo '--- итог после конца окна (C, закрылась час назад): S1–S4 сдали сами, S5 — автоматически, S6 — личное окно идёт.'
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1') is null as _ \gset
select * from pg_temp.live(timed_work_live(:C));
reset role;

\echo '=== 8. Главная учителя: идущие работы. A — K (общее окно) и C (личное окно S6 идёт); U (не опубликовано) — нет.'
\echo '===    X (посторонний) — пусто; ученик S1 — пусто.'
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1') is null as _ \gset
select x->>'title' as работа, x->>'personal_live' as личных_идёт from jsonb_array_elements(my_live_timed_works()) x;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a3') is null as _ \gset
select my_live_timed_works() as посторонний_X;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1') is null as _ \gset
select my_live_timed_works() as ученик_S1;
reset role;

\echo '=== 9. Уходы на пробнике — монитору пробника: преподаватель 11А (B) видит, преподаватель 10А (A) — отказ 42501.'
begin;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b7') is null as _ \gset
select work_report_away(null, :M9, 2, 45) is null as _ \gset
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2') is null as _ \gset
select mock_exam_away(:M9) as преподаватель_B;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1') is null as _ \gset
select mock_exam_away(:M9);
reset role;
rollback;

\echo '=== 10. anon: ни одна новая функция не исполнима (отказ).'
set role anon;
select my_work_mode();
select timed_work_live(:K);
reset role;
\echo '=== 11. Права на функции (has_function_privilege authenticated / anon).'
select f as функция, has_function_privilege('authenticated', f, 'execute') as authenticated, has_function_privilege('anon', f, 'execute') as anon
  from unnest(array['public.student_active_works(uuid)', 'public.work_mode_active_for_profile(uuid)', 'public.my_work_mode()',
                    'public.work_mark_opened(uuid)', 'public.work_report_away(uuid,uuid,integer,integer)', 'public.timed_work_live(uuid)',
                    'public.my_live_timed_works()', 'public.mock_exam_away(uuid)', 'public.my_variant_answer_flags(uuid)',
                    'public.catalog_answer_reasons(uuid,uuid[])', 'public.catalog_work_mode_guard()']) f;
