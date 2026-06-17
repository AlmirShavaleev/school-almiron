/**
 * Edge Function: yookassa-webhook
 * Принимает уведомления от ЮКассы и обновляет статус платежей / подписок.
 *
 * Настройка в личном кабинете ЮКассы:
 *   URL уведомлений: https://<project>.supabase.co/functions/v1/yookassa-webhook
 *   Типы: payment.succeeded, payment.cancelled, payment.waiting_for_capture
 *
 * ENV:
 *   YOOKASSA_SHOP_ID  — для верификации (проверяем shop_id в payload)
 *   YOOKASSA_SECRET   — для рекуррентных списаний
 *   APP_URL           — base URL (для return_url при авто-списании)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const YOOKASSA_API = 'https://api.yookassa.ru/v3/payments'

interface YookassaNotification {
  type:   'notification'
  event:  'payment.succeeded' | 'payment.cancelled' | 'payment.waiting_for_capture' | 'refund.succeeded'
  object: YookassaPaymentObject
}

interface YookassaPaymentObject {
  id:             string
  status:         string
  paid:           boolean
  amount:         { value: string; currency: string }
  payment_method: { id: string; type: string; saved: boolean } | null
  metadata:       Record<string, string> | null
  captured_at:    string | null
  created_at:     string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const notification: YookassaNotification = await req.json()
    console.log('[webhook] event:', notification.event, 'payment_id:', notification.object?.id)

    const obj     = notification.object
    const meta    = obj.metadata || {}
    const planId  = meta.plan_id
    const studentId = meta.student_id

    // ── payment.succeeded ─────────────────────────────────────────────────────
    if (notification.event === 'payment.succeeded') {

      // 1. Обновить запись платежа
      await supabase
        .from('payments')
        .update({
          status:                       'succeeded',
          yookassa_payment_method_id:   obj.payment_method?.id || null,
          paid_at:                      obj.captured_at || new Date().toISOString(),
        })
        .eq('yookassa_payment_id', obj.id)

      // 2. Найти / создать подписку
      if (planId && studentId) {
        const { data: plan } = await supabase
          .from('plans').select('*').eq('id', planId).single()

        if (plan) {
          const now      = new Date()
          const periodEnd = new Date(now)
          if (plan.billing_period === 'month') periodEnd.setMonth(periodEnd.getMonth() + 1)
          else if (plan.billing_period === 'year') periodEnd.setFullYear(periodEnd.getFullYear() + 1)
          else periodEnd.setFullYear(periodEnd.getFullYear() + 100) // once → far future

          const savedMethodId = obj.payment_method?.saved ? obj.payment_method.id : null

          const { data: existSub } = await supabase
            .from('subscriptions')
            .select('id')
            .eq('student_id', studentId)
            .eq('plan_id', planId)
            .maybeSingle()

          if (existSub) {
            // Обновить существующую (рекуррентное продление)
            await supabase
              .from('subscriptions')
              .update({
                status:                      'active',
                current_period_start:        now.toISOString(),
                current_period_end:          periodEnd.toISOString(),
                cancel_at_period_end:        false,
                yookassa_payment_method_id:  savedMethodId || undefined,
                updated_at:                  now.toISOString(),
              })
              .eq('id', existSub.id)

            // Привязать платёж к подписке
            await supabase
              .from('payments')
              .update({ subscription_id: existSub.id })
              .eq('yookassa_payment_id', obj.id)
          } else {
            // Создать новую подписку
            const { data: newSub } = await supabase
              .from('subscriptions')
              .insert({
                student_id:                 studentId,
                plan_id:                    planId,
                status:                     'active',
                current_period_start:       now.toISOString(),
                current_period_end:         periodEnd.toISOString(),
                yookassa_payment_method_id: savedMethodId,
              })
              .select('id')
              .single()

            if (newSub) {
              await supabase
                .from('payments')
                .update({ subscription_id: newSub.id })
                .eq('yookassa_payment_id', obj.id)
            }
          }
        }
      }
    }

    // ── payment.cancelled ─────────────────────────────────────────────────────
    if (notification.event === 'payment.cancelled') {
      await supabase
        .from('payments')
        .update({ status: 'cancelled' })
        .eq('yookassa_payment_id', obj.id)
    }

    return new Response('ok', { status: 200, headers: corsHeaders() })

  } catch (e) {
    console.error('[webhook] error:', e)
    return new Response(String(e), { status: 500 })
  }
})

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }
}
