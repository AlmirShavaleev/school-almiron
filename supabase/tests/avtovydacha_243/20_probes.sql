-- §243. Пробы «тема открыта = ДЗ выдано» и сводки новых ДЗ. Ожидания — в \echo перед каждым
-- выводом (ручной подсчёт по 10_data_243.sql). Действия учителя — под ролью authenticated с его
-- jwt (RLS и сторож работают как на проде); подмена «сегодняшней даты» и времени постановки в
-- сводку — под postgres (это данные, а не права).
\set ON_ERROR_STOP 0
\pset null '∅'

create or replace function pg_temp.u(p text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid $$;
create or replace function pg_temp.hw(p text) returns uuid language sql stable as $$
  select h.id from public.topic_homework h where h.topic_id = pg_temp.u(p) $$;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', false),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
$$;
create or replace function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', false), set_config('request.jwt.claims', '', false);
$$;
create or replace function pg_temp.msk(t timestamptz) returns text language sql stable as $$
  select to_char(t at time zone 'Europe/Moscow', 'DD.MM HH24:MI') $$;
create or replace function pg_temp.at(t text) returns timestamptz language sql stable as $$
  select ('2026-10-05 ' || t || ' Europe/Moscow')::timestamptz $$;
-- Сводка по строкам topic_homework_digest: ученик, тема, отправлено/выброшено.
create or replace function pg_temp.dig() returns table (student text, topic text, state text)
language sql stable as $$
  select p.full_name, t.title,
         case when d.sent_at is not null then 'sent ' || pg_temp.msk(d.sent_at)
              when d.dropped_at is not null then 'dropped: ' || d.drop_reason
              else 'pending' end
    from public.topic_homework_digest d
    join public.profiles p on p.id = d.profile_id
    join public.topic_homework h on h.id = d.homework_id
    join public.topics t on t.id = h.topic_id
   order by p.full_name, t.order_index, t.title;
$$;
create or replace function pg_temp.state(p text) returns table (topic text, published boolean, via text, has_at boolean, digest int)
language sql stable as $$
  select t.title, h.is_published, h.published_via, h.published_at is not null,
         (select count(*)::int from public.topic_homework_digest d where d.homework_id = h.id)
    from public.topic_homework h join public.topics t on t.id = h.topic_id where t.id = pg_temp.u(p);
$$;

\echo '=== 0. После миграции (разовая выдача): выданы МОЛЧА только открытые темы с файлом / работы по времени;'
\echo '    Кинематика и Контрольная (11А) и копия K1 (10Б) — backfill; каркас не выдаётся; Статика и Чужая'
\echo '    (выданы кнопкой до §243) — как были (via ∅, published_at ∅); без файлов и закрытые — нет.'
select c.title as course, t.title as topic, t.kind, h.is_published as pub, h.published_via as via, h.published_at is not null as at,
       (select count(*) from topic_homework_files f where f.homework_id = h.id) as files
  from topic_homework h join topics t on t.id = h.topic_id join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 where c.title <> 'Массовый курс'
 order by c.title, t.order_index;
\echo '--- в сводке после бэкфилла — 0 строк; ошибок выдачи — 0; задание крона поставлено'
select count(*) as digest_rows from topic_homework_digest;
select count(*) as dispatch_errors from notification_dispatch_errors;
select jobname, schedule, command from cron_probe.job where jobname = 'topic-homework-autopublish';

\echo '=== 1. Права. Ученик S1: служебные функции — permission denied (4 шт.), таблица сводки — permission denied'
select pg_temp.as_user(pg_temp.u('b1'));
select public._topic_homework_autopublish(null, 'topic');
select public.topic_homework_digest_flush(now());
select public.topic_homework_autopublish_tick();
select public._topic_homework_digest_enqueue(array[pg_temp.hw('7a04')], now());
select count(*) from public.topic_homework_digest;
\echo '--- ученик: «когда уйдёт сводка» — Нет прав на это ДЗ'
select public.topic_homework_digest_eta(pg_temp.hw('7a04'));
\echo '--- посторонний преподаватель X: по чужому ДЗ — Нет прав; по своему — {pending 0}'
select pg_temp.as_user(pg_temp.u('a3'));
select public.topic_homework_digest_eta(pg_temp.hw('7a04'));
select public.topic_homework_digest_eta(pg_temp.hw('7f01'));
\echo '--- X не может ни выдать, ни снять чужое ДЗ (RLS: 0 строк)'
update public.topic_homework set is_published = false where id = pg_temp.hw('7a04');
select pg_temp.as_postgres();
select is_published from topic_homework where id = pg_temp.hw('7a04');

\echo '=== 2. Сторож: учитель O не пишет флаг выдачи сам'
select pg_temp.as_user(pg_temp.u('a0'));
\echo '--- снять выдачу открытой темы (Кинематика) — ошибка «Скрыть выданное ДЗ нельзя»'
update public.topic_homework set is_published = false where id = pg_temp.hw('7a04');
\echo '--- «выдать» ДЗ закрытой темы руками (Законы Ньютона) — строка обновлена, но флаг остался false'
update public.topic_homework set is_published = true, published_via = 'topic', due_at = date '2026-10-03' where id = pg_temp.hw('7a01');
select pg_temp.as_postgres();
select * from pg_temp.state('7a01');

\echo '=== 3. Тумблер: O открывает «Законы Ньютона» → выдано (topic), в сводке S1 и S2;'
\echo '    S3 уже сдал (попытка submitted заведена заранее), S5 выключен — их нет'
set session_replication_role = replica;
insert into topic_homework_attempts (homework_id, student_id, attempt_number, status, submitted_at)
values (pg_temp.hw('7a01'), pg_temp.u('1b3'), 1, 'submitted', now());
set session_replication_role = origin;
select pg_temp.as_user(pg_temp.u('a0'));
update public.topics set is_open = true where id = pg_temp.u('7a01');
select pg_temp.as_postgres();
select * from pg_temp.state('7a01');
select * from pg_temp.dig();

\echo '=== 4. Закрыл и открыл снова — второй выдачи и новых строк нет (published_at тот же)'
select published_at as first_published from topic_homework where id = pg_temp.hw('7a01') \gset
select pg_temp.as_user(pg_temp.u('a0'));
update public.topics set is_open = false where id = pg_temp.u('7a01');
update public.topics set is_open = true  where id = pg_temp.u('7a01');
select pg_temp.as_postgres();
select h.published_at = :'first_published'::timestamptz as same_published_at,
       (select count(*) from topic_homework_digest d where d.homework_id = h.id) as digest_rows
  from topic_homework h where h.id = pg_temp.hw('7a01');

\echo '=== 5. Новичок: S4 пришёл в 11А после выдачи «Законов Ньютона» — строки для S4 нет'
insert into group_students (group_id, student_id) values (pg_temp.u('f1'), pg_temp.u('1b4'));
select count(*) as s4_rows from topic_homework_digest where profile_id = pg_temp.u('b4');

\echo '=== 6. ДЗ без файлов: «Работа и мощность» открыта, но не выдано; O добавил файл → выдано (content),'
\echo '    в сводке S1, S2, S3 и S4 (S4 уже в группе на момент выдачи)'
select * from pg_temp.state('7a03');
select pg_temp.as_user(pg_temp.u('a0'));
insert into public.topic_homework_files (homework_id, storage_path, original_filename, position)
values (pg_temp.hw('7a03'), 'hw/rabota.pdf', 'rabota.pdf', 0);
\echo '--- второй файл той же ДЗ — ничего не меняет'
insert into public.topic_homework_files (homework_id, storage_path, original_filename, position)
values (pg_temp.hw('7a03'), 'hw/rabota-2.pdf', 'rabota-2.pdf', 1);
select pg_temp.as_postgres();
select * from pg_temp.state('7a03');

\echo '=== 7. Работы по времени: O открывает «Проверочную» (без файлов) → выдано (topic), сводки нет;'
\echo '    O создаёт ДЗ в открытой «Контрольной 2» → выдано сразу (content), сводки нет;'
\echo '    O создаёт ДЗ в открытой «Гидростатике» (урок) без файлов, пытаясь передать is_published = true → не выдано'
select pg_temp.as_user(pg_temp.u('a0'));
update public.topics set is_open = true where id = pg_temp.u('7a06');
insert into public.topic_homework (topic_id, title, is_published, created_by)
values (pg_temp.u('7a09'), 'Контрольная работа', false, pg_temp.u('a0'));
insert into public.topic_homework (topic_id, title, is_published, published_via, created_by)
values (pg_temp.u('7a10'), 'Домашнее задание', true, 'backfill', pg_temp.u('a0'));
select pg_temp.as_postgres();
select * from pg_temp.state('7a06') union all select * from pg_temp.state('7a09') union all select * from pg_temp.state('7a10');

\echo '=== 8. Дата: «Импульс тела» открывается по available_from. Сегодня дата ещё не наступила (через 3 дня) —'
\echo '    крон не выдаёт. Дата наступила (подменяем available_from без триггеров, как будто прошли дни) →'
\echo '    крон выдаёт (schedule), в сводке S1, S2, S3, S4'
select public._topic_homework_autopublish(null, 'schedule') as cron_published_before;
set session_replication_role = replica;
update topics set available_from = current_date where id = pg_temp.u('7a02');
set session_replication_role = origin;
select public._topic_homework_autopublish(null, 'schedule') as cron_published_after;
select * from pg_temp.state('7a02');
\echo '--- дата в прошлом, поставленная учителем, выдаёт сразу триггером (topic): «Давление»'
select pg_temp.as_user(pg_temp.u('a0'));
update public.topics set is_open = null, available_from = current_date - 1 where id = pg_temp.u('7a08');
select pg_temp.as_postgres();
select * from pg_temp.state('7a08');

\echo '=== 9. Каркас: O добавил файл в ДЗ каркаса «Каркас: Работа» → каркас не выдан, копия в 10Б (тема открыта)'
\echo '    получила файл синхронизацией и выдана (content), в сводке S7'
select pg_temp.as_user(pg_temp.u('a0'));
insert into public.topic_homework_files (homework_id, storage_path, original_filename, position)
values (pg_temp.hw('7c02'), 'hw/karkas-rabota.pdf', 'karkas-rabota.pdf', 0);
select pg_temp.as_postgres();
select c.title as course, h.is_published, h.published_via,
       (select count(*) from topic_homework_files f where f.homework_id = h.id) as files,
       (select string_agg(p.full_name, ', ') from topic_homework_digest d join profiles p on p.id = d.profile_id where d.homework_id = h.id) as digest
  from topic_homework h join topics t on t.id = h.topic_id join modules m on m.id = t.module_id join courses c on c.id = m.course_id
 where t.id = pg_temp.u('7c02') or t.source_topic_id = pg_temp.u('7c02')
 order by c.title;

\echo '=== 10. Второй курс и массовое открытие: O открывает обе темы Математики и 14 тем Массового курса'
\echo '    («Открыть до сюда» — одним update) → S1 +2 строки, S6 — 14'
select pg_temp.as_user(pg_temp.u('a0'));
update public.topics set is_open = true where module_id = pg_temp.u('e2');
update public.topics set is_open = true where module_id = pg_temp.u('e3');
select pg_temp.as_postgres();
select p.full_name, count(*) as rows from topic_homework_digest d join profiles p on p.id = d.profile_id group by p.full_name order by 1;
select count(*) as dispatch_errors from notification_dispatch_errors;

\echo '=== 11. Тайминги (topic_homework_digest_due_at, МСК): 14:00/14:00 → 14:30; 14:00/14:20 → 14:50 (сдвиг);'
\echo '    14:00/15:45 → 16:00 (потолок 2 ч); 21:10/21:45 → 06.10 08:00; 23:10 → 06.10 08:00; 01:00 → 05.10 08:00;'
\echo '    07:50 → 08:20; 21:20/21:25 → 21:55 (ещё не ночь)'
select f, l, pg_temp.msk(public.topic_homework_digest_due_at(pg_temp.at(f), pg_temp.at(l))) as due
  from (values ('14:00', '14:00'), ('14:00', '14:20'), ('14:00', '15:45'), ('21:10', '21:45'),
               ('23:10', '23:10'), ('01:00', '01:00'), ('07:50', '07:50'), ('21:20', '21:25')) v(f, l);
\echo '--- дата для колокольчика: «3 октября» (год текущий), «5 января 2027»'
select public._topic_homework_ru_day(date '2026-10-03', pg_temp.at('12:00')) as this_year,
       public._topic_homework_ru_day(date '2027-01-05', pg_temp.at('12:00')) as next_year;

\echo '=== 12. Отправка. Раскладываем время постановки (05.10, МСК): S1 — 14:00…15:50 (шесть строк, потолок → 16:00);'
\echo '    S2, S3, S4, S7 — 14:00 (→ 14:30); S6 — 21:50 (→ 06.10 08:00).'
\echo '    Перед отправкой: S2 сдал «Работу и мощность»; «Давление» учитель снова закрыл; S4 ушёл из 11А;'
\echo '    S3 по «Импульсу тела» учитель уже отправил ручное «Напомнить» (new_homework).'
update topic_homework_digest set queued_at = pg_temp.at('14:00') where profile_id <> pg_temp.u('b1');
update topic_homework_digest d set queued_at = pg_temp.at(x.t)
  from (values ('7a01', '14:00'), ('7a02', '14:40'), ('7a03', '15:20'), ('7a08', '15:30'), ('7b01', '15:40'), ('7b02', '15:50')) x(topic, t)
 where d.profile_id = pg_temp.u('b1') and d.homework_id = pg_temp.hw(x.topic);
update topic_homework_digest set queued_at = pg_temp.at('21:50') where profile_id = pg_temp.u('b6');
select pg_temp.as_user(pg_temp.u('b2'));
insert into public.topic_homework_attempts (homework_id, student_id, attempt_number)
values (pg_temp.hw('7a03'), pg_temp.u('1b2'), 1);
select public.topic_homework_submit_attempt((select id from public.topic_homework_attempts where homework_id = pg_temp.hw('7a03') and student_id = pg_temp.u('1b2')));
select pg_temp.as_user(pg_temp.u('a0'));
update public.topics set is_open = false where id = pg_temp.u('7a08');
select pg_temp.as_postgres();
delete from group_students where group_id = pg_temp.u('f1') and student_id = pg_temp.u('1b4');
insert into notification_queue (profile_id, event_type, entity_type, entity_id, deduplication_key, payload, created_at)
values (pg_temp.u('b3'), 'new_homework', 'topic_homework', pg_temp.hw('7a02'), 'probe-manual', '{}', pg_temp.at('14:10'));

\echo '--- «когда уйдёт» для учителя по «Законам Ньютона»: 2 ученика (S1, S2), позднейшая — 05.10 16:00'
select pg_temp.as_user(pg_temp.u('a0'));
select (e->>'pending')::int as pending, pg_temp.msk((e->>'due_at')::timestamptz) as due
  from public.topic_homework_digest_eta(pg_temp.hw('7a01')) e;
select pg_temp.as_postgres();

\echo '--- 14:29 — рано, ничего не уходит'
select public.topic_homework_digest_flush(pg_temp.at('14:29'));
\echo '--- 14:31 — уходят S2 (2 ДЗ: Работа — сдал, Давление — закрыто), S3 (1 ДЗ: Импульс — ручное, Давление — закрыто),'
\echo '    S4 — всё выброшено (ушёл), S7 (1 ДЗ); S1 и S6 ещё рано'
select public.topic_homework_digest_flush(pg_temp.at('14:31'));
select * from pg_temp.dig();
\echo '--- 15:59 — S1 ещё ждёт (потолок 16:00); 16:01 — S1 (5 ДЗ в двух курсах, Давление — закрыто)'
select public.topic_homework_digest_flush(pg_temp.at('15:59'));
select public.topic_homework_digest_flush(pg_temp.at('16:01'));
\echo '--- S6: 22:30 и 07:59 — ночь, не шлём; 06.10 08:01 — 14 ДЗ одной сводкой'
select public.topic_homework_digest_flush(pg_temp.at('22:30'));
select public.topic_homework_digest_flush(('2026-10-06 07:59 Europe/Moscow')::timestamptz);
select public.topic_homework_digest_flush(('2026-10-06 08:01 Europe/Moscow')::timestamptz);

\echo '=== 13. Что ушло. Очередь Telegram — только S1, S6, S7 (S2 без Telegram, S3 выключен): форма по числу;'
\echo '    колокольчик — всем пятерым, по одной записи'
select p.full_name, q.event_type, (q.payload->>'count')::int as n, q.payload->>'link' as link,
       jsonb_array_length(q.payload->'courses') as courses
  from notification_queue q join profiles p on p.id = q.profile_id
 where q.event_type = 'new_homework_digest' order by p.full_name;
select p.full_name, n.title, n.message, n.link
  from notifications n join profiles p on p.id = n.user_id order by p.full_name;
\echo '--- payload S1 (2–9, два курса) и S7 (1 ДЗ) целиком; у S6 — первые два пункта из 14'
select jsonb_pretty(q.payload) from notification_queue q where q.profile_id = pg_temp.u('b1') and q.event_type = 'new_homework_digest';
select jsonb_pretty(q.payload) from notification_queue q where q.profile_id = pg_temp.u('b7') and q.event_type = 'new_homework_digest';
select q.payload->'count' as count, q.payload->'courses' as courses, q.payload->'items'->0 as first, q.payload->'items'->1 as second
  from notification_queue q where q.profile_id = pg_temp.u('b6') and q.event_type = 'new_homework_digest';

\echo '=== 14. Один раз навсегда: после отправки O закрывает и открывает «Законы Ньютона» — новых строк нет;'
\echo '    прямая постановка той же пары — 0 (первичный ключ)'
select pg_temp.as_user(pg_temp.u('a0'));
update public.topics set is_open = false where id = pg_temp.u('7a01');
update public.topics set is_open = true  where id = pg_temp.u('7a01');
select pg_temp.as_postgres();
select count(*) filter (where sent_at is null and dropped_at is null) as pending,
       count(*) as all_rows
  from topic_homework_digest where homework_id = pg_temp.hw('7a01');
select public._topic_homework_digest_enqueue(array[pg_temp.hw('7a01')], now()) as enqueued_again;
\echo '--- колокольчик S1 — всё ещё одна запись; повторный прогон отправки ничего не шлёт'
select public.topic_homework_digest_flush(pg_temp.at('17:00'));
select count(*) as s1_bell from notifications where user_id = pg_temp.u('b1');

\echo '=== 15. Тик крона целиком (сейчас): выдавать нечего, ошибок нет'
select (public.topic_homework_autopublish_tick())->'published' as published;
select count(*) as dispatch_errors from notification_dispatch_errors;
