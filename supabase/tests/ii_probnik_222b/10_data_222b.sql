-- §222b. Данные поверх цепочки §231 (все выдуманы) и помощник проб.
--
-- Люди — как в §231 (../mock_exam_rights_231/10_data_231.sql):
--   ADM …000a владелец платформы;  T11A …00a1 преподаватель 11А;  OWN …00a2 владелец курса 11А (teacher);
--   T11B …00b1 преподаватель 11Б (посторонний для 11А);  CUR …00c1 куратор курса 11А;
--   S1 …0051, S2 …0052, S4 …0054 — ученики 11А;  S53 …0053 — ученик 11Б.
-- Пробник №6 (11А, шаблон на 19 номеров, вторая часть 13–19): фото у S1 (с §228) и у S4 (здесь); у S2 фото нет.
-- Пробник №2 (11Б): фото у S53.
insert into mock_exam_photos (mock_exam_id, student_id, storage_path, file_name) values
 ('50000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000054','50000000-0000-0000-0000-000000000006/photos/20000000-0000-0000-0000-000000000054/1_p.jpg','p.jpg'),
 ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000053','50000000-0000-0000-0000-000000000002/photos/20000000-0000-0000-0000-000000000053/1_p.jpg','p.jpg');

-- Предложения ИИ (так их пишет edge-функция — сервисным ключом, здесь — владельцем таблиц).
insert into mock_exam_ai_suggestions (mock_exam_id, student_id, task_number, points, max_points, confidence, comment, regions, model) values
 ('50000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000051', 13, 1, 2, 'medium', 'Потерян корень на отборе',
   '[{"photo_id":"00000000-0000-0000-0000-000000000000","page":1,"x":0.1,"y":0.2,"w":0.5,"h":0.1}]', 'test/model'),
 ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000053', 13, 2, 2, 'high', null, '[]', 'test/model');

-- Состояние: у S1 (№6) проверка «идёт» 20 минут — мертва, сторож закроет; у S53 (№2) — идёт прямо сейчас.
insert into mock_exam_ai_runs (mock_exam_id, student_id, status, requested_at, started_at) values
 ('50000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000051','running', now() - interval '21 minutes', now() - interval '20 minutes'),
 ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000053','running', now(), now());

-- Значение первого столбца первой строки (или ошибка) — для ответа функции.
create or replace function public.probe_val(p_sql text) returns text
language plpgsql security invoker as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, 'null');
exception when others then
  return 'ERR ' || sqlstate || ': ' || left(sqlerrm, 90);
end $$;
grant execute on function public.probe_val(text) to authenticated;
