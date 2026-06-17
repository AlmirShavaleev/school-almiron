/**
 * Edge Function: charge-recurring
 * Списывает ежемесячные/ежегодные платежи по истёкшим подпискам.
 *
 * Запускать через Supabase Cron (pg_cron) или внешний планировщик:
 *   SELECT cron.schedule('charge-recurring', '0 9 * * *',
 *     $$SELECT net.http_post(
 *       url:= 'https://<proj>.supabase.co/functions/v1/charge-recurring',
 *       headers:= '{"Authorization":"Bearer <anon_key>"}'::jsonb
 *     )$$
 *   );
 *
 * ENV:
 *   YOOKASSA_SHOP_ID
 *   YOOKASSA_SECRET
 *   APP_URL
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const YOOKASSA_API = 'https://api.yookassa.ru/v3/payments'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors() })
  }

  const shopId = Deno.env.get('YOOKASSA_SHOP_ID')
  const secret = Deno.env.get('YOOKASSA_SECRET')
  const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173'

  if (!shopId || !secret) {
    return json({ error: 'YuKassa credentials not configured' }, 503)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const now = new Date().toISOString()

    // Найти активные подписки, у которых период истёк и есть сохранённый метод оплаты
    const { data: subs, error } = await supabase
      .from('subscriptions')
      .select('*, plans(*), students(profile_id, profiles(full_name, email))')
      .eq('status', 'active')
      .eq('cancel_at_period_end', false)
      .lt('current_period_end', now)
      .not('yookassa_payment_method_id', 'is', null)

    if (error) {
      console.error('[charge-recurring] DB error:', error)
      return json({ error: error.message }, 500)
    }

    console.log(`[charge-recurring] Found ${subs?.length ?? 0} subscriptions to charge`)

    const results: { sub_id: string; status: string; error?: string }[] = []

    for (const sub of subs || []) {
      const plan    = sub.plans
      const profile = sub.students?.profiles

      if (!plan || plan.billing_period === 'once') continue

      const idempotencyKey = `recurring-${sub.id}-${Date.now()}`

      try {
        const paymentPayload = {
          amount:  { value: plan.price.toFixed(2), currency: plan.currency || 'RUB' },
          capture: true,
          payment_method_id: sub.yookassa_payment_method_id,  // автоматическое списание
          description: `Подписка «${plan.name}» — автопродление`,
          metadata: {
            plan_id:      plan.id,
            student_id:   sub.student_id,
            profile_id:   sub.students?.profile_id || '',
            plan_name:    plan.name,
            student_name: profile?.full_name || '',
            is_recurring: 'true',
          },
          receipt: profile?.email ? {
            customer: { email: profile.email },
            items: [{
              description:     plan.name,
              quantity:        '1.00',
              amount:          { value: plan.price.toFixed(2), currency: plan.currency || 'RUB' },
              vat_code:        1,
              payment_mode:    'full_prepayment',
              payment_subject: 'service',
            }],
          } : undefined,
        }

        const ykRes = await fetch(YOOKASSA_API, {
          method:  'POST',
          headers: {
            'Authorization':   'Basic ' + btoa(`${shopId}:${secret}`),
            'Content-Type':    'application/json',
            'Idempotence-Key': idempotencyKey,
          },
          body: JSON.stringify(paymentPayload),
        })

        if (!ykRes.ok) {
          const errText = await ykRes.text()
          throw new Error(`YuKassa: ${errText}`)
        }

        const ykPayment = await ykRes.json()

        // Сохранить попытку платежа
        await supabase.from('payments').insert({
          student_id:            sub.student_id,
          subscription_id:       sub.id,
          plan_id:               plan.id,
          amount:                plan.price,
          currency:              plan.currency || 'RUB',
          status:                ykPayment.status === 'succeeded' ? 'succeeded' : 'pending',
          yookassa_payment_id:   ykPayment.id,
          description:           paymentPayload.description,
          is_recurring:          true,
          paid_at:               ykPayment.status === 'succeeded' ? new Date().toISOString() : null,
        })

        // Если succeeded сразу (при автосписании) — продлить период
        if (ykPayment.status === 'succeeded') {
          const newStart = new Date()
          const newEnd   = new Date(newStart)
          if (plan.billing_period === 'month') newEnd.setMonth(newEnd.getMonth() + 1)
          else newEnd.setFullYear(newEnd.getFullYear() + 1)

          await supabase.from('subscriptions').update({
            current_period_start: newStart.toISOString(),
            current_period_end:   newEnd.toISOString(),
            status:               'active',
            updated_at:           newStart.toISOString(),
          }).eq('id', sub.id)
        } else {
          // pending — вебхук обновит при успехе
          await supabase.from('subscriptions').update({
            status:     'past_due',
            updated_at: new Date().toISOString(),
          }).eq('id', sub.id)
        }

        results.push({ sub_id: sub.id, status: ykPayment.status })

      } catch (e) {
        console.error(`[charge-recurring] Failed for sub ${sub.id}:`, e)
        // Пометить как просроченную
        await supabase.from('subscriptions').update({
          status:     'past_due',
          updated_at: new Date().toISOString(),
        }).eq('id', sub.id)

        results.push({ sub_id: sub.id, status: 'error', error: String(e) })
      }
    }

    return json({ charged: results.length, results })

  } catch (e) {
    console.error('[charge-recurring] Fatal:', e)
    return json({ error: String(e) }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  })
}

function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }
}
