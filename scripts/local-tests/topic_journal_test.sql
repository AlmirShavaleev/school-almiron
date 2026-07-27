-- Поведенческие тесты get_student_topic_journal ролями (set role authenticated
-- + request.jwt.claim.sub). Результаты копятся во временной таблице и печатаются
-- в конце: так видно все провалы разом, а не только первый.

create temp table results (name text, ok boolean, detail text);
-- Временная таблица результатов должна быть доступна тестовым ролям
grant all on results to public;

-- ── Данные ───────────────────────────────────────────────────────────────────
insert into profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Ученик Свой',   'student'),
  ('00000000-0000-0000-0000-0000000000a2', 'Ученик Чужой',  'student'),
  ('00000000-0000-0000-0000-0000000000b1', 'Препод Свой',   'teacher'),
  ('00000000-0000-0000-0000-0000000000b2', 'Препод Чужой',  'teacher'),
  ('00000000-0000-0000-0000-0000000000c1', 'Владелец',      'owner');

insert into teachers (id, profile_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2');

insert into students (id, profile_id, full_name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Ученик Свой'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2', 'Ученик Чужой');

insert into courses (id, title, owner_id) values
  ('00000000-0000-0000-0000-0000000000f1', 'Физика ОГЭ', '00000000-0000-0000-0000-0000000000b1');

insert into groups (id, name, course_id, teacher_id) values
  ('00000000-0000-0000-0000-000000000101', 'Группа 1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1');

insert into group_students values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000e1');

insert into modules (id, course_id, title, order_index) values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000f1', 'Основной', 0);

insert into topics (id, module_id, title, order_index, available_from) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', 'Тема 1', 0, null),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', 'Тема 2', 1, current_date - 1),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000201', 'Тема будущая', 2, current_date + 30);

-- ДЗ: принятое с баллом, просроченное несданное, неопубликованное, в закрытой теме
insert into topic_homework (id, topic_id, title, is_published, due_at, grade_scale) values
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000301', 'ДЗ 1', true,  current_date - 5, 'five'),
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000302', 'ДЗ 2', true,  current_date - 2, 'hundred'),
  ('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000302', 'ДЗ черновик', false, null, null),
  ('00000000-0000-0000-0000-000000000404', '00000000-0000-0000-0000-000000000303', 'ДЗ будущей темы', true, null, null);

-- Две попытки по ДЗ 1: возврат, затем принятие (accepted не последняя по created)
insert into topic_homework_attempts (id, homework_id, student_id, attempt_number, status, submitted_at) values
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-0000000000e1', 1, 'returned_for_revision', now() - interval '3 day'),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-0000000000e1', 2, 'accepted', now() - interval '1 day');

insert into topic_homework_reviews (id, attempt_id, reviewer_id, decision, comment, score, created_at) values
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-0000000000b1', 'returned_for_revision', 'переделай', null, now() - interval '3 day'),
  ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-0000000000b1', 'accepted', 'молодец', 4, now() - interval '1 day');

-- Тесты: один пройден, один привязан но не начат
insert into topic_tests (id, title) values
  ('00000000-0000-0000-0000-000000000701', 'Тест по теме 1'),
  ('00000000-0000-0000-0000-000000000702', 'Тест по теме 2');

insert into topic_test_assignments (id, test_id, topic_id) values
  ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000301'),
  ('00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000302');

insert into topic_test_attempts (id, assignment_id, test_id, student_id, status, completed_at, total_points, max_points) values
  ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-0000000000e1', 'completed', now(), 7, 10);

grant execute on function public.get_student_topic_journal(uuid, uuid) to authenticated;

-- ── Тесты ────────────────────────────────────────────────────────────────────
set role authenticated;

-- 1. Ученик видит свой журнал
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into results
select 'ученик: журнал не пустой',
       j is not null and jsonb_array_length(j->'homework') = 2,
       coalesce(jsonb_pretty(j->'summary'), 'null')
from (select public.get_student_topic_journal('00000000-0000-0000-0000-0000000000e1') as j) q;

insert into results
select 'ДЗ 1: accepted побеждает более свежий возврат, балл 4',
       (h->>'status') = 'accepted' and (h->>'score') = '4' and (h->>'comment') = 'молодец',
       h::text
from (select jsonb_path_query_first(public.get_student_topic_journal('00000000-0000-0000-0000-0000000000e1'),
        '$.homework[*] ? (@.title == "ДЗ 1")') as h) q;

insert into results
select 'ДЗ 2: не сдано и просрочено',
       (h->>'status') = 'not_started' and (h->>'is_overdue') = 'true',
       h::text
from (select jsonb_path_query_first(public.get_student_topic_journal('00000000-0000-0000-0000-0000000000e1'),
        '$.homework[*] ? (@.title == "ДЗ 2")') as h) q;

insert into results
select 'неопубликованное ДЗ и ДЗ закрытой темы в журнал не попадают',
       not (j::text like '%ДЗ черновик%') and not (j::text like '%ДЗ будущей темы%'),
       null
from (select public.get_student_topic_journal('00000000-0000-0000-0000-0000000000e1') as j) q;

insert into results
select 'тесты: пройденный с процентом и непройденный',
       jsonb_array_length(j->'tests') = 2
       and (jsonb_path_query_first(j, '$.tests[*] ? (@.status == "completed")')->>'percent') = '70'
       and (jsonb_path_query_first(j, '$.tests[*] ? (@.status == "not_started")')->>'test_title') = 'Тест по теме 2',
       (j->'tests')::text
from (select public.get_student_topic_journal('00000000-0000-0000-0000-0000000000e1') as j) q;

insert into results
select 'сводка: 1 принято, 1 просрочено, средний по пятибалльной = 4.0, тестов 2/1, средний процент 70',
       (s->>'hw_accepted') = '1' and (s->>'hw_overdue') = '1'
       and (s->>'avg_score_five') = '4.0' and (s->>'avg_score_hundred') is null
       and (s->>'tests_total') = '2' and (s->>'tests_completed') = '1'
       and (s->>'tests_avg_percent') = '70',
       s::text
from (select public.get_student_topic_journal('00000000-0000-0000-0000-0000000000e1')->'summary' as s) q;

-- 2. Ученик не видит чужой журнал
insert into results
select 'ученик не читает чужой журнал',
       public.get_student_topic_journal('00000000-0000-0000-0000-0000000000e2') is null, null;

-- 3. Преподаватель своей группы видит
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into results
select 'преподаватель группы видит журнал ученика',
       jsonb_array_length(public.get_student_topic_journal('00000000-0000-0000-0000-0000000000e1')->'homework') = 2, null;

-- 4. Чужой преподаватель не видит
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b2';
insert into results
select 'чужой преподаватель не видит журнал',
       public.get_student_topic_journal('00000000-0000-0000-0000-0000000000e1') is null, null;

-- 5. Владелец видит
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
insert into results
select 'owner видит журнал',
       jsonb_array_length(public.get_student_topic_journal('00000000-0000-0000-0000-0000000000e1')->'homework') = 2, null;

-- 6. Аноним без jwt
reset request.jwt.claim.sub;
insert into results
select 'без авторизации журнал не отдаётся',
       public.get_student_topic_journal('00000000-0000-0000-0000-0000000000e1') is null, null;

-- 7. Фильтр по курсу
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into results
select 'фильтр по чужому курсу даёт пустой журнал',
       jsonb_array_length(public.get_student_topic_journal(
         '00000000-0000-0000-0000-0000000000e1',
         '00000000-0000-0000-0000-00000000ffff') -> 'homework') = 0, null;

reset role;
select name, case when ok then 'OK' else 'FAIL' end as status, coalesce(detail, '') as detail
  from results order by ctid;
select count(*) filter (where not ok) as failures from results;
