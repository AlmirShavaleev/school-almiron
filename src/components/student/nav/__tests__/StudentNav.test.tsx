import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { subscriptionTag, studentPageTitle } from '@/lib/studentNav'

// Меню ученика, вариант В (письмо ЛК_стиль_меню_ученика.md, 16.10).
vi.mock('@/hooks/useMyTopicHomework', () => ({ useHomeworkToDoCount: () => 3 }))
// Метка «до …» — из «Моих подписок» (тот же access_until, что на карточке), не из student_path_home.
vi.mock('@/hooks/useSubscription', () => ({ useSubscriptionsEnabled: () => ({ enabled: true }) }))
vi.mock('@/lib/subscription/api', () => ({
  fetchMySubscriptions: async () => [{ has_access: true, status: 'active', access_until: '2099-11-18T09:00:00Z' }],
}))
vi.mock('@/hooks/useMyCuratorships', () => ({ useMyCuratorships: () => ({ isCurator: false }) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn(async () => {}) }) }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'p1', role: 'student' } }) }))

import { StudentNav } from '@/components/student/nav/StudentNav'

function Where() { return <span data-testid="where">{useLocation().pathname}</span> }
function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <div className="stu"><StudentNav /></div>
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  )
}

describe('меню ученика', () => {
  it('компьютер: 5 пунктов и «Ещё»; активный — ДЗ со счётчиком «сдать»', () => {
    renderAt('/my-homework')
    const rail = screen.getByTestId('student-rail')
    expect(within(rail).getAllByRole('link').map(a => a.textContent)).toEqual(['Главная', 'Курсы', '3ДЗ', 'Банк', 'Пробники'])
    expect(within(rail).getByTestId('student-nav-hw')).toHaveAttribute('aria-current', 'page')
    expect(within(rail).getByTestId('student-nav-bank')).toHaveAttribute('href', '/catalog')
  })

  it('«Ещё»: Подписка и курсы «до 18 нояб», Настройки, Выйти; переход закрывает меню', async () => {
    renderAt('/student')
    fireEvent.click(screen.getByTestId('student-nav-more'))
    const pop = screen.getByTestId('student-more-pop')
    // метка приходит из my_subscriptions (тот же access_until, что на карточке)
    await waitFor(() => expect(within(pop).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Подписка и курсыдо 18 нояб', 'Настройки', 'Выйти']))
    fireEvent.click(within(pop).getByTestId('student-more-subscription'))
    expect(screen.getByTestId('where')).toHaveTextContent('/subscription')
    expect(screen.queryByTestId('student-more-pop')).toBeNull()
  })

  it('телефон: панель на 5 мест (без «Пробников»), «Пробники» — в листе «Ещё»', () => {
    renderAt('/student')
    const bar = screen.getByTestId('student-tabbar')
    expect(within(bar).getAllByRole('link').map(a => a.textContent)).toEqual(['Главная', 'Курсы', '3ДЗ', 'Банк'])
    fireEvent.click(within(bar).getByTestId('student-tab-more'))
    const sheet = screen.getByTestId('student-more-sheet')
    expect(within(sheet).getAllByRole('menuitem')[0]).toHaveTextContent('Пробники')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('student-more-sheet')).toBeNull()
  })
})

describe('правила меню', () => {
  it('метка подписки — ближайшее окончание открытой', () => {
    const now = new Date('2026-10-16T10:00:00Z')
    expect(subscriptionTag([
      { has_access: true, status: 'active', access_until: '2026-12-01T09:00:00Z' },
      { has_access: true, status: 'trial', access_until: '2026-11-18T09:00:00Z' },
      { has_access: false, status: 'expired', access_until: '2026-10-01T09:00:00Z' },
    ], now)).toBe('до 18 нояб')
    expect(subscriptionTag([], now)).toBeNull()
  })

  it('названия страниц ученика по пунктам меню', () => {
    expect(studentPageTitle('/student')).toBe('Главная')
    expect(studentPageTitle('/my-course')).toBe('Курсы')
    expect(studentPageTitle('/catalog/abc')).toBe('Банк задач')
    expect(studentPageTitle('/subscription')).toBe('Подписка и курсы')
    expect(studentPageTitle('/my-course/g1')).toBeNull()
  })
})
