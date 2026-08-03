-- Счётчик «сколько человек прошло» для входа по четырём экзаменам (§52).
-- PostgREST не умеет group by, поэтому агрегат считаем в базе.
--
-- SECURITY DEFINER, а не INVOKER: RLS на test_variant_student_assignments
-- пускает учителя-выдавшего и админа, но не куратора, хотя сами варианты
-- куратор видеть вправе (tv_select). На INVOKER куратор получал бы «прошло 0»
-- вместо настоящего числа — молчаливое враньё вместо отказа. Видимость здесь
-- повторяет tv_select один в один.

create or replace function public.variant_pass_counts(p_variant_ids uuid[])
returns table (
  variant_id     uuid,
  assigned_count integer,
  passed_count   integer
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    tvsa.variant_id,
    count(*)::integer,
    count(*) filter (where tvsa.status in ('submitted', 'completed'))::integer
  from public.test_variant_student_assignments tvsa
  join public.test_variants tv on tv.id = tvsa.variant_id
  where tvsa.variant_id = any(p_variant_ids)
    and case public.current_user_role()
          when 'teacher' then tv.created_by = auth.uid()
          when 'admin'   then true
          when 'owner'   then true
          when 'curator' then true
          else false
        end
  group by 1;
$$;

comment on function public.variant_pass_counts(uuid[]) is
  'Выдано и пройдено по каждому варианту. Видимость как у test_variants. §52';

revoke all on function public.variant_pass_counts(uuid[]) from public, anon;
grant execute on function public.variant_pass_counts(uuid[]) to authenticated;
