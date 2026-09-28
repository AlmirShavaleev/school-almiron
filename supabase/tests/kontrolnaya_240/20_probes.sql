-- §240. Пробы после PENDING_240 (дважды). Записи — в откатываемых блоках;
-- роль authenticated + request.jwt.claims отдельным оператором (§29.4).
-- Под владельцем таблиц (postgres) RLS не проверяется — пробы прав только
-- под authenticated.
\pset footer off
\set ON_ERROR_STOP 0
-- Ошибка внутри блока откатывает только свой оператор: пробы отказов идут
-- вперемешку с разрешёнными действиями в одной транзакции.
\set ON_ERROR_ROLLBACK on
\set A  '00000000-0000-4000-8000-0000000000a1'
\set X  '00000000-0000-4000-8000-0000000000a3'
\set S1 '00000000-0000-4000-8000-0000000001b1'
\set S2 '00000000-0000-4000-8000-0000000001b2'
\set S3 '00000000-0000-4000-8000-0000000001b3'
\set S4 '00000000-0000-4000-8000-0000000001b4'
\set S5 '00000000-0000-4000-8000-0000000001b5'
\set S6 '00000000-0000-4000-8000-0000000001b6'
\set S7 '00000000-0000-4000-8000-0000000001b7'
\set TL '00000000-0000-4000-8000-0000007a0001'
\set TK '00000000-0000-4000-8000-0000007a0002'
\set TF '00000000-0000-4000-8000-0000007a0003'
\set TC '00000000-0000-4000-8000-0000007a0004'
\set TN '00000000-0000-4000-8000-0000007a0005'
\set HL '00000000-0000-4000-8000-0000000d0001'
\set HK '00000000-0000-4000-8000-0000000d0002'
\set HF '00000000-0000-4000-8000-0000000d0003'
\set HC '00000000-0000-4000-8000-0000000d0004'
\set HN '00000000-0000-4000-8000-0000000d0005'
\set C1 '00000000-0000-4000-8000-00000c0a0001'
\set C2 '00000000-0000-4000-8000-00000c0a0002'
\set C3 '00000000-0000-4000-8000-00000c0a0003'
\set C4 '00000000-0000-4000-8000-00000c0a0004'
\set C5 '00000000-0000-4000-8000-00000c0a0005'
\set C6 '00000000-0000-4000-8000-00000c0a0006'

\echo '=== 0. Схема: тип тем (прежние — lesson), окно, отметка автосдачи; задание cron одно'
select t.title, t.kind, h.opens_at is not null as has_window from topics t left join topic_homework h on h.topic_id = t.id
 where t.module_id = '00000000-0000-4000-8000-0000000e0001' order by t.order_index;
select count(*) filter (where kind = 'lesson') as lesson_topics_elsewhere from topics where module_id <> '00000000-0000-4000-8000-0000000e0001';
select jobname, schedule, command from cron_probe.job;
\echo '=== 0b. CHECK: окно «закрывается раньше открытия» и половинчатое окно — отказ; неизвестный тип — отказ'
update topic_homework set opens_at = now(), closes_at = now() - interval '1 minute' where id = :'HK';
update topic_homework set opens_at = now(), closes_at = null where id = :'HK';
update topics set kind = 'exam' where id = :'TK';

-- ═══ Ученик S2 ══════════════════════════════════════════════════════════════
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
\echo '=== 1. S2: условие (worksheet_homework) по темам: урок L — есть; K (идёт) — есть; F (завтра) — нет; C (закрылась) — есть; N (без времени; у S2 там сданная работа) — есть'
select t.code, count(i.id) as cond_rows
  from (values ('L', :'TL'::uuid), ('K', :'TK'::uuid), ('F', :'TF'::uuid), ('C', :'TC'::uuid), ('N', :'TN'::uuid)) t(code, id)
  left join topic_material_items i on i.topic_id = t.id and i.section = 'worksheet_homework'
 group by t.code order by t.code;
\echo '=== 1a. S4 (в теме N попыток нет): условие N — нет; у S2 оно видно, потому что у него уже есть сданная работа'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b4","role":"authenticated"}', false) \g /dev/null
select count(*) as cond_N_for_S4 from topic_material_items where topic_id = :'TN' and section = 'worksheet_homework';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
\echo '=== 1b. S2: объекты хранилища условий (topic-materials): все, кроме F'
select t.title from storage.objects o join topics t on o.name = t.id || '/cond.pdf'
 where o.bucket_id = 'topic-materials' order by 1;
\echo '=== 1c. S2: условие файлом ДЗ (строки topic_homework_files и объекты topic-homework): урок и K — есть, F — нет'
select h.title, count(f.id) from topic_homework h left join topic_homework_files f on f.homework_id = h.id
 where h.id in (:'HL', :'HK', :'HF') group by h.title order by 1;
select name from storage.objects where bucket_id = 'topic-homework' order by 1;
\echo '=== 1d. S2: конспект (не условие) у F виден как раньше — прячется только условие'
select count(*) as notes_F from topic_material_items where topic_id = :'TF' and section = 'notes';

\echo '=== 2. S2: начать F (не началась), N (без времени), C (вышло) — отказ с понятным текстом'
select topic_homework_start_attempt(:'HF');
select topic_homework_start_attempt(:'HN');
\echo '    (C: у S2 уже есть черновик без фото — RPC возвращает его, как раньше; новую попытку сторож не создаст)'
select topic_homework_start_attempt(:'HC') = :'C2' as returns_existing_draft;
\echo '=== 2b. S2 в C (вне окна): залить фото — отказ (строка и объект); сдать — отказ; удалить черновик — отказ'
insert into topic_homework_attempt_files (attempt_id, storage_path, file_name) values (:'C2', :'C2' || '/late.jpg', 'late.jpg');
insert into storage.objects (bucket_id, name) values ('topic-homework-attempts', :'C2' || '/late.jpg');
select topic_homework_submit_attempt(:'C2');
update topic_homework_attempts set status = 'submitted' where id = :'C2';
delete from topic_homework_attempts where id = :'C2';
\echo '=== 2c. S1 в C (вне окна, черновик с фото): удалить фото — ни строка, ни объект не удаляются (0 строк)'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', false) \g /dev/null
delete from topic_homework_attempt_files where attempt_id = :'C1';
delete from storage.objects where bucket_id = 'topic-homework-attempts' and name like :'C1' || '/%';
select count(*) as s1_files_still_there from topic_homework_attempt_files where attempt_id = :'C1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null

\echo '=== 3. S2 в K (идёт): начать → залить фото (строка + объект) → переставить → сдать; время сдачи — серверное'
begin;
select topic_homework_start_attempt(:'HK') as k_attempt \gset
select attempt_number, status from topic_homework_attempts where id = :'k_attempt';
insert into topic_homework_attempt_files (attempt_id, storage_path, file_name, mime_type) values (:'k_attempt', :'k_attempt' || '/p1.jpg', 'p1.jpg', 'image/jpeg');
insert into storage.objects (bucket_id, name) values ('topic-homework-attempts', :'k_attempt' || '/p1.jpg');
update topic_homework_attempt_files set position = 0 where attempt_id = :'k_attempt';
\echo '    отметку «сдано автоматически» ученик себе не ставит'
update topic_homework_attempts set auto_submitted = true where id = :'k_attempt';
update topic_homework_attempts set status = 'submitted', submitted_at = now() - interval '1 day' where id = :'k_attempt';
select status, auto_submitted, submitted_at > now() - interval '1 minute' as server_time from topic_homework_attempts where id = :'k_attempt';
\echo '    после сдачи — фото не удалить (как у ДЗ), новую попытку не начать: RPC вернёт сданную'
delete from topic_homework_attempt_files where attempt_id = :'k_attempt';
select topic_homework_start_attempt(:'HK') = :'k_attempt' as same_attempt;
rollback;

\echo '=== 4. S2 в N: одна попытка — у S2 возвращённая (наследие), даже при открытом окне новую не начать'
reset role;
begin;
update topic_homework set opens_at = now() - interval '5 minutes', closes_at = now() + interval '5 minutes' where id = :'HN';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
select topic_homework_start_attempt(:'HN');
rollback;

\echo '=== 5. S2: решение и критерии в C — нет (работа не проверена)'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
select section, count(*) from topic_material_items where topic_id = :'TC' group by section order by 1;
\echo '=== 5b. S2: личные окна — видит только своё (своего нет)'
select count(*) as windows_seen from topic_homework_personal_windows;
\echo '=== 5c. S2: своё окно и серверное время (K: общее окно, timed)'
select (w->>'timed')::boolean as timed, (w->>'personal')::boolean as personal,
       (w->>'opens_at')::timestamptz < now() and now() < (w->>'closes_at')::timestamptz as live,
       abs(extract(epoch from (w->>'server_now')::timestamptz - now())) < 1 as server_now
  from topic_homework_my_window(:'HK') w;
select app_server_now() is not null as server_now_ok;
\echo '=== 5d. S2: личное окно не поставить и сводку не прочитать'
select topic_homework_set_personal_window(:'HC', :'S2', now(), now() + interval '1 hour');
select topic_homework_timed_summary(:'HC');
\echo '=== 5e. S2: автосдачу не вызвать'
select topic_homework_autosubmit_due();

-- ═══ Ученик S4 (личное окно идёт) и S5 (личное окно закрылось) ═══════════════
\echo '=== 6. S4 в C: личное окно заменяет общее — условие видно, фото заливается, сдать можно'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b4","role":"authenticated"}', false) \g /dev/null
begin;
select count(*) as cond_rows from topic_material_items where topic_id = :'TC' and section = 'worksheet_homework';
select (w->>'personal')::boolean as personal from topic_homework_my_window(:'HC') w;
insert into topic_homework_attempt_files (attempt_id, storage_path, file_name) values (:'C4', :'C4' || '/p2.jpg', 'p2.jpg');
select topic_homework_submit_attempt(:'C4');
select status, auto_submitted from topic_homework_attempts where id = :'C4';
rollback;
\echo '=== 6b. S5 в C: личное окно закрылось — фото не залить'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b5","role":"authenticated"}', false) \g /dev/null
insert into topic_homework_attempt_files (attempt_id, storage_path, file_name) values (:'C5', :'C5' || '/p2.jpg', 'p2.jpg');

-- ═══ Автосдача (как её зовёт pg_cron — владельцем) ═══════════════════════════
reset role;
\echo '=== 7. Автосдача: S1 (фото, общее окно) и S5 (фото, личное окно закрылось) и S6 (фото, уведомление падает) — сданы;'
\echo '       S2 (без фото) — черновик; S4 (личное окно идёт) — черновик; S3 — как был'
select topic_homework_autosubmit_due() as autosubmitted;
select s.full_name, a.status, a.auto_submitted,
       case when a.submitted_at is null then null
            when a.submitted_at = h.closes_at then 'время закрытия (общее)'
            when a.submitted_at = w.closes_at then 'время закрытия (личное)'
            else 'сам' end as submitted
  from topic_homework_attempts a join topic_homework h on h.id = a.homework_id
  join students st on st.id = a.student_id join profiles s on s.id = st.profile_id
  left join topic_homework_personal_windows w on w.homework_id = a.homework_id and w.student_id = a.student_id
 where a.homework_id = :'HC' order by s.full_name;
\echo '    уведомления: у S1 и S5 есть; у S6 сбой уведомления не откатил сдачу'
select s.full_name from probe_notify n join topic_homework_attempts a on a.id = n.attempt_id
  join students st on st.id = a.student_id join profiles s on s.id = st.profile_id order by 1;
\echo '=== 7b. Повторный запуск ничего не меняет'
select topic_homework_autosubmit_due() as autosubmitted_again;
select count(*) as notifications from probe_notify;

-- ═══ Преподаватель A ═══════════════════════════════════════════════════════
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
\echo '=== 8. A видит всё: условие F (до открытия), критерии и решение C'
select t.code, i.section, count(*) from (values ('F', :'TF'::uuid), ('C', :'TC'::uuid)) t(code, id)
  join topic_material_items i on i.topic_id = t.id group by 1, 2 order by 1, 2;
\echo '=== 9. Вернуть на доработку работу по времени — отказ (RPC и прямой UPDATE)'
select topic_homework_review_attempt(:'C1', 'returned_for_revision', 'Переделай');
update topic_homework_attempts set status = 'returned_for_revision' where id = :'C1';
\echo '=== 10. Сводка по C: сдали сами / автоматически / не сдали / в классе'
select topic_homework_timed_summary(:'HC') - 'server_now' - 'opens_at' - 'closes_at' as summary;
\echo '=== 11. «Открыть заново»: S2 (не сдал) — да; S1 (сдано автоматически) — нет; S7 (другой курс) — нет'
begin;
select topic_homework_set_personal_window(:'HC', :'S2', now() - interval '1 minute', now() + interval '44 minutes');
select topic_homework_set_personal_window(:'HC', :'S1', now(), now() + interval '1 hour');
select topic_homework_set_personal_window(:'HC', :'S7', now(), now() + interval '1 hour');
select topic_homework_set_personal_window(:'HC', :'S2', now(), now() - interval '1 hour');
select topic_homework_set_personal_window(:'HL', :'S2', now(), now() + interval '1 hour');
\echo '    …и S2 теперь в окне: фото заливается, сдача проходит'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
select count(*) as windows_seen_by_S2 from topic_homework_personal_windows;
insert into topic_homework_attempt_files (attempt_id, storage_path, file_name) values (:'C2', :'C2' || '/p1.jpg', 'p1.jpg');
select topic_homework_submit_attempt(:'C2');
select status, auto_submitted from topic_homework_attempts where id = :'C2';
\echo '    …а после сдачи снять личное окно уже нельзя'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
select topic_homework_clear_personal_window(:'HC', :'S2');
rollback;
\echo '=== 11b. Снять личное окно S4 (не сдано) — можно'
begin;
select topic_homework_clear_personal_window(:'HC', :'S4');
select count(*) as windows_left from topic_homework_personal_windows;
rollback;
\echo '=== 12. Решение и критерии — после проверки: A принимает S3, S3 видит решение и критерии (строки и объекты); S2 — нет'
begin;
select topic_homework_review_attempt(:'C3', 'accepted', 'Хорошо', 4) is not null as accepted;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}', false) \g /dev/null
select section, count(*) from topic_material_items where topic_id = :'TC' group by section order by 1;
select split_part(name, '/', 2) as file from storage.objects where bucket_id = 'topic-materials' and name like :'TC' || '/%' order by 1;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
select split_part(name, '/', 2) as file_for_S2 from storage.objects where bucket_id = 'topic-materials' and name like :'TC' || '/%' order by 1;
rollback;

-- ═══ Посторонний преподаватель X ═══════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', false) \g /dev/null
\echo '=== 13. X: личное окно, снятие, сводка — отказ; личных окон не видит'
select topic_homework_set_personal_window(:'HC', :'S2', now(), now() + interval '1 hour');
select topic_homework_clear_personal_window(:'HC', :'S4');
select topic_homework_timed_summary(:'HC');
select count(*) as windows_seen from topic_homework_personal_windows;
\echo '=== 13b. X: вердикт по чужой работе — отказ (как раньше)'
select topic_homework_review_attempt(:'C3', 'accepted', null, 4);

-- ═══ Обычное ДЗ не изменилось ════════════════════════════════════════════════
\echo '=== 14. Урок L: S2 начинает, заливает, сдаёт после срока (срок мягкий); A возвращает; S2 начинает попытку №2; возврат виден'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
begin;
select topic_homework_start_attempt(:'HL') as l_attempt \gset
insert into topic_homework_attempt_files (attempt_id, storage_path, file_name) values (:'l_attempt', :'l_attempt' || '/p1.jpg', 'p1.jpg');
insert into storage.objects (bucket_id, name) values ('topic-homework-attempts', :'l_attempt' || '/p1.jpg');
delete from storage.objects where name = :'l_attempt' || '/p1.jpg';
select topic_homework_submit_attempt(:'l_attempt');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false) \g /dev/null
select topic_homework_review_attempt(:'l_attempt', 'returned_for_revision', 'Исправь задачу 2') is not null as returned;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', false) \g /dev/null
select a.attempt_number, a.status, a.auto_submitted from topic_homework_attempts a where a.homework_id = :'HL' order by 1;
select topic_homework_start_attempt(:'HL') is not null as second_attempt;
select attempt_number, status from topic_homework_attempts where homework_id = :'HL' order by 1;
\echo '    решение урока до принятия закрыто, как раньше'
select count(*) as solution_rows from topic_material_items where topic_id = :'TL' and section = 'solution';
rollback;
reset role;

-- ═══ Каркас → классы ═══════════════════════════════════════════════════════
\echo '=== 15. Смена типа темы в каркасе уезжает в копии; окно копии синхронизация не трогает и из каркаса не приносит'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a0","role":"authenticated"}', false) \g /dev/null
update topic_homework set opens_at = now() + interval '2 days', closes_at = now() + interval '2 days 45 minutes'
 where topic_id = (select id from topics where source_topic_id = '00000000-0000-4000-8000-000000070001'
                    and module_id in (select id from modules where course_id = '00000000-0000-4000-8000-0000000c0001'));
update topics set kind = 'control' where id = '00000000-0000-4000-8000-000000070001';
update topic_homework set title = 'Контрольная работа №1', opens_at = now(), closes_at = now() + interval '1 hour'
 where topic_id = '00000000-0000-4000-8000-000000070001';
select c.title, t.kind, h.title as hw_title,
       case when h.opens_at is null then 'нет окна' when c.is_template then 'окно каркаса' else 'окно класса' end as window
  from topics t join modules m on m.id = t.module_id join courses c on c.id = m.course_id
  join topic_homework h on h.topic_id = t.id
 where t.id = '00000000-0000-4000-8000-000000070001' or t.source_topic_id = '00000000-0000-4000-8000-000000070001'
 order by c.title;
rollback;
\echo '=== 16. Копирование темы в другой курс: тип едет, окно — нет'
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a0","role":"authenticated"}', false) \g /dev/null
insert into topics (id, module_id, title, order_index) values
  ('00000000-0000-4000-8000-0000007b0002', (select id from modules where course_id = '00000000-0000-4000-8000-0000000c0002' limit 1), 'K (копия)', 9);
select course_copy_topic_content(:'TK', '00000000-0000-4000-8000-0000007b0002', 'none', 0) is not null as copied;
select t.kind, h.opens_at, h.closes_at, h.is_published from topics t join topic_homework h on h.topic_id = t.id
 where t.id = '00000000-0000-4000-8000-0000007b0002';
rollback;
