-- §231. Данные поверх слепка §229 (все выдуманы) и помощники проб.
--
-- Люди слепка (../mock_exam_lesson_221/10_data.sql):
--   ADM  …000a  владелец платформы (admin + строка teachers)
--   T11A …00a1  преподаватель группы 11А (курс «Математика 11А»)
--   OWN  …00a2  владелец курса 11А, роль teacher, своей группы нет
--   T11B …00b1  преподаватель 11Б (другой курс) — ПОСТОРОННИЙ для 11А
--   CUR  …00c1  куратор курса 11А (course_curators), роль curator
--   S1   …0051  ученица 11А;  S53 …0053 — ученик 11Б (посторонний для 11А)
--
-- Пробник №9 — «удалённой группы»: group_id null, автор T11A (так остаётся
-- пробник после удаления группы: FK ON DELETE SET NULL).
insert into mock_exams (id, title, subject, exam_type, group_id, date, template_id, created_by) values
 ('50000000-0000-0000-0000-000000000009','Пробник №9 удалённой группы','math','ege', null, now(),
   (select id from mock_exam_templates where year = 2027), '10000000-0000-0000-0000-0000000000a1');

-- Итоги: №6 (11А) — S1 и S2, S1 уже отправлен; №2 (11Б) — S53. Пишем тем же
-- путём, что экран (save_mock_exam_grid), от имени преподавателя группы.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false) \g /dev/null
select public.save_mock_exam_grid('50000000-0000-0000-0000-000000000006',
  '[{"student_id":"20000000-0000-0000-0000-000000000051","points":[1,1,1,1,1,1,1,1,1,1,1,1,2,3,2,2,3,4,4]},
    {"student_id":"20000000-0000-0000-0000-000000000052","points":[1,0,1,0,1,0,1,0,1,0,1,0,0,0,0,0,0,0,0]}]'::jsonb) \g /dev/null
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', false) \g /dev/null
select public.save_mock_exam_grid('50000000-0000-0000-0000-000000000002',
  '[{"student_id":"20000000-0000-0000-0000-000000000053","points":[1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0]}]'::jsonb) \g /dev/null
select set_config('request.jwt.claims', '{}', false) \g /dev/null
update mock_exam_results set notified_at = now() - interval '1 hour', notified_score = score,
       notified_part1_score = part1_score, notified_part2_score = part2_score
 where mock_exam_id = '50000000-0000-0000-0000-000000000006' and student_id = '20000000-0000-0000-0000-000000000051';

-- ── Помощники проб (только в этой базе) ─────────────────────────────────────
-- Выполнить оператор под текущей ролью и вернуть «rows=N» или «ERR <sqlstate>: …».
create or replace function public.probe_exec(p_sql text) returns text
language plpgsql security invoker as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return 'rows=' || n;
exception when others then
  return 'ERR ' || sqlstate || ': ' || left(sqlerrm, 90);
end $$;
-- Сколько строк отдаёт запрос (или ошибка).
create or replace function public.probe_count(p_sql text) returns text
language plpgsql security invoker as $$
declare n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into n;
  return 'rows=' || n;
exception when others then
  return 'ERR ' || sqlstate || ': ' || left(sqlerrm, 90);
end $$;
grant execute on function public.probe_exec(text), public.probe_count(text) to authenticated;

-- Журнал проб: пишется ПОСЛЕ отката каждой пробы, под владельцем.
create table probe_log (n serial, who text, action text, expected text, actual text);
