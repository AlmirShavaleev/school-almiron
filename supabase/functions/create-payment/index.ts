/**
 * Edge Function: create-payment
 * Создаёт платёж в ЮКассе и сохраняет запись в БД.
 *
 * ENV (задаются в Supabase → Settings → Edge Functions → Secrets):
 *   YOOKASSA_SHOP_ID   — идентификатор магазина
 *   YOOKASSA_SECRET    — секретный ключ
 *   APP_URL            — base URL приложения (напр. https://school.example.com)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const YOOKASSA_API = 'https://api.yookassa.ru/v3/payments'

interface CreatePaymentRequest {
  plan_id:      string   // uuid плана
  student_id:   string   // uuid записи students
  profile_id:   string   // uuid профиля (для return_url)
  save_method:  boolean  // сохранить карту для рекуррентных
  description?: string
}

interface YookassaPayment {
  id:     string
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'cancelled'
  amount: { value: string; currency: string }
  confirmation?: { type: string; confirmation_url: string }
  payment_method?: { id: string; type: string; saved: boolean }
  metadata?: Record<string, string>
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const shopId = Deno.env.get('YOOKASSA_SHOP_ID')
    const secret = Deno.env.get('YOOKASSA_SECRET')
    const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173'

    if (!shopId || !secret) {
      return json({ error: 'YOOKASSA_SHOP_ID / YOOKASSA_SECRET не настроены' }, 503)
    }

    // Init Supabase with service role (need to write payments table)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body: CreatePaymentRequest = await req.json()
    const { plan_id, student_id, profile_id, save_method } = body

    // Load plan
    const { data: plan, error: planErr } = await supabase
      .from('plans').select('*').eq('id', plan_id).single()
    if (planErr || !plan) return json({ error: 'Тариф не найден' }, 404)

    // Load student profile for metadata
    const { data: profile } = await supabase
      .from('profiles').select('full_name, email').eq('id', profile_id).single()

    // Idempotency key — повтор запроса не создаёт дубль
    const idempotencyKey = `${student_id}-${plan_id}-${Date.now()}`

    const paymentPayload = {
      amount: { value: plan.price.toFixed(2), currency: plan.currency || 'RUB' },
      capture: true,
      confirmation: {
        type:       'redirect',
        return_url: `${appUrl}/payment-result`,
      },
      description: body.description || `Оплата тарифа «${plan.name}»`,
      save_payment_method: save_method && plan.billing_period !== 'once',
      metadata: {
        plan_id,
        student_id,
        profile_id,
        plan_name: plan.name,
        student_name: profile?.full_name || '',
      },
      receipt: profile?.email ? {
        customer: { email: profile.email },
        items: [{
          description:  plan.name,
          quantity:     '1.00',
          amount:       { value: plan.price.toFixed(2), currency: plan.currency || 'RUB' },
          vat_code:     1,  // без НДС — при необходимости поменять
          payment_mode:    'full_prepayment',
          payment_subject: 'service',
        }],
      } : undefined,
    }

    // Call YuKassa API
    const ykRes = await fetch(YOOKASSA_API, {
      method:  'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${shopId}:${secret}`),
        'Content-Type':  'application/json',
        'Idempotence-Key': idempotencyKey,
      },
      body: JSON.stringify(paymentPayload),
    })

    if (!ykRes.ok) {
      const err = await ykRes.text()
      console.error('[create-payment] YuKassa error:', err)
      return json({ error: 'Ошибка ЮКассы: ' + err }, 502)
    }

    const ykPayment: YookassaPayment = await ykRes.json()

    // Save payment record to DB
    const { data: payment, error: insertErr } = await supabase
      .from('payments')
      .insert({
        student_id,
        plan_id,
        amount:               plan.price,
        currency:             plan.currency || 'RUB',
        status:               'pending',
        yookassa_payment_id:  ykPayment.id,
        confirmation_url:     ykPayment.confirmation?.confirmation_url,
        description:          paymentPayload.description,
        is_recurring:         false,
        metadata:             { save_method },
      })
      .select('id')
      .single()

    if (insertErr) {
      console.error('[create-payment] DB insert error:', insertErr)
      // Не блокируем — пусть редирект работает
    }

    return json({
      payment_id:       ykPayment.id,
      db_payment_id:    payment?.id,
      confirmation_url: ykPayment.confirmation?.confirmation_url,
      status:           ykPayment.status,
    })

  } catch (e) {
    console.error('[create-payment] Unexpected error:', e)
    return json({ error: String(e) }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
