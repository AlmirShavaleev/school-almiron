-- §242. Поверх цепочки §241 (../razdel_241/run.sh: слепок §221 + §240 + пробники §241):
-- то, что читают функции §242 и чего в цепочке нет.
--   * auth_is_staff_of_topic — ДОСЛОВНО из 20260718133034 (нужна настоящим файлам
--     видео 20260917230035 / 20260917230444, которые run.sh накатывает следом);
--   * material_views в слепке §240 — без ключа; ключ как в 20260808220907, иначе
--     индекс PENDING_242 и выборки не похожи на прод.
create or replace function public.auth_is_staff_of_topic(p_topic_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from topics tp
    join modules m on m.id = tp.module_id
    where tp.id = p_topic_id
      and (
        exists (
          select 1 from public.courses c
          where c.id = m.course_id and c.owner_id = auth.uid()
        )
        or exists (
          select 1
          from groups g
          where g.course_id = m.course_id
            and (
              exists (select 1 from teachers t where t.id = g.teacher_id and t.profile_id = auth.uid())
              or exists (select 1 from curators c where c.id = g.curator_id and c.profile_id = auth.uid())
            )
        )
      )
  );
$function$;
revoke all on function public.auth_is_staff_of_topic(uuid) from anon, public;
grant execute on function public.auth_is_staff_of_topic(uuid) to authenticated;

alter table public.material_views add primary key (profile_id, item_id, viewed_on);
create index if not exists material_views_topic_idx on public.material_views (topic_id);
alter table public.material_views enable row level security;
revoke all on table public.material_views from anon, authenticated;
