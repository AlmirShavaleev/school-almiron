-- §101. Копия курса ссылается на те же объекты хранилища, а не заливает свои.
--
-- 1. Уникальность storage_path снимается: общий путь — теперь норма, а не порча.
-- 2. Права на файл перестают выводиться из первой папки пути: у общего объекта
--    папка осталась от темы-шаблона, и ученик копии получал бы отказ.
-- 3. Счёт ссылок — запросом по индексу, без счётчика-колонки.

-- ── 1. Уникальность → обычные индексы ───────────────────────────────────────
-- Имя course_lesson_materials_path_uniq — легаси: таблица раньше называлась
-- course_lesson_materials, индекс переехал вместе с ней и в списке
-- constraint'ов не виден (это индекс, а не констрейнт).
drop index if exists public.course_lesson_materials_path_uniq;

alter table public.topic_homework_files
  drop constraint if exists topic_homework_files_storage_path_key;

-- Индексы нужны не «на всякий случай»: по ним считаются ссылки при удалении.
create index if not exists topic_material_items_storage_path_idx
  on public.topic_material_items (storage_path)
  where storage_path is not null;

create index if not exists topic_homework_files_storage_path_idx
  on public.topic_homework_files (storage_path);

-- ── 2. Сколько строк ссылается на объект ────────────────────────────────────
create or replace function public.storage_path_refs(p_bucket text, p_path text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    case
      when p_bucket = 'topic-homework' then 0
      else (select count(*) from public.topic_material_items where storage_path = p_path)
    end
    +
    case
      when p_bucket in ('topic-materials', 'course-materials', 'course-lesson-materials') then 0
      else (select count(*) from public.topic_homework_files where storage_path = p_path)
    end
  )::int;
$$;

comment on function public.storage_path_refs(text, text) is
  'Сколько строк ссылается на объект хранилища. Правило удаления живёт только '
  'здесь: объект убирается, когда ответ 0. Считает ОБЕ таблицы (материалы темы '
  'и файлы ДЗ) — путь встречается в двух, и забыв вторую, удаление материала '
  'выбило бы файл у чужого задания (§101). SECURITY DEFINER: под вызывающим '
  'RLS спрятала бы чужие строки, и счёт вышел бы заниженным — то есть в пользу '
  'удаления. Ошибаться эта функция должна в другую сторону.';

grant execute on function public.storage_path_refs(text, text) to authenticated;

-- ── 3. Видимость объекта — по ссылающимся строкам, а не по первой папке ─────
create or replace function public.topic_material_object_visible(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.topic_material_items i
     where i.storage_path = p_object_name
       and (
            public.topic_material_can_manage(i.topic_id)
         or (
              public.course_student_can_see_topic(i.topic_id)
              and (i.section is distinct from 'solution'
                   or public.topic_solution_unlocked(i.topic_id))
            )
       )
  );
$$;

comment on function public.topic_material_object_visible(text) is
  'Видит ли вызывающий этот объект хотя бы по одной ссылающейся строке. '
  'Заменяет вывод темы из первой папки пути: у общего объекта копии папка '
  'осталась от темы-шаблона, и ученик копии получал бы отказ, а ученик '
  'шаблона — лишний доступ (§101). Проверка положительная: нет подходящей '
  'строки — нет доступа, поэтому новая ссылка не может ослабить старую. '
  'Гейт «Решения ДЗ» (§95) считается ПО СВОЕЙ строке в СВОЕЙ теме. '
  'SECURITY DEFINER обязателен: тот же подзапрос под учеником RLS скрыла бы, '
  'и exists стал бы ложью там, где доступ есть (зеркало ловушки §95).';

create or replace function public.topic_homework_object_visible(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.topic_homework_files f
      join public.topic_homework h on h.id = f.homework_id
     where f.storage_path = p_object_name
       and (
            public.topic_material_can_manage(h.topic_id)
         or public.course_student_can_see_topic(h.topic_id)
       )
  );
$$;

comment on function public.topic_homework_object_visible(text) is
  'То же для файлов задания: видимость по ссылающейся строке, а не по папке '
  'пути (§101).';

grant execute on function public.topic_material_object_visible(text) to authenticated;
grant execute on function public.topic_homework_object_visible(text) to authenticated;

-- ── 4. Политики чтения ──────────────────────────────────────────────────────
-- Ветка «первая папка + can_manage» остаётся ТОЛЬКО персоналу: она закрывает
-- окно между загрузкой файла и вставкой строки материала, когда ссылаться ещё
-- не на что. Ученику такой ветки нет — ему только строки.
drop policy if exists topic_material_files_read on storage.objects;
create policy topic_material_files_read on storage.objects
for select to public
using (
  bucket_id = 'topic-materials'
  and (
       public.topic_material_can_manage(((storage.foldername(name))[1])::uuid)
    or public.topic_material_object_visible(name)
  )
);

drop policy if exists topic_homework_files_read on storage.objects;
create policy topic_homework_files_read on storage.objects
for select to public
using (
  bucket_id = 'topic-homework'
  and (
       public.topic_material_can_manage(((storage.foldername(name))[1])::uuid)
    or public.topic_homework_object_visible(name)
  )
);
