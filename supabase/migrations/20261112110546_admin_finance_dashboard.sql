-- Verified provider mode; NULL must never be counted as real money.
alter table public.subscription_payments add column if not exists is_test boolean;
alter table public.subscription_payments add column if not exists finance_verified_at timestamptz;

create or replace function public.admin_finance_snapshot(p_month date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare v_start timestamptz; v_result jsonb;
begin
 if auth.uid() is null or not public.is_admin_or_owner() then
   raise exception 'Только администратор' using errcode='42501';
 end if;
 if p_month is null or p_month < date '2020-01-01' or p_month > (now() at time zone 'Europe/Moscow')::date then
   raise exception 'Недопустимый месяц' using errcode='22023';
 end if;
 v_start := (date_trunc('month',p_month::timestamp)-interval '11 months') at time zone 'Europe/Moscow';
 select jsonb_build_object(
 'now',now(),
 'courses',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title) order by c.title),'[]'::jsonb)
   from public.courses c where not c.is_template and exists(select 1 from public.subscription_tariffs t where t.course_id=c.id)),
 'unknown_payments',(select count(*) from public.subscription_payments where is_test is null and yookassa_payment_id is not null),
 'payments',(select coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'student_id',p.student_id,'course_id',s.course_id,'subscription_id',s.id,
   'kind',p.kind,'status',p.status,'amount_rub',p.amount_rub,'is_test',p.is_test,
   'created_at',p.created_at,'paid_at',p.paid_at,'refunded_at',p.refunded_at,
   'period_end',(select l.details->>'period_end' from public.subscription_log l where l.payment_id=p.id and l.event='payment_succeeded' order by l.id limit 1),
   'is_first',not exists(select 1 from public.subscription_payments prev
       where prev.student_id=p.student_id and prev.subscription_id=p.subscription_id
       and prev.paid_at is not null and prev.is_test is not distinct from p.is_test
       and (prev.paid_at,prev.id)<(p.paid_at,p.id)))),'[]'::jsonb)
   from public.subscription_payments p join public.student_subscriptions s on s.id=p.subscription_id
   where p.paid_at>=v_start or p.created_at>=v_start or p.refunded_at>=v_start),
 'refunds',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (
   select distinct on(l.yookassa_object_id) l.yookassa_object_id as id,l.payment_id,l.created_at as at,
       (l.details->>'refund_rub')::numeric as amount_rub
   from public.subscription_log l where l.event='refund_partial' and l.created_at>=v_start
       and l.yookassa_object_id is not null and (l.details->>'refund_rub') ~ '^\d+(\.\d+)?$'
   order by l.yookassa_object_id,l.id
 ) x),
 'subscriptions',(select coalesce(jsonb_agg(jsonb_build_object(
   'id',ss.id,'student_id',ss.student_id,'course_id',ss.course_id,'status',ss.status,
   'access_until',ss.access_until,'auto_renew',ss.auto_renew,'source',ss.source,
   'full_name',pr.full_name,'email',pr.email,
   'is_test',(select p.is_test from public.subscription_payments p where p.subscription_id=ss.id and p.paid_at is not null order by p.paid_at desc,p.id desc limit 1)
 )),'[]'::jsonb) from public.student_subscriptions ss
   join public.students st on st.id=ss.student_id join public.profiles pr on pr.id=st.profile_id),
 'enrollments',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (
   select distinct st.id as student_id,c.id as course_id,pr.full_name,pr.email
   from public.group_students gs join public.groups g on g.id=gs.group_id
   join public.courses c on c.id=g.course_id join public.students st on st.id=gs.student_id
   join public.profiles pr on pr.id=st.profile_id
   where pr.role='student' and not c.is_template
     and exists(select 1 from public.subscription_tariffs t where t.course_id=c.id and t.is_active)
 ) x)
 ) into v_result;
 return v_result;
end $$;
revoke all on function public.admin_finance_snapshot(date) from public,anon;
grant execute on function public.admin_finance_snapshot(date) to authenticated;

