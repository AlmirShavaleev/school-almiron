-- §258. Честный предпросмотр «как ученик» у работы по времени.
-- Применено оркестратором 02.10 (MCP apply_migration, версия 20261002203702); применённый текст — без строк-комментариев и comment on.
--
-- Интерфейсу нужно ЗНАТЬ, что в теме есть «Ответы и критерии» и «Условие»,
-- даже когда сами строки ученику не приходят (RLS: criteria — за
-- topic_solution_unlocked, worksheet_homework работы по времени — за
-- topic_condition_visible, §240). Иначе вкладка у ученика пропадает без
-- объяснения, а в предпросмотре персонала — открыта без замка.
--
-- Тело — из 20260927153810_trenirovka_training_track.sql (последняя редакция
-- функции); прежние поля has_solution / has_homework / unlocked без изменений,
-- добавлены has_criteria и has_condition — по тому же правилу, что
-- has_solution (видимые строки основной дорожки). Ни одного пути к файлу.
--
-- Права: create or replace сохраняет прежние гранты; явно закрываем anon и
-- public (как у помощников §240) и оставляем authenticated. Повторный прогон
-- файла безопасен: только create or replace / revoke / grant, без drop.

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
         and i.track = 'ege'
    ),
    'has_homework', exists (
      select 1 from topic_homework h where h.topic_id = p_topic_id
    ),
    'unlocked', public.topic_solution_unlocked(p_topic_id),
    'has_criteria', exists (
      select 1 from topic_material_items i
       where i.topic_id = p_topic_id and i.section = 'criteria' and i.is_visible
         and i.track = 'ege'
    ),
    'has_condition', exists (
      select 1 from topic_material_items i
       where i.topic_id = p_topic_id and i.section = 'worksheet_homework' and i.is_visible
         and i.track = 'ege'
    )
  );
$$;

comment on function public.topic_solution_state(uuid) is
  'Флаги рубрик с гейтом для страницы темы: есть ли решение, ответы и критерии, условие; есть ли ДЗ; открыто ли решение (и критерии) этому ученику. Без путей к файлам. §258';

revoke all on function public.topic_solution_state(uuid) from public, anon;
grant execute on function public.topic_solution_state(uuid) to authenticated;
