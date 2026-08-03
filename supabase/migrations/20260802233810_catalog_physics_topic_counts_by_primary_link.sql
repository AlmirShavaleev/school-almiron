-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260802233810
--   name    = catalog_physics_topic_counts_by_primary_link
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- ============================================================
-- «Физические темы»: счётчики считают только основную тему задачи (2026-08-03)
-- ============================================================
-- Владелец: числа на вкладке «Физические темы» не сходились. Карточка раздела
-- «Механика» показывала 1247 задач, а сумма счётчиков по её 31 подтеме — 1979.
--
-- Причина не в ошибке подсчёта, а в устройстве разбора: у задачи ровно одна
-- связь is_primary и до двух дополнительных (в среднем 1.54 связи на задачу,
-- максимум 3). Раздел считал distinct-задачи, подтемы — все связи, поэтому
-- сумма подтем всегда была больше.
--
-- Решение владельца: считать по основной теме. Проверено на проде до правки —
-- после фильтра числа сходятся точно, раздел = сумма своих подтем:
--   Механика               1247 -> 1208 (сумма подтем 1979 -> 1208)
--   МКТ и термодинамика     782 -> 775  (1279 -> 775)
--   Электростатика          132 -> 115  (187 -> 115)
--   Постоянный ток          190 -> 158  (253 -> 158)
--   Магнитное поле и ЭМИ    296 -> 292  (383 -> 292)
--   Оптика                  224 -> 224  (286 -> 224)
--   Квантовая и атомная     336 -> 335  (405 -> 335)
-- Всего по вкладке: 3107 задач — ровно число задач с разбором, без двойного
-- счёта.
--
-- Безопасность: у каждой из 3107 задач есть ровно одна связь is_primary
-- (проверено: 3107 primary-связей на 3107 задач, задач с двумя primary — 0).
-- Поэтому ни одна задача не пропадает из вкладки целиком; она перестаёт
-- показываться только в дополнительных темах. Список задач темы фильтруется
-- тем же признаком на клиенте (useCatalog.ts, loadPhysicsTopicTasks) — иначе
-- счётчик в боковой панели расходился бы с длиной списка на странице.
--
-- Экзаменационного вида правка не касается: там свой RPC
-- get_catalog_section_topic_tree, и is_primary в нём не участвует.
--
-- ОТКАТ: обе функции восстанавливаются из миграции
-- 20260718170717_add_catalog_perf_indexes_and_fix_source_match.sql —
-- достаточно убрать строки «and tt.is_primary» и вернуть count(*).

create or replace function public.get_catalog_topic_counts_by_source(
  p_subject text, p_exam_type text, p_source text
) returns table (topic_id uuid, task_count bigint, completed_count bigint)
language sql stable security invoker as $$
  with user_done as (
    select ctp.task_id from public.catalog_task_progress ctp
    where ctp.user_id = auth.uid() and ctp.is_completed = true
    group by ctp.task_id
  )
  select tt.topic_id,
         count(distinct tt.task_id)::bigint,
         count(distinct ud.task_id)::bigint
  from public.catalog_task_topics tt
  join public.catalog_tasks t on t.id = tt.task_id
  left join user_done ud on ud.task_id = tt.task_id
  where tt.source is not distinct from p_source
    and tt.is_primary
    and t.subject = p_subject
    and t.exam_type = p_exam_type
    and t.is_published = true
  group by tt.topic_id
$$;

revoke execute on function public.get_catalog_topic_counts_by_source(text,text,text) from public;
grant  execute on function public.get_catalog_topic_counts_by_source(text,text,text) to authenticated;

comment on function public.get_catalog_topic_counts_by_source(text,text,text) is
  'Счётчики тем вкладки «Физические темы»: только основная тема задачи (is_primary), иначе сумма подтем больше счётчика раздела — у задачи до трёх связей.';

create or replace function public.get_catalog_section_task_counts_by_source(
  p_subject text, p_exam_type text, p_source text
) returns table (section_id uuid, task_count bigint, completed_count bigint)
language sql stable security invoker as $$
  with links as (
    select distinct parent.id as section_id, tt.task_id
    from public.catalog_task_topics tt
    join public.catalog_topics leaf   on leaf.id = tt.topic_id
    join public.catalog_topics parent on parent.id = leaf.parent_id
    join public.catalog_tasks t       on t.id = tt.task_id
    where tt.source is not distinct from p_source
      and tt.is_primary
      and t.subject = p_subject
      and t.exam_type = p_exam_type
      and t.is_published = true
  ),
  user_done as (
    select ctp.task_id from public.catalog_task_progress ctp
    where ctp.user_id = auth.uid() and ctp.is_completed = true
    group by ctp.task_id
  )
  select l.section_id,
         count(distinct l.task_id)::bigint,
         count(distinct ud.task_id)::bigint
  from links l
  left join user_done ud on ud.task_id = l.task_id
  group by grouping sets ((l.section_id), ())
$$;

revoke execute on function public.get_catalog_section_task_counts_by_source(text,text,text) from public;
grant  execute on function public.get_catalog_section_task_counts_by_source(text,text,text) to authenticated;

comment on function public.get_catalog_section_task_counts_by_source(text,text,text) is
  'Счётчики разделов вкладки «Физические темы»: только основная тема задачи (is_primary), чтобы карточка раздела равнялась сумме своих подтем.';
