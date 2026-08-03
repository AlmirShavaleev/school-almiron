-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260802223053
--   name    = exam_topic_tree_excludes_ai_physics_links
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- ============================================================
-- Экзаменационный вид: темы раздела без параллельной ИИ-таксономии (2026-08-03)
-- ============================================================
-- Владелец: «неправильно показывается кол-во задач в подтемах ЕГЭ по физике».
--
-- Что было. get_catalog_section_topic_tree сознательно не фильтровала связи по
-- catalog_task_topics.source — чтобы не потерять legacy-связи (source is null).
-- Но связи ai_physics_v1 ведут в ДРУГОЕ дерево тем (external_id 900000–900712),
-- которое показывается на отдельной вкладке «Физические темы». В
-- экзаменационном виде эти темы приезжали как обычные подтемы раздела:
--
--   раздел «№1 Кинематика», 146 задач, в списке 17 тем, из них 8 — из ИИ-дерева;
--   сумма счётчиков подтем 377 при 146 задачах в разделе;
--   среди подтем номера №1 висели «Механические волны, звук» и «Законы Ньютона».
--
-- Проверено на проде: разделение источников полное — 31 818 связей с source is
-- null ведут только в обычные темы, все 4 772 связи ai_physics_v1 — только в
-- дерево 900000–900712. Поэтому отсечение по source ничего не теряет и трогает
-- ровно физику ЕГЭ: 323 -> 234 строк тем на 26 разделах; математика ЕГЭ/ОГЭ и
-- физика ОГЭ не меняются вовсе (0 связей ai_physics_v1).
--
-- Фильтр намеренно записан как «is distinct from AI-источник», а не «is null»:
-- если появится ещё один источник обычных связей, он останется виден в
-- экзаменационном виде. Исключается только параллельная таксономия.

create or replace function public.get_catalog_section_topic_tree(p_section_id uuid)
returns table (
  id              uuid,
  external_id     bigint,
  parent_id       uuid,
  title           text,
  slug            text,
  "position"      integer,
  task_count      bigint,
  completed_count bigint
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with links as (
    select tt.topic_id, tt.task_id
      from catalog_task_topics tt
      join catalog_tasks t on t.id = tt.task_id
     where t.section_id = p_section_id
       and t.is_published
       and tt.source is distinct from 'ai_physics_v1'
  ),
  agg as (
    select l.topic_id,
           count(distinct l.task_id)   as task_count,
           count(distinct ctp.task_id) as completed_count
      from links l
      left join catalog_task_progress ctp
             on ctp.task_id = l.task_id
            and ctp.user_id = auth.uid()
            and ctp.is_completed
     group by l.topic_id
  )
  select tp.id, tp.external_id, tp.parent_id, tp.title, tp.slug, tp."position",
         a.task_count, a.completed_count
    from agg a
    join catalog_topics tp on tp.id = a.topic_id
   where tp.is_published
   order by tp."position";
$$;

comment on function public.get_catalog_section_topic_tree(uuid) is
  'Темы раздела каталога с числом задач и личным прогрессом вызывающего — одним запросом. Связи ai_physics_v1 исключены: это отдельное дерево тем вкладки «Физические темы», в экзаменационном виде оно давало чужие подтемы и завышенные счётчики.';

revoke all on function public.get_catalog_section_topic_tree(uuid) from public, anon;
grant execute on function public.get_catalog_section_topic_tree(uuid) to authenticated, service_role;
