/**
 * §282. Что показать ученику о подписке (`src/lib/subscription/view.ts`) и
 * возврат к оформлению после регистрации (`pendingSubscribe.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkoutErrorText,
  checkoutErrors,
  daysLabel,
  describeSubscription,
  formatDateMsk,
  formatRub,
  paymentHistory,
  periodLabel,
  resultState,
  type MySubscription,
} from '../subscription/view'
import {
  PENDING_SUBSCRIBE_MAX_AGE_MS,
  clearPendingSubscribe,
  getPendingSubscribePath,
  readPendingSubscribe,
  savePendingSubscribe,
} from '../subscription/pendingSubscribe'

const NOW = new Date('2026-10-10T09:00:00Z')
const sub = (over: Partial<MySubscription> = {}): MySubscription => ({
  id: 's1', course_id: 'c1', course_title: 'Курс с подпиской', group_id: 'g1',
  tariff_id: 't1', tariff_title: 'Месяц', price_rub: 2900,
  status: 'active', has_access: true,
  current_period_end: '2026-11-10T09:00:00Z', access_until: '2026-11-10T09:00:00Z',
  auto_renew: true, can_auto_renew: true, next_charge_at: '2026-11-10T09:00:00Z',
  last_charge_error: null, card_title: 'Visa •4242', payments: [],
  ...over,
})

describe('форматы', () => {
  it('даты по Москве, рубли, склонения', () => {
    expect(formatDateMsk('2026-10-14T21:30:00Z')).toBe('15 октября 2026 г.')
    expect(formatDateMsk(null)).toBeNull()
    expect(formatRub(2900).replace(/\s/g, ' ')).toBe('2 900 ₽')
    expect(periodLabel(1)).toBe('в месяц')
    expect(periodLabel(3)).toBe('за 3 месяца')
    expect(periodLabel(12)).toBe('за 12 месяцев')
    expect(daysLabel(1)).toBe('1 день')
    expect(daysLabel(3)).toBe('3 дня')
    expect(daysLabel(7)).toBe('7 дней')
    expect(daysLabel(11)).toBe('11 дней')
    expect(daysLabel(21)).toBe('21 день')
  })
})

describe('describeSubscription', () => {
  it('активна с автопродлением: до какого числа, следующее списание, карта; можно отменить', () => {
    const v = describeSubscription(sub(), NOW)
    expect(v.headline).toBe('Курс открыт до 10 ноября 2026 г.')
    expect(v.details.join(' ')).toContain('Следующее списание — 10 ноября 2026 г.')
    expect(v.details.join(' ')).toContain('Visa •4242')
    expect(v).toMatchObject({ tone: 'success', canCancelAutoRenew: true, canEnableAutoRenew: false, payLabel: 'Оплатить следующий месяц' })
  })

  it('активна без автопродления: предупреждение, включить можно при сохранённой карте', () => {
    const v = describeSubscription(sub({ auto_renew: false, next_charge_at: null }), NOW)
    expect(v.details.join(' ')).toContain('Автопродление выключено')
    expect(v.canEnableAutoRenew).toBe(true)
    expect(describeSubscription(sub({ auto_renew: false, can_auto_renew: false }), NOW).canEnableAutoRenew).toBe(false)
  })

  it('не удалось списать: дата повтора и срок доступа, тон «внимание»', () => {
    const v = describeSubscription(sub({ status: 'past_due', next_charge_at: '2026-10-11T09:00:00Z', access_until: '2026-10-14T09:00:00Z' }), NOW)
    expect(v.headline).toBe('Не удалось продлить подписку')
    expect(v.details.join(' ')).toContain('Повторим списание 11 октября 2026 г.')
    expect(v.tone).toBe('warning')
  })

  it('закончилась / отменена: курс закрыт, прогресс сохранён, «Продлить»', () => {
    const v = describeSubscription(sub({ status: 'expired', has_access: false, auto_renew: false }), NOW)
    expect(v.headline).toBe('Подписка закончилась, курс закрыт')
    expect(v.details.join(' ')).toContain('Прогресс и работы сохранены')
    expect(v).toMatchObject({ tone: 'error', payLabel: 'Продлить подписку', canCancelAutoRenew: false })
    expect(describeSubscription(sub({ status: 'cancelled', has_access: false }), NOW).headline).toBe('Подписка отменена, курс закрыт')
  })

  it('пробный период: до какого числа; истёк — закончился', () => {
    expect(describeSubscription(sub({ status: 'trial', auto_renew: false, access_until: '2026-10-17T09:00:00Z' }), NOW).headline)
      .toBe('Пробный период до 17 октября 2026 г.')
    expect(describeSubscription(sub({ status: 'trial', has_access: false, access_until: '2026-10-01T09:00:00Z' }), NOW).headline)
      .toBe('Пробный период закончился')
  })

  it('has_access от базы главнее дат: база сказала «нет» — «срок вышел»', () => {
    expect(describeSubscription(sub({ has_access: false }), NOW).headline).toBe('Срок подписки вышел')
  })
})

describe('paymentHistory', () => {
  it('без «создан», новые сверху', () => {
    const h = paymentHistory(sub({
      payments: [
        { id: 'a', kind: 'initial', amount_rub: 2900, status: 'succeeded', paid_at: null, created_at: '2026-09-10T00:00:00Z', refunded_at: null },
        { id: 'b', kind: 'renewal', amount_rub: 2900, status: 'created', paid_at: null, created_at: '2026-10-10T00:00:00Z', refunded_at: null },
        { id: 'c', kind: 'renewal', amount_rub: 2900, status: 'canceled', paid_at: null, created_at: '2026-10-09T00:00:00Z', refunded_at: null },
      ],
    }))
    expect(h.map((p) => p.id)).toEqual(['c', 'a'])
  })
})

describe('checkoutErrors', () => {
  const ok = { email: 'a@b.ru', acceptedOffer: true, isMinor: false, parentConsent: false, saveCard: false }
  it('всё заполнено — ошибок нет; карта не обязательна', () => {
    expect(checkoutErrors(ok)).toEqual({})
  })
  it('email, оферта, согласие родителя у несовершеннолетнего', () => {
    expect(checkoutErrors({ ...ok, email: 'нет' })).toHaveProperty('email')
    expect(checkoutErrors({ ...ok, acceptedOffer: false })).toHaveProperty('acceptedOffer')
    expect(checkoutErrors({ ...ok, isMinor: true })).toHaveProperty('parentConsent')
    expect(checkoutErrors({ ...ok, isMinor: true, parentConsent: true })).toEqual({})
  })
  it('коды ошибок сервера → понятный текст', () => {
    expect(checkoutErrorText('TRIAL_USED')).toBe('Пробный период по этому курсу уже был.')
    expect(checkoutErrorText('???', 'Текст сервера')).toBe('Текст сервера')
    expect(checkoutErrorText(null)).toBe('Не удалось начать оплату. Попробуйте ещё раз.')
  })
})

describe('resultState', () => {
  it('статус строки платежа → экран возврата', () => {
    expect(resultState('succeeded')).toBe('succeeded')
    expect(resultState('pending')).toBe('waiting')
    expect(resultState('created')).toBe('waiting')
    expect(resultState('canceled')).toBe('failed')
    expect(resultState('failed')).toBe('failed')
    expect(resultState(undefined)).toBe('unknown')
  })
})

describe('pendingSubscribe', () => {
  const T = '11111111-2222-4333-8444-555555555555'
  afterEach(() => clearPendingSubscribe())

  it('сохраняет тариф и отдаёт путь оформления ученику и «ещё не знаем»', () => {
    savePendingSubscribe(T)
    expect(getPendingSubscribePath(null)).toBe(`/subscribe/checkout/${T}`)
    expect(getPendingSubscribePath('student')).toBe(`/subscribe/checkout/${T}`)
  })
  it('персоналу не нужен — запись чистится', () => {
    savePendingSubscribe(T)
    expect(getPendingSubscribePath('teacher')).toBeNull()
    expect(readPendingSubscribe()).toBeNull()
  })
  it('старше суток и мусор — забываются', () => {
    savePendingSubscribe(T)
    expect(readPendingSubscribe(Date.now() + PENDING_SUBSCRIBE_MAX_AGE_MS + 1)).toBeNull()
    savePendingSubscribe('не-uuid')
    expect(readPendingSubscribe()).toBeNull()
    localStorage.setItem('subscription-pending-tariff', '{oops')
    expect(readPendingSubscribe()).toBeNull()
  })
})
