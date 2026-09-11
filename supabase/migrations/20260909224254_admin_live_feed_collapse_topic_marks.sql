-- Лента: отметки темы схлопываются до одного события.
--
-- Найдено на живых данных сразу после первой версии: `topic_section_marks`
-- хранит отметку на КАЖДУЮ рубрику темы (`group_key`), поэтому один ученик,
-- закрывший тему, давал в ленте две-три одинаковые строки подряд с одним и
-- тем же временем и названием. Вводная просит событие «ученик отметил тему
-- пройденной» — оно одно, а не по числу рубрик.
--
-- Схлопываем по (ученик, тема) с последним временем: это и есть момент, когда
-- тема стала пройденной целиком.
create or replace function public.admin_live_feed(p_limit integer default 20)
returns table (
  kind       text,
  at         timestamptz,
  actor_name text,
  detail     text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_admin_or_owner() then
    raise exception 'ONLY_ADMIN_SEES_SCHOOL_STATS' using errcode = 'P0001';
  end if;

  return query
  with events as (
    -- Сдал работу
    select 'submitted'::text as kind,
           a.submitted_at    as at,
           p.full_name       as actor_name,
           t.title           as detail
      from public.topic_homework_attempts a
      join public.students s  on s.id = a.student_id
      join public.profiles p  on p.id = s.profile_id
      join public.topic_homework h on h.id = a.homework_id
      join public.topics t    on t.id = h.topic_id
     where a.submitted_at is not null

    union all

    -- Преподаватель разобрал работу
    select 'reviewed',
           r.created_at,
           p.full_name,
           t.title
      from public.topic_homework_reviews r
      join public.profiles p  on p.id = r.reviewer_id
      join public.topic_homework_attempts a on a.id = r.attempt_id
      join public.topic_homework h on h.id = a.homework_id
      join public.topics t    on t.id = h.topic_id

    union all

    -- Ученик отметил тему пройденной. Одна строка на (ученик, тема), а не по
    -- числу рубрик: рубрик у темы до десяти (§100), и без группировки лента
    -- забивалась бы повторами одного действия.
    select 'marked',
           max(m.marked_at),
           min(p.full_name),
           min(t.title)
      from public.topic_section_marks m
      join public.students s on s.id = m.student_id
      join public.profiles p on p.id = s.profile_id
      join public.topics t   on t.id = m.topic_id
     group by m.student_id, m.topic_id

    union all

    -- Зачислен в курс
    select 'enrolled',
           gs.joined_at,
           p.full_name,
           coalesce(c.title, g.name)
      from public.group_students gs
      join public.students s on s.id = gs.student_id
      join public.profiles p on p.id = s.profile_id
      join public.groups g   on g.id = gs.group_id
      left join public.courses c on c.id = g.course_id
  )
  select e.kind, e.at, e.actor_name, e.detail
    from events e
   where e.at is not null
   order by e.at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

revoke all on function public.admin_live_feed(integer) from public, anon;
grant execute on function public.admin_live_feed(integer) to authenticated;
