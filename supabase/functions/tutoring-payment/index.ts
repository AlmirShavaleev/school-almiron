import { createClient } from 'jsr:@supabase/supabase-js@2'
import { verifiedTutoringPayment } from './verify.ts'
import { returnBase } from '../_shared/subscription.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

Deno.serve(async (req: Request) => {
 if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
 if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
 try {
  const authorization = req.headers.get('Authorization') ?? ''
  const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await auth.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
  if (authError || !user) return json({ error: 'Войдите в аккаунт' }, 401)
  const body = await req.json().catch(() => null)
  if (!body || !uuid(body.booking_id) || !['checkout','sync'].includes(body.action)) return json({ error: 'Неверный запрос' }, 400)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: booking, error } = await admin.from('tutoring_bookings').select('*').eq('id', body.booking_id).eq('profile_id', user.id).maybeSingle()
  if (error || !booking) return json({ error: 'Запись не найдена' }, 404)
  const shop = Deno.env.get('SUBSCRIPTION_YK_SHOP_ID')
  const key = Deno.env.get('SUBSCRIPTION_YK_SECRET_KEY')
  const app = Deno.env.get('SUBSCRIPTION_APP_URL')
  // Initial release accepts test-store credentials only. No real charges.
  if (!shop || !key?.startsWith('test_') || !app) return json({ error: 'Тестовая оплата пока не настроена' }, 503)
  const headers = { Authorization: 'Basic ' + btoa(`${shop}:${key}`), 'Content-Type': 'application/json' }
  if (body.action === 'checkout') {
   if (booking.status !== 'pending' || new Date(booking.reserved_until).getTime() <= Date.now()) return json({ error: 'Резерв истёк. Выберите время заново.' }, 409)
   if (booking.confirmation_url) return json({ confirmation_url: booking.confirmation_url })
   const base = returnBase(body.return_origin, app, Deno.env.get('SUBSCRIPTION_RETURN_ORIGINS'))
   const result = await fetch('https://api.yookassa.ru/v3/payments', {
    method: 'POST', headers: { ...headers, 'Idempotence-Key': booking.id },
    body: JSON.stringify({ amount: { value: Number(booking.amount_rub).toFixed(2), currency: 'RUB' }, capture: true,
     confirmation: { type: 'redirect', return_url: `${base}/tutoring?booking=${booking.id}` },
     description: 'Личный разбор с Альмиром — 45 минут',
     metadata: { origin: 'tutoring_v1', booking_id: booking.id },
     receipt: { customer: { email: booking.receipt_email }, items: [{ description: 'Личный разбор — 45 минут', quantity: '1.00', amount: { value: Number(booking.amount_rub).toFixed(2), currency: 'RUB' }, vat_code: 1, payment_mode: 'full_prepayment', payment_subject: 'service' }] },
    }),
   })
   const payment = await result.json().catch(() => null)
   if (!result.ok || !payment?.id || payment.test !== true || !payment.confirmation?.confirmation_url) return json({ error: 'Не удалось получить тестовую страницу оплаты. Повторите попытку.' }, 502)
   const { error: saveError } = await admin.from('tutoring_bookings').update({ yookassa_id: payment.id, confirmation_url: payment.confirmation.confirmation_url, payment_status: payment.status, updated_at: new Date().toISOString() }).eq('id', booking.id).eq('status','pending')
   if (saveError) return json({ error: 'Не удалось сохранить платёж. Повторите попытку.' }, 503)
   return json({ confirmation_url: payment.confirmation.confirmation_url })
  }
  if (!booking.yookassa_id) return json({ status: booking.status })
  const response = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(booking.yookassa_id)}`, { headers })
  const payment = await response.json().catch(() => null)
  if (!response.ok || !verifiedTutoringPayment(payment, booking)) return json({ error: 'Пока не удалось проверить платёж. Попробуйте ещё раз.' }, 502)
  const { data: status, error: applyError } = await admin.rpc('tutoring_apply_payment', { p_id: booking.id, p_yookassa_id: payment.id, p_status: payment.status, p_amount: Number(payment.amount.value) })
  if (applyError) return json({ error: 'Не удалось обновить статус оплаты' }, 503)
  return json({ status })
 } catch {
  return json({ error: 'Сервис временно недоступен. Повторите попытку.' }, 503)
 }
})
