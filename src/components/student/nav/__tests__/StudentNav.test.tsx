import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
  it('компьютер: в панели главные разделы и быстрый вход в план', () => {
    renderAt('/my-homework')
    const rail = screen.getByTestId('student-rail')
    expect(within(rail).getAllByRole('link').map(a => a.textContent)).toEqual([
      'Главная', 'Мои курсы', '3ДЗ', 'Банк', 'Пробники', 'Мой план',
    ])
    expect(within(rail).getByTestId('student-nav-hw')).toHaveAttribute('aria-current', 'page')
    expect(within(rail).getByTestId('student-nav-bank')).toHaveAttribute('href', '/catalog')
    expect(within(rail).getByTestId('student-nav-work-plan')).toHaveAttribute('href', '/my-work-plan')
    expect(within(rail).getByRole('button', { name: 'Ещё' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('«Ещё» показывает витрину, оплату и настройки, выход остаётся в панели', () => {
    renderAt('/my-subscription')
    const rail = screen.getByTestId('student-rail')
    const more = within(rail).getByRole('button', { name: 'Ещё' })
    expect(more).toHaveAttribute('data-active', 'true')
    expect(within(rail).getByRole('button', { name: 'Выйти' })).toBeInTheDocument()
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    const popup = within(screen.getByTestId('student-rail-more'))
    expect(popup.getByRole('link', { name: /Оплата/ })).toHaveAttribute('aria-current', 'page')
    expect(popup.getByRole('link', { name: 'Витрина курсов' })).toHaveAttribute('href', '/courses')
    fireEvent.click(popup.getByRole('link', { name: 'Настройки' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/settings')
    expect(more).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(more)
    screen.getByRole('link', { name: 'Настройки' }).focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(more).toHaveFocus()
    expect(more).toHaveAttribute('aria-expanded', 'false')
  })

  it('телефон: панель на 5 мест (без «Пробников»), «Пробники» — в листе «Ещё»', () => {
    renderAt('/student')
    const bar = screen.getByTestId('student-tabbar')
    expect(within(bar).getAllByRole('link').map(a => a.textContent)).toEqual(['Главная', 'Мои курсы', '3ДЗ', 'Банк'])
    fireEvent.click(within(bar).getByTestId('student-tab-more'))
    const sheet = screen.getByTestId('student-more-sheet')
    expect(within(sheet).getAllByRole('menuitem')[0]).toHaveTextContent('Пробники')
    expect(within(sheet).getByRole('menuitem', { name: 'Мой план работы' })).toBeInTheDocument()
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
    expect(studentPageTitle('/my-course')).toBe('Мои курсы')
    expect(studentPageTitle('/catalog/abc')).toBe('Банк задач')
    expect(studentPageTitle('/subscription')).toBe('Оплата')
    expect(studentPageTitle('/courses')).toBe('Витрина курсов')
    expect(studentPageTitle('/my-subscription')).toBe('Оплата')
    expect(studentPageTitle('/my-course/g1')).toBeNull()
  })
})
