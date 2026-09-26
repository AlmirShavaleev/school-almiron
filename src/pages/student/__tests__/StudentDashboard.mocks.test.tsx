import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * §224.2. Кабинет — первый экран после входа: идущий пробник стоит над
 * списком дел, с подписью курса и одной кнопкой на страницу пробника.
 */

const MIN = 60_000
vi.mock('@/hooks/useStudentWeekPlan', () => ({ useStudentWeekPlan: () => ({ courses: [], loading: false, error: null }) }))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'profile-1', full_name: 'Иванова Анна', role: 'student' } }),
}))
vi.mock('@/hooks/useStudentDashboard', () => ({
  useStudentDashboard: () => ({
    courses: [
      { courseId: 'c1', groupId: 'g-phys', courseTitle: 'Физика ЕГЭ', subject: 'Физика' },
      { courseId: 'c2', groupId: 'g-sand', courseTitle: 'Песочница — пробник (тест)', subject: 'Математика' },
    ],
    hwItems: [], testItems: [],
    stats: { courses: 2, hwTotal: 0, hwAccepted: 0, hwWaiting: 0, hwRevision: 0, testsAvailable: 0, testsCompleted: 0 },
    loading: false,
  }),
}))
vi.mock('@/hooks/useStudentTodo', () => ({
  useStudentTodo: () => ({ todo: { overdue: [], returned: [], dueSoon: [], noDue: [], tests: [], newlyOpened: [], checked: [], isClear: true }, loading: false, error: null }),
}))
const loadMockExamsByGroup = vi.fn(async (ids: string[]) => {
  const now = Date.now()
  const s = now - 233 * MIN
  return Object.fromEntries(ids.map(g => [g, g !== 'g-sand' ? [] : [{
    id: 'ex1', title: '№1', starts_at: new Date(s).toISOString(), ends_at: new Date(s + 240 * MIN).toISOString(),
    photos_until: new Date(s + 255 * MIN).toISOString(), duration_minutes: 240,
    submitted_at: null, has_work: false, notified: false, server_now: new Date(now).toISOString(),
  }]]))
})
vi.mock('@/lib/myMockExams', () => ({ loadMockExamsByGroup: (ids: string[], preview: boolean) => loadMockExamsByGroup(ids, preview) }))

import { StudentDashboard } from '@/pages/student/StudentDashboard'

describe('StudentDashboard — идущий пробник (§224.2)', () => {
  it('баннер с подписью курса, одна кнопка на страницу пробника', async () => {
    render(
      <MemoryRouter initialEntries={['/student']}>
        <Routes>
          <Route path="/student" element={<StudentDashboard />} />
          <Route path="/my-course/:groupId/mock/:examId" element={<p>пробник группы g-sand</p>} />
        </Routes>
      </MemoryRouter>,
    )
    const banner = await screen.findByTestId('mock-alert')
    expect(screen.getAllByTestId('mock-alert')).toHaveLength(1)
    expect(banner).toHaveTextContent('Идёт пробник «№1»')
    expect(banner).toHaveTextContent('Песочница — пробник (тест)')
    expect(loadMockExamsByGroup).toHaveBeenCalledWith(['g-phys', 'g-sand'], false)
    fireEvent.click(screen.getByRole('link', { name: /Начать/ }))
    expect(await screen.findByText('пробник группы g-sand')).toBeInTheDocument()
  })
})
