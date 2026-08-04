import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TeacherDashboard } from '@/pages/teacher/TeacherDashboard'

/**
 * Тест переписан 2026-08-04 под нынешний кабинет.
 *
 * Прежняя версия описывала кабинет двух переделок назад: кормила
 * `useTeacherHomeworkSummary` и ждала «Ожидают проверки», «На доработке у
 * учеников», «Все работы проверены». Ни одного из этих текстов в компоненте
 * давно нет, и хука он больше не зовёт — страница живёт на одном
 * `useTeacherDashboard`. Пять красных висели бесхозными и ничего не сторожили.
 *
 * Замысел прежнего теста сохранён: кабинет показывает очередь по живому
 * контуру `topic_homework_*`, а не по легаси. Сам запрет на легаси держится в
 * хуке; здесь проверяется, что кабинет рисует именно из него.
 */

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'profile-1', full_name: 'Виктор Андреев', role: 'teacher' } }),
}))

vi.mock('@/store/staffModeStore', () => ({
  useEffectiveRole: () => 'teacher',
}))

const useTeacherDashboardMock = vi.fn()
vi.mock('@/hooks/useTeacherDashboard', () => ({
  useTeacherDashboard: (...args: unknown[]) => useTeacherDashboardMock(...args),
}))

const baseDashboard = {
  courses: [],
  pendingReviews: [],
  recentTests: [],
  stats: { courses: 0, students: 0, pendingReviews: 0, bankTests: 0 },
  loading: false,
  reload: vi.fn(),
}

function renderDashboard() {
  return render(<MemoryRouter><TeacherDashboard /></MemoryRouter>)
}

const attempt = (attemptId: string, studentName: string, hwTitle: string) => ({
  attemptId, studentName, hwTitle, submittedAt: '2026-08-01T10:00:00Z',
})

describe('TeacherDashboard — очередь по живому контуру topic_homework', () => {
  beforeEach(() => {
    useTeacherDashboardMock.mockReturnValue(baseDashboard)
  })

  it('кабинет спрашивает данные по своему профилю и роли представления', () => {
    renderDashboard()
    expect(useTeacherDashboardMock).toHaveBeenCalledWith('profile-1', 'teacher')
  })

  it('показывает работы, ждущие проверки, с числом в заголовке', () => {
    useTeacherDashboardMock.mockReturnValue({
      ...baseDashboard,
      pendingReviews: [attempt('a1', 'Иван Петров', 'Матан ДЗ')],
      stats: { ...baseDashboard.stats, pendingReviews: 3 },
    })
    renderDashboard()

    expect(screen.getByText('Ждут проверки: 3 работ')).toBeInTheDocument()
    expect(screen.getByText(/Матан ДЗ/)).toBeInTheDocument()
    expect(screen.getByText(/Иван Петров/)).toBeInTheDocument()
  })

  it('без ожидающих работ блок очереди не рисуется вовсе', () => {
    renderDashboard()
    expect(screen.queryByText(/Ждут проверки/)).not.toBeInTheDocument()
  })

  it('в очереди показывает не больше пяти работ', () => {
    useTeacherDashboardMock.mockReturnValue({
      ...baseDashboard,
      pendingReviews: Array.from({ length: 7 }, (_, i) => attempt(`a${i}`, `Ученик ${i}`, `ДЗ ${i}`)),
      stats: { ...baseDashboard.stats, pendingReviews: 7 },
    })
    renderDashboard()

    expect(screen.getByText(/ДЗ 4/)).toBeInTheDocument()
    expect(screen.queryByText(/ДЗ 5/)).not.toBeInTheDocument()
  })

  it('счётчик «на проверке» берётся из статистики, а не из длины списка', () => {
    useTeacherDashboardMock.mockReturnValue({
      ...baseDashboard,
      pendingReviews: [attempt('a1', 'Иван Петров', 'Матан ДЗ')],
      stats: { ...baseDashboard.stats, pendingReviews: 7 },
    })
    renderDashboard()

    expect(screen.getAllByText('7').length).toBeGreaterThan(0)
  })
})
