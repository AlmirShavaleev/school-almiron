import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { staffNavFor } from '@/hooks/useStaffNav'

// Кабинет учителя и админа в стиле нового ЛК (письмо ЛК_учитель_и_админ_редизайн.md, 17.10).
vi.mock('@/hooks/useSidebarBadges', () => ({ useSidebarBadges: () => ({ '/homework-queue': 6 }) }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn(async () => {}) }) }))

import { StaffNav } from '@/components/student/nav/StudentNav'

describe('меню персонала', () => {
  it('учитель: колонка — Главная · Проверка · Курсы · Ученики · Банк; админских пунктов нет', () => {
    const { main, more } = staffNavFor('teacher')
    expect(main.map(i => i.label)).toEqual(['Главная', 'Проверка', 'Курсы', 'Ученики', 'Банк'])
    expect(more.map(i => i.key)).not.toContain('perf')
    expect(more.map(i => i.key)).toContain('teacher')
  })

  it('админ: «Админ» в колонке, админские экраны — в «Ещё»', () => {
    const { main, more } = staffNavFor('owner')
    expect(main.map(i => i.key)).toEqual(['home', 'admin', 'review', 'courses', 'students', 'bank'])
    expect(more.map(i => i.key)).toEqual(expect.arrayContaining(['support', 'telegram', 'perf', 'subscriptions', 'settings']))
  })

  it('«Тесты» и «Банк тестов» убраны совсем, «Уведомления» — колокольчиком', () => {
    for (const role of ['teacher', 'admin', 'owner'] as const) {
      const { main, more } = staffNavFor(role)
      const all = [...main.map(i => i.to), ...more.map(i => i.to)]
      expect(all).not.toContain('/variants')
      expect(all).not.toContain('/tests')
      expect(all).not.toContain('/notifications')
    }
  })

  it('компьютер: счётчик на «Проверке», «Ещё» открывается; телефон: 4 пункта + «Ещё», «Ученики» — в листе', () => {
    render(<MemoryRouter initialEntries={['/homework-queue']}><StaffNav role="teacher" /></MemoryRouter>)
    const review = screen.getByTestId('staff-nav-review')
    expect(review).toHaveAttribute('data-active', 'true')
    expect(review).toHaveTextContent('6')
    fireEvent.click(screen.getByTestId('staff-nav-more'))
    expect(within(screen.getByTestId('staff-more-pop')).getByText('Оценки уроков')).toBeInTheDocument()

    const bar = screen.getByTestId('staff-tabbar')
    expect(within(bar).getAllByRole('link').map(a => a.textContent)).toEqual(['Главная', '6Проверка', 'Курсы', 'Банк'])
    fireEvent.click(screen.getByTestId('staff-tab-more'))
    expect(within(screen.getByTestId('staff-more-sheet')).getByText('Ученики')).toBeInTheDocument()
  })
})
