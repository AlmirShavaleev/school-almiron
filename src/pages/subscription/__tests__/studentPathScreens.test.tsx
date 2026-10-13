/**
 * §290-B. Экраны пути ученика: анкета `/start`, витрина «Курсы», плашка и
 * «Продолжить урок» на главной. База подменена на уровне `@/lib/studentPath`
 * и `@/lib/subscription/api` — проверяется поведение экранов.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import type { PathSubscription, ShowcaseCard, StudentPathHome } from '@/lib/studentPath'

const path = vi.hoisted(() => ({
  fetchStudentPathHome: vi.fn(),
  fetchCourseDemo: vi.fn(),
  saveOnboarding: vi.fn(),
  fetchShowcase: vi.fn(),
  requestLaunchNotice: vi.fn(),
}))
const api = vi.hoisted(() => ({
  fetchSubscriptionsEnabled: vi.fn(),
  fetchMySubscriptions: vi.fn(),
}))
vi.mock('@/lib/studentPath', async (orig) => ({ ...(await orig<object>()), ...path }))
vi.mock('@/lib/subscription/api', async (orig) => ({ ...(await orig<object>()), ...api }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: () => Promise.resolve({ data: null, error: null }) } }))

import { OnboardingPage } from '@/pages/student/OnboardingPage'
import { CoursesPage } from '../CoursesPage'
import { SubscriptionPathCard } from '@/components/student/home/SubscriptionPathCard'
import { resetFeatureFlagCache } from '@/hooks/useSubscription'

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}{l.search}</p>
}

function renderAt(url: string, routes: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          {routes}
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const onboarding = (needed: boolean): StudentPathHome['onboarding'] => ({
  needed, completed: !needed, grade: null, exam: null, subject: null, target_score: null,
  months_to_exam: null, hours_per_week: null, diagnostic_status: 'none',
})

beforeEach(() => {
  vi.clearAllMocks()
  resetFeatureFlagCache()
  useAuthStore.setState({
    profile: { id: 'p1', email: 's@example.com', full_name: 'Аня', role: 'student', created_at: '', updated_at: '' },
    loading: false,
  } as never)
  api.fetchSubscriptionsEnabled.mockResolvedValue(true)
  api.fetchMySubscriptions.mockResolvedValue([])
})

describe('анкета /start', () => {
  const route = <Route path="/start" element={<OnboardingPage />} />

  it('нужна — поля проверяются; сохранение → «Курсы» с предметом', async () => {
    path.fetchStudentPathHome.mockResolvedValue({ onboarding: onboarding(true), subscriptions: [] })
    path.saveOnboarding.mockResolvedValue(onboarding(false))
    renderAt('/start', route)
    fireEvent.click(await screen.findByTestId('onboarding-submit'))
    expect(await screen.findByText(/Выберите класс/)).toBeInTheDocument()
    expect(path.saveOnboarding).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('onboarding-grade-11'))
    // месяцы до экзамена подставились по классу
    expect((screen.getByTestId('onboarding-months') as HTMLInputElement).value).not.toBe('')
    fireEvent.click(screen.getByTestId('onboarding-subject-math'))
    fireEvent.change(screen.getByTestId('onboarding-target'), { target: { value: '80' } })
    fireEvent.click(screen.getByTestId('onboarding-submit'))
    await waitFor(() => expect(path.saveOnboarding).toHaveBeenCalledWith(expect.objectContaining({ grade: 11, subject: 'math', target_score: '80' })))
    expect(await screen.findByTestId('where')).toHaveTextContent('/courses?from=start&subject=math')
  })

  it('не нужна (школьник, пройдена) или подписка закрыта — на главную', async () => {
    path.fetchStudentPathHome.mockResolvedValue({ onboarding: onboarding(false), subscriptions: [] })
    renderAt('/start', route)
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/)

    resetFeatureFlagCache()
    api.fetchSubscriptionsEnabled.mockResolvedValue(false)
    path.fetchStudentPathHome.mockResolvedValue({ onboarding: onboarding(true), subscriptions: [] })
    renderAt('/start', route)
    expect((await screen.findAllByTestId('where')).at(-1)).toHaveTextContent(/^\/$/)
    expect(path.fetchStudentPathHome).toHaveBeenCalledTimes(1)
  })
})

const CARDS: ShowcaseCard[] = [
  {
    id: 'm1', slug: 'math-ege-part1', title: 'Математика ЕГЭ. 1 часть', subtitle: 'Скоро', description: null, includes: [],
    subject: 'math', course_id: null, status: 'soon', tariffs: [], month_price: null, year_price: null,
    year_discount_pct: null, trial_days: 0, my_status: null, my_access_until: null, has_access: false,
    trial_available: false, notify_requested: false,
  },
  {
    id: 'ph', slug: 'physics-ege', title: 'Физика ЕГЭ', subtitle: 'С нуля до высокого балла', description: null,
    includes: ['Видеоуроки', 'Банк задач ЕГЭ'], subject: 'physics', course_id: 'c1', status: 'live',
    tariffs: [
      { id: 't-m', title: 'Месяц', price_rub: 500, period_months: 1, trial_days: 3 },
      { id: 't-y', title: 'Год', price_rub: 4800, period_months: 12, trial_days: 3 },
    ],
    month_price: 500, year_price: 4800, year_discount_pct: 20, trial_days: 3, my_status: null, my_access_until: null,
    has_access: false, trial_available: true, notify_requested: false,
  },
]

describe('«Курсы»', () => {
  const route = <Route path="/courses" element={<CoursesPage />} />

  it('после анкеты курс предмета первым; цены месяц/год и −20 %; переключатель периода ведёт на нужный тариф', async () => {
    path.fetchShowcase.mockResolvedValue(CARDS)
    renderAt('/courses?from=start&subject=physics', route)
    const cards = await screen.findAllByTestId('course-card')
    expect(cards[0]).toHaveAttribute('data-slug', 'physics-ege')
    expect(cards[0]).toHaveTextContent('Для вас')
    expect(screen.getByTestId('course-card-both')).toHaveTextContent(/500\s₽\/мес или 4\s800\s₽\/год \(−20 %\)/)
    expect(screen.getByTestId('course-card-price')).toHaveTextContent(/500\s₽ в месяц/)
    expect(screen.getByTestId('course-card-trial').closest('a')).toHaveAttribute('href', '/subscribe/checkout/t-m')
    fireEvent.click(screen.getByTestId('courses-period-12'))
    expect(screen.getByTestId('course-card-price')).toHaveTextContent(/4\s800\s₽ в год/)
    expect(screen.getByTestId('course-card-trial').closest('a')).toHaveAttribute('href', '/subscribe/checkout/t-y')
    expect(screen.getByTestId('courses-period-12')).toHaveTextContent('Год −20 %')
  })

  it('«Скоро» — без оплаты, «Сообщить о запуске»', async () => {
    path.fetchShowcase.mockResolvedValue(CARDS)
    path.requestLaunchNotice.mockImplementation(async () => {
      path.fetchShowcase.mockResolvedValue([{ ...CARDS[0], notify_requested: true }, CARDS[1]])
      return true
    })
    renderAt('/courses', route)
    const soon = (await screen.findAllByTestId('course-card')).find((c) => c.dataset.status === 'soon')!
    expect(soon).not.toHaveTextContent('₽')
    fireEvent.click(screen.getByTestId('course-card-notify'))
    await waitFor(() => expect(path.requestLaunchNotice).toHaveBeenCalledWith('m1'))
    expect(await screen.findByTestId('course-card-notified')).toBeInTheDocument()
  })

  it('курс открыт — «Открыть курс» в группу; пробный — ещё и «Оформить подписку»', async () => {
    path.fetchShowcase.mockResolvedValue([{ ...CARDS[1], has_access: true, my_status: 'trial', my_access_until: '2026-10-16T09:00:00Z', trial_available: false }])
    api.fetchMySubscriptions.mockResolvedValue([{ course_id: 'c1', group_id: 'g1' }])
    renderAt('/courses', route)
    expect((await screen.findByTestId('course-card-open')).closest('a')).toHaveAttribute('href', '/my-course/g1')
    expect(screen.getByTestId('course-card-buy').closest('a')).toHaveAttribute('href', '/subscribe/checkout/t-m')
  })

  it('витрина пуста (подписка закрыта) — «пока недоступно»', async () => {
    path.fetchShowcase.mockResolvedValue([])
    renderAt('/courses', route)
    expect(await screen.findByTestId('courses-unavailable')).toBeInTheDocument()
  })
})

const SUB: PathSubscription = {
  subscription_id: 's1', course_id: 'c1', course_title: 'Физика ЕГЭ', group_id: 'g1', tariff_id: 't-m',
  status: 'trial', source: 'trial', demo: true, has_access: true, access_until: '2026-10-15T09:00:00Z',
  auto_renew: false, continue: { topic_id: 'tp1', title: 'Кинематика', module_title: 'Механика' },
}

describe('главная: плашка и «Продолжить урок»', () => {
  const now = new Date('2026-10-13T12:00:00Z')
  const show = (subs: PathSubscription[]) =>
    render(<MemoryRouter><SubscriptionPathCard subscriptions={subs} now={now} /></MemoryRouter>)

  it('демо — «До конца пробного — 2 дня», «Оформить» на тариф; урок — в тему курса', () => {
    show([SUB])
    const banner = screen.getByTestId('subscription-path-banner')
    expect(banner).toHaveAttribute('data-kind', 'demo')
    expect(banner).toHaveTextContent('До конца пробного — 2 дня')
    expect(screen.getByTestId('subscription-path-buy').closest('a')).toHaveAttribute('href', '/subscribe/checkout/t-m')
    expect(screen.getByTestId('subscription-path-continue')).toHaveAttribute('href', '/my-course/g1/topic/tp1')
    expect(screen.getByTestId('subscription-path-continue')).toHaveTextContent('Кинематика')
  })

  it('промо-дни — «Курс открыт до …»; оплачено и без урока — ничего', () => {
    show([{ ...SUB, demo: false, source: 'manual' }])
    expect(screen.getByTestId('subscription-path-banner')).toHaveAttribute('data-kind', 'promo')
    expect(screen.getByTestId('subscription-path-banner')).toHaveTextContent('Курс открыт до 15 октября')
    const { container } = show([{ ...SUB, status: 'active', source: 'purchase', demo: false, continue: null }])
    expect(container).toBeEmptyDOMElement()
  })
})
