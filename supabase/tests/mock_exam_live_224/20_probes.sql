-- §224. Пробы прав и триггера. Каждая проба — в откатываемом блоке; роль и
-- claims — ОТДЕЛЬНЫМИ операторами (CLAUDE.md, §29.4). now() внутри блока
-- постоянен, время двигается сдвигом starts_at / last_seen_at под владельцем
-- таблиц ДО переключения роли.
\pset footer off
\set E4 '''50000000-0000-0000-0000-000000000004'''
\set E3 '''50000000-0000-0000-0000-000000000003'''
\set E5 '''50000000-0000-0000-0000-000000000005'''
\set T11A    '''{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}'''
\set T11B    '''{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}'''
\set CUR     '''{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'''
\set S1      '''{"sub":"00000000-0000-0000-0000-000000000051","role":"authenticated"}'''
\set S2      '''{"sub":"00000000-0000-0000-0000-000000000052","role":"authenticated"}'''
\set S11B    '''{"sub":"00000000-0000-0000-0000-000000000053","role":"authenticated"}'''

\echo '=================== P. ПИНГ ==================='
\echo '--- P1. свой ученик, окно открыто: первый пинг создаёт бланк (opened_at, 12 пустых полей)'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select public.mock_exam_ping(:E4) - 'server_now' as ping1;
\echo '--- P2. сразу второй пинг — no-op (чаще раза в 10 с база не пишет)'
select public.mock_exam_ping(:E4) - 'server_now' as ping2;
select opened_at = now() as opened_now, last_seen_at = now() as seen_now, array_length(answers, 1) as fields,
       (select count(*) from unnest(answers) a where a is not null) as filled, submitted_at
  from mock_exam_sheets where mock_exam_id = :E4;
\echo '--- P2b. бланк мимо функции — не записать (ни last_seen_at, ни вставки)'
savepoint a;
update mock_exam_sheets set last_seen_at = now() where mock_exam_id = :E4;
rollback to savepoint a;
insert into mock_exam_sheets (mock_exam_id, student_id, opened_at) values (:E4, '20000000-0000-0000-0000-000000000052', now());
rollback;

\echo '--- P3. через 11 с после прошлого пинга — пишет; opened_at не меняется'
begin;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, opened_at, last_seen_at)
values (:E4, '20000000-0000-0000-0000-000000000051', array_fill(null::text, array[12]), now() - interval '5 minutes', now() - interval '11 seconds');
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select public.mock_exam_ping(:E4) - 'server_now' as ping_after_11s;
select opened_at = now() - interval '5 minutes' as opened_kept, last_seen_at = now() as seen_now from mock_exam_sheets where mock_exam_id = :E4;
rollback;

\echo '--- P4. через 9 с — no-op'
begin;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, opened_at, last_seen_at)
values (:E4, '20000000-0000-0000-0000-000000000051', array_fill(null::text, array[12]), now() - interval '5 minutes', now() - interval '9 seconds');
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select public.mock_exam_ping(:E4) - 'server_now' as ping_after_9s;
select last_seen_at = now() - interval '9 seconds' as seen_unchanged from mock_exam_sheets where mock_exam_id = :E4;
rollback;

\echo '--- P5. ученик ЧУЖОЙ группы (11Б) пингует пробник 11А — отказ'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S11B, true) \g /dev/null
select public.mock_exam_ping(:E4);
rollback;
\echo '--- P6. преподаватель группы пингует — отказ (он не ученик)'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.mock_exam_ping(:E4);
rollback;
\echo '--- P7. anon — нет права execute'
begin;
select set_config('role', 'anon', true) \g /dev/null
select public.mock_exam_ping(:E4);
rollback;

\echo '--- P8. до начала (E3 начнётся через час) — no-op, бланк не создан'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select public.mock_exam_ping(:E3) - 'server_now' as ping_before_start;
select count(*) as sheets_e3 from mock_exam_sheets where mock_exam_id = :E3;
rollback;
\echo '--- P9. после конца окна (E4 сдвинут: кончился 1 мин назад) — no-op, last_seen_at не тронут'
begin;
update mock_exams set starts_at = now() - interval '241 minutes' where id = :E4;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, opened_at, last_seen_at)
values (:E4, '20000000-0000-0000-0000-000000000051', array_fill(null::text, array[12]), now() - interval '3 hours', now() - interval '2 hours');
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select public.mock_exam_ping(:E4) - 'server_now' as ping_after_end;
select last_seen_at = now() - interval '2 hours' as seen_unchanged from mock_exam_sheets where mock_exam_id = :E4;
rollback;
\echo '--- P10. пробник без окна (E5) — no-op'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select public.mock_exam_ping(:E5) - 'server_now' as ping_no_window;
rollback;
\echo '--- P11. после сдачи: пинг пишет только last_seen_at; ответы, сдача, updated_at — прежние'
begin;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, submitted_at, updated_at, opened_at, last_seen_at)
values (:E4, '20000000-0000-0000-0000-000000000051', array['12','0,75',null,null,null,null,null,null,null,null,null,null],
        now() - interval '1 minute', now() - interval '2 minutes', now() - interval '20 minutes', now() - interval '1 minute');
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select public.mock_exam_ping(:E4) - 'server_now' as ping_after_submit;
select answers[1:3] as answers_1_3, submitted_at = now() - interval '1 minute' as submitted_kept,
       updated_at = now() - interval '2 minutes' as updated_kept, last_seen_at = now() as seen_now
  from mock_exam_sheets where mock_exam_id = :E4;
\echo '--- P11b. и ответ после сдачи по-прежнему не пишется'
select public.save_mock_exam_answer(:E4, 3, '5');
rollback;
\echo '--- P12. пинг, потом ответ: поле ложится на своё место (не сдвигается в пустом массиве)'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S2, true) \g /dev/null
select public.mock_exam_ping(:E4) - 'server_now' as ping;
select public.save_mock_exam_answer(:E4, 5, '7') - 'saved_at' as saved;
select r->'answers' as answers from public.my_mock_exam(:E4) r;
rollback;

\echo '=================== L. МОНИТОР mock_exam_live ==================='
\echo '--- L1. ученик своей группы — отказ'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select public.mock_exam_live(:E4);
rollback;
\echo '--- L2. преподаватель ЧУЖОЙ группы (11Б) — отказ'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11B, true) \g /dev/null
select public.mock_exam_live(:E4);
rollback;
\echo '--- L3. anon — нет права execute'
begin;
select set_config('role', 'anon', true) \g /dev/null
select public.mock_exam_live(:E4);
rollback;
\echo '--- L4. преподаватель группы: S1 пишет (пинг 30 с назад, 2 ответа), S2 был 80 с назад, S4 сдал (фото 1), ключа и ответов в ответе нет'
begin;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, opened_at, last_seen_at) values
 (:E4, '20000000-0000-0000-0000-000000000051', array['12',' ',null,'секрет',null,null,null,null,null,null,null,null], now() - interval '20 minutes', now() - interval '30 seconds'),
 (:E4, '20000000-0000-0000-0000-000000000052', array_fill(null::text, array[12]), now() - interval '25 minutes', now() - interval '80 seconds');
insert into mock_exam_sheets (mock_exam_id, student_id, answers, submitted_at, opened_at, last_seen_at) values
 (:E4, '20000000-0000-0000-0000-000000000054', array['1','2','3','4','5','6','7','8','9','10','11','12'], now() - interval '1 minute', now() - interval '28 minutes', now() - interval '10 seconds');
insert into mock_exam_photos (mock_exam_id, student_id, storage_path, file_name) values
 (:E4, '20000000-0000-0000-0000-000000000054', '50000000-0000-0000-0000-000000000004/photos/20000000-0000-0000-0000-000000000054/1.jpg', '1.jpg');
insert into mock_exam_answer_keys (mock_exam_id, answers) values (:E4, array['12','1','1','ключ-ответ','1','1','1','1','1','1','1','1']);
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select (r->>'server_now')::timestamptz = now() as server_now_is_db, r->>'part1_last' as part1_last,
       r ? 'key' as has_key, r::text like '%"answers"%' as has_answers_arr,
       r::text like '%секрет%' as leaks_answer, r::text like '%ключ-ответ%' as leaks_key
  from public.mock_exam_live(:E4) r;
select x->>'name' as name, x->>'online' as online, x->>'answered' as answered, (x->>'submitted_at') is not null as submitted,
       x->>'photos' as photos, (x->>'opened_at') is not null as opened
  from public.mock_exam_live(:E4) r, jsonb_array_elements(r->'students') x;
\echo '--- L5. куратор курса — видит (персонал курса), тот же список'
select set_config('request.jwt.claims', :CUR, true) \g /dev/null
select jsonb_array_length(r->'students') as students from public.mock_exam_live(:E4) r;
rollback;
\echo '--- L6. окно закрылось: онлайн нет ни у кого, даже при свежем пинге'
begin;
update mock_exams set starts_at = now() - interval '241 minutes' where id = :E4;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, opened_at, last_seen_at) values
 (:E4, '20000000-0000-0000-0000-000000000051', array_fill(null::text, array[12]), now() - interval '20 minutes', now() - interval '5 seconds');
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select x->>'name' as name, x->>'online' as online from public.mock_exam_live(:E4) r, jsonb_array_elements(r->'students') x
 where x->>'has_sheet' = 'true';
rollback;

\echo '=================== M. РАЗДЕЛ «ПРОБНИКИ» (my_mock_exams) ==================='
\echo '--- M1. свой ученик: E3 (с разделом) и E4 (без раздела) — видны; E5 (без времени) — нет'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select x->>'title' as title, x->>'module_id' is not null as has_module, x->>'has_work' as has_work, x->>'score' as score
  from public.my_mock_exams('40000000-0000-0000-0000-000000000001') r, jsonb_array_elements(r) x;
rollback;
\echo '--- M2. открыл и ушёл (только пинг) — has_work = false; с ответом — true'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select public.mock_exam_ping(:E4) - 'server_now' as ping;
select x->>'has_work' as has_work_after_ping from public.my_mock_exams('40000000-0000-0000-0000-000000000001') r, jsonb_array_elements(r) x where x->>'id' = '50000000-0000-0000-0000-000000000004';
select public.save_mock_exam_answer(:E4, 1, '12') - 'saved_at' as saved;
select x->>'has_work' as has_work_after_answer from public.my_mock_exams('40000000-0000-0000-0000-000000000001') r, jsonb_array_elements(r) x where x->>'id' = '50000000-0000-0000-0000-000000000004';
rollback;
\echo '--- M3. ученик чужой группы спрашивает список 11А — пусто'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S11B, true) \g /dev/null
select public.my_mock_exams('40000000-0000-0000-0000-000000000001') as list;
rollback;
\echo '--- M4. итог в списке — только после «Уведомить» И конца окна'
begin;
insert into mock_exam_results (mock_exam_id, student_id, score, notified_at) values (:E4, '20000000-0000-0000-0000-000000000051', 70, now());
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select x->>'score' as score_while_running, x->>'notified' as notified from public.my_mock_exams('40000000-0000-0000-0000-000000000001') r, jsonb_array_elements(r) x where x->>'id' = '50000000-0000-0000-0000-000000000004';
select set_config('role', 'postgres', true) \g /dev/null
update mock_exams set starts_at = now() - interval '5 hours' where id = :E4;
select set_config('role', 'authenticated', true) \g /dev/null
select x->>'score' as score_after_end, x->>'max_score' as max_score, x->>'notified' as notified from public.my_mock_exams('40000000-0000-0000-0000-000000000001') r, jsonb_array_elements(r) x where x->>'id' = '50000000-0000-0000-0000-000000000004';
rollback;

\echo '=================== G. ПРОВЕРКА ПО КЛЮЧУ НЕ ТРОГАЕТ ПУСТОЙ БЛАНК ==================='
\echo '--- G1. после конца: S1 открыл и ушёл (пинг), S2 ответил на №1 — проверен только S2'
begin;
insert into mock_exam_sheets (mock_exam_id, student_id, answers, opened_at, last_seen_at) values
 (:E4, '20000000-0000-0000-0000-000000000051', array_fill(null::text, array[12]), now() - interval '3 hours', now() - interval '3 hours'),
 (:E4, '20000000-0000-0000-0000-000000000052', array['12',null,null,null,null,null,null,null,null,null,null,null], now() - interval '3 hours', now() - interval '3 hours');
insert into mock_exam_answer_keys (mock_exam_id, answers) values (:E4, array['12','1','1','1','1','1','1','1','1','1','1','1']);
update mock_exams set starts_at = now() - interval '5 hours' where id = :E4;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.grade_mock_exam_part1(:E4) as grade;
select s.profile_id is not null as has_profile, r.student_id, r.score from mock_exam_results r join students s on s.id = r.student_id where r.mock_exam_id = :E4;
rollback;

\echo '=================== N. УВЕДОМЛЕНИЯ О НАЧАЛЕ (триггер) ==================='
\echo '--- N1. время назначено за 3 ч: каждому ученику 11А (3) — «через час» (за 1 ч) и «начался»'
begin;
update mock_exams set starts_at = date_trunc('minute', now()) + interval '3 hours' where id = :E5;
select event_type, count(*) as rows, min(status::text) as status,
       min(scheduled_for) - date_trunc('minute', now()) as at_from_now, min(payload->>'link') as link
  from notification_queue where entity_id = :E5 group by event_type order by event_type;
\echo '--- N2. перенос на +5 ч: старые 6 строк cancelled, новые 6 pending с другим ключом'
update mock_exams set starts_at = date_trunc('minute', now()) + interval '5 hours' where id = :E5;
select status, event_type, count(*) as rows, min(scheduled_for) - date_trunc('minute', now()) as at_from_now
  from notification_queue where entity_id = :E5 group by status, event_type order by status, event_type;
\echo '--- N3. правка названия: строк не прибавилось, у pending новый текст'
update mock_exams set title = 'Пробник №5 — переименован' where id = :E5;
select status, count(*) as rows, min(payload->>'title') as title from notification_queue where entity_id = :E5 group by status order by status;
\echo '--- N4. одна строка уже ушла (sent); правка длительности — её не трогаем, остальные pending с новым концом'
update notification_queue set status = 'sent' where id = (select id from notification_queue where entity_id = :E5 and status = 'pending' order by deduplication_key limit 1);
update mock_exams set duration_minutes = 180 where id = :E5;
select status, (payload->>'ends_at')::timestamptz - (payload->>'starts_at')::timestamptz as window_in_payload, count(*) as rows
  from notification_queue where entity_id = :E5 group by 1, 2 order by 1, 2;
\echo '--- N5. перенос «в прошлое» (началось 10 мин назад): всё pending погашено, новых нет'
update mock_exams set starts_at = now() - interval '10 minutes' where id = :E5;
select status, count(*) as rows from notification_queue where entity_id = :E5 group by status order by status;
\echo '--- N6. перенос на +30 мин: «через час» уже в прошлом — только «начался»'
update mock_exams set starts_at = date_trunc('minute', now()) + interval '30 minutes' where id = :E5;
select event_type, count(*) from notification_queue where entity_id = :E5 and status = 'pending' group by event_type;
\echo '--- N7. время снято (starts_at = null): pending не осталось'
update mock_exams set starts_at = null where id = :E5;
select count(*) as pending from notification_queue where entity_id = :E5 and status = 'pending';
\echo '--- N8. вернули +5 ч (как в N2): погашенные строки ожили, дублей нет'
update mock_exams set starts_at = date_trunc('minute', now()) + interval '5 hours', duration_minutes = 240 where id = :E5;
select status, count(*) as rows from notification_queue where entity_id = :E5 group by status order by status;
select count(*) as dup_keys from (select deduplication_key from notification_queue group by 1 having count(*) > 1) d;
\echo '--- N9. пробник перевели в группу 11Б: строки 11А погашены, ученику 11Б — 2 строки'
update mock_exams set group_id = '40000000-0000-0000-0000-000000000002' where id = :E5;
select q.status, s.id is not null as is_11b, count(*) from notification_queue q
  left join students s on s.profile_id = q.profile_id and s.id = '20000000-0000-0000-0000-000000000053'
 where q.entity_id = :E5 group by 1, 2 order by 1, 2;
\echo '--- N10. пробник удалён: pending не осталось'
delete from mock_exams where id = :E5;
select count(*) as pending_after_delete from notification_queue where entity_id = :E5 and status = 'pending';
rollback;

\echo '--- N11. под преподавателем группы (RLS mock_exams_manage): назначил время — строки встали (триггер definer), ему самому очередь не видна'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
update mock_exams set starts_at = date_trunc('minute', now()) + interval '2 hours' where id = :E5;
select count(*) as queue_visible_to_teacher from notification_queue;
select set_config('role', 'postgres', true) \g /dev/null
select event_type, count(*) from notification_queue where entity_id = :E5 and status = 'pending' group by event_type order by event_type;
rollback;
\echo '--- N12. ученик не может поставить строку в очередь сам и не видит её'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
select count(*) as queue_visible_to_student from notification_queue;
insert into notification_queue (profile_id, event_type, deduplication_key) values ('00000000-0000-0000-0000-000000000051', 'mock_exam_started', 'x');
rollback;
\echo '--- N13. ученик не может сдвинуть время пробника (и тем самым очередь)'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :S1, true) \g /dev/null
update mock_exams set starts_at = now() + interval '1 day' where id = :E5;
rollback;
\echo '--- N14. функцию триггера нельзя позвать напрямую'
begin;
select set_config('role', 'authenticated', true) \g /dev/null
select set_config('request.jwt.claims', :T11A, true) \g /dev/null
select public.mock_exam_schedule_notifications();
rollback;
