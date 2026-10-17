/**
 * «Курсы» и «Моя подписка» в стиле ЛК без дублей (письмо
 * ЛК_стиль_курсы_и_моя_подписка_без_дублей.md, 16.10). Только отображение:
 * данные — те же `my_subscriptions` / `courses_showcase`, логика оплаты не
 * меняется. Здесь — чистые правила, чтобы их проверял vitest.
 */
import { maskPaymentTitle } from '../../../supabase/functions/_shared/subscription.ts'
import { formatRub, periodLabel, type MySubscription } from '@/lib/subscription/view'
import type { ShowcaseCard } from '@/lib/studentPath'

const MSK_DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })

/** «18 ноября» по Москве — без года: в строке статуса год лишний. */
export function dayMonthMsk(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : MSK_DAY.format(d)
}

export type StatusKind = 'active' | 'renew_off' | 'past_due' | 'trial' | 'ended' | 'pending'

export interface SubscriptionCardView {
  kind: StatusKind
  /** Одна строка статуса вместо трёх. */
  line: string
  /** Пилюля тарифа рядом со статусом: «Месяц» / «Год» / «3 месяца». */
  tariff: string | null
  /** Кнопка оплаты; null — не показывать (автопродление включено, до конца > 3 дней). */
  pay: { label: string; primary: boolean } | null
  /** «Отменить автопродление» — тихой ссылкой внизу. */
  canCancelAutoRenew: boolean
  canEnableAutoRenew: boolean
}

const DAY = 86_400_000

export function subscriptionCardView(s: MySubscription, now: Date = new Date()): SubscriptionCardView {
  const until = dayMonthMsk(s.access_until)
  const next = dayMonthMsk(s.next_charge_at)
  const live = s.has_access && (!s.access_until || new Date(s.access_until) > now)
  const daysLeft = s.access_until ? (new Date(s.access_until).getTime() - now.getTime()) / DAY : Infinity
  const m = s.period_months
  const tariff = m === 12 ? 'Год' : m === 1 ? 'Месяц' : m ? periodLabel(m).replace(/^за /, '') : null
  const renewable = s.status === 'active' || s.status === 'past_due'
  const base = {
    tariff,
    canCancelAutoRenew: renewable && s.auto_renew,
    canEnableAutoRenew: renewable && !s.auto_renew && s.can_auto_renew && live,
  }

  if (s.status === 'pending') {
    return { ...base, kind: 'pending', line: 'Подписка ещё не оплачена', pay: { label: 'Оплатить', primary: true } }
  }
  if (s.status === 'trial' && live) {
    return { ...base, kind: 'trial', line: until ? `Пробный период до ${until}` : 'Пробный период', pay: { label: 'Оформить подписку', primary: true } }
  }
  if (!live) {
    return {
      ...base,
      kind: 'ended',
      line: s.status === 'trial' ? 'Пробный период закончился' : until ? `Закончилась ${until}` : 'Подписка закончилась',
      pay: { label: 'Оформить снова', primary: true },
    }
  }
  if (s.status === 'past_due') {
    return {
      ...base,
      kind: 'past_due',
      line: `Не удалось продлить${next ? ` · повторим ${next}` : ''}${until ? ` · доступ до ${until}` : ''}`,
      pay: { label: 'Оплатить вручную', primary: false },
    }
  }
  if (!s.auto_renew) {
    return { ...base, kind: 'renew_off', line: `Доступ до ${until} · автопродление выключено`, pay: { label: 'Продлить', primary: false } }
  }
  // «ЮMoney ••1136»: хвост кошелька/карты — двумя точками, одна читалась как разделитель.
  const from = s.card_title ? ` с ${maskPaymentTitle(s.card_title).replace(/•(\d{4})/g, '••$1')}` : ''
  return {
    ...base,
    kind: 'active',
    line: `Активна до ${until}${next ? ` · ${next} спишем ${formatRub(s.price_rub)}${from}` : ''}`,
    // При автопродлении ручная оплата дублирует списание — только в последние 3 дня.
    pay: daysLeft <= 3 ? { label: 'Продлить заранее', primary: false } : null,
  }
}

/** Курс на витрине, на который уже есть подписка (пробный — ещё нет). */
export function isSubscribed(card: ShowcaseCard): boolean {
  return card.status === 'live' && card.has_access && card.my_status !== 'trial'
}

/** «экономия 1 200 ₽» при годовом тарифе; null — считать нечего. */
export function yearSaving(card: ShowcaseCard): number | null {
  if (card.month_price == null || card.year_price == null) return null
  const save = card.month_price * 12 - card.year_price
  return save > 0 ? save : null
}
