/**
 * §241. Страница курса ученика: раздел «Контрольные, самостоятельные и
 * пробники» над программой вместо прежнего блока «Пробники»; без дублей —
 * работы по времени не показываются в своих модулях, модуль, где кроме них
 * ничего не было, скрыт; прогресс курса и модулей не меняется. Без данных
 * раздела (RPC ещё нет на базе, сбой, предпросмотр) — всё как раньше.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { countTopics } from '@/lib/studentCourseCounters'
import type { ModuleProgress } from '@/hooks/useStudentCourseProgram'
import type { MyAssessments } from '@/lib/courseAssessments'
import type { MockLessonListRow } from '@/lib/mockExamLesson'

const topic = (id: string, title: string, kind = 'lesson') => ({
  id, title, order_index: 1, max_score: null, kind,
  available_from: null, is_open: true, sections: new Set(),
  hw_id: null, hw_title: null, hw_instructions: null, hw_due_at: null,
  hw_grade_scale: null, hw_status: null, hw_score: null, hw_max: null, hw_comment: null,
  test_assignment_id: null, test_title: null, test_status: null,
  test_points: null, test_max_points: null, tasks_total: 0, tasks_closed: 0,
  completed_count: 0, assignment_count: 0,
}) as any

const moduleOf = (id: string, title: string, ts: any[]): ModuleProgress => ({
  id, title, order_index: 1, topics: ts, done: 0, total: 0,
  counters: countTopics(ts.map(t => ({ is_open: t.is_open, available_from: t.available_from, hasHomework: false, hwStatus: null }))),
})

const modules: ModuleProgress[] = [
  moduleOf('m1', 'Механика', [topic('t1', 'Законы Ньютона'), topic('t2', 'КР: Кинематика', 'control')]),
  moduleOf('m2', 'Контрольные работы', [topic('t3', 'Проверочная: Импульс', 'check')]),
  moduleOf('m3', 'Оптика', [topic('t4', 'Линзы')]),
]
const now = Date.now()
const iso = (mins: number) => new Date(now + mins * 60_000).toISOString()
const mockRow: MockLessonListRow = {
  id: 'ex1', title: 'Пробник №5', starts_at: iso(3 * 24 * 60), ends_at: iso(3 * 24 * 60 + 235),
  photos_until: iso(3 * 24 * 60 + 250), duration_minutes: 235, submitted_at: null, has_work: false, notified: false, server_now: iso(0),
}
const READY: MyAssessments = {
  serverNow: iso(0),
  works: [
    { topic_id: 't2', homework_id: 'h2', kind: 'control', title: 'КР: Кинематика', module_id: 'm1', module_title: 'Механика', topic_open: true, available_from: null, grade_scale: 'five', opens_at: iso(24 * 60), closes_at: iso(24 * 60 + 45), personal: false, status: 'none', submitted_at: null, reviewed_at: null, score: null, tasks: null, group: null },
    { topic_id: 't3', homework_id: 'h3', kind: 'check', title: 'Проверочная: Импульс', module_id: 'm2', module_title: 'Контрольные работы', topic_open: true, available_from: null, grade_scale: 'five', opens_at: null, closes_at: null, personal: false, status: 'none', submitted_at: null, reviewed_at: null, score: null, tasks: null, group: null },
  ],
  mocks: [mockRow],
}

let assessments: { status: string; data: MyAssessments | null } = { status: 'ready', data: READY }
let preview = false
const hookArgs: unknown[][] = []

vi.mock('@/hooks/useStudentCourseProgram', () => ({
  useStudentCourseProgram: () => ({
    course: { id: 'c1', title: 'Физика ЕГЭ 11А', subject: 'physics', exam_type: 'ege', group_name: '11А', teacher: null, curator: null },
    modules, mockExams: [mockRow], loading: false, error: null, reload: vi.fn(),
  }),
}))
vi.mock('@/hooks/useCourseAssessments', () => ({
  useMyCourseAssessments: (...args: unknown[]) => { hookArgs.push(args); return { ...assessments, reload: vi.fn() } },
}))
vi.mock('@/hooks/useStudentWeekPlan', () => ({ useStudentWeekPlan: () => ({ courses: [], loading: false, error: null }) }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (selector: any) => selector({ profile: { id: 'p1', role: 'student' } }) }))
vi.mock('@/store/staffModeStore', () => ({ usePreviewMode: () => preview }))

import { StudentCoursePage } from '@/pages/StudentCoursePage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/my-course/g1']}>
      <Routes>
        <Route path="/my-course/:groupId" element={<StudentCoursePage />} />
        <Route path="/my-course/:groupId/topic/:id" element={<p>страница темы</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  assessments = { status: 'ready', data: READY }
  preview = false
  hookArgs.length = 0
  localStorage.clear()
})

describe('StudentCoursePage — раздел «Контрольные, самостоятельные и пробники»', () => {
  it('над программой вместо блока «Пробники»; внутри — пробник, контрольная и проверочная', () => {
    renderPage()
    const section = screen.getByTestId('assessments-section')
    expect(section).toHaveTextContent('Контрольные, самостоятельные и пробники')
    expect(screen.queryByTestId('mock-exams-section')).toBeNull()
    expect(within(section).getAllByTestId('assessments-block').map(b => b.getAttribute('data-block'))).toEqual(['mock', 'control', 'check'])
    const firstModule = screen.getByText('Механика')
    expect(section.compareDocumentPosition(firstModule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hookArgs[0]).toEqual(['g1', true])
  })

  it('без дублей: модуль «Контрольные работы» (в нём только работа по времени) скрыт, в «Механике» КР нет', () => {
    renderPage()
    expect(screen.queryByText('Контрольные работы')).toBeNull()
    expect(screen.getByText('Оптика')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Механика'))
    const list = screen.getByTestId('topics-list-view')
    expect(list).toHaveTextContent('Законы Ньютона')
    expect(list).not.toHaveTextContent('КР: Кинематика')
    expect(screen.getByText(/1 тема/)).toBeInTheDocument()
  })

  it('прогресс не трогаем: счётчик курса считает все темы, как раньше', () => {
    renderPage()
    expect(screen.getByTestId('course-topics-counter')).toHaveTextContent('4')
  })

  it('строка КР без результата ведёт на страницу темы', async () => {
    renderPage()
    fireEvent.click(screen.getByText('КР: Кинематика'))
    expect(await screen.findByText('страница темы')).toBeInTheDocument()
  })

  it('RPC недоступна (миграции нет, сбой) — прежний блок «Пробники», темы на своих местах', () => {
    assessments = { status: 'error', data: null }
    renderPage()
    expect(screen.queryByTestId('assessments-section')).toBeNull()
    expect(screen.getByTestId('mock-exams-section')).toBeInTheDocument()
    expect(screen.getByText('Контрольные работы')).toBeInTheDocument()
  })

  it('пока грузится — ни раздела, ни прежнего блока, темы на месте', () => {
    assessments = { status: 'loading', data: null }
    renderPage()
    expect(screen.queryByTestId('assessments-section')).toBeNull()
    expect(screen.queryByTestId('mock-exams-section')).toBeNull()
    expect(screen.getByText('Контрольные работы')).toBeInTheDocument()
  })

  it('у курса нет ни работ, ни пробников — раздела нет вовсе', () => {
    assessments = { status: 'ready', data: { serverNow: iso(0), works: [], mocks: [] } }
    renderPage()
    expect(screen.queryByTestId('assessments-section')).toBeNull()
    expect(screen.queryByTestId('mock-exams-section')).toBeNull()
  })

  it('предпросмотр персонала: RPC ученика не зовём, пробники — прежним блоком по расписанию', () => {
    preview = true
    assessments = { status: 'idle', data: null }
    renderPage()
    expect(hookArgs[0]).toEqual(['g1', false])
    expect(screen.getByTestId('mock-exams-section')).toBeInTheDocument()
    expect(screen.getByText('Контрольные работы')).toBeInTheDocument()
  })
})
