/**
 * §290-B. Путь ученика — чистые функции: анкета, плашки главной (демо и
 * промо-дни различаются), карточки «Курсов», замок демо, маска способа оплаты.
 */
import { describe, expect, it } from 'vitest'
import {
  DEMO_LOCK_NOTE,
  cardAction,
  daysLeft,
  defaultMonthsToExam,
  onboardingErrors,
  pathBanners,
  tariffFor,
  withDemoLocks,
  type PathSubscription,
  type ShowcaseCard,
} from '../studentPath'
import { cardTitleOf, maskPaymentTitle } from '../../../supabase/functions/_shared/subscription.ts'

const NOW = new Date('2026-10-13T12:00:00Z')

describe('анкета', () => {
  const ok = { grade: 11 as const, subject: 'physics' as const, target_score: '85', months_to_exam: '', hours_per_week: '' }
  it('обязательные поля и диапазоны', () => {
    expect(onboardingErrors(ok)).toEqual({})
    expect(onboardingErrors({ ...ok, grade: null, subject: null, target_score: '' })).toEqual({
      grade: 'Выберите класс', subject: 'Выберите предмет', target_score: 'Балл — от 0 до 100',
    })
    expect(onboardingErrors({ ...ok, target_score: '101' }).target_score).toBeDefined()
    expect(onboardingErrors({ ...ok, target_score: '7.5' }).target_score).toBeDefined()
    expect(onboardingErrors({ ...ok, months_to_exam: '0', hours_per_week: '41' })).toEqual({
      months_to_exam: 'От 1 до 36 месяцев', hours_per_week: 'От 1 до 40 часов',
    })
  })
  it('месяцев до ЕГЭ по классу: октябрь 11-го — до июня, 10-го — на год больше', () => {
    expect(defaultMonthsToExam(11, NOW)).toBe(8)
    expect(defaultMonthsToExam(10, NOW)).toBe(20)
    expect(defaultMonthsToExam(9, NOW)).toBe(32)
    expect(defaultMonthsToExam(11, new Date('2026-03-01T12:00:00Z'))).toBe(3)
  })
})

const sub = (over: Partial<PathSubscription> = {}): PathSubscription => ({
  subscription_id: 's', course_id: 'c', course_title: 'Физика ЕГЭ', group_id: 'g', tariff_id: 't',
  status: 'trial', source: 'trial', demo: true, has_access: true,
  access_until: '2026-10-15T09:00:00Z', auto_renew: false, continue: null, ...over,
})

describe('главная: плашка срока', () => {
  it('сутки вверх: 45 ч → 2 дня; прошло — нет', () => {
    expect(daysLeft('2026-10-15T09:00:00Z', NOW)).toBe(2)
    expect(daysLeft('2026-10-13T14:00:00Z', NOW)).toBe(1)
    expect(daysLeft('2026-10-13T11:00:00Z', NOW)).toBeNull()
  })
  it('демо — «До конца пробного — N дня»; промо-дни — «Курс открыт до …»; оплачено — ничего', () => {
    expect(pathBanners([sub()], NOW)).toEqual([
      { kind: 'demo', courseId: 'c', courseTitle: 'Физика ЕГЭ', text: 'До конца пробного — 2 дня' },
    ])
    expect(pathBanners([sub({ demo: false, source: 'manual' })], NOW)).toEqual([
      { kind: 'promo', courseId: 'c', courseTitle: 'Физика ЕГЭ', text: 'Курс открыт до 15 октября 2026 г.' },
    ])
    expect(pathBanners([sub({ status: 'active', source: 'purchase', demo: false })], NOW)).toEqual([])
    expect(pathBanners([sub({ status: 'expired', has_access: false, demo: false })], NOW)).toEqual([])
  })
})

const card = (over: Partial<ShowcaseCard> = {}): ShowcaseCard => ({
  id: 'x', slug: 'physics-ege', title: 'Физика ЕГЭ', subtitle: null, description: null, includes: [],
  subject: 'physics', course_id: 'c', status: 'live',
  tariffs: [
    { id: 'm', title: 'Месяц', price_rub: 500, period_months: 1, trial_days: 3 },
    { id: 'y', title: 'Год', price_rub: 4800, period_months: 12, trial_days: 3 },
  ],
  month_price: 500, year_price: 4800, year_discount_pct: 20, trial_days: 3,
  my_status: null, my_access_until: null, has_access: false, trial_available: true, notify_requested: false,
  ...over,
})

describe('«Курсы»', () => {
  it('тариф периода; кнопка по состоянию', () => {
    expect(tariffFor(card(), 12)?.id).toBe('y')
    expect(tariffFor(card({ tariffs: [] }), 1)).toBeNull()
    expect(cardAction(card())).toBe('trial')
    expect(cardAction(card({ trial_available: false }))).toBe('buy')
    expect(cardAction(card({ has_access: true }))).toBe('open')
    expect(cardAction(card({ status: 'soon' }))).toBe('notify')
  })
})

describe('страница курса: замок демо', () => {
  const mods = [{ id: 'm', topics: [
    { id: 'a', progress: { open: true, note: null } },
    { id: 'b', progress: { open: false, note: 'Откроется после урока «A»' } },
    { id: 'c' },
  ] }]
  it('демо — у закрытых «Доступно по подписке»; не демо — как есть', () => {
    expect(withDemoLocks(mods, false)).toBe(mods)
    const d = withDemoLocks(mods, true)[0].topics
    expect(d[0].progress).toEqual({ open: true, note: null })
    expect(d[1].progress).toEqual({ open: false, note: DEMO_LOCK_NOTE })
    expect(d[2]).toEqual({ id: 'c' })
  })
})

describe('способ оплаты — только последние 4 цифры (тест 12.10)', () => {
  it('кошелёк ЮMoney и длинные номера', () => {
    expect(maskPaymentTitle('YooMoney wallet 410011758831136')).toBe('ЮMoney •1136')
    expect(maskPaymentTitle('SberPay')).toBe('SberPay')
    expect(maskPaymentTitle('Счёт 40817810099910004312')).toBe('Счёт •4312')
    expect(maskPaymentTitle('Visa •4242')).toBe('Visa •4242')
  })
  it('при сохранении из ответа ЮKassa', () => {
    expect(cardTitleOf({ type: 'yoo_money', account_number: '410011758831136', title: 'YooMoney wallet 410011758831136' }))
      .toBe('ЮMoney •1136')
    expect(cardTitleOf({ title: 'YooMoney wallet 410011758831136' })).toBe('ЮMoney •1136')
    expect(cardTitleOf({ card: { last4: '4242', card_type: 'Visa' } })).toBe('Visa •4242')
  })
})
