-- ============================================================
-- Решение ДЗ не должно лежать перед учеником до проверки.
--
-- Раздел «Решение ДЗ» показывался ученику наравне с конспектом и теорией:
-- политика `topic_material_items_student_select` смотрела только на
-- `is_visible` и доступность темы. То есть готовое решение было открыто ровно
-- тем, кто ещё не сдал работу. Домашнее задание после такого не имеет смысла.
--
-- Теперь раздел 'solution' открывается ученику, только когда его работу
-- проверили: статус попытки `accepted` или `returned_for_revision`. Возврат на
-- доработку тоже открывает — ученику как раз и нужно свериться с эталоном,
-- чтобы понять, что переделывать.
--
-- Если в теме ДЗ нет вовсе, решение не прячем: прятать нечего, а материал
-- иначе остался бы недостижимым навсегда.
--
-- Защита стоит в RLS, а не в интерфейсе. Спрятанная кнопка — не защита:
-- путь к файлу утёк бы в первом же ответе PostgREST, и по нему выписалась бы
-- подписанная ссылка.
-- ============================================================

create or replace function public.topic_solution_unlocked(p_topic_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
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
         and a.status in ('accepted', 'returned_for_revision')
    );
$$;

comment on function public.topic_solution_unlocked(uuid) is
  'Открыт ли ученику раздел «Решение ДЗ» этой темы: да, если его работу уже проверили или ДЗ в теме нет.';

-- Интерфейсу нужно ЗНАТЬ, что решение существует и когда откроется, но не
-- видеть его содержимого. Поэтому отдельная функция, возвращающая три флага и
-- ни одного пути к файлу.
create or replace function public.topic_solution_state(p_topic_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'has_solution', exists (
      select 1 from topic_material_items i
       where i.topic_id = p_topic_id and i.section = 'solution' and i.is_visible
    ),
    'has_homework', exists (
      select 1 from topic_homework h where h.topic_id = p_topic_id
    ),
    'unlocked', public.topic_solution_unlocked(p_topic_id)
  );
$$;

drop policy if exists topic_material_items_student_select on public.topic_material_items;

create policy topic_material_items_student_select on public.topic_material_items
  for select to authenticated
  using (
    is_visible
    and public.course_student_can_see_topic(topic_id)
    and (section is distinct from 'solution' or public.topic_solution_unlocked(topic_id))
  );

grant execute on function public.topic_solution_unlocked(uuid) to authenticated;
grant execute on function public.topic_solution_state(uuid)    to authenticated;
