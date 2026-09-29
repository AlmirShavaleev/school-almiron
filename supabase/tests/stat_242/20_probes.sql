-- §242. Пробы статистики курса. Ожидания — в \echo перед каждым выводом (ручной подсчёт по 10_data_242.sql).
\set ON_ERROR_STOP 0
\pset null '∅'
\set c10 '''00000000-0000-4000-8000-0000000c0001'''
\set c11 '''00000000-0000-4000-8000-0000000c0002'''
\set ctpl '''00000000-0000-4000-8000-0000000c0000'''
\set t1 '''00000000-0000-4000-8000-0000007a0001'''
\set t2 '''00000000-0000-4000-8000-0000007a0002'''

create or replace function pg_temp.d(k int) returns date language sql as $$
  select (now() at time zone 'Europe/Moscow')::date - k $$;
create or replace function pg_temp.ts(k int) returns timestamptz language sql as $$
  select ((now() at time zone 'Europe/Moscow')::date - k + time '12:00') at time zone 'Europe/Moscow' $$;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', false),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
$$;
create or replace function pg_temp.summary(j jsonb) returns table (
  in_class int, active int, views int, views_prev int, video_s int, video_done int,
  submitted int, accepted int, returned int, pending int, oldest_days int,
  avg5 numeric, avg5_n int, avg100 numeric, avg100_n int, quiet text, no_hw_14 text)
language sql as $$
  select (j->>'in_class')::int, (j->>'active')::int, (j->>'views')::int, (j->>'views_prev')::int,
         (j->>'video_seconds')::int, (j->>'video_done')::int,
         (j->>'submitted')::int, (j->>'accepted')::int, (j->>'returned')::int, (j->>'pending')::int,
         ((now() at time zone 'Europe/Moscow')::date - ((j->>'pending_oldest_at')::timestamptz at time zone 'Europe/Moscow')::date),
         (j->>'avg_five')::numeric, (j->>'avg_five_count')::int, (j->>'avg_hundred')::numeric, (j->>'avg_hundred_count')::int,
         (select string_agg((q->>'full_name') || coalesce(' D' || ((j->>'to')::date - (q->>'last_day')::date), ' никогда'), ', ') from jsonb_array_elements(j->'quiet') q),
         (select string_agg(q->>'full_name', ', ') from jsonb_array_elements(j->'no_hw_14') q);
$$;
create or replace function pg_temp.days(j jsonb) returns text language sql as $$
  select string_agg('D' || ((j->>'to')::date - (d->>'day')::date) || '=' || (d->>'active'), ' ' order by (d->>'day')::date desc)
    from jsonb_array_elements(j->'days') d where (d->>'active')::int > 0;
$$;
create or replace function pg_temp.topics(j jsonb) returns table (topic text, timed boolean, opened int, videos int, done int, started int, hw boolean, scale text, submitted int, avg numeric, pending int)
language sql as $$
  select t.title, (x->>'timed')::boolean, (x->>'opened')::int, (x->>'videos')::int, (x->>'video_done')::int, (x->>'video_started')::int,
         (x->>'hw')::boolean, x->>'grade_scale', (x->>'submitted')::int, (x->>'avg_score')::numeric, (x->>'pending')::int
    from jsonb_array_elements(j->'topics') x join public.topics t on t.id = (x->>'topic_id')::uuid
   order by t.order_index;
$$;
create or replace function pg_temp.tstud(j jsonb) returns table (student text, opened boolean, video text, hw text, score int)
language sql as $$
  select x->>'full_name', (x->>'opened')::boolean, x->>'video', x->>'hw_status', (x->>'score')::int
    from jsonb_array_elements(j->'rows') x;
$$;
create or replace function pg_temp.studs(j jsonb) returns table (student text, last text, days int, files text, video_s int, hw7 int, hw30 int, hw text, avg5 numeric, avg100 numeric, debts int, mock int)
language sql as $$
  select x->>'full_name', coalesce('D' || ((j->>'to')::date - (x->>'last_day')::date), 'никогда'), (x->>'days')::int,
         (x->>'files_opened') || '/' || (x->>'files_total'), (x->>'video_seconds')::int,
         (x->>'hw7')::int, (x->>'hw30')::int, (x->>'hw_done') || '/' || (x->>'hw_total'),
         (x->>'avg_five')::numeric, (x->>'avg_hundred')::numeric, (x->>'debts')::int, (x->>'mock_score')::int
    from jsonb_array_elements(j->'rows') x;
$$;

\echo === 1. Преподаватель 10А, сводка за 7 дней.
\echo ===    ожидание: in_class 4; active 3 (S1,S2,S3); views 5 (S1: F1 D0, F1 D1, F2 D1, TR1 D2; S2: F1 D3; преподаватель не считается);
\echo ===    views_prev 2 (S1 F3 D8, S3 F1 D9); video 900+120 = 1020 с, досмотрено 2 (S1 V1, V2); сдано 3 (S1 T1 D2, S2 T1 D1, S2 T2 D5; T4 — контрольная, не считается),
\echo ===    принято 2, вернули 0; ждут 1 (S2 T1, сдано D1 → 1 день); средний 5.00 (1) и 60.0 (1); не заходили — Ученик 4 (никогда); без ДЗ 14 дней — Ученик 3, Ученик 4.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select * from pg_temp.summary(public.course_stats_summary(:c10, '7d'));
\echo ===    активность по дням (только ненулевые): D0=1 (S1) D1=2 (S1,S2) D2=1 D3=1 D4=1 (черновик S3) D5=1 D8=1 D9=1 D10=1 D12=1 D20=1; всего 30 дней
select pg_temp.days(public.course_stats_summary(:c10, '7d')) as days,
       jsonb_array_length(public.course_stats_summary(:c10, '7d')->'days') as n_days;

\echo === 2. Сводка за 30 дней: active 3; views 7 (+ S1 F3 D8, S3 F1 D9); prev 1 (S2 F3 D40); video 1420 с, досмотрено 3 (+ S3 V1 D12);
\echo ===    сдано 5 (+ S1 T2 D20, S2 T1 D10), принято 3, вернули 1; средний 5.00 (1), 70.0 (2).
select * from pg_temp.summary(public.course_stats_summary(:c10, '30d'));
\echo === 3. Сводка «всё время»: views 8, views_prev ∅ (прошлого периода нет); остальное как за 30 дней.
select * from pg_temp.summary(public.course_stats_summary(:c10, 'all'));
\echo === 4. Неверный период — 22023.
select public.course_stats_summary(:c10, '14d');

\echo === 5. По темам за 7 дней.
\echo ===    T1: открыли 2 (S1, S2), видео 1, досмотрел 1 (S1), начал 1 (S2); ДЗ пятибалльное, сдали 2 (S1, S2), средний 5, ждут 1.
\echo ===    T2: открыли 1 (S1 TR1 D2), видео 2, S1 досмотрел одно из двух → начал 1; ДЗ стобалльное, сдали 1 (S2 D5), средний 60, ждут 0.
\echo ===    T3 (закрыта): 0, без видео, ДЗ есть, 0 сдач. T4 (контрольная): timed, hw = false.
select * from pg_temp.topics(public.course_stats_topics(:c10, '7d'));
\echo === 6. По темам за всё время: T1 открыли 3 (+ S3 D9), досмотрели 2 (+ S3 D12), начал 1; сдали 2, средний 5; T2 открыли 2 (+ S2 F3 D40), сдали 2, средний 70.
select * from pg_temp.topics(public.course_stats_topics(:c10, 'all'));

\echo === 7. Тема T1 по ученикам, 7 дней: S1 открыл, досмотрел, принято 5; S2 открыл, начал, ждёт (вторая попытка);
\echo ===    S3 не открывал (D9 вне периода), видео нет (D12 вне), черновик D4; S4 — ничего.
select * from pg_temp.tstud(public.course_stats_topic_students(:c10, :t1, '7d'));
\echo === 8. Тема T1, всё время: S3 открыл и досмотрел.
select * from pg_temp.tstud(public.course_stats_topic_students(:c10, :t1, 'all'));
\echo === 9. Тема T2, 7 дней: у S1 досмотрено одно видео из двух — «начал»; ДЗ S1 (D20) вне периода — ∅; S2 принято 60.
select * from pg_temp.tstud(public.course_stats_topic_students(:c10, :t2, '7d'));
\echo === 10. Тема чужого курса (владелец обоих курсов спрашивает T1 от имени 11А) — 22023.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a0');
select public.course_stats_topic_students(:c11, :t1, '7d');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');

\echo === 11. По ученикам, 7 дней (сначала дольше всех не заходившие).
\echo ===    S4: никогда, 0 дней, файлов 0/3 (F1, F3, TR1), ДЗ 0/2, долг 1 (T1, срок D3), пробник ∅ (не писал).
\echo ===    S3: D4, 1 день, 1/3, ДЗ 0/2 (черновик — не сдача), долг 1. S2: D1, 3 дня (D1, D3, D5), 2/3, видео 120, ДЗ за 7 — 2, за 30 — 3, 2/2, средний 100-балльной 60, пробник 65.
\echo ===    S1: D0, 3 дня, 4/5 (+ F2 решение — принято; + F5 условие контрольной — уже сдал; TR2 скрыта), видео 900, за 7 — 1, за 30 — 2 (T4 не считается), 2/2, средний 5, пробник 70 (последний с итогом — №2).
select * from pg_temp.studs(public.course_stats_students(:c10, '7d'));
select public.course_stats_students(:c10, '7d')->'mock' as last_mock;

\echo === 12. «Доступные файлы» = то, что RLS topic_material_items_student_select отдаёт самому ученику (kind = file, курс 10А):
\echo ===    ожидание: S1 5, S2 3, S3 3, S4 3 — совпадает с files_total в п. 11.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select 'S1' as who, count(*) from topic_material_items i join topics t on t.id = i.topic_id join modules m on m.id = t.module_id
 where m.course_id = '00000000-0000-4000-8000-0000000c0001' and i.kind = 'file';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
select 'S2' as who, count(*) from topic_material_items i join topics t on t.id = i.topic_id join modules m on m.id = t.module_id
 where m.course_id = '00000000-0000-4000-8000-0000000c0001' and i.kind = 'file';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b3');
select 'S3' as who, count(*) from topic_material_items i join topics t on t.id = i.topic_id join modules m on m.id = t.module_id
 where m.course_id = '00000000-0000-4000-8000-0000000c0001' and i.kind = 'file';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b4');
select 'S4' as who, count(*) from topic_material_items i join topics t on t.id = i.topic_id join modules m on m.id = t.module_id
 where m.course_id = '00000000-0000-4000-8000-0000000c0001' and i.kind = 'file';

\echo === 13. Права. Ученик своего курса — 42501 на всех четырёх.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000b1');
select public.course_stats_summary(:c10, '7d');
select public.course_stats_topics(:c10, '7d');
select public.course_stats_topic_students(:c10, :t1, '7d');
select public.course_stats_students(:c10, '7d');
\echo === 14. Чужой преподаватель (11А) и посторонний — 42501.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
select public.course_stats_summary(:c10, '7d');
select public.course_stats_students(:c10, '7d');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a3');
select public.course_stats_topics(:c10, '7d');
select public.course_stats_topic_students(:c10, :t1, '7d');
\echo === 15. Внутренние помощники ученику и учителю недоступны (permission denied).
select * from public.course_stats_roster_internal(:c10);
select * from public.course_stats_files_internal(:c10);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select * from public.course_stats_activity_internal(:c10);
\echo === 16. Аноним — permission denied.
select set_config('role', 'anon', false), set_config('request.jwt.claims', '', false);
select public.course_stats_summary(:c10, '7d');
\echo === 17. Владелец курса (не преподаватель группы) — данные; шаблон — пустой класс.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a0');
select in_class, active, views, submitted from pg_temp.summary(public.course_stats_summary(:c10, '30d'));
select (public.course_stats_summary(:ctpl, '7d'))->>'in_class' as tpl_in_class,
       jsonb_array_length(public.course_stats_students(:ctpl, '7d')->'rows') as tpl_rows;
\echo === 18. Преподаватель 11А по своему курсу — свой ученик S7 (никогда), чужих не видно.
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
select * from pg_temp.studs(public.course_stats_students(:c11, '7d'));

\echo === 19. Объём: курс 170 тем (по 5 файлов и видео) × 20 учеников, ~10 тыс. просмотров, 3 тыс. дней видео, 2 тыс. сдач —
\echo ===    каждая функция одним вызовом; ожидание: все четыре быстрее 2 с (в откатываемом блоке, под владельцем курса).
reset role;
begin;
insert into courses (id, title, owner_id) values ('00000000-0000-4000-8000-0000000c0bbb', 'Объём', '00000000-0000-4000-8000-0000000000a0');
insert into groups (id, name, course_id, teacher_id) values ('00000000-0000-4000-8000-0000000f0bbb', 'Объём', '00000000-0000-4000-8000-0000000c0bbb', '00000000-0000-4000-8000-0000000001a1');
insert into profiles (id, full_name, role) select ('00000000-0000-4000-8000-0000009' || lpad(n::text, 5, '0'))::uuid, 'Ученик ' || n, 'student' from generate_series(1, 20) n;
insert into students (id, profile_id) select ('00000000-0000-4000-8000-0000008' || lpad(n::text, 5, '0'))::uuid, ('00000000-0000-4000-8000-0000009' || lpad(n::text, 5, '0'))::uuid from generate_series(1, 20) n;
insert into group_students select '00000000-0000-4000-8000-0000000f0bbb', ('00000000-0000-4000-8000-0000008' || lpad(n::text, 5, '0'))::uuid from generate_series(1, 20) n;
insert into modules (id, course_id, title) values ('00000000-0000-4000-8000-0000000e0bbb', '00000000-0000-4000-8000-0000000c0bbb', 'М');
insert into topics (id, module_id, title, order_index, is_open)
select ('00000000-0000-4000-8000-0000007' || lpad(n::text, 5, '0'))::uuid, '00000000-0000-4000-8000-0000000e0bbb', 'Т' || n, n, true from generate_series(1, 170) n;
insert into topic_material_items (id, topic_id, kind, section, storage_path, created_by)
select gen_random_uuid(), ('00000000-0000-4000-8000-0000007' || lpad(n::text, 5, '0'))::uuid, case when k = 6 then 'video' else 'file' end::course_material_kind,
       case when k = 5 then 'solution' else 'theory' end, 'v/' || n || '/' || k, '00000000-0000-4000-8000-0000000000a1'
  from generate_series(1, 170) n, generate_series(1, 6) k;
insert into topic_homework (topic_id, title, is_published, created_by, grade_scale, due_at)
select ('00000000-0000-4000-8000-0000007' || lpad(n::text, 5, '0'))::uuid, 'ДЗ', true, '00000000-0000-4000-8000-0000000000a1', 'five', pg_temp.d(n % 30)
  from generate_series(1, 170) n;
insert into material_views (profile_id, item_id, topic_id, viewed_on)
select distinct on (s.profile_id, i.id, pg_temp.d((hashtext(s.id::text || i.id::text) & 63)))
       s.profile_id, i.id, i.topic_id, pg_temp.d((hashtext(s.id::text || i.id::text) & 63))
  from students s join group_students gs on gs.student_id = s.id and gs.group_id = '00000000-0000-4000-8000-0000000f0bbb'
  join topic_material_items i on i.kind = 'file' and i.topic_id in (select id from topics where module_id = '00000000-0000-4000-8000-0000000e0bbb')
 where (hashtext(s.id::text || i.id::text) & 3) <> 0;
insert into video_watch_daily (student_id, item_id, day, seconds, max_position, duration_seconds)
select s.profile_id, i.id, pg_temp.d(abs(hashtext(i.id::text || s.id::text)) % 60), 300, abs(hashtext(s.id::text || i.id::text)) % 700, 600
  from students s join group_students gs on gs.student_id = s.id and gs.group_id = '00000000-0000-4000-8000-0000000f0bbb'
  join topic_material_items i on i.kind = 'video' and i.topic_id in (select id from topics where module_id = '00000000-0000-4000-8000-0000000e0bbb');
insert into topic_homework_attempts (homework_id, student_id, attempt_number, created_at)
select h.id, s.id, 1, pg_temp.ts(abs(hashtext(h.id::text || s.id::text)) % 60)
  from topic_homework h join topics t on t.id = h.topic_id and t.module_id = '00000000-0000-4000-8000-0000000e0bbb'
  cross join (select student_id as id from group_students where group_id = '00000000-0000-4000-8000-0000000f0bbb') s
 where abs(hashtext(s.id::text || h.id::text)) % 5 <> 0;
update topic_homework_attempts a set status = 'submitted', submitted_at = a.created_at
  from topic_homework h join topics t on t.id = h.topic_id and t.module_id = '00000000-0000-4000-8000-0000000e0bbb'
 where a.homework_id = h.id;
select (select count(*) from material_views mv join topics t on t.id = mv.topic_id and t.module_id = '00000000-0000-4000-8000-0000000e0bbb') as views,
       (select count(*) from video_watch_daily) as video_rows,
       (select count(*) from topic_homework_attempts a join topic_homework h on h.id = a.homework_id join topics t on t.id = h.topic_id and t.module_id = '00000000-0000-4000-8000-0000000e0bbb') as attempts;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a0');
create temp table if not exists perf (fn text, ms numeric);
do $$
declare t0 timestamptz; c uuid := '00000000-0000-4000-8000-0000000c0bbb'; j jsonb;
begin
  t0 := clock_timestamp(); j := public.course_stats_summary(c, '30d');  insert into perf values ('summary 30d', extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp(); j := public.course_stats_topics(c, 'all');   insert into perf values ('topics all', extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp(); j := public.course_stats_students(c, '7d');  insert into perf values ('students 7d', extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp(); j := public.course_stats_topic_students(c, '00000000-0000-4000-8000-000000700001', 'all');
  insert into perf values ('topic_students all', extract(epoch from clock_timestamp() - t0) * 1000);
end $$;
select fn, ms < 2000 as under_2s from perf;
\echo     (замер на этой машине, мс — в probes.out не сравнивать:)
select fn, round(ms) as ms from perf;
select (public.course_stats_students('00000000-0000-4000-8000-0000000c0bbb', '7d')->'rows'->0->>'files_total')::int as files_total_one_student,
       jsonb_array_length(public.course_stats_topics('00000000-0000-4000-8000-0000000c0bbb', 'all')->'topics') as topics;
rollback;
