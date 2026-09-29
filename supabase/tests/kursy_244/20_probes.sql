-- §244. Пробы teacher_courses_overview. Ожидания — ручной подсчёт по 10_data_244.sql (шапка файла),
-- записаны таблицей pg_temp.expected; каждая проба печатает строки функции и столбец «сошлось».
\set ON_ERROR_STOP 0
\pset null '∅'

create or replace function pg_temp.id(t text) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-' || lpad(t, 12, '0'))::uuid $$;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', false),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
$$;

-- Ожидание по (кто смотрит, курс): students, topics, open, modules, pending, subs_7d, next_open (+k к сегодня), next_count.
create temp table expected (who text, course text, students int, topics int, open_topics int, modules int,
                            pending int, subs_7d int, next_k int, next_count int);
insert into expected values
  ('O',  'c0a1', 0, 3, 3, 2, 0, 0, null, 0),
  ('O',  'c0a2', 0, 2, 1, 1, 0, 0, 4,    1),
  ('O',  'c001', 4, 8, 4, 2, 4, 5, 5,    2),
  ('O',  'c002', 2, 3, 1, 1, 1, 2, 3,    1),
  ('O',  'c003', 1, 0, 0, 0, 0, 0, null, 0),
  ('K',  'c001', 4, 8, 4, 2, 3, 4, 5,    2),
  ('B',  'c002', 2, 3, 1, 1, 1, 2, 3,    1),
  ('X',  'c00f', 1, 1, 1, 1, 1, 1, null, 0);
grant select on expected to authenticated;
-- Подписи для вывода — копией под postgres: у authenticated в слепке может не быть прав на таблицы.
create temp table titles as select id, title from public.courses;
create temp table names as select s.id, p.full_name from public.students s join public.profiles p on p.id = s.profile_id;
grant select on titles, names to authenticated, anon;

create or replace function pg_temp.check(p_who text, p_ids uuid[] default null)
returns table (course text, students int, ids_match boolean, topics int, open_topics int, modules int,
               pending int, subs_7d int, next_open_k int, next_count int, "сошлось" text)
language sql as $$
  select c.title, o.students, o.students = cardinality(o.student_ids),
         o.topics, o.open_topics, o.modules, o.pending, o.subs_7d,
         o.next_open - current_date, o.next_open_count,
         case when e.course is null then 'нет ожидания'
              when (o.students, o.topics, o.open_topics, o.modules, o.pending, o.subs_7d, o.next_open_count)
                   = (e.students, e.topics, e.open_topics, e.modules, e.pending, e.subs_7d, e.next_count)
                   and (o.next_open - current_date) is not distinct from e.next_k then 'да'
              else 'РАСХОЖДЕНИЕ' end
    from public.teacher_courses_overview(p_ids) o
    join titles c on c.id = o.course_id
    left join expected e on e.who = p_who and pg_temp.id(e.course) = o.course_id
   order by c.title;
$$;

\echo === 1. Владелец O (teacher, не админ): свои 5 курсов (2 шаблона + 3 копии), чужого нет. Все строки — «да».
select pg_temp.as_user(pg_temp.id('a0'));
select * from pg_temp.check('O');

\echo === 2. O: ученики c1 поимённо — S1, S2, S3 и sK (куратор-ученик), без повторов.
select n.full_name from public.teacher_courses_overview(array[pg_temp.id('c001')]) o
  cross join unnest(o.student_ids) sid join names n on n.id = sid
 order by 1;

\echo === 3. O с p_course_ids = [c1, чужой cf]: только c1 — чужой курс в списке ничего не открывает.
select * from pg_temp.check('O', array[pg_temp.id('c001'), pg_temp.id('c00f')]);

\echo === 4. Куратор-ученик K (course_curators на c1): только c1; ждут 3 и сдач 4 — своя сдача sK не считается.
select pg_temp.as_user(pg_temp.id('a4'));
select * from pg_temp.check('K');

\echo === 5. Преподаватель группы B (не владелец): только c2 (физика 11А).
select pg_temp.as_user(pg_temp.id('a2'));
select * from pg_temp.check('B');

\echo === 6. Посторонний преподаватель X: только свой cf; курсы O ему не отдаются даже по прямому списку id — пусто.
select pg_temp.as_user(pg_temp.id('a3'));
select * from pg_temp.check('X');
select count(*) as "курсы O по списку id" from public.teacher_courses_overview(array[pg_temp.id('c001'), pg_temp.id('c002'), pg_temp.id('c0a1')]);

\echo === 7. Ученик S1: пусто (0 строк), без ошибки.
select pg_temp.as_user(pg_temp.id('b1'));
select count(*) as "строк ученику" from public.teacher_courses_overview();

\echo === 8. Администратор платформы: без списка — все 6 курсов школы; со списком [c1, cf] — ровно 2.
select pg_temp.as_user(pg_temp.id('a5'));
select count(*) as "все" from public.teacher_courses_overview();
select c.title, o.pending from public.teacher_courses_overview(array[pg_temp.id('c001'), pg_temp.id('c00f')]) o
  join titles c on c.id = o.course_id order by 1;

\echo === 9. Аноним: permission denied (execute отозван у anon и public).
reset role;
set role anon;
select count(*) from public.teacher_courses_overview();
reset role;

\echo === 10. Права на функцию: authenticated — да, anon — нет; security definer, stable.
select has_function_privilege('authenticated', 'public.teacher_courses_overview(uuid[])', 'execute') as auth_exec,
       has_function_privilege('anon', 'public.teacher_courses_overview(uuid[])', 'execute') as anon_exec,
       p.prosecdef as definer, p.provolatile as volatility
  from pg_proc p where p.proname = 'teacher_courses_overview';

\echo === 11. Граница окна «7 дней»: сдача D6 входит, D7 — нет (c1 у O: 5 сдач, среди них S2 №2 от D6; S3 от D7 не считается).
select pg_temp.as_user(pg_temp.id('a0'));
select (select subs_7d from public.teacher_courses_overview(array[pg_temp.id('c001')])) as subs_7d_c1;
reset role;
