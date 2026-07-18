-- ============================================================
-- DEMO DATA — CRM данные (без auth.users и profiles — уже созданы)
-- Использует подзапросы по email, поэтому UUID не важны
-- ============================================================

-- ============================================================
-- 3. STUDENTS
-- ============================================================

insert into students (id, profile_id, grade, target_exam, target_subject, target_score, xp_points, league)
select
  'a1000001-0000-0000-0000-000000000000', id, 11,'ege','physics',85,2450,'silver'
from profiles where email='alex@demo.ru'
on conflict (id) do nothing;

insert into students (id, profile_id, grade, target_exam, target_subject, target_score, xp_points, league)
select 'a1000002-0000-0000-0000-000000000000', id, 11,'ege','physics',90,3820,'gold'
from profiles where email='maria@demo.ru'
on conflict (id) do nothing;

insert into students (id, profile_id, grade, target_exam, target_subject, target_score, xp_points, league)
select 'a1000003-0000-0000-0000-000000000000', id, 10,'oge','math',0,1200,'bronze'
from profiles where email='dima@demo.ru'
on conflict (id) do nothing;

insert into students (id, profile_id, grade, target_exam, target_subject, target_score, xp_points, league)
select 'a1000004-0000-0000-0000-000000000000', id, 11,'ege','physics',80,5100,'platinum'
from profiles where email='anna@demo.ru'
on conflict (id) do nothing;

insert into students (id, profile_id, grade, target_exam, target_subject, target_score, xp_points, league)
select 'a1000005-0000-0000-0000-000000000000', id, 10,'oge','math',0,980,'bronze'
from profiles where email='ivan@demo.ru'
on conflict (id) do nothing;

insert into students (id, profile_id, grade, target_exam, target_subject, target_score, xp_points, league)
select 'a1000006-0000-0000-0000-000000000000', id, 11,'ege','physics',95,6200,'academic'
from profiles where email='sofia@demo.ru'
on conflict (id) do nothing;

insert into students (id, profile_id, grade, target_exam, target_subject, target_score, xp_points, league)
select 'a1000007-0000-0000-0000-000000000000', id, 11,'ege','physics',75,1750,'bronze'
from profiles where email='nikita@demo.ru'
on conflict (id) do nothing;

insert into students (id, profile_id, grade, target_exam, target_subject, target_score, xp_points, league)
select 'a1000008-0000-0000-0000-000000000000', id, 10,'oge','math',0,2100,'silver'
from profiles where email='kate@demo.ru'
on conflict (id) do nothing;

insert into students (id, profile_id, grade, target_exam, target_subject, target_score, xp_points, league)
select 'a1000009-0000-0000-0000-000000000000', id, 11,'ege','physics',88,3400,'gold'
from profiles where email='pavel@demo.ru'
on conflict (id) do nothing;

insert into students (id, profile_id, grade, target_exam, target_subject, target_score, xp_points, league)
select 'a1000010-0000-0000-0000-000000000000', id, 10,'oge','math',0,4500,'gold'
from profiles where email='olga@demo.ru'
on conflict (id) do nothing;

-- ============================================================
-- 4. PARENTS
-- ============================================================

insert into parents (id, profile_id)
select 'b1000001-0000-0000-0000-000000000000', id from profiles where email='petrov-parent@demo.ru'
on conflict (id) do nothing;

insert into parents (id, profile_id)
select 'b1000002-0000-0000-0000-000000000000', id from profiles where email='ivanova-parent@demo.ru'
on conflict (id) do nothing;

insert into parents (id, profile_id)
select 'b1000003-0000-0000-0000-000000000000', id from profiles where email='kozlov-parent@demo.ru'
on conflict (id) do nothing;

insert into parent_students (parent_id, student_id) values
  ('b1000001-0000-0000-0000-000000000000','a1000001-0000-0000-0000-000000000000'),
  ('b1000002-0000-0000-0000-000000000000','a1000002-0000-0000-0000-000000000000'),
  ('b1000003-0000-0000-0000-000000000000','a1000003-0000-0000-0000-000000000000')
on conflict do nothing;

-- ============================================================
-- 5. TEACHERS & CURATORS
-- ============================================================

insert into teachers (id, profile_id, subjects, bio, rating)
select 'c1000001-0000-0000-0000-000000000000', id, '{physics}','Преподаватель физики, 10 лет опыта. Средний балл выпускников — 82.',4.9
from profiles where email='physics@demo.ru'
on conflict (id) do nothing;

insert into teachers (id, profile_id, subjects, bio, rating)
select 'c1000002-0000-0000-0000-000000000000', id, '{math}','Преподаватель математики. Специализация — ОГЭ и база ЕГЭ.',4.7
from profiles where email='math@demo.ru'
on conflict (id) do nothing;

insert into curators (id, profile_id)
select 'd1000001-0000-0000-0000-000000000000', id from profiles where email='curator@demo.ru'
on conflict (id) do nothing;

-- ============================================================
-- 6. COURSES & GROUPS
-- ============================================================

insert into courses (id, title, subject, exam_type, description, price, duration_weeks) values
  ('e1000001-0000-0000-0000-000000000000','ЕГЭ Физика 2025',     'physics','ege','Полный курс подготовки к ЕГЭ по физике.',8000,36),
  ('e1000002-0000-0000-0000-000000000000','ОГЭ Математика 2025', 'math',   'oge','Подготовка к ОГЭ по математике.',6000,30)
on conflict (id) do nothing;

insert into groups (id, name, course_id, teacher_id, curator_id, max_students, schedule_days, schedule_time) values
  ('f1000001-0000-0000-0000-000000000000','ЕГЭ Физика 11А','e1000001-0000-0000-0000-000000000000','c1000001-0000-0000-0000-000000000000','d1000001-0000-0000-0000-000000000000',8, '{tuesday,friday}',    '18:00'),
  ('f1000002-0000-0000-0000-000000000000','ЕГЭ Физика 11Б','e1000001-0000-0000-0000-000000000000','c1000001-0000-0000-0000-000000000000','d1000001-0000-0000-0000-000000000000',8, '{monday,thursday}',   '19:00'),
  ('f1000003-0000-0000-0000-000000000000','ОГЭ Математика', 'e1000002-0000-0000-0000-000000000000','c1000002-0000-0000-0000-000000000000','d1000001-0000-0000-0000-000000000000',10,'{wednesday,saturday}','17:00')
on conflict (id) do nothing;

insert into group_students (group_id, student_id) values
  ('f1000001-0000-0000-0000-000000000000','a1000001-0000-0000-0000-000000000000'),
  ('f1000001-0000-0000-0000-000000000000','a1000002-0000-0000-0000-000000000000'),
  ('f1000001-0000-0000-0000-000000000000','a1000004-0000-0000-0000-000000000000'),
  ('f1000001-0000-0000-0000-000000000000','a1000006-0000-0000-0000-000000000000'),
  ('f1000002-0000-0000-0000-000000000000','a1000007-0000-0000-0000-000000000000'),
  ('f1000002-0000-0000-0000-000000000000','a1000009-0000-0000-0000-000000000000'),
  ('f1000003-0000-0000-0000-000000000000','a1000003-0000-0000-0000-000000000000'),
  ('f1000003-0000-0000-0000-000000000000','a1000005-0000-0000-0000-000000000000'),
  ('f1000003-0000-0000-0000-000000000000','a1000008-0000-0000-0000-000000000000'),
  ('f1000003-0000-0000-0000-000000000000','a1000010-0000-0000-0000-000000000000')
on conflict do nothing;

-- ============================================================
-- 7. ЗАНЯТИЯ
-- ============================================================

insert into lessons (id, group_id, teacher_id, title, scheduled_at, duration_minutes, status, zoom_link) values
  ('a2000001-0000-0000-0000-000000000000','f1000001-0000-0000-0000-000000000000','c1000001-0000-0000-0000-000000000000','Механика: кинематика',        now()-interval '7 days', 90,'completed',null),
  ('a2000002-0000-0000-0000-000000000000','f1000001-0000-0000-0000-000000000000','c1000001-0000-0000-0000-000000000000','Механика: динамика',          now()-interval '3 days', 90,'completed',null),
  ('a2000003-0000-0000-0000-000000000000','f1000001-0000-0000-0000-000000000000','c1000001-0000-0000-0000-000000000000','Термодинамика: основы',       now()+interval '2 days', 90,'scheduled','https://zoom.us/j/demo1'),
  ('a2000004-0000-0000-0000-000000000000','f1000002-0000-0000-0000-000000000000','c1000001-0000-0000-0000-000000000000','Электростатика',              now()-interval '5 days', 90,'completed',null),
  ('a2000005-0000-0000-0000-000000000000','f1000002-0000-0000-0000-000000000000','c1000001-0000-0000-0000-000000000000','Электродинамика',             now()+interval '4 days', 90,'scheduled','https://zoom.us/j/demo2'),
  ('a2000006-0000-0000-0000-000000000000','f1000003-0000-0000-0000-000000000000','c1000002-0000-0000-0000-000000000000','Алгебра: квадратные уравн.',  now()-interval '4 days', 90,'completed',null),
  ('a2000007-0000-0000-0000-000000000000','f1000003-0000-0000-0000-000000000000','c1000002-0000-0000-0000-000000000000','Геометрия: треугольники',     now()+interval '1 day',  90,'scheduled','https://zoom.us/j/demo3')
on conflict (id) do nothing;

-- ============================================================
-- 8. ПОСЕЩАЕМОСТЬ
-- ============================================================

insert into attendance (lesson_id, student_id, present, late) values
  ('a2000001-0000-0000-0000-000000000000','a1000001-0000-0000-0000-000000000000',true, false),
  ('a2000001-0000-0000-0000-000000000000','a1000002-0000-0000-0000-000000000000',true, false),
  ('a2000001-0000-0000-0000-000000000000','a1000004-0000-0000-0000-000000000000',false,false),
  ('a2000001-0000-0000-0000-000000000000','a1000006-0000-0000-0000-000000000000',true, true),
  ('a2000002-0000-0000-0000-000000000000','a1000001-0000-0000-0000-000000000000',true, false),
  ('a2000002-0000-0000-0000-000000000000','a1000002-0000-0000-0000-000000000000',true, false),
  ('a2000002-0000-0000-0000-000000000000','a1000004-0000-0000-0000-000000000000',true, false),
  ('a2000002-0000-0000-0000-000000000000','a1000006-0000-0000-0000-000000000000',true, false)
on conflict do nothing;

-- ============================================================
-- 9. ДОМАШНИЕ ЗАДАНИЯ
-- ============================================================

insert into homeworks (id, lesson_id, group_id, title, description, due_date, max_score, created_by) values
  ('b2000001-0000-0000-0000-000000000000','a2000001-0000-0000-0000-000000000000','f1000001-0000-0000-0000-000000000000','Кинематика: задачи §3',     'Решить задачи 3.1–3.10 из сборника Иродова',now()+interval '3 days',100,'c1000001-0000-0000-0000-000000000000'),
  ('b2000002-0000-0000-0000-000000000000','a2000002-0000-0000-0000-000000000000','f1000001-0000-0000-0000-000000000000','Динамика: законы Ньютона',  'Задачи из сборника, стр. 15–18',            now()-interval '1 day', 100,'c1000001-0000-0000-0000-000000000000'),
  ('b2000003-0000-0000-0000-000000000000','a2000004-0000-0000-0000-000000000000','f1000002-0000-0000-0000-000000000000','Электростатика: конденсат.','Задачи 5.1–5.8',                            now()+interval '5 days',100,'c1000001-0000-0000-0000-000000000000'),
  ('b2000004-0000-0000-0000-000000000000','a2000006-0000-0000-0000-000000000000','f1000003-0000-0000-0000-000000000000','Квадратные уравнения',      'Учебник стр. 45, упр. 1–15',               now()+interval '2 days',100,'c1000002-0000-0000-0000-000000000000')
on conflict (id) do nothing;

insert into homework_submissions (homework_id, student_id, status, score, feedback, submitted_at, checked_at, checked_by) values
  ('b2000002-0000-0000-0000-000000000000','a1000001-0000-0000-0000-000000000000','checked',  78,'Хорошая работа! Задача 3 решена неверно.',       now()-interval '2 days',now()-interval '1 day','c1000001-0000-0000-0000-000000000000'),
  ('b2000002-0000-0000-0000-000000000000','a1000002-0000-0000-0000-000000000000','checked',  95,'Отлично! Все задачи решены верно.',               now()-interval '2 days',now()-interval '1 day','c1000001-0000-0000-0000-000000000000'),
  ('b2000002-0000-0000-0000-000000000000','a1000004-0000-0000-0000-000000000000','submitted',null,null,                                            now()-interval '1 day',null,null),
  ('b2000001-0000-0000-0000-000000000000','a1000001-0000-0000-0000-000000000000','submitted',null,null,                                            now(),null,null)
on conflict do nothing;

-- ============================================================
-- 10. ПРОБНИКИ
-- ============================================================

insert into mock_exams (id, title, subject, exam_type, group_id, date, max_score, created_by) values
  ('c2000001-0000-0000-0000-000000000000','Пробник ЕГЭ #1 (октябрь)','physics','ege','f1000001-0000-0000-0000-000000000000',now()-interval '30 days',100,'c1000001-0000-0000-0000-000000000000'),
  ('c2000002-0000-0000-0000-000000000000','Пробник ЕГЭ #2 (ноябрь)', 'physics','ege','f1000001-0000-0000-0000-000000000000',now()-interval '10 days',100,'c1000001-0000-0000-0000-000000000000'),
  ('c2000003-0000-0000-0000-000000000000','Пробник ОГЭ #1 (октябрь)','math',   'oge','f1000003-0000-0000-0000-000000000000',now()-interval '20 days',32, 'c1000002-0000-0000-0000-000000000000')
on conflict (id) do nothing;

insert into mock_exam_results (mock_exam_id, student_id, score, part1_score, part2_score) values
  ('c2000001-0000-0000-0000-000000000000','a1000001-0000-0000-0000-000000000000',58,35,23),
  ('c2000001-0000-0000-0000-000000000000','a1000002-0000-0000-0000-000000000000',67,42,25),
  ('c2000001-0000-0000-0000-000000000000','a1000004-0000-0000-0000-000000000000',71,45,26),
  ('c2000001-0000-0000-0000-000000000000','a1000006-0000-0000-0000-000000000000',82,50,32),
  ('c2000002-0000-0000-0000-000000000000','a1000001-0000-0000-0000-000000000000',66,40,26),
  ('c2000002-0000-0000-0000-000000000000','a1000002-0000-0000-0000-000000000000',74,46,28),
  ('c2000002-0000-0000-0000-000000000000','a1000004-0000-0000-0000-000000000000',79,49,30),
  ('c2000002-0000-0000-0000-000000000000','a1000006-0000-0000-0000-000000000000',89,55,34),
  ('c2000003-0000-0000-0000-000000000000','a1000003-0000-0000-0000-000000000000',22,15,7),
  ('c2000003-0000-0000-0000-000000000000','a1000005-0000-0000-0000-000000000000',18,12,6),
  ('c2000003-0000-0000-0000-000000000000','a1000008-0000-0000-0000-000000000000',25,17,8)
on conflict do nothing;

-- ============================================================
-- 11. ПЛАТЕЖИ
-- ============================================================

insert into payments (student_id, amount, status, description, due_date, paid_at) values
  ('a1000001-0000-0000-0000-000000000000',8000,'paid',   'Октябрь 2024','2024-10-01','2024-09-30'),
  ('a1000001-0000-0000-0000-000000000000',8000,'paid',   'Ноябрь 2024', '2024-11-01','2024-10-30'),
  ('a1000001-0000-0000-0000-000000000000',8000,'pending','Декабрь 2024','2024-12-01',null),
  ('a1000002-0000-0000-0000-000000000000',8000,'paid',   'Ноябрь 2024', '2024-11-01','2024-10-28'),
  ('a1000003-0000-0000-0000-000000000000',6000,'overdue','Октябрь 2024','2024-10-01',null),
  ('a1000003-0000-0000-0000-000000000000',6000,'pending','Ноябрь 2024', '2024-11-01',null),
  ('a1000004-0000-0000-0000-000000000000',8000,'paid',   'Ноябрь 2024', '2024-11-01','2024-11-01'),
  ('a1000005-0000-0000-0000-000000000000',6000,'paid',   'Ноябрь 2024', '2024-11-01','2024-10-29'),
  ('a1000006-0000-0000-0000-000000000000',8000,'paid',   'Ноябрь 2024', '2024-11-01','2024-10-31'),
  ('a1000007-0000-0000-0000-000000000000',8000,'overdue','Октябрь 2024','2024-10-01',null),
  ('a1000008-0000-0000-0000-000000000000',6000,'paid',   'Ноябрь 2024', '2024-11-01','2024-11-02'),
  ('a1000009-0000-0000-0000-000000000000',8000,'pending','Декабрь 2024','2024-12-01',null),
  ('a1000010-0000-0000-0000-000000000000',6000,'paid',   'Ноябрь 2024', '2024-11-01','2024-10-30');

-- ============================================================
-- 12. XP И ДОСТИЖЕНИЯ
-- ============================================================

insert into leaderboard_points (student_id, points, reason) values
  ('a1000001-0000-0000-0000-000000000000',50, 'homework'),
  ('a1000001-0000-0000-0000-000000000000',20, 'attendance'),
  ('a1000002-0000-0000-0000-000000000000',100,'homework'),
  ('a1000004-0000-0000-0000-000000000000',150,'exam'),
  ('a1000006-0000-0000-0000-000000000000',200,'achievement');

insert into student_achievements (student_id, achievement_id)
  select 'a1000001-0000-0000-0000-000000000000', id from achievements where condition_type = 'homework' limit 1
  on conflict do nothing;
insert into student_achievements (student_id, achievement_id)
  select 'a1000002-0000-0000-0000-000000000000', id from achievements where condition_type = 'score' limit 1
  on conflict do nothing;
insert into student_achievements (student_id, achievement_id)
  select 'a1000006-0000-0000-0000-000000000000', id from achievements where condition_type = 'attendance' limit 1
  on conflict do nothing;

-- ============================================================
-- 13. РЕКОМЕНДАЦИИ
-- ============================================================

insert into recommendations (student_id, text, created_by)
select 'a1000001-0000-0000-0000-000000000000','Повторить законы Фарадея и Ленца, решить 10–15 задач на ЭМИ', id
from profiles where email='physics@demo.ru';

insert into recommendations (student_id, text, created_by)
select 'a1000001-0000-0000-0000-000000000000','Проработать интерференцию и дифракцию — часто встречается в части 2', id
from profiles where email='physics@demo.ru';

insert into recommendations (student_id, text, created_by)
select 'a1000003-0000-0000-0000-000000000000','Уделить внимание геометрии — результаты по этому разделу низкие', id
from profiles where email='math@demo.ru';

select 'Демо-данные успешно загружены! Пользователей: 18, учеников: 10, групп: 3' as result;
