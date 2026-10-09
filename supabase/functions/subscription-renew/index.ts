/**
 * Edge Function: subscription-renew (§282)
 *
 * Раз в час (pg_cron `subscription-renew`, секрет — из vault, как у
 * student-reminders). Деплой с verify_jwt = false; вызывающий проверяется
 * заголовком X-Cron-Secret (fail-closed).
 *
 * 1) Автосписание по сохранённой карте: `subscription_renewal_due` →
 *    `subscription_renewal_begin` (строка платежа; её id — Idempotence-Key;
 *    если прошлый запрос оборвался, возвращается ТА ЖЕ строка) → POST в
 *    ЮKassa → итог в `subscription_apply_payment` (ответ API — подлинный, это
 *    наш запрос) или `subscription_payment_failed` (4xx: платёж точно не
 *    создан). 429/5xx/сеть — строка остаётся 'created', через час повтор с
 *    тем же ключом. Отказ банка → повторы по расписанию из настроек
 *    (`_subscription_renewal_failed`), доступ во время повторов сохраняется.
 * 2) Письма из очереди `subscription_mail_outbox` через Resend. Нет ключа /
 *    отправителя — письмо пропускается с пометкой mail_skipped, остальное
 *    работает (кабинет + Telegram).
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
 *      SUBSCRIPTION_YK_SHOP_ID, SUBSCRIPTION_YK_SECRET_KEY,
 *      SUBSCRIPTION_RESEND_API_KEY, SUBSCRIPTION_MAIL_FROM, SUBSCRIPTION_APP_URL
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  YOOKASSA_API,
  applyPaymentArgs,
  basicAuthHeader,
  buildRenewalPayment,
  classifyResponse,
  paymentFacts,
} from '../_shared/subscription.ts'
import { planMail, type MailRow } from '../_shared/subscription-mail.ts'

/** Сколько подписок списывать за один запуск: 2 с CPU на запрос, сеть — ожидание. */
const RENEW_BATCH = 25
const MAIL_BATCH = 20

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let res = 0
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return res === 0
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('subscription-renew: CRON_SECRET not configured')
    return json({ error: 'CRON_SECRET not configured' }, 500)
  }
  if (!safeEqual(req.headers.get('X-Cron-Secret') ?? '', cronSecret)) {
    console.warn('subscription-renew: rejected (bad or missing X-Cron-Secret)')
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const report = { renew: [] as { subscription_id: string; result: string }[], mail: { sent: 0, skipped: 0, failed: 0 } }

  // ── 1. Автосписание ─────────────────────────────────────────────────────
  const shopId = Deno.env.get('SUBSCRIPTION_YK_SHOP_ID')
  const secretKey = Deno.env.get('SUBSCRIPTION_YK_SECRET_KEY')
  if (shopId && secretKey) {
    const { data: due, error } = await admin.rpc('subscription_renewal_due', { p_limit: RENEW_BATCH })
    if (error) console.error('subscription-renew: renewal_due', error.message)
    for (const row of (due ?? []) as { subscription_id: string }[]) {
      report.renew.push({ subscription_id: row.subscription_id, result: await renewOne(admin, shopId, secretKey, row.subscription_id) })
    }
  } else {
    console.warn('subscription-renew: YooKassa secrets not configured — renewal skipped')
  }

  // ── 2. Письма ───────────────────────────────────────────────────────────
  const { data: mails, error: mailErr } = await admin.rpc('subscription_mail_claim', { p_limit: MAIL_BATCH })
  if (mailErr) console.error('subscription-renew: mail_claim', mailErr.message)
  const cfg = {
    apiKey: Deno.env.get('SUBSCRIPTION_RESEND_API_KEY'),
    from: Deno.env.get('SUBSCRIPTION_MAIL_FROM'),
    cabinetUrl: Deno.env.get('SUBSCRIPTION_APP_URL'),
  }
  for (const row of (mails ?? []) as MailRow[]) {
    const plan = planMail(row, cfg)
    if (!plan.send) {
      await admin.rpc('subscription_mail_done', { p_id: row.id, p_ok: false, p_error: null, p_skipped: plan.skipped })
      report.mail.skipped++
      continue
    }
    let ok = false
    let err: string | null = null
    try {
      const res = await fetch(plan.request.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(plan.request.body),
      })
      ok = res.ok
      if (!ok) err = `http_${res.status}: ${(await res.text()).slice(0, 300)}`
    } catch (e) {
      err = String(e).slice(0, 300)
    }
    await admin.rpc('subscription_mail_done', { p_id: row.id, p_ok: ok, p_error: err, p_skipped: null })
    if (ok) report.mail.sent++
    else report.mail.failed++
  }

  return json(report)
})

type Admin = ReturnType<typeof createClient>

async function renewOne(admin: Admin, shopId: string, secretKey: string, subscriptionId: string): Promise<string> {
  const { data: begin, error } = await admin.rpc('subscription_renewal_begin', { p_subscription_id: subscriptionId })
  if (error) {
    // частичный unique: открытое автосписание уже есть — ждём вебхук
    console.warn('subscription-renew: renewal_begin', subscriptionId, error.message)
    return 'begin_failed'
  }
  if (!begin) return 'not_due'

  const paymentId: string = begin.payment_id
  const request = buildRenewalPayment({
    paymentId,
    subscriptionId,
    amountRub: Number(begin.amount_rub),
    description: begin.description,
    receiptEmail: begin.receipt_email,
    receiptVatCode: begin.receipt_vat_code,
    methodId: begin.yookassa_method_id,
  })

  let status: number | null = null
  let body: Record<string, unknown> | null = null
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
    body = await res.json().catch(() => null)
  } catch (e) {
    console.error('subscription-renew: network error', subscriptionId, String(e))
  }

  const cls = classifyResponse(status)
  if (cls === 'retryable') return 'retry_later'
  if (cls === 'definitive') {
    const { data } = await admin.rpc('subscription_payment_failed', {
      p_payment_id: paymentId,
      p_reason: `http_${status}:${String(body?.code ?? '')}`,
    })
    return `rejected:${data}`
  }

  const facts = paymentFacts(body)
  if (!facts) return 'bad_response'
  await admin.rpc('subscription_payment_attach', {
    p_payment_id: paymentId,
    p_yookassa_id: facts.yookassaId,
    p_status: facts.status,
    p_confirmation_url: null,
  })
  if (facts.status === 'succeeded' || facts.status === 'canceled') {
    const { data, error: applyErr } = await admin.rpc('subscription_apply_payment', applyPaymentArgs(facts))
    if (applyErr) {
      console.error('subscription-renew: apply_payment', applyErr.message)
      return 'apply_failed'
    }
    return String(data)
  }
  return 'pending'
}
