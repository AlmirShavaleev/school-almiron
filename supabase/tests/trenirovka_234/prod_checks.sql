-- §234. Что проверить на проде СРАЗУ ПОСЛЕ применения PENDING_234 (только
-- чтение). Ожидаемое — в комментариях.

-- 1. Все старые материалы получили дорожку ege, тренировки ещё нет.
--    Ожидается одна строка: ege | <число строк таблицы>.
select track, count(*) from public.topic_material_items group by track;

-- 2. Новые CHECK и индекс на месте.
select conname from pg_constraint
 where conrelid = 'public.topic_material_items'::regclass
   and conname in ('topic_material_items_track_check', 'topic_material_items_training_subtopic_check',
                   'topic_material_items_section_check', 'topic_material_items_homework_tasks_training_check')
 order by 1;                                                     -- 4 строки
select pg_get_constraintdef(oid) from pg_constraint
 where conname = 'topic_material_items_section_check';            -- 8 значений, последнее homework_tasks
select indexname from pg_indexes where indexname = 'topic_material_items_topic_track_idx';

-- 3. Функции получили новые тела (true во всех столбцах).
select
  pg_get_functiondef('public.template_sync_topic_apply(uuid)'::regprocedure)        like '%ti.subtopic_title%' as sync_carries,
  pg_get_functiondef('public.course_copy_topic_content(uuid,uuid,text,integer)'::regprocedure) like '%v_row.subtopic_title%' as copy_carries,
  pg_get_functiondef('public.topic_done_events()'::regprocedure)                     like '%mi.track = ''ege''%' as done_ege_only,
  pg_get_functiondef('public.topic_solution_state(uuid)'::regprocedure)              like '%i.track = ''ege''%' as state_ege_only,
  pg_get_functiondef('public.topic_material_object_visible(text)'::regprocedure)     like '%i.track = ''training''%' as file_gate,
  pg_get_functiondef('public.school_unopened_materials(integer)'::regprocedure)      like '%i.track = ''ege''%' as unopened_ege_only;

-- 4. Политики: ученику — гейт с исключением тренировки и скрытые подтемы;
--    у topic_subtopic_hidden — read/insert/delete.
select policyname, cmd, qual from pg_policies
 where tablename in ('topic_material_items', 'topic_subtopic_hidden') order by tablename, policyname;

-- 5. «Тема пройдена» не сдвинулась: до загрузки тренировки число пар то же,
--    что было до применения (снять `select count(*) from topic_done_events()`
--    ДО применения и сравнить).
select count(*) from public.topic_done_events();
