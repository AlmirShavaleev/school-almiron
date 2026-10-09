/**
 * §282 «Подписка» — что показать ученику и админу по строке подписки.
 * Чистые функции (тесты: src/lib/__tests__/subscriptionView.test.ts).
 *
 * Доступ решает база (`subscription_access_ok`); здесь — только слова,
 * даты и какие кнопки показать, по тем же полям, что вернула база
 * (`has_access`), без второй копии правила.
 */

export type SubscriptionStatus = 'pending' | 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired'
export type PaymentStatus = 'created' | 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled' | 'refunded' | 'failed'

export interface SubscriptionPayment {
  id: string
  kind: 'initial' | 'renewal'
  amount_rub: number
  status: PaymentStatus
  paid_at: string | null
  created_at: string
  refunded_at: string | null
}

/** Строка из RPC `my_subscriptions()`. */
export interface MySubscription {
  id: string
  course_id: string
  course_title: string
  group_id: string | null
  tariff_id: string
  tariff_title: string
  price_rub: number
  /** Период тарифа в месяцах (с PENDING_282_renew; до неё — нет). */
  period_months?: number
  status: SubscriptionStatus
  has_access: boolean
  current_period_end: string | null
  access_until: string | null
  auto_renew: boolean
  can_auto_renew: boolean
  next_charge_at: string | null
  last_charge_error: string | null
  card_title: string | null
  payments: SubscriptionPayment[]
}

/** Строка из RPC `subscription_tariffs_public()`. */
export interface PublicTariff {
  id: string
  title: string
  description: string | null
  price_rub: number
  period_months: number
  trial_days: number
  course_id: string
  course_title: string
}

export type Tone = 'success' | 'warning' | 'error' | 'default'

const MSK_DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })
const MSK_SHORT = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' })

/** «15 октября 2026» по Москве; пусто — null. */
export function formatDateMsk(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : MSK_DATE.format(d)
}

/** «15.10.2026» по Москве. */
export function formatShortDateMsk(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : MSK_SHORT.format(d)
}

/** «2 900 ₽» (неразрывные пробелы — как в Intl). */
export function formatRub(v: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v)
}

/** «в месяц» / «за 3 месяца». */
export function periodLabel(months: number): string {
  if (months === 1) return 'в месяц'
  const m10 = months % 10, m100 = months % 100
  const word = m10 === 1 && m100 !== 11 ? 'месяц' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'месяца' : 'месяцев'
  return `за ${months} ${word}`
}

/** «7 дней» — для пробного периода. */
export function daysLabel(n: number): string {
  const n10 = n % 10, n100 = n % 100
  const word = n10 === 1 && n100 !== 11 ? 'день' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'дня' : 'дней'
  return `${n} ${word}`
}

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  pending: 'Ожидает оплаты',
  trial: 'Пробный период',
  active: 'Активна',
  past_due: 'Не удалось списать',
  cancelled: 'Отменена',
  expired: 'Закончилась',
}

export const STATUS_TONE: Record<SubscriptionStatus, Tone> = {
  pending: 'default',
  trial: 'success',
  active: 'success',
  past_due: 'warning',
  cancelled: 'error',
  expired: 'error',
}

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  created: 'Создан',
  pending: 'Ожидает оплаты',
  waiting_for_capture: 'Ожидает оплаты',
  succeeded: 'Оплачен',
  canceled: 'Не прошёл',
  refunded: 'Возвращён',
  failed: 'Ошибка',
}

export interface SubscriptionView {
  /** Вывод одной строкой — что происходит. */
  headline: string
  /** Подробности: до какого числа, следующее списание, карта. */
  details: string[]
  tone: Tone
  /** Показать «Оплатить / Продлить» (переход к оформлению). */
  canPay: boolean
  payLabel: string
  /** Показать «Отменить автопродление». */
  canCancelAutoRenew: boolean
  /** Показать «Включить автопродление» (карта сохранена). */
  canEnableAutoRenew: boolean
}

/** Что сказать ученику о его подписке. `now` — для тестов. */
export function describeSubscription(s: MySubscription, now: Date = new Date()): SubscriptionView {
  const until = formatDateMsk(s.access_until)
  const next = formatDateMsk(s.next_charge_at)
  const details: string[] = []
  let headline: string
  const live = s.has_access && (!s.access_until || new Date(s.access_until) > now)

  switch (s.status) {
    case 'trial':
      headline = live ? `Пробный период до ${until}` : 'Пробный период закончился'
      if (live) details.push('Чтобы курс не закрылся, оформите подписку до конца пробного периода.')
      break
    case 'active':
      headline = live ? `Курс открыт до ${until}` : 'Срок подписки вышел'
      if (live && s.auto_renew && next) details.push(`Следующее списание — ${next}, ${formatRub(s.price_rub)}.`)
      if (live && !s.auto_renew) details.push('Автопродление выключено: после этой даты курс закроется.')
      break
    case 'past_due':
      headline = 'Не удалось продлить подписку'
      if (next) details.push(`Повторим списание ${next}.`)
      if (until) details.push(`Курс открыт до ${until}.`)
      details.push('Проверьте карту или оплатите месяц вручную.')
      break
    case 'cancelled':
      headline = 'Подписка отменена, курс закрыт'
      details.push('Прогресс и работы сохранены — после оплаты всё вернётся.')
      break
    case 'expired':
      headline = 'Подписка закончилась, курс закрыт'
      details.push('Прогресс и работы сохранены — после оплаты всё вернётся.')
      break
    default:
      headline = 'Подписка ещё не оплачена'
  }
  if (s.card_title && s.auto_renew) details.push(`Карта: ${s.card_title}.`)

  const renewable = s.status === 'active' || s.status === 'past_due'
  return {
    headline,
    details,
    tone: live ? (s.status === 'past_due' ? 'warning' : 'success') : STATUS_TONE[s.status],
    canPay: true,
    payLabel: live ? 'Оплатить следующий месяц' : s.status === 'pending' ? 'Оплатить' : 'Продлить подписку',
    canCancelAutoRenew: renewable && s.auto_renew,
    canEnableAutoRenew: renewable && !s.auto_renew && s.can_auto_renew && live,
  }
}

/** Платежи для истории: только завершённые и ожидающие, новые сверху. */
export function paymentHistory(s: MySubscription): SubscriptionPayment[] {
  return [...(s.payments ?? [])]
    .filter((p) => p.status !== 'created')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export interface CheckoutForm {
  email: string
  acceptedOffer: boolean
  isMinor: boolean
  parentConsent: boolean
  saveCard: boolean
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Ошибки формы оформления по полям; пусто — можно платить. Те же правила проверяет SQL. */
export function checkoutErrors(f: CheckoutForm): Partial<Record<keyof CheckoutForm, string>> {
  const e: Partial<Record<keyof CheckoutForm, string>> = {}
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'Нужен email — на него придёт чек'
  if (!f.acceptedOffer) e.acceptedOffer = 'Нужно согласие с офертой и политикой'
  if (f.isMinor && !f.parentConsent) e.parentConsent = 'Нужно согласие родителя'
  return e
}

/** Код ошибки из ответа SQL/edge (hint или code) → текст ученику. */
export function checkoutErrorText(code: string | null | undefined, fallback?: string | null): string {
  switch (code) {
    case 'FLAG_OFF': return 'Оформление подписки сейчас недоступно.'
    case 'NOT_STUDENT': return 'Подписку оформляет учётная запись ученика.'
    case 'TARIFF_INACTIVE': return 'Этот тариф больше недоступен.'
    case 'NO_TRIAL': return 'У тарифа нет пробного периода.'
    case 'TRIAL_USED': return 'Пробный период по этому курсу уже был.'
    case 'NO_CONSENT': return 'Нужно согласие с офертой и политикой.'
    case 'NO_PARENT_CONSENT': return 'Нужно согласие родителя.'
    case 'BAD_EMAIL': return 'Проверьте email для чека.'
    case 'NOT_CONFIGURED': return 'Оплата пока не настроена. Попробуйте позже.'
    case 'YOOKASSA_UNAVAILABLE': return 'Платёжный сервис не ответил. Попробуйте ещё раз.'
    case 'YOOKASSA_REJECTED': return 'Платёжный сервис отклонил запрос. Попробуйте позже.'
    case 'UNAUTHORIZED': return 'Войдите в аккаунт ещё раз.'
    default: return fallback || 'Не удалось начать оплату. Попробуйте ещё раз.'
  }
}

export type ResultState = 'waiting' | 'succeeded' | 'failed' | 'refunded' | 'unknown'

/** Что показать на странице возврата из ЮKassa по статусу нашей строки платежа. */
export function resultState(status: PaymentStatus | null | undefined): ResultState {
  switch (status) {
    case 'succeeded': return 'succeeded'
    case 'canceled':
    case 'failed': return 'failed'
    case 'refunded': return 'refunded'
    case 'created':
    case 'pending':
    case 'waiting_for_capture': return 'waiting'
    default: return 'unknown'
  }
}
