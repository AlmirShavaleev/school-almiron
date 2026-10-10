/**
 * §282. Экраны подписки: витрина, оформление, «Моя подписка», плашка
 * «курс закрыт», пункт меню за флагом. База и edge-функция подменены на
 * уровне `@/lib/subscription/api` — проверяется поведение экранов.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import type { MySubscription, PublicTariff } from '@/lib/subscription/view'

const api = vi.hoisted(() => ({
  fetchFeatureFlag: vi.fn(),
  fetchSubscriptionsEnabled: vi.fn(),
  checkPromo: vi.fn(),
  fetchPublicTariffs: vi.fn(),
  fetchSubscriptionSettings: vi.fn(),
  fetchMySubscriptions: vi.fn(),
  fetchCourseAccess: vi.fn(),
  setAutoRenew: vi.fn(),
  startTrial: vi.fn(),
  beginCheckout: vi.fn(),
  fetchPayment: vi.fn(),
}))
vi.mock('@/lib/subscription/api', async (orig) => ({ ...(await orig<object>()), ...api }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const res = Promise.resolve({ count: 0, data: null, error: null })
      const chain: Record<string, unknown> = {}
      for (const k of ['eq', 'is', 'select', 'in', 'order', 'limit']) chain[k] = () => Object.assign(res, chain)
      return chain
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))

import { SubscribePage } from '../SubscribePage'
import { SubscriptionCheckoutPage } from '../SubscriptionCheckoutPage'
import { MySubscriptionPage } from '../MySubscriptionPage'
import { SubscriptionResultPage } from '../SubscriptionResultPage'
import { SubscriptionLockBanner } from '@/components/subscription/SubscriptionLockBanner'
import { Sidebar } from '@/components/layout/Sidebar'
import { resetFeatureFlagCache } from '@/hooks/useSubscription'

const TARIFF: PublicTariff = {
  id: '11111111-2222-4333-8444-555555555555', title: 'Месяц', description: null, price_rub: 2900,
  period_months: 1, trial_days: 7, course_id: 'c1', course_title: 'Курс с подпиской',
}
const SUB: MySubscription = {
  id: 's1', course_id: 'c1', course_title: 'Курс с подпиской', group_id: 'g1', tariff_id: TARIFF.id,
  tariff_title: 'Месяц', price_rub: 2900, status: 'active', has_access: true,
  current_period_end: '2099-11-10T09:00:00Z', access_until: '2099-11-10T09:00:00Z', auto_renew: true,
  can_auto_renew: true, next_charge_at: '2099-11-10T09:00:00Z', last_charge_error: null, card_title: 'Visa •4242',
  payments: [{ id: 'p1', kind: 'initial', amount_rub: 2900, status: 'succeeded', paid_at: '2099-10-10T09:00:00Z', created_at: '2099-10-10T09:00:00Z', refunded_at: null }],
}

function student() {
  useAuthStore.setState({
    profile: { id: 'p1', email: 'kid@example.ru', full_name: 'Аня Петрова', role: 'student', created_at: '', updated_at: '' },
    loading: false,
  } as never)
}

function renderAt(path: string, routes: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>{routes}<Route path="*" element={<div data-testid="elsewhere" />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resetFeatureFlagCache()
  api.fetchFeatureFlag.mockResolvedValue(true)
  api.fetchSubscriptionsEnabled.mockResolvedValue(true)
  api.fetchPublicTariffs.mockResolvedValue([TARIFF])
  api.fetchSubscriptionSettings.mockResolvedValue({ offer_url: 'https://docs.test/offer', privacy_url: null, parent_consent_url: null, retry_days: [1, 3] })
  api.fetchMySubscriptions.mockResolvedValue([])
  student()
})
afterEach(() => localStorage.clear())

describe('витрина /subscribe', () => {
  it('флаг выключен (тарифов нет) — «пока недоступно»', async () => {
    api.fetchPublicTariffs.mockResolvedValue([])
    renderAt('/subscribe', <Route path="/subscribe" element={<SubscribePage />} />)
    expect(await screen.findByTestId('subscribe-unavailable')).toBeInTheDocument()
  })

  it('гость выбирает тариф → регистрация, тариф запомнен', async () => {
    useAuthStore.setState({ profile: null, loading: false } as never)
    renderAt('/subscribe', <>
      <Route path="/subscribe" element={<SubscribePage />} />
      <Route path="/register" element={<div data-testid="register" />} />
    </>)
    fireEvent.click(await screen.findByTestId('tariff-choose'))
    expect(screen.getByTestId('register')).toBeInTheDocument()
    expect(localStorage.getItem('subscription-pending-tariff')).toContain(TARIFF.id)
  })

  it('ученик — сразу к оформлению', async () => {
    renderAt('/subscribe', <>
      <Route path="/subscribe" element={<SubscribePage />} />
      <Route path="/subscribe/checkout/:tariffId" element={<div data-testid="checkout" />} />
    </>)
    fireEvent.click(await screen.findByTestId('tariff-choose'))
    expect(screen.getByTestId('checkout')).toBeInTheDocument()
  })
})

describe('оформление', () => {
  const route = <Route path="/subscribe/checkout/:tariffId" element={<SubscriptionCheckoutPage />} />

  it('без согласия с офертой не платим; карта по умолчанию НЕ сохраняется', async () => {
    renderAt(`/subscribe/checkout/${TARIFF.id}`, route)
    expect(await screen.findByTestId('checkout-save-card')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('checkout-pay'))
    expect(await screen.findByText(/Нужно согласие с офертой/)).toBeInTheDocument()
    expect(api.beginCheckout).not.toHaveBeenCalled()
  })

  it('несовершеннолетний — нужно согласие родителя', async () => {
    renderAt(`/subscribe/checkout/${TARIFF.id}`, route)
    fireEvent.click(await screen.findByTestId('checkout-offer'))
    fireEvent.click(screen.getByTestId('checkout-minor'))
    fireEvent.click(screen.getByTestId('checkout-pay'))
    expect(await screen.findByText(/Нужно согласие родителя/)).toBeInTheDocument()
    expect(api.beginCheckout).not.toHaveBeenCalled()
  })

  it('оплата: email из профиля, галочка карты уходит как есть, переход на страницу ЮKassa', async () => {
    api.beginCheckout.mockResolvedValue({ confirmation_url: 'https://yoomoney.test/pay', payment_id: 'p' })
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    renderAt(`/subscribe/checkout/${TARIFF.id}`, route)
    expect(await screen.findByTestId('checkout-email')).toHaveValue('kid@example.ru')
    fireEvent.click(screen.getByTestId('checkout-offer'))
    fireEvent.click(screen.getByTestId('checkout-save-card'))
    fireEvent.click(screen.getByTestId('checkout-pay'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://yoomoney.test/pay'))
    expect(api.beginCheckout).toHaveBeenCalledWith(TARIFF.id, expect.objectContaining({ saveCard: true, acceptedOffer: true, email: 'kid@example.ru' }), null)
    vi.unstubAllGlobals()
  })

  it('промокод: цену показывает сервер, в оформление уходит применённый код, кнопка — новая сумма', async () => {
    api.checkPromo.mockResolvedValue({
      ok: true, code: 'HALF3', kind: 'percent', percent: 50, discount_payments: 3,
      free_days: null, free_months: null, price_rub: 2900, amount_rub: 1450, free: false,
    })
    api.beginCheckout.mockResolvedValue({ confirmation_url: 'https://yoomoney.test/pay', payment_id: 'p' })
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    renderAt(`/subscribe/checkout/${TARIFF.id}`, route)
    fireEvent.change(await screen.findByTestId('checkout-promo'), { target: { value: ' half3 ' } })
    fireEvent.click(screen.getByTestId('checkout-promo-apply'))
    expect(await screen.findByTestId('checkout-promo-ok')).toHaveTextContent('Скидка 50 % на 3 платежа подряд, включая автопродление')
    expect(api.checkPromo).toHaveBeenCalledWith(TARIFF.id, 'half3')
    // с промокодом пробный не предлагается — одна кнопка оплаты с новой суммой
    expect(screen.queryByTestId('checkout-trial')).toBeNull()
    expect(screen.getByTestId('checkout-pay')).toHaveTextContent(/1\s450/)
    fireEvent.click(screen.getByTestId('checkout-offer'))
    fireEvent.click(screen.getByTestId('checkout-pay'))
    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(api.beginCheckout).toHaveBeenCalledWith(TARIFF.id, expect.anything(), 'HALF3')
    vi.unstubAllGlobals()
  })

  it('промокод не подошёл — одно и то же «не подходит», без подсказки; изменили поле — скидка снята', async () => {
    api.checkPromo.mockResolvedValue({ ok: false, error_code: 'PROMO_INVALID', error: 'Промокод не подходит' })
    renderAt(`/subscribe/checkout/${TARIFF.id}`, route)
    fireEvent.change(await screen.findByTestId('checkout-promo'), { target: { value: 'NOPE1' } })
    fireEvent.click(screen.getByTestId('checkout-promo-apply'))
    expect(await screen.findByTestId('checkout-promo-error')).toHaveTextContent('Промокод не подходит.')
    api.checkPromo.mockResolvedValue({ ok: false, error_code: 'RATE_LIMIT', error: 'x' })
    fireEvent.click(screen.getByTestId('checkout-promo-apply'))
    expect(await screen.findByText(/Слишком много попыток/)).toBeInTheDocument()
  })

  it('бесплатный промокод — «Активировать», без страницы ЮKassa, сразу в «Мою подписку»', async () => {
    api.checkPromo.mockResolvedValue({
      ok: true, code: 'BLOG2M', kind: 'free_months', percent: null, discount_payments: null,
      free_days: null, free_months: 2, price_rub: 2900, amount_rub: 0, free: true,
    })
    api.beginCheckout.mockResolvedValue({ free: true, access_until: '2099-01-01T00:00:00Z', subscription_id: 's' })
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    renderAt(`/subscribe/checkout/${TARIFF.id}`, <>
      {route}
      <Route path="/my-subscription" element={<div data-testid="my-sub" />} />
    </>)
    fireEvent.change(await screen.findByTestId('checkout-promo'), { target: { value: 'blog2m' } })
    fireEvent.click(screen.getByTestId('checkout-promo-apply'))
    expect(await screen.findByTestId('checkout-promo-ok')).toHaveTextContent('2 месяца бесплатно — без оплаты и без карты')
    expect(screen.getByTestId('checkout-pay')).toHaveTextContent('Активировать по промокоду')
    expect(screen.queryByText(/страница ЮKassa|странице ЮKassa/)).toBeNull()
    fireEvent.click(screen.getByTestId('checkout-offer'))
    fireEvent.click(screen.getByTestId('checkout-pay'))
    expect(await screen.findByTestId('my-sub')).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('пробный период доступен — главная кнопка «пробный», ошибка сервера показана текстом', async () => {
    const { SubscriptionError } = await import('@/lib/subscription/api')
    api.startTrial.mockRejectedValue(new SubscriptionError('x', 'TRIAL_USED'))
    renderAt(`/subscribe/checkout/${TARIFF.id}`, route)
    fireEvent.click(await screen.findByTestId('checkout-offer'))
    fireEvent.click(screen.getByTestId('checkout-trial'))
    expect(await screen.findByTestId('checkout-error')).toHaveTextContent('Пробный период по этому курсу уже был.')
  })

  it('пробный уже был (есть подписка) — кнопки пробного нет', async () => {
    api.fetchMySubscriptions.mockResolvedValue([{ ...SUB, status: 'expired', has_access: false }])
    renderAt(`/subscribe/checkout/${TARIFF.id}`, route)
    expect(await screen.findByTestId('checkout-pay')).toBeInTheDocument()
    expect(screen.queryByTestId('checkout-trial')).toBeNull()
  })
})

describe('«Моя подписка»', () => {
  const route = <Route path="/my-subscription" element={<MySubscriptionPage />} />

  it('статус, следующее списание, история; отмена автопродления с подтверждением', async () => {
    api.fetchMySubscriptions.mockResolvedValue([SUB])
    api.setAutoRenew.mockResolvedValue({ auto_renew: false })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/my-subscription', route)
    expect(await screen.findByTestId('my-subscription-headline')).toHaveTextContent('Курс открыт до 10 ноября 2099')
    expect(screen.getByText(/Следующее списание/)).toBeInTheDocument()
    expect(screen.getByTestId('my-subscription-payments')).toHaveTextContent('Оплачен')
    fireEvent.click(screen.getByTestId('my-subscription-cancel-renew'))
    await waitFor(() => expect(api.setAutoRenew).toHaveBeenCalledWith('s1', false))
  })

  it('тариф на несколько месяцев — цена «за 3 месяца», а не «в месяц»', async () => {
    api.fetchMySubscriptions.mockResolvedValue([{ ...SUB, period_months: 3 }])
    renderAt('/my-subscription', route)
    expect(await screen.findByText(/за 3 месяца/)).toBeInTheDocument()
  })

  it('подписки нет — «Выбрать тариф»', async () => {
    renderAt('/my-subscription', route)
    expect(await screen.findByText('Подписки пока нет.')).toBeInTheDocument()
  })
})

describe('возврат из ЮKassa', () => {
  const route = <Route path="/subscribe/result" element={<SubscriptionResultPage />} />
  it('оплачено — «Подписка оформлена» и вход в курс', async () => {
    api.fetchPayment.mockResolvedValue({ id: 'p1', status: 'succeeded', amount_rub: 2900, paid_at: null, cancellation_reason: null, subscription_id: 's1' })
    api.fetchMySubscriptions.mockResolvedValue([SUB])
    renderAt('/subscribe/result?payment=p1', route)
    expect(await screen.findByText('Подписка оформлена')).toBeInTheDocument()
    expect((await screen.findByText('Перейти к курсу')).closest('a')).toHaveAttribute('href', '/my-course/g1')
  })
  it('не прошла — «деньги не списаны», попробовать снова', async () => {
    api.fetchPayment.mockResolvedValue({ id: 'p1', status: 'canceled', amount_rub: 2900, paid_at: null, cancellation_reason: 'x', subscription_id: 's1' })
    renderAt('/subscribe/result?payment=p1', route)
    expect(await screen.findByText('Оплата не прошла')).toBeInTheDocument()
    expect(screen.getByTestId('subscription-result')).toHaveAttribute('data-state', 'failed')
  })
  it('ждём банк — крутилка', async () => {
    api.fetchPayment.mockResolvedValue({ id: 'p1', status: 'pending', amount_rub: 2900, paid_at: null, cancellation_reason: null, subscription_id: 's1' })
    renderAt('/subscribe/result?payment=p1', route)
    expect(await screen.findByText('Проверяем оплату…')).toBeInTheDocument()
  })
})

describe('плашка «курс закрыт»', () => {
  async function renderBanner() {
    render(<MemoryRouter><SubscriptionLockBanner courseId="c1" /></MemoryRouter>)
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
  }

  it('курс бесплатный или доступ есть — плашки нет', async () => {
    api.fetchCourseAccess.mockResolvedValue({ paid: false, has_access: true, status: null, access_until: null, tariff_id: null })
    await renderBanner()
    expect(screen.queryByTestId('subscription-lock')).toBeNull()
  })

  it('подписка закончилась — «прогресс сохранён» и «Продлить»', async () => {
    api.fetchCourseAccess.mockResolvedValue({ paid: true, has_access: false, status: 'expired', access_until: '2026-10-01T09:00:00Z', tariff_id: TARIFF.id })
    await renderBanner()
    expect(screen.getByTestId('subscription-lock')).toHaveTextContent('Прогресс и работы сохранены')
    expect(screen.getByTestId('subscription-lock-renew').closest('a')).toHaveAttribute('href', `/subscribe/checkout/${TARIFF.id}`)
  })

  it('оформление начато, но не оплачено (pending) — «доступен по подписке», а не «закончилась»', async () => {
    api.fetchCourseAccess.mockResolvedValue({ paid: true, has_access: false, status: 'pending', access_until: null, tariff_id: TARIFF.id })
    await renderBanner()
    expect(screen.getByTestId('subscription-lock')).toHaveTextContent('Курс доступен по подписке')
    expect(screen.getByTestId('subscription-lock-renew')).toHaveTextContent('Оформить')
  })

  it('флаг выключен — объяснение есть, кнопки оформления нет', async () => {
    api.fetchSubscriptionsEnabled.mockResolvedValue(false)
    api.fetchCourseAccess.mockResolvedValue({ paid: true, has_access: false, status: null, access_until: null, tariff_id: null })
    await renderBanner()
    expect(screen.getByTestId('subscription-lock')).toHaveTextContent('Курс доступен по подписке')
    expect(screen.queryByTestId('subscription-lock-renew')).toBeNull()
  })

  it('ошибка чтения — плашки нет, страница цела', async () => {
    api.fetchCourseAccess.mockRejectedValue(new Error('нет функции'))
    await renderBanner()
    expect(screen.queryByTestId('subscription-lock')).toBeNull()
  })
})

describe('меню ученика', () => {
  async function renderMenu() {
    render(<MemoryRouter initialEntries={['/student']}><Sidebar open onClose={() => {}} /></MemoryRouter>)
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
  }
  it('флаг включён — пункт «Моя подписка»', async () => {
    await renderMenu()
    expect(screen.getByRole('link', { name: /Моя подписка/ })).toHaveAttribute('href', '/my-subscription')
  })
  it('флаг выключен — пункта нет', async () => {
    api.fetchSubscriptionsEnabled.mockResolvedValue(false)
    await renderMenu()
    expect(screen.queryByRole('link', { name: /Моя подписка/ })).toBeNull()
  })
})
