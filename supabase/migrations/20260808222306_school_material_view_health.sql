-- Сколько просмотров записалось — сторож контракта врезки.
--
-- Зачем отдельная цифра на экране: клиентский вызов `record_material_view`
-- в `TopicMaterialItems` намеренно глушит ЛЮБУЮ ошибку — учёт не должен
-- мешать ученику открыть файл. Плата за это — молчание: разъедься имя функции
-- или параметра, права или подпись, и аналитика просто перестанет наполняться,
-- ничего об этом не сказав. Ноль в этой строке — единственный видимый сигнал,
-- что учёт сломался.
--
-- Сужение то же, что у остальных срезов: считаем просмотры материалов СВОИХ
-- курсов, чтобы преподаватель не видел охват чужих.

create or replace function public.school_material_view_health()
returns table (views_7d integer, views_total integer, first_day date)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_today date := (now() at time zone 'Europe/Moscow')::date;
begin
  if not exists (select 1 from public.my_staff_course_ids()) then
    raise exception 'NOT_STAFF_OF_ANY_COURSE' using errcode = 'P0001';
  end if;

  return query
  with mine as (select cid from public.my_staff_course_ids() as cid),
  my_views as (
    select v.viewed_on
      from public.material_views v
      join public.topics t  on t.id = v.topic_id
      join public.modules m on m.id = t.module_id
      join mine mm on mm.cid = m.course_id
  )
  select
    (select count(*) from my_views where viewed_on > v_today - 7)::int,
    (select count(*) from my_views)::int,
    (select min(viewed_on) from my_views);
end;
$fn$;

revoke all on function public.school_material_view_health() from public, anon;
grant execute on function public.school_material_view_health() to authenticated;
