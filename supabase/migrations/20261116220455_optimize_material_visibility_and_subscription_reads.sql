set local lock_timeout = '3s';
set local statement_timeout = '20s';

CREATE OR REPLACE FUNCTION public.student_tmi_solution_topics()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with candidates as materialized (
    select c.topic_id from public.student_candidate_topics() as c(topic_id)
  ),
  accepted_topics as materialized (
    select distinct h.topic_id
      from public.topic_homework_attempts a
      join public.topic_homework h on h.id = a.homework_id
     where a.student_id = (select public.auth_student_id())
       and a.status = 'accepted'
  )
  select coalesce(array_agg(c.topic_id), '{}'::uuid[])
    from candidates c
   where (select exists (
           select 1 from public.app_feature_flags f
            where f.key = 'read_only_mode' and f.enabled
         ))
      or not exists (select 1 from public.topic_homework h where h.topic_id = c.topic_id)
      or c.topic_id in (select a.topic_id from accepted_topics a);
$function$;

CREATE OR REPLACE FUNCTION public.student_tmi_condition_topics()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(array_agg(c.topic_id), '{}'::uuid[])
    from public.student_candidate_topics() as c(topic_id)
    join public.topics t on t.id = c.topic_id
   where (t.kind is distinct from 'check' and t.kind is distinct from 'control')
      or public.topic_condition_visible(c.topic_id);
$function$;

CREATE OR REPLACE FUNCTION public.my_subscriptions()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                 s.id,
           'course_id',          s.course_id,
           'course_title',       c.title,
           'group_id',           (select g.id from public.groups g where g.course_id = s.course_id
                                   order by g.created_at limit 1),
           'tariff_id',          s.tariff_id,
           'tariff_title',       t.title,
           'price_rub',          t.price_rub,
           'period_months',      t.period_months,
           'status',             s.status,
           'has_access',         s.status in ('trial','active','past_due') and s.access_until > now(),
           'current_period_end', s.current_period_end,
           'access_until',       s.access_until,
           'auto_renew',         s.auto_renew,
           'can_auto_renew',     exists (select 1 from public.subscription_payment_methods m
                                          where m.subscription_id = s.id),
           'next_charge_at',     s.next_charge_at,
           'last_charge_error',  s.last_charge_error,
           'card_title',         s.card_title,
           'promo',              (select jsonb_build_object('percent', r.percent, 'payments_left', r.payments_left,
                                                            'next_amount_rub', public._promo_price(t.price_rub, r.percent))
                                    from public.subscription_promo_redemptions r
                                   where r.subscription_id = s.id and r.status = 'applied'
                                     and r.kind = 'percent' and r.payments_left > 0
                                     and (r.tariff_id is null or r.tariff_id = s.tariff_id)
                                   order by r.created_at desc limit 1),
           'payments',           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', p.id, 'kind', p.kind, 'amount_rub', p.amount_rub,
                      'discount_rub', p.discount_rub,
                      'status', p.status, 'paid_at', p.paid_at, 'created_at', p.created_at,
                      'refunded_at', p.refunded_at)
                    order by p.created_at desc)
               from public.subscription_payments p
              where p.subscription_id = s.id and p.status <> 'created'), '[]'::jsonb)
         ) order by s.created_at), '[]'::jsonb)
    from public.student_subscriptions s
    join public.courses c on c.id = s.course_id
    join public.subscription_tariffs t on t.id = s.tariff_id
   where s.student_id = (select public.auth_student_id());
$function$;
