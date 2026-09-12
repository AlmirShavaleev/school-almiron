import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { countTopics } from '@/lib/studentCourseCounters'
import type { ModuleProgress } from '@/hooks/useStudentCourseProgram'

/**
 * §141. Фикстура — ровно прод на 06.09: часть тем открыта, часть закрыта,
 * опубликованных ДЗ ноль. До правки страница показывала «0 из 0 заданий».
 */

const TODAY = '2026-09-06'

const topic = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Тема ${id}`, order_index: 1, max_score: null,
  available_from: null, is_open: null, sections: [],
  hw_id: null, hw_title: null, hw_instructions: null, hw_due_at: null,
  hw_grade_scale: null, hw_status: null, hw_score: null, hw_max: null, hw_comment: null,
  test_assignment_id: null, test_title: null, test_status: null,
  test_points: null, test_max_points: null,
  completed_count: 0, assignment_count: 0,
  ...over,
}) as any

const topics = [
  topic('t1', { is_open: true }),
  topic('t2', { is_open: true }),
  topic('t3', { is_open: false }),
  topic('t4', { available_from: '2026-12-01' }),
]

const modules: ModuleProgress[] = [{
  id: 'm1', title: 'Механика', order_index: 1, topics,
  done: 0, total: 0,
  counters: countTopics(topics.map(t => ({
    is_open: t.is_open, available_from: t.available_from,
    hasHomework: !!t.hw_id, hwStatus: t.hw_status,
  })), TODAY),
}]

vi.mock('@/hooks/useStudentCourseProgram', () => ({
  useStudentCourseProgram: () => ({
    course: {
      id: 'c1', title: 'Физика ЕГЭ 11А', subject: 'physics', exam_type: 'ege',
      group_name: '11А', teacher: null, curator: null,
    },
    modules,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))

const useStudentWeekPlanMock = vi.fn(() => ({ courses: [], loading: false, error: null }))
vi.mock('@/hooks/useStudentWeekPlan', () => ({
  useStudentWeekPlan: () => useStudentWeekPlanMock(),
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'p1', role: 'student' } }),
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

describe('StudentCoursePage — счётчики', () => {
  it('главный счётчик считает открытые темы, а не задания', async () => {
    renderPage()
    expect(await screen.findByTestId('course-topics-counter')).toHaveTextContent('2 из 4 тем открыто')
  })

  it('при нуле опубликованных ДЗ строка говорит словами, а не пустует', async () => {
    renderPage()
    expect(await screen.findByTestId('course-homework-counter'))
      .toHaveTextContent('Домашних заданий пока нет')
  })

  it('раздел в списке считает тем же правилом, что и курс', async () => {
    renderPage()
    expect(await screen.findByTestId('module-topics-counter')).toHaveTextContent('2 из 4 тем открыто')
    expect(screen.getByTestId('module-homework-counter')).toHaveTextContent('Домашних заданий пока нет')
  })

  it('слова «заданий» там, где считаются темы, больше нет', async () => {
    const { container } = renderPage()
    await screen.findByTestId('course-topics-counter')
    expect(container.textContent).not.toMatch(/\d+ из \d+ заданий/)
    expect(container.textContent).not.toMatch(/\d+ \/ \d+ заданий/)
  })

  it('неделя по учебному плану монтируется на странице курса и фильтруется по нему (§151)', async () => {
    const week = {
      course_id: 'c1', group_id: 'g1', course_title: 'Физика ЕГЭ 11А', subject: 'physics',
      week_no: 1, weeks_total: 10, week_start: '2026-09-07', week_end: '2026-09-13',
      deadline: '2026-09-13T21:00:00+00:00',
      topics: [{ topic_id: 't1', title: 'Тема недели', open_now: true, hw_published: false, hw_status: 'none', done: false, marked: false }],
    }
    useStudentWeekPlanMock.mockReturnValue({
      courses: [week, { ...week, course_id: 'other', topics: [{ ...week.topics[0], title: 'Чужая тема' }] }],
      loading: false, error: null,
    })
    renderPage()
    const block = await screen.findByTestId('student-week-plan')
    expect(block).toHaveTextContent('Тема недели')
    expect(block).not.toHaveTextContent('Чужая тема')
  })
})
