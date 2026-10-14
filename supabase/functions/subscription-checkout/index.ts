/**
 * Edge Function: subscription-checkout (§282)
 *
 * Оформление платной подписки: создаёт платёж в ЮKassa и возвращает ссылку
 * на страницу оплаты. Деплой с verify_jwt = true.
 *
 * Ученик определяется по JWT (auth.getUser), НЕ по телу запроса. Всё, что
 * решает «можно ли, сколько, какой тариф, какие согласия» — в SQL
 * `subscription_checkout_begin` (флаг, роль ученика, тариф активен,
 * согласие с офертой, согласие родителя у несовершеннолетнего, email чека).
 * Id строки платежа — Idempotence-Key: повтор запроса в ЮKassa не создаст
 * второй платёж.
 *
 * §287: промокод (`promo_code`) проверяет и считает SQL; цена в ЮKassa и в
 * чеке — уже со скидкой. Бесплатный исход (бесплатные дни/месяцы, скидка
 * 100 %) — без платежа: ответ { free: true }, ключи ЮKassa для него не нужны.
 * Отказ по промокоду — { error, code: PROMO_INVALID | RATE_LIMIT | PROMO_ACTIVE }.
 * Возврат после оплаты — на `return_origin`, если это адрес сайта или один
 * из SUBSCRIPTION_RETURN_ORIGINS (превью ветки); иначе на адрес сайта.
 *
 * Тело: { tariff_id, save_card, is_minor, parent_consent, accepted_offer, receipt_email?, promo_code?, return_origin? }
 * Ответ: { confirmation_url, payment_id } | { free: true, access_until, subscription_id }
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
 *      SUBSCRIPTION_YK_SHOP_ID, SUBSCRIPTION_YK_SECRET_KEY, SUBSCRIPTION_APP_URL,
 *      SUBSCRIPTION_RETURN_ORIGINS (необязательно; через запятую)
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  YOOKASSA_API,
  basicAuthHeader,
  buildFirstPayment,
  classifyResponse,
  isUuid,
  promoInput,
  returnBase,
} from '../_shared/subscription.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405)

  const shopId = Deno.env.get('SUBSCRIPTION_YK_SHOP_ID')
  const secretKey = Deno.env.get('SUBSCRIPTION_YK_SECRET_KEY')
  const appUrl = (Deno.env.get('SUBSCRIPTION_APP_URL') ?? '').replace(/\/+$/, '')

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: userData, error: userErr } = await authClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Требуется вход', code: 'UNAUTHORIZED' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Неверный запрос', code: 'BAD_REQUEST' }, 400)
  }
  if (!isUuid(body.tariff_id)) return json({ error: 'Не выбран тариф', code: 'BAD_REQUEST' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: begin, error: beginErr } = await admin.rpc('subscription_checkout_begin', {
    p_profile_id: userData.user.id,
    p_tariff_id: body.tariff_id,
    p_save_card: body.save_card === true,
    p_is_minor: body.is_minor === true,
    p_parent_consent: body.parent_consent === true,
    p_accepted_offer: body.accepted_offer === true,
    p_receipt_email: typeof body.receipt_email === 'string' ? body.receipt_email : null,
    p_promo_code: promoInput(body.promo_code),
  })
  if (beginErr || !begin) {
    // Тексты ошибок SQL написаны для ученика; код — в hint.
    return json({ error: beginErr?.message ?? 'Не удалось начать оформление', code: beginErr?.hint ?? 'BEGIN_FAILED' }, 400)
  }
  if (begin.error_code) {
    // отказ по промокоду — ответ SQL, а не исключение (попытка записана)
    return json({ error: begin.error, code: begin.error_code }, 400)
  }
  if (begin.free === true) {
    return json({ free: true, access_until: begin.access_until, subscription_id: begin.subscription_id })
  }

  const paymentId: string = begin.payment_id
  if (!shopId || !secretKey || !appUrl) {
    console.error('subscription-checkout: secrets not configured')
    await admin.rpc('subscription_payment_failed', { p_payment_id: paymentId, p_reason: 'not_configured' })
    return json({ error: 'Оплата пока не настроена', code: 'NOT_CONFIGURED' }, 503)
  }
  const request = buildFirstPayment({
    paymentId,
    subscriptionId: begin.subscription_id,
    amountRub: Number(begin.amount_rub),
    description: begin.description,
    receiptEmail: begin.receipt_email,
    receiptVatCode: begin.receipt_vat_code,
    saveCard: begin.save_card === true,
    returnUrl: `${returnBase(body.return_origin, appUrl, Deno.env.get('SUBSCRIPTION_RETURN_ORIGINS'))}/subscribe/result?payment=${paymentId}`,
  })

  let status: number | null = null
  let ykBody: Record<string, unknown> | null = null
  try {
    const res = await fetch(`${YOOKASSA_API}/payments`, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(shopId, secretKey),
        'Content-Type': 'application/json',
        'Idempotence-Key': paymentId,
      },
      body: JSON.stringify(request),
    })
    status = res.status
    ykBody = await res.json().catch(() => null)
  } catch (e) {
    console.error('subscription-checkout: network error', String(e))
  }

  const cls = classifyResponse(status)
  if (cls === 'definitive') {
    console.error('subscription-checkout: yookassa rejected', status, ykBody?.code, ykBody?.description)
    await admin.rpc('subscription_payment_failed', { p_payment_id: paymentId, p_reason: `http_${status}:${String(ykBody?.code ?? '')}` })
    return json({ error: 'Платёжный сервис отклонил запрос. Попробуйте позже.', code: 'YOOKASSA_REJECTED' }, 502)
  }
  if (cls === 'retryable') {
    return json({ error: 'Платёжный сервис не ответил. Попробуйте ещё раз.', code: 'YOOKASSA_UNAVAILABLE' }, 503)
  }

  const ykId = typeof ykBody?.id === 'string' ? ykBody.id : null
  const confirmation = ykBody?.confirmation as Record<string, unknown> | undefined
  const confirmationUrl = typeof confirmation?.confirmation_url === 'string' ? confirmation.confirmation_url : null
  await admin.rpc('subscription_payment_attach', {
    p_payment_id: paymentId,
    p_yookassa_id: ykId,
    p_status: typeof ykBody?.status === 'string' ? ykBody.status : 'pending',
    p_confirmation_url: confirmationUrl,
  })
  if (!confirmationUrl) return json({ error: 'Не получена ссылка на оплату', code: 'NO_CONFIRMATION' }, 502)

  return json({ confirmation_url: confirmationUrl, payment_id: paymentId })
})
