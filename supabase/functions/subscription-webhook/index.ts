/**
 * Edge Function: subscription-webhook (§282)
 *
 * HTTP-уведомления ЮKassa. Деплой с verify_jwt = false (ЮKassa не шлёт JWT).
 * URL этой функции ставится в ЛК ЮKassa → Интеграция → HTTP-уведомления;
 * события: payment.succeeded, payment.canceled, payment.waiting_for_capture, refund.succeeded.
 *
 * Подлинность: телу уведомления НЕ верим. Из тела — только событие и id
 * (`parseNotification`); статус, сумму и способ оплаты берём запросом
 * GET /v3/payments/{id} (или /v3/refunds/{id}) с ключами магазина. Поддельное
 * уведомление с чужим/выдуманным id ничего не меняет: ЮKassa вернёт 404 или
 * настоящий статус.
 *
 * Идемпотентность — в SQL (`subscription_apply_payment`/`_refund`): статус
 * платежа движется только вперёд, продление — один раз на платёж.
 *
 * Ответ 200 — «принято, не повторяй» (в т.ч. для чужих и неизвестных
 * объектов). 500 — только если ЮKassa или база недоступны: ЮKassa повторит.
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUBSCRIPTION_YK_SHOP_ID, SUBSCRIPTION_YK_SECRET_KEY
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  YOOKASSA_API,
  applyPaymentArgs,
  basicAuthHeader,
  parseNotification,
  paymentFacts,
  refundFacts,
} from '../_shared/subscription.ts'

const MAX_BODY = 64 * 1024

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return text('Method Not Allowed', 405)

  const shopId = Deno.env.get('SUBSCRIPTION_YK_SHOP_ID')
  const secretKey = Deno.env.get('SUBSCRIPTION_YK_SECRET_KEY')
  if (!shopId || !secretKey) {
    // магазин ещё не настроен — 503 (не «сломалось», а «не готово»); ЮKassa повторит
    console.error('subscription-webhook: secrets not configured')
    return text('not configured', 503)
  }

  const raw = await req.text()
  if (raw.length > MAX_BODY) return text('too large', 413)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return text('bad json', 400)
  }
  const ref = parseNotification(parsed)
  if (!ref) return text('ignored')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const path = ref.kind === 'payment' ? `payments/${ref.id}` : `refunds/${ref.id}`

  let res: Response
  try {
    res = await fetch(`${YOOKASSA_API}/${path}`, { headers: { Authorization: basicAuthHeader(shopId, secretKey) } })
  } catch (e) {
    console.error('subscription-webhook: yookassa unreachable', String(e))
    return text('retry', 500)
  }
  if (res.status === 404) {
    // Объекта нет в нашем магазине — подделка или чужой магазин. Повторять незачем.
    await admin.from('subscription_log').insert({ event: 'webhook_not_found', yookassa_object_id: ref.id, details: { event: ref.event } })
    return text('ok')
  }
  if (!res.ok) {
    console.error('subscription-webhook: yookassa status', res.status)
    return text('retry', 500)
  }
  const obj = await res.json().catch(() => null)

  if (ref.kind === 'refund') {
    const f = refundFacts(obj)
    if (!f || !f.succeeded) return text('ok')
    const { data, error } = await admin.rpc('subscription_apply_refund', {
      p_yookassa_payment_id: f.paymentId,
      p_refund_id: f.refundId,
      // частичный возврат доступ не закрывает; не разобрали сумму — как полный
      p_refund_rub: Number.isFinite(f.amountRub) ? f.amountRub : null,
    })
    if (error) {
      console.error('subscription-webhook: apply_refund', error.message)
      return text('retry', 500)
    }
    return text(String(data))
  }

  const facts = paymentFacts(obj)
  if (!facts) {
    await admin.from('subscription_log').insert({ event: 'webhook_bad_object', yookassa_object_id: ref.id, details: { event: ref.event } })
    return text('ok')
  }
  if (!facts.ours) {
    // Платёж магазина, но не подписки (например, старые функции) — не наш.
    return text('ok')
  }
  const { data, error } = await admin.rpc('subscription_apply_payment', applyPaymentArgs(facts))
  if (error) {
    console.error('subscription-webhook: apply_payment', error.message)
    return text('retry', 500)
  }
  return text(String(data))
})
