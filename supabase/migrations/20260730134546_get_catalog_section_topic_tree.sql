-- СТАТУС: ПРИМЕНЕНО через одобренный MCP-процесс.
--   version = 20260730134546
--   name    = get_catalog_section_topic_tree
-- Имя файла совпадает с remote schema_migrations. Не переименовывать.
--
-- ============================================================
-- Темы раздела каталога одним запросом (2026-07-30)
-- ============================================================
-- Владелец: «всё равно довольно очень долго загружается, особенно темы и
-- количество задач».
--
-- Причина оказалась не в скорости SQL (после индекса
-- catalog_tasks_counts_covering_idx счётчики считаются за 10–16 мс), а в ЧИСЛЕ
-- последовательных запросов из браузера. useCatalogTopics для обычного
-- (не физического) вида делал так:
--   1) fetchAllPagedRows по catalog_tasks — выкачать ВСЕ id задач раздела;
--   2) разбить их на пачки по IN_FILTER_CHUNK = 50 и на КАЖДУЮ сделать
--      отдельный запрос к catalog_task_topics (.in('task_id', batch));
--   3) запрос к catalog_topics по собранному списку id;
--   4) прогресс пользователя — снова пачками по 50.
-- Для раздела на ~1000 задач это ~20 запросов на связи + ~20 на прогресс,
-- и все строго друг за другом. При круговой задержке 150–250 мс это
-- 5–8 секунд ожидания на одном разделе — ровно то, что и наблюдалось.
--
-- Вся эта арифметика — обычная группировка, её место в базе. Одна RPC
-- отдаёт сразу и темы, и число задач, и личный прогресс по каждой теме.
-- Замер на самом большом разделе математики ЕГЭ (1036 задач, 25 тем): 11 мс.
--
-- ВАЖНО про source: связи НЕ фильтруются по catalog_task_topics.source —
-- в экзаменационном виде должны учитываться и legacy-связи (source is null),
-- и связи ai_physics_v1. Этим RPC отличается от
-- get_catalog_topic_counts_by_source, который специально сужен до одного
-- источника для физического вида. Раньше это поведение держалось клиентским
-- кодом и было закреплено тестом «exam-mode ... не фильтрует legacy-связи
-- по source» — тест теперь проверяет этот файл.
--
-- SECURITY INVOKER: права держит RLS. Прогресс дополнительно сужен явным
-- ctp.user_id = auth.uid() — чтобы функция оставалась корректной, даже если
-- политику на catalog_task_progress когда-нибудь ослабят.
--
-- Фильтр is_published на темах безопасен: на проде все 2302 темы published.
-- (Клиентский fetchCatalogTopicsWithPublishedFallback подстраховывал не от
-- неопубликованных тем, а от ОТСУТСТВИЯ колонки в старой схеме.)
--
-- "position" в кавычках: без них Postgres читает его как ключевое слово и
-- падает на syntax error в списке колонок RETURNS TABLE.

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
  'Темы раздела каталога с числом задач и личным прогрессом вызывающего — одним запросом вместо ~30 последовательных запросов из браузера.';

revoke all on function public.get_catalog_section_topic_tree(uuid) from public, anon;
grant execute on function public.get_catalog_section_topic_tree(uuid) to authenticated, service_role;
