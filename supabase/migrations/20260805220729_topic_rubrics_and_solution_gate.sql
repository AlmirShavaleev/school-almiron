-- Новые рубрики темы и гейт «Решения ДЗ» (решения владельца 2026-08-05).
--
-- РУБРИКИ. Список живёт не в одном месте: в базе это два text-столбца с CHECK
-- (`topic_material_items.section` и `lesson_template_materials.type`), а
-- «Видео» и «Тестирование» вообще не рубрики-секции — видео это kind='video' в
-- той же таблице, тестирование отдельная таблица topic_test_assignments.
-- Поэтому «десять рубрик» — порядок в интерфейсе поверх трёх хранилищ, а
-- настоящих новых значений три.
--
-- Шаблоны уроков получают те же три значения: урок из шаблона не должен
-- отличаться от урока с нуля (решение владельца).

alter table public.topic_material_items drop constraint if exists topic_material_items_section_check;
alter table public.topic_material_items add constraint topic_material_items_section_check
  check (section = any (array[
    'notes', 'theory', 'tasks',
    'task_solution',       -- Решение задач
    'worksheet_tasks',     -- Рабочий лист задач
    'worksheet_homework',  -- Рабочий лист ДЗ
    'solution'             -- Решение ДЗ (с гейтом ниже)
  ]::text[]));

alter table public.lesson_template_materials drop constraint if exists lesson_template_materials_type_check;
alter table public.lesson_template_materials add constraint lesson_template_materials_type_check
  check (type = any (array[
    'notes', 'theory', 'tasks',
    'task_solution', 'worksheet_tasks', 'worksheet_homework',
    'homework', 'solution', 'video', 'link'
  ]::text[]));

-- ГЕЙТ. Правило было: открыто, если попытка `accepted` ИЛИ
-- `returned_for_revision`. Владелец решил иначе: «на доработке» решения ещё не
-- открывает — иначе достаточно сдать что угодно и получить возврат.
--
-- Ветка «у темы нет ДЗ вовсе» оставлена открытой сознательно: закрыть её —
-- значит спрятать решения у всех тем, где ДЗ не задавали, а таких большинство.
create or replace function public.topic_solution_unlocked(p_topic_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    not exists (
      select 1 from topic_homework h where h.topic_id = p_topic_id
    )
    or exists (
      select 1
        from topic_homework_attempts a
        join topic_homework h on h.id = a.homework_id
       where h.topic_id = p_topic_id
         and a.student_id = public.auth_student_id()
         and a.status = 'accepted'
    );
$function$;

-- ДЫРА В STORAGE. Политика на строку материала (topic_material_items_student_select)
-- гейт уже держала, а политика на ФАЙЛ — нет: она пускала любого ученика,
-- который видит тему. То есть строку решения ученик не видел, а файл мог
-- перечислить в бакете и подписать по пути. Спрятанная в интерфейсе рубрика,
-- чей файл достаётся прямым запросом, — это не гейт.
--
-- Проверку выносим в SECURITY DEFINER функцию не для красоты: подзапрос прямо
-- в политике исполнялся бы ПОД УЧЕНИКОМ, RLS скрыл бы от него строку решения,
-- `not exists` стал бы истиной — и гейт открыл бы файл вместо того, чтобы
-- закрыть. Ровно наоборот задуманному.
create or replace function public.topic_material_file_locked(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
      from topic_material_items i
     where i.storage_path = p_object_name
       and i.section = 'solution'
       and not public.topic_solution_unlocked(i.topic_id)
  );
$function$;

comment on function public.topic_material_file_locked(text) is
  'Закрыт ли файл материала гейтом решения ДЗ. Определяется только здесь, копию в политику не вносить.';

drop policy if exists topic_material_files_read on storage.objects;
create policy topic_material_files_read on storage.objects
for select using (
  bucket_id = 'topic-materials'
  and (
    topic_material_can_manage(((storage.foldername(name))[1])::uuid)
    or (
      course_student_can_see_topic(((storage.foldername(name))[1])::uuid)
      -- Файл, не привязанный ни к одной строке материала, ведёт себя как
      -- раньше: правило сужает доступ только к запертым решениям.
      and not public.topic_material_file_locked(name)
    )
  )
);
