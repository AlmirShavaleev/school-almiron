/**
 * §224. На странице курса ученика пробники — своим разделом «Пробники» над
 * разделами курса; внутри раздела курса их больше нет (строка §221 убрана).
 *
 * §224.2. Идущий пробник — баннером сверху в ЛЮБОМ состоянии страницы:
 * жалоба владельца 26.09 — в курсе с одним разделом ученик открыл раздел, и
 * пробника там не было нигде. Главная кнопка одна — в баннере.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const moduleOf = (id: string, title: string, ts: any[]): ModuleProgress => ({
  id, title, order_index: 1, topics: ts, done: 0, total: 0,
  counters: countTopics(ts.map(t => ({ is_open: t.is_open, available_from: t.available_from, hasHomework: false, hwStatus: null }))),
})
let modules: ModuleProgress[] = [moduleOf('m1', 'Механика', [topic('t1'), topic('t2')])]
const min = 60_000
const now = Date.now()
const openExam = (extra: Partial<MockLessonListRow> = {}): MockLessonListRow => ({
  id: 'ex1', title: 'Пробник №3', module_id: 'm1', module_position: 1,
  starts_at: new Date(now - 20 * min).toISOString(), ends_at: new Date(now + 220 * min).toISOString(),
  photos_until: new Date(now + 235 * min).toISOString(), duration_minutes: 240,
  submitted_at: null, has_work: false, notified: false, server_now: new Date(now).toISOString(), ...extra,
})
let mockExams: MockLessonListRow[] = [openExam()]

vi.mock('@/hooks/useStudentCourseProgram', () => ({
  useStudentCourseProgram: () => ({
    course: { id: 'c1', title: 'Математика ЕГЭ 11А', subject: 'math', exam_type: 'ege', group_name: '11А', teacher: null, curator: null },
    modules, mockExams, loading: false, error: null, reload: vi.fn(),
  }),
}))
vi.mock('@/hooks/useStudentWeekPlan', () => ({ useStudentWeekPlan: () => ({ courses: [], loading: false, error: null }) }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (selector: any) => selector({ profile: { id: 'p1', role: 'student' } }) }))

import { StudentCoursePage } from '@/pages/StudentCoursePage'

function renderPage(entry = '/my-course/g1') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/my-course/:groupId" element={<StudentCoursePage />} />
        <Route path="/my-course/:groupId/mock/:examId" element={<p>страница пробника</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  modules = [moduleOf('m1', 'Механика', [topic('t1'), topic('t2')])]
  mockExams = [openExam()]
})

describe('StudentCoursePage — раздел «Пробники»', () => {
  it('над разделами курса; строка идущего ведёт на страницу пробника', async () => {
    renderPage()
    const section = await screen.findByTestId('mock-exams-section')
    const moduleCard = screen.getByText('Механика')
    expect(section.compareDocumentPosition(moduleCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByTestId('mock-section-open'))
    expect(await screen.findByText('страница пробника')).toBeInTheDocument()
  })

  it('внутри раздела курса строки пробника в списке тем нет, даже если у него остался module_id', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Механика'))
    expect(await screen.findByTestId('topics-list-view')).not.toHaveTextContent('Пробник №3')
    expect(screen.queryByTestId('mock-exams-section')).toBeNull()
  })

  it('ближайший пробник без идущего — главная кнопка остаётся в разделе', async () => {
    mockExams = [openExam({ starts_at: new Date(now + 48 * 60 * min).toISOString(), ends_at: new Date(now + 52 * 60 * min).toISOString(), photos_until: new Date(now + 53 * 60 * min).toISOString() })]
    renderPage()
    await screen.findByTestId('mock-exams-section')
    expect(screen.queryByTestId('mock-alert')).toBeNull()
  })
})

describe('StudentCoursePage — баннер идущего пробника (§224.2)', () => {
  it('главная курса: баннер сверху, над заголовком; главная кнопка ровно одна — в баннере', async () => {
    renderPage()
    const banner = await screen.findByTestId('mock-alert')
    expect(banner).toHaveTextContent('Идёт «Пробник №3»')
    const title = screen.getByRole('heading', { level: 1 })
    expect(banner.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Начать/ })).toHaveLength(1)
    expect(screen.queryByTestId('mock-section-primary')).toBeNull()
    fireEvent.click(screen.getByTestId('mock-alert-open'))
    expect(await screen.findByText('страница пробника')).toBeInTheDocument()
  })

  it('сценарий владельца: один раздел, одна пустая тема, пробник без раздела — баннер и в открытом разделе', async () => {
    modules = [moduleOf('m1', 'Основной', [{ ...topic('t1'), title: 'Урок перед пробником (пустой)' }])]
    mockExams = [openExam({ title: '№1', module_id: null, ends_at: new Date(now + 7 * min).toISOString() })]
    renderPage()
    fireEvent.click(await screen.findByText('Основной'))
    await screen.findByTestId('topics-list-view')
    const banner = screen.getByTestId('mock-alert')
    expect(banner).toHaveTextContent('Идёт пробник «№1»')
    expect(banner).toHaveTextContent('осталось 7 мин')
    fireEvent.click(screen.getByTestId('mock-alert-open'))
    expect(await screen.findByText('страница пробника')).toBeInTheDocument()
  })

  it('в режиме «Карточки» — тоже', async () => {
    localStorage.setItem('student-course-view', 'cards')
    renderPage()
    fireEvent.click(await screen.findByText('Механика'))
    await screen.findByTestId('topics-cards-view')
    expect(screen.getByTestId('mock-alert')).toHaveAttribute('data-kind', 'open')
    localStorage.clear()
  })
})

describe('StudentCoursePage — ссылка из Telegram (§224.1)', () => {
  it('?mock=<id> сразу открывает страницу пробника', async () => {
    renderPage('/my-course/g1?mock=0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0')
    expect(await screen.findByText('страница пробника')).toBeInTheDocument()
  })
  it('мусор в ?mock= не уводит со страницы курса', () => {
    renderPage('/my-course/g1?mock=../../admin')
    expect(screen.queryByText('страница пробника')).toBeNull()
  })
})
