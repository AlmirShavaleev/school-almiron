import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { countTopics } from '@/lib/studentCourseCounters'
import type { ModuleProgress } from '@/hooks/useStudentCourseProgram'

/**
 * §290-B. Страница курса ученика: демо (пробный период по подписке) —
 * плашка «Оформить подписку» и подпись замка «Доступно по подписке»; пустой
 * «Раздел 0» (тест 12.10) ученику не показывается.
 */

const topic = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Урок ${id}`, order_index: 1, max_score: null,
  available_from: null, is_open: null, sections: new Set<string>(),
  hw_id: null, hw_title: null, hw_instructions: null, hw_due_at: null,
  hw_grade_scale: null, hw_status: null, hw_score: null, hw_max: null, hw_comment: null,
  test_assignment_id: null, test_title: null, test_status: null,
  test_points: null, test_max_points: null,
  completed_count: 0, assignment_count: 0,
  ...over,
}) as unknown as ModuleProgress['topics'][number]

const lessons = [
  topic('1', { progress: { open: true, note: null } }),
  topic('2', { progress: { open: true, note: null } }),
  topic('3', { progress: { open: false, note: 'Откроется после урока «Урок 2»' } }),
]
const counters = (ts: unknown[]) => countTopics(ts.map(() => ({ is_open: true, available_from: null, hasHomework: false, hwStatus: null })), '2026-10-13')
const modules: ModuleProgress[] = [
  { id: 'm0', title: 'Раздел 0 · Основной', order_index: 0, topics: [], done: 0, total: 0, counters: counters([]) },
  { id: 'm1', title: 'Механика', order_index: 1, topics: lessons, done: 0, total: 0, counters: counters(lessons) },
]

vi.mock('@/hooks/useStudentCourseProgram', () => ({
  useStudentCourseProgram: () => ({
    course: { id: 'c1', title: 'Физика ЕГЭ', subject: 'physics', exam_type: 'ege', group_name: 'g', teacher: null, curator: null },
    modules,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'p1', role: 'student' } }),
}))
const demo = vi.hoisted(() => ({ value: true }))
vi.mock('@/lib/studentPath', async (orig) => ({
  ...(await orig<object>()),
  fetchCourseDemo: vi.fn(async () => demo.value),
}))

import { StudentCoursePage } from '@/pages/StudentCoursePage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/my-course/g1']}>
      <Routes>
        <Route path="/my-course/:groupId" element={<StudentCoursePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { demo.value = true })

describe('§290-B страница курса', () => {
  it('пустой раздел ученику не показывается', async () => {
    renderPage()
    const cards = await screen.findAllByTestId('module-card')
    expect(cards).toHaveLength(1)
    expect(screen.queryByText(/Раздел 0/)).toBeNull()
  })

  it('демо: плашка «Оформить подписку», у закрытого урока — «Доступно по подписке»', async () => {
    renderPage()
    // Пробный период — строкой доступа в шапке курса (письмо 15.10).
    expect(await screen.findByTestId('course-access')).toHaveAttribute('data-kind', 'trial')
    expect(screen.getByTestId('course-demo-buy').closest('a')).toHaveAttribute('href', '/courses')
    fireEvent.click(screen.getAllByTestId('module-card')[0])
    expect(await screen.findByText('Доступно по подписке')).toBeInTheDocument()
    expect(screen.queryByText(/Откроется после урока/)).toBeNull()
  })

  it('не демо — плашки нет, подпись замка прежняя', async () => {
    demo.value = false
    renderPage()
    fireEvent.click((await screen.findAllByTestId('module-card'))[0])
    // Подпись замка на плитке — номером урока (владелец 15.10).
    expect(await screen.findByText(/Откроется после урока 2/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('course-demo-buy')).toBeNull())
  })
})
