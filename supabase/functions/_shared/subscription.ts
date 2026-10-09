/**
 * §282 «Подписка» — чистая логика обмена с ЮKassa для edge-функций subscription-*.
 *
 * Без сети, базы и Deno-API: модуль импортируют и edge-функции, и vitest
 * (`src/lib/__tests__/subscriptionYookassa.test.ts`). Всё, что решает «что
 * отправить в ЮKassa» и «как понять её ответ», — здесь; в index.ts только
 * fetch и вызовы RPC.
 *
 * Подлинность уведомлений: телу уведомления не верим. Из тела берётся
 * только тип события и id объекта (`parseNotification`), статус и сумма —
 * из ответа API ЮKassa на запрос по этому id (`paymentFacts`/`refundFacts`).
 */

export const YOOKASSA_API = 'https://api.yookassa.ru/v3'

/** Метка в metadata платежа: отличает наши платежи от платежей старых функций в том же магазине. */
export const PAYMENT_ORIGIN = 'subscription_282'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** id объектов ЮKassa: латиница, цифры, дефисы, подчёркивания; длина с запасом. */
const YK_ID_RE = /^[0-9A-Za-z_-]{8,64}$/

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

export function isYookassaId(v: unknown): v is string {
  return typeof v === 'string' && YK_ID_RE.test(v)
}

/** Сумма для ЮKassa — строка с двумя знаками («2900.00»). */
export function formatAmount(rub: number): string {
  if (!Number.isFinite(rub) || rub <= 0) throw new Error(`Неверная сумма: ${rub}`)
  return (Math.round(rub * 100) / 100).toFixed(2)
}

/** «2900.00» → 2900; мусор → NaN (сверка суммы тогда не пройдёт). */
export function parseAmount(v: unknown): number {
  if (typeof v !== 'string' || !/^\d+(\.\d{1,2})?$/.test(v)) return Number.NaN
  return Number(v)
}

export function basicAuthHeader(shopId: string, secretKey: string): string {
  return 'Basic ' + btoa(`${shopId}:${secretKey}`)
}

export interface PaymentDraft {
  /** id строки subscription_payments — он же Idempotence-Key. */
  paymentId: string
  subscriptionId: string
  amountRub: number
  description: string
  receiptEmail?: string | null
  /** Код ставки НДС для чека; нет — объект receipt не передаётся. */
  receiptVatCode?: number | null
}

export interface FirstPaymentDraft extends PaymentDraft {
  returnUrl: string
  /** Сохранить карту для автопродления — только при явной галочке. */
  saveCard: boolean
}

export interface RenewalPaymentDraft extends PaymentDraft {
  /** Сохранённый способ оплаты (subscription_payment_methods). */
  methodId: string
}

function receiptOf(d: PaymentDraft) {
  if (d.receiptVatCode == null || !d.receiptEmail) return undefined
  return {
    customer: { email: d.receiptEmail },
    items: [{
      description: d.description.slice(0, 128),
      quantity: '1.00',
      amount: { value: formatAmount(d.amountRub), currency: 'RUB' },
      vat_code: d.receiptVatCode,
      payment_mode: 'full_prepayment',
      payment_subject: 'service',
    }],
  }
}

function metadataOf(d: PaymentDraft) {
  return { origin: PAYMENT_ORIGIN, payment_id: d.paymentId, subscription_id: d.subscriptionId }
}

/** Тело POST /v3/payments для первой оплаты (переход на страницу ЮKassa). */
export function buildFirstPayment(d: FirstPaymentDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    amount: { value: formatAmount(d.amountRub), currency: 'RUB' },
    capture: true,
    confirmation: { type: 'redirect', return_url: d.returnUrl },
    description: d.description.slice(0, 128),
    metadata: metadataOf(d),
  }
  if (d.saveCard) body.save_payment_method = true
  const receipt = receiptOf(d)
  if (receipt) body.receipt = receipt
  return body
}

/** Тело POST /v3/payments для автосписания по сохранённому способу. */
export function buildRenewalPayment(d: RenewalPaymentDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    amount: { value: formatAmount(d.amountRub), currency: 'RUB' },
    capture: true,
    payment_method_id: d.methodId,
    description: d.description.slice(0, 128),
    metadata: metadataOf(d),
  }
  const receipt = receiptOf(d)
  if (receipt) body.receipt = receipt
  return body
}

export type YkResponseClass = 'ok' | 'definitive' | 'retryable'

/**
 * Как понимать ответ ЮKassa на создание платежа.
 *  - ok — платёж создан (тело — объект платежа);
 *  - definitive — 4xx кроме 429: платёж точно не создан, повтор с тем же ключом даст то же;
 *  - retryable — 429/5xx/сеть: результат неизвестен, повторять С ТЕМ ЖЕ Idempotence-Key.
 */
export function classifyResponse(status: number | null): YkResponseClass {
  if (status == null) return 'retryable'
  if (status >= 200 && status < 300) return 'ok'
  if (status === 429 || status >= 500) return 'retryable'
  return 'definitive'
}

export type NotificationRef =
  | { kind: 'payment'; event: string; id: string }
  | { kind: 'refund'; event: string; id: string }

const PAYMENT_EVENTS = new Set(['payment.succeeded', 'payment.canceled', 'payment.waiting_for_capture'])
const REFUND_EVENTS = new Set(['refund.succeeded'])

/**
 * Из тела уведомления — только событие и id объекта. Всё остальное в теле
 * игнорируется: его мог прислать кто угодно.
 */
export function parseNotification(body: unknown): NotificationRef | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.type !== 'notification' || typeof b.event !== 'string') return null
  const obj = b.object as Record<string, unknown> | undefined
  const id = obj?.id
  if (!isYookassaId(id)) return null
  if (PAYMENT_EVENTS.has(b.event)) return { kind: 'payment', event: b.event, id }
  if (REFUND_EVENTS.has(b.event)) return { kind: 'refund', event: b.event, id }
  return null
}

/** Аргументы RPC subscription_apply_payment из объекта платежа, полученного от API ЮKassa. */
export interface PaymentFacts {
  yookassaId: string
  ourPaymentId: string | null
  ours: boolean
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled'
  amountRub: number
  methodId: string | null
  methodSaved: boolean
  cardTitle: string | null
  cancelReason: string | null
  paidAt: string | null
}

const PAYMENT_STATUSES = new Set(['pending', 'waiting_for_capture', 'succeeded', 'canceled'])

export function cardTitleOf(method: unknown): string | null {
  if (!method || typeof method !== 'object') return null
  const m = method as Record<string, unknown>
  const card = m.card as Record<string, unknown> | undefined
  const last4 = typeof card?.last4 === 'string' && /^\d{4}$/.test(card.last4) ? card.last4 : null
  if (last4) {
    const brand = typeof card?.card_type === 'string' && card.card_type !== 'Unknown' ? card.card_type : 'Карта'
    return `${brand} •${last4}`
  }
  return typeof m.title === 'string' && m.title.trim() ? m.title.trim().slice(0, 60) : null
}

export function paymentFacts(obj: unknown): PaymentFacts | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (!isYookassaId(o.id) || typeof o.status !== 'string' || !PAYMENT_STATUSES.has(o.status)) return null
  const amount = o.amount as Record<string, unknown> | undefined
  if (amount?.currency !== 'RUB') return null
  const meta = (o.metadata ?? {}) as Record<string, unknown>
  const method = o.payment_method as Record<string, unknown> | undefined
  const cancel = o.cancellation_details as Record<string, unknown> | undefined
  return {
    yookassaId: o.id,
    ourPaymentId: isUuid(meta.payment_id) ? meta.payment_id : null,
    ours: meta.origin === PAYMENT_ORIGIN,
    status: o.status as PaymentFacts['status'],
    amountRub: parseAmount(amount?.value),
    methodId: typeof method?.id === 'string' && method.id ? method.id : null,
    methodSaved: method?.saved === true,
    cardTitle: cardTitleOf(method),
    cancelReason: typeof cancel?.reason === 'string' ? cancel.reason : null,
    paidAt: typeof o.captured_at === 'string' ? o.captured_at : null,
  }
}

/** Параметры RPC subscription_apply_payment (имена — как в SQL). */
export function applyPaymentArgs(f: PaymentFacts) {
  return {
    p_yookassa_id: f.yookassaId,
    p_our_payment_id: f.ourPaymentId,
    p_status: f.status,
    p_amount_rub: Number.isFinite(f.amountRub) ? f.amountRub : null,
    p_method_id: f.methodId,
    p_method_saved: f.methodSaved,
    p_card_title: f.cardTitle,
    p_cancel_reason: f.cancelReason,
    p_paid_at: f.paidAt,
  }
}

export interface RefundFacts {
  refundId: string
  paymentId: string
  succeeded: boolean
}

export function refundFacts(obj: unknown): RefundFacts | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (!isYookassaId(o.id) || !isYookassaId(o.payment_id)) return null
  return { refundId: o.id, paymentId: o.payment_id, succeeded: o.status === 'succeeded' }
}

/** Понятная ученику причина отказа ЮKassa (cancellation_details.reason). */
export function cancelReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case 'insufficient_funds': return 'недостаточно средств на карте'
    case 'card_expired': return 'истёк срок действия карты'
    case 'expired_on_confirmation': return 'оплата не была подтверждена вовремя'
    case 'expired_on_capture': return 'платёж не был завершён вовремя'
    case 'permission_revoked': return 'автосписания с карты запрещены'
    case 'payment_method_restricted':
    case 'payment_method_limit_exceeded': return 'банк ограничил операции по карте'
    case 'fraud_suspected': return 'банк заподозрил мошенничество и отклонил платёж'
    case 'issuer_unavailable': return 'банк карты недоступен'
    case '3d_secure_failed': return 'не пройдено подтверждение 3-D Secure'
    case 'call_issuer': return 'банк отклонил платёж — позвоните в банк'
    case 'canceled_by_merchant': return 'платёж отменён'
    case null:
    case undefined:
    case '': return 'платёж не прошёл'
    default: return 'банк отклонил платёж'
  }
}
