import { describe, expect, it } from 'vitest'
import { subscriptionCardView, isSubscribed, yearSaving } from '@/lib/subscription/cardView'
import type { MySubscription } from '@/lib/subscription/view'
import type { ShowcaseCard } from '@/lib/studentPath'

// «Моя подписка» без дублей (письмо 16.10): одна строка статуса, тариф
// пилюлей, ручная оплата при автопродлении — только за 3 дня до конца.
const NOW = new Date('2026-10-16T09:00:00Z')

const sub = (over: Partial<MySubscription> = {}): MySubscription => ({
  id: 's1', course_id: 'c1', course_title: 'Физика ЕГЭ — подписка (тест)', group_id: 'g1',
  tariff_id: 't1', tariff_title: 'Месяц', price_rub: 500, period_months: 1,
  status: 'active', has_access: true,
  current_period_end: '2026-11-18T09:00:00Z', access_until: '2026-11-18T09:00:00Z',
  auto_renew: true, can_auto_renew: true, next_charge_at: '2026-11-18T09:00:00Z',
  last_charge_error: null, card_title: 'ЮMoney', payments: [],
  ...over,
})

describe('subscriptionCardView', () => {
  it('автопродление включено: «Активна до … · … спишем 500 ₽ с ЮMoney», ручной оплаты нет', () => {
    const v = subscriptionCardView(sub(), NOW)
    expect(v.kind).toBe('active')
    expect(v.line).toMatch(/^Активна до 18 ноября · 18 ноября спишем 500\s₽ с ЮMoney$/)
    expect(v.tariff).toBe('Месяц')
    expect(v.pay).toBeNull()
    expect(v.canCancelAutoRenew).toBe(true)
  })

  it('до конца ≤ 3 дней при автопродлении — «Продлить заранее»', () => {
    const v = subscriptionCardView(sub({ access_until: '2026-10-18T09:00:00Z', next_charge_at: '2026-10-18T09:00:00Z' }), NOW)
    expect(v.pay?.label).toBe('Продлить заранее')
  })

  it('автопродление выключено: «Доступ до … · автопродление выключено», «Продлить» и «Включить»', () => {
    const v = subscriptionCardView(sub({ auto_renew: false }), NOW)
    expect(v.kind).toBe('renew_off')
    expect(v.line).toBe('Доступ до 18 ноября · автопродление выключено')
    expect(v.pay?.label).toBe('Продлить')
    expect(v.canEnableAutoRenew).toBe(true)
    expect(v.canCancelAutoRenew).toBe(false)
  })

  it('истекла: «Закончилась …» и «Оформить снова»', () => {
    const v = subscriptionCardView(sub({ status: 'expired', has_access: false, access_until: '2026-10-01T09:00:00Z', auto_renew: false }), NOW)
    expect(v.kind).toBe('ended')
    expect(v.line).toBe('Закончилась 1 октября')
    expect(v.pay).toEqual({ label: 'Оформить снова', primary: true })
  })

  it('годовой тариф — пилюля «Год», на 3 месяца — «3 месяца»', () => {
    expect(subscriptionCardView(sub({ period_months: 12 }), NOW).tariff).toBe('Год')
    expect(subscriptionCardView(sub({ period_months: 3 }), NOW).tariff).toBe('3 месяца')
  })
})

const card = (over: Partial<ShowcaseCard> = {}): ShowcaseCard => ({
  id: 'sc1', slug: 'phys', title: 'Физика ЕГЭ', subtitle: null, description: null, includes: [],
  subject: 'physics', course_id: 'c1', status: 'live', tariffs: [],
  month_price: 500, year_price: 4800, year_discount_pct: 20, trial_days: 7,
  my_status: null, my_access_until: null, has_access: false, trial_available: true, notify_requested: false,
  ...over,
})

describe('витрина', () => {
  it('подписка есть — карточка «с подпиской»; пробный — ещё нет', () => {
    expect(isSubscribed(card({ has_access: true, my_status: 'active' }))).toBe(true)
    expect(isSubscribed(card({ has_access: true, my_status: 'trial' }))).toBe(false)
    expect(isSubscribed(card())).toBe(false)
  })

  it('экономия за год: 500 × 12 − 4 800 = 1 200', () => {
    expect(yearSaving(card())).toBe(1200)
    expect(yearSaving(card({ year_price: null }))).toBeNull()
  })
})
