/**
 * §282. Обмен с ЮKassa — чистый модуль `supabase/functions/_shared/subscription.ts`
 * (его же импортируют edge-функции subscription-checkout / -webhook / -renew).
 */
import { describe, expect, it } from 'vitest'
import {
  PAYMENT_ORIGIN,
  applyPaymentArgs,
  basicAuthHeader,
  buildFirstPayment,
  buildRenewalPayment,
  cancelReasonText,
  cardTitleOf,
  classifyResponse,
  formatAmount,
  parseAmount,
  parseNotification,
  paymentFacts,
  refundFacts,
  promoInput,
  returnBase,
} from '../../../supabase/functions/_shared/subscription.ts'

const PID = '11111111-2222-4333-8444-555555555555'
const SID = '66666666-7777-4888-9999-aaaaaaaaaaaa'
const YK = '2d6e3a45-000f-5000-9000-1b2c3d4e5f60'

describe('formatAmount / parseAmount', () => {
  it('две цифры после точки, без плавающих хвостов', () => {
    expect(formatAmount(2900)).toBe('2900.00')
    expect(formatAmount(0.1 + 0.2)).toBe('0.30')
    expect(() => formatAmount(0)).toThrow()
    expect(() => formatAmount(Number.NaN)).toThrow()
  })
  it('разбор суммы ЮKassa строгий', () => {
    expect(parseAmount('2900.00')).toBe(2900)
    expect(parseAmount('2900')).toBe(2900)
    expect(parseAmount('29,00')).toBeNaN()
    expect(parseAmount(2900)).toBeNaN()
  })
})

describe('запросы на создание платежа', () => {
  const base = { paymentId: PID, subscriptionId: SID, amountRub: 2900, description: 'Подписка «Месяц»' }

  it('первая оплата: редирект, metadata, карта сохраняется только по галочке', () => {
    const noSave = buildFirstPayment({ ...base, saveCard: false, returnUrl: 'https://x/subscribe/result?payment=1' })
    expect(noSave).toMatchObject({
      amount: { value: '2900.00', currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: 'https://x/subscribe/result?payment=1' },
      metadata: { origin: PAYMENT_ORIGIN, payment_id: PID, subscription_id: SID },
    })
    expect(noSave).not.toHaveProperty('save_payment_method')
    expect(noSave).not.toHaveProperty('receipt')
    expect(buildFirstPayment({ ...base, saveCard: true, returnUrl: 'r' })).toHaveProperty('save_payment_method', true)
  })

  it('чек — только когда задан код НДС и есть email', () => {
    const withReceipt = buildFirstPayment({ ...base, saveCard: false, returnUrl: 'r', receiptEmail: 'a@b.ru', receiptVatCode: 1 })
    expect(withReceipt.receipt).toMatchObject({
      customer: { email: 'a@b.ru' },
      items: [{ quantity: '1.00', vat_code: 1, payment_subject: 'service', payment_mode: 'full_prepayment', amount: { value: '2900.00' } }],
    })
    expect(buildFirstPayment({ ...base, saveCard: false, returnUrl: 'r', receiptVatCode: 1 })).not.toHaveProperty('receipt')
  })

  it('автосписание — по сохранённому способу, без редиректа', () => {
    const r = buildRenewalPayment({ ...base, methodId: 'pm-1' })
    expect(r).toMatchObject({ payment_method_id: 'pm-1', capture: true })
    expect(r).not.toHaveProperty('confirmation')
    expect(r).not.toHaveProperty('save_payment_method')
  })

  it('Basic-авторизация', () => {
    expect(basicAuthHeader('123', 'test_key')).toBe('Basic ' + btoa('123:test_key'))
  })
})

describe('classifyResponse', () => {
  it('4xx — окончательно, 429/5xx/сеть — повторять тем же ключом', () => {
    expect(classifyResponse(200)).toBe('ok')
    expect(classifyResponse(400)).toBe('definitive')
    expect(classifyResponse(401)).toBe('definitive')
    expect(classifyResponse(429)).toBe('retryable')
    expect(classifyResponse(500)).toBe('retryable')
    expect(classifyResponse(null)).toBe('retryable')
  })
})

describe('parseNotification — из тела только событие и id', () => {
  it('платёж и возврат', () => {
    expect(parseNotification({ type: 'notification', event: 'payment.succeeded', object: { id: YK, status: 'succeeded' } }))
      .toEqual({ kind: 'payment', event: 'payment.succeeded', id: YK })
    expect(parseNotification({ type: 'notification', event: 'refund.succeeded', object: { id: YK } }))
      .toEqual({ kind: 'refund', event: 'refund.succeeded', id: YK })
  })
  it('мусор, чужие события и кривые id отбрасываются', () => {
    expect(parseNotification(null)).toBeNull()
    expect(parseNotification('x')).toBeNull()
    expect(parseNotification({ type: 'x', event: 'payment.succeeded', object: { id: YK } })).toBeNull()
    expect(parseNotification({ type: 'notification', event: 'payout.succeeded', object: { id: YK } })).toBeNull()
    expect(parseNotification({ type: 'notification', event: 'payment.succeeded', object: { id: '../../payouts' } })).toBeNull()
    expect(parseNotification({ type: 'notification', event: 'payment.succeeded', object: {} })).toBeNull()
  })
})

describe('paymentFacts — разбор ответа API', () => {
  const ok = {
    id: YK,
    status: 'succeeded',
    amount: { value: '2900.00', currency: 'RUB' },
    payment_method: { type: 'bank_card', id: 'pm-1', saved: true, card: { last4: '4444', card_type: 'MasterCard' } },
    captured_at: '2026-10-10T10:00:00.000Z',
    metadata: { origin: PAYMENT_ORIGIN, payment_id: PID, subscription_id: SID },
  }

  it('успешный платёж с сохранённой картой', () => {
    const f = paymentFacts(ok)!
    expect(f).toMatchObject({
      yookassaId: YK, ourPaymentId: PID, ours: true, status: 'succeeded', amountRub: 2900,
      methodId: 'pm-1', methodSaved: true, cardTitle: 'MasterCard •4444', paidAt: '2026-10-10T10:00:00.000Z',
    })
    expect(applyPaymentArgs(f)).toEqual({
      p_yookassa_id: YK, p_our_payment_id: PID, p_status: 'succeeded', p_amount_rub: 2900,
      p_method_id: 'pm-1', p_method_saved: true, p_card_title: 'MasterCard •4444',
      p_cancel_reason: null, p_paid_at: '2026-10-10T10:00:00.000Z',
    })
  })

  it('отказ — причина из cancellation_details', () => {
    const f = paymentFacts({ ...ok, status: 'canceled', cancellation_details: { party: 'issuer', reason: 'insufficient_funds' } })!
    expect(f.status).toBe('canceled')
    expect(f.cancelReason).toBe('insufficient_funds')
  })

  it('чужой платёж магазина (без нашей метки) распознаётся', () => {
    expect(paymentFacts({ ...ok, metadata: { plan_id: 'x' } })).toMatchObject({ ours: false, ourPaymentId: null })
  })

  it('не рубли, неизвестный статус, кривая сумма', () => {
    expect(paymentFacts({ ...ok, amount: { value: '10.00', currency: 'USD' } })).toBeNull()
    expect(paymentFacts({ ...ok, status: 'weird' })).toBeNull()
    expect(applyPaymentArgs(paymentFacts({ ...ok, amount: { value: 'abc', currency: 'RUB' } })!).p_amount_rub).toBeNull()
  })

  it('название карты: бренд и 4 цифры, иначе title способа', () => {
    expect(cardTitleOf({ card: { last4: '1234', card_type: 'Unknown' } })).toBe('Карта •1234')
    expect(cardTitleOf({ title: 'SberPay' })).toBe('SberPay')
    expect(cardTitleOf(null)).toBeNull()
  })
})

describe('refundFacts', () => {
  it('возврат и платёж, к которому он относится', () => {
    expect(refundFacts({ id: YK, payment_id: '2d6e3a45-000f-5000-9000-aaaaaaaaaaaa', status: 'succeeded', amount: { value: '290.00', currency: 'RUB' } }))
      .toEqual({ refundId: YK, paymentId: '2d6e3a45-000f-5000-9000-aaaaaaaaaaaa', succeeded: true, amountRub: 290 })
    expect(refundFacts({ id: YK, payment_id: '2d6e3a45-000f-5000-9000-aaaaaaaaaaaa', status: 'succeeded' })!.amountRub).toBeNaN()
    expect(refundFacts({ id: YK, status: 'succeeded' })).toBeNull()
  })
})

describe('cancelReasonText', () => {
  it('известные причины — по-русски, неизвестные — нейтрально', () => {
    expect(cancelReasonText('insufficient_funds')).toBe('недостаточно средств на карте')
    expect(cancelReasonText('something_new')).toBe('банк отклонил платёж')
    expect(cancelReasonText(null)).toBe('платёж не прошёл')
  })
})

describe('§287 returnBase — возврат из ЮKassa только на свои адреса', () => {
  const APP = 'https://alminion.ru'
  const PREVIEW = 'https://almiron-git-podpiska-team.vercel.app'
  it('адрес сайта и перечисленное превью — принимаются', () => {
    expect(returnBase('https://alminion.ru', APP, PREVIEW)).toBe(APP)
    expect(returnBase(PREVIEW, APP, `${PREVIEW}, https://other.example`)).toBe(PREVIEW)
    expect(returnBase(PREVIEW + '/', APP, PREVIEW)).toBe(PREVIEW)
  })
  it('всё остальное — на адрес сайта: чужое превью, http, путь, логин в адресе, мусор', () => {
    for (const bad of [
      'https://almiron-git-evil-team.vercel.app',
      'https://evil.vercel.app',
      'http://alminion.ru',
      'https://alminion.ru.evil.com',
      'https://alminion.ru/subscribe',
      'https://alminion.ru?x=1',
      'https://user@alminion.ru',
      'javascript:alert(1)',
      '//evil.com',
      '',
      null,
      42,
      'https://' + 'a'.repeat(300) + '.ru',
    ]) {
      expect(returnBase(bad, APP, PREVIEW)).toBe(APP)
    }
  })
  it('без списка превью — только адрес сайта; кривые элементы списка игнорируются', () => {
    expect(returnBase(PREVIEW, APP, null)).toBe(APP)
    expect(returnBase(PREVIEW, APP, 'http://x.ru, *.vercel.app, ,')).toBe(APP)
    expect(returnBase(APP, APP + '/', '')).toBe(APP)
  })
})

describe('§287 promoInput', () => {
  it('строка до 64 знаков, обрезка пробелов; остальное — null', () => {
    expect(promoInput('  BLOG-2026 ')).toBe('BLOG-2026')
    expect(promoInput('')).toBeNull()
    expect(promoInput('   ')).toBeNull()
    expect(promoInput('x'.repeat(65))).toBeNull()
    expect(promoInput(123)).toBeNull()
    expect(promoInput(null)).toBeNull()
  })
})
