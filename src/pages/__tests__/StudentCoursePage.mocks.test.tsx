/**
 * §224. На странице курса ученика пробники — своим разделом «Пробники» над
 * разделами курса; внутри раздела курса их больше нет (строка §221 убрана).
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { countTopics } from '@/lib/studentCourseCounters'
import type { ModuleProgress } from '@/hooks/useStudentCourseProgram'
import type { MockLessonListRow } from '@/lib/mockExamLesson'

const topic = (id: string) => ({
  id, title: `Тема ${id}`, order_index: 1, max_score: null,
  available_from: null, is_open: true, sections: new Set(),
  hw_id: null, hw_title: null, hw_instructions: null, hw_due_at: null,
  hw_grade_scale: null, hw_status: null, hw_score: null, hw_max: null, hw_comment: null,
  test_assignment_id: null, test_title: null, test_status: null,
  test_points: null, test_max_points: null, tasks_total: 0, tasks_closed: 0,
  completed_count: 0, assignment_count: 0,
}) as any

const topics = [topic('t1'), topic('t2')]
const modules: ModuleProgress[] = [{
  id: 'm1', title: 'Механика', order_index: 1, topics, done: 0, total: 0,
  counters: countTopics(topics.map(t => ({ is_open: t.is_open, available_from: t.available_from, hasHomework: false, hwStatus: null }))),
}]
const min = 60_000
const now = Date.now()
const mockExams: MockLessonListRow[] = [{
  id: 'ex1', title: 'Пробник №3', module_id: 'm1', module_position: 1,
  starts_at: new Date(now - 20 * min).toISOString(), ends_at: new Date(now + 220 * min).toISOString(),
  photos_until: new Date(now + 235 * min).toISOString(), duration_minutes: 240,
  submitted_at: null, has_work: false, notified: false, server_now: new Date(now).toISOString(),
}]

vi.mock('@/hooks/useStudentCourseProgram', () => ({
  useStudentCourseProgram: () => ({
    course: { id: 'c1', title: 'Математика ЕГЭ 11А', subject: 'math', exam_type: 'ege', group_name: '11А', teacher: null, curator: null },
    modules, mockExams, loading: false, error: null, reload: vi.fn(),
  }),
}))
vi.mock('@/hooks/useStudentWeekPlan', () => ({ useStudentWeekPlan: () => ({ courses: [], loading: false, error: null }) }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (selector: any) => selector({ profile: { id: 'p1', role: 'student' } }) }))

import { StudentCoursePage } from '@/pages/StudentCoursePage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/my-course/g1']}>
      <Routes>
        <Route path="/my-course/:groupId" element={<StudentCoursePage />} />
        <Route path="/my-course/:groupId/mock/:examId" element={<p>страница пробника</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('StudentCoursePage — раздел «Пробники»', () => {
  it('над разделами курса; главная кнопка ведёт на страницу пробника', async () => {
    renderPage()
    const section = await screen.findByTestId('mock-exams-section')
    const moduleCard = screen.getByText('Механика')
    expect(section.compareDocumentPosition(moduleCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByTestId('mock-section-primary'))
    expect(await screen.findByText('страница пробника')).toBeInTheDocument()
  })

  it('внутри раздела курса пробника нет, даже если у него остался module_id', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Механика'))
    expect(await screen.findByTestId('topics-list-view')).not.toHaveTextContent('Пробник №3')
    expect(screen.queryByTestId('mock-exams-section')).toBeNull()
  })
})
