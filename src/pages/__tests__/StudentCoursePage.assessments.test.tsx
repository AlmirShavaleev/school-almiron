/**
 * §241/§259. Страница курса ученика: раздел «Контрольные, самостоятельные и
 * пробники» над программой вместо прежнего блока «Пробники» — с §259 только
 * ожидающие (прошедших нет; ничего не ждёт — раздела нет). Модуль, где все
 * темы — работы по времени, снова виден карточкой «только работы» (названия и
 * когда, без оценок, без «N из M тем»), внутри — те же работы списком и
 * карточками, клик → страница темы. В модулях с уроками работ нет, как с §241.
 * Прогресс курса и модулей не меняется. Без данных раздела (RPC ещё нет на
 * базе, сбой, предпросмотр) — темы на своих местах.
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
  moduleOf('m2', 'Контрольные работы', [topic('t3', 'Проверочная: Импульс', 'check'), topic('t5', 'КР: Статика', 'control')]),
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
    // Прошедшая и проверенная, с оценкой 5: в раздел не попадает, в модуле работ — без оценки.
    { topic_id: 't3', homework_id: 'h3', kind: 'check', title: 'Проверочная: Импульс', module_id: 'm2', module_title: 'Контрольные работы', topic_open: true, available_from: null, grade_scale: 'five', opens_at: '2026-09-22T12:00:00.000Z', closes_at: '2026-09-22T12:40:00.000Z', personal: false, status: 'reviewed', submitted_at: '2026-09-22T12:35:00.000Z', reviewed_at: '2026-09-23T15:00:00.000Z', score: 5, tasks: [{ no: '1', verdict: 'correct' }], group: { avg: 4.1, count: 16, submitted: 16, in_group: 18, better_pct: 70, best: false } },
    // Без времени — ни в разделе, ни времени в модуле.
    { topic_id: 't5', homework_id: 'h5', kind: 'control', title: 'КР: Статика', module_id: 'm2', module_title: 'Контрольные работы', topic_open: true, available_from: null, grade_scale: 'five', opens_at: null, closes_at: null, personal: false, status: 'none', submitted_at: null, reviewed_at: null, score: null, tasks: null, group: null },
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
  // §274: по умолчанию теперь карточки; эти проверки — про вид «Список».
  localStorage.setItem('student-course-view', 'list')
})

const worksCard = () => screen.getByTestId('module-works-card')

describe('StudentCoursePage — раздел «Контрольные, самостоятельные и пробники»', () => {
  it('над программой вместо блока «Пробники»; внутри — только ожидающие: пробник и КР до начала', () => {
    renderPage()
    const section = screen.getByTestId('assessments-section')
    expect(section).toHaveTextContent('Контрольные, самостоятельные и пробники')
    expect(screen.queryByTestId('mock-exams-section')).toBeNull()
    expect(within(section).getAllByTestId('assessments-block').map(b => b.getAttribute('data-block'))).toEqual(['mock', 'control'])
    // Проверенная (с оценкой) и без времени — не в разделе.
    expect(section).not.toHaveTextContent('Проверочная: Импульс')
    expect(section).not.toHaveTextContent('КР: Статика')
    const firstModule = screen.getByText('Механика')
    expect(section.compareDocumentPosition(firstModule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hookArgs[0]).toEqual(['g1', true])
  })

  it('ничего не ждёт — раздела нет, а модуль «Контрольные работы» на месте', () => {
    assessments = { status: 'ready', data: { ...READY, works: READY.works.filter(w => w.topic_id !== 't2'), mocks: [] } }
    renderPage()
    expect(screen.queryByTestId('assessments-section')).toBeNull()
    expect(screen.queryByTestId('mock-exams-section')).toBeNull()
    expect(worksCard()).toHaveTextContent('Контрольные работы')
  })

  it('строка КР без результата ведёт на страницу темы', async () => {
    renderPage()
    fireEvent.click(screen.getByText('КР: Кинематика'))
    expect(await screen.findByText('страница темы')).toBeInTheDocument()
  })
})

describe('StudentCoursePage — модуль «Контрольные работы» (§259)', () => {
  it('виден карточкой: только работы с датой, «2 работы», без оценок и без «N из M тем»', () => {
    renderPage()
    const card = worksCard()
    expect(card).toHaveTextContent('Контрольные работы')
    expect(within(card).getAllByTestId('module-works-item').map(li => li.textContent)).toEqual([
      'Проверочная: Импульс22 сент, 15:00',
      'КР: Статика',
    ])
    expect(within(card).getByTestId('module-works-count')).toHaveTextContent('2 работы')
    expect(within(card).queryByTestId('module-topics-counter')).toBeNull()
    expect(within(card).queryByTestId('module-homework-counter')).toBeNull()
    expect(card).not.toHaveTextContent(/тем|оценка|провер(ено|ена)|верно/)
    // Обычные модули — прежними карточками со счётчиком тем.
    expect(screen.getAllByTestId('module-topics-counter')).toHaveLength(2)
  })

  it('в модуле с уроками работ нет: в «Механике» — только урок', () => {
    renderPage()
    fireEvent.click(screen.getByText('Механика'))
    const list = screen.getByTestId('topics-list-view')
    expect(list).toHaveTextContent('Законы Ньютона')
    expect(list).not.toHaveTextContent('КР: Кинематика')
    expect(screen.getByText(/1 тема/)).toBeInTheDocument()
  })

  it('внутри модуля работ — те же работы списком: когда, без оценок; клик → страница темы', async () => {
    renderPage()
    fireEvent.click(worksCard())
    expect(screen.getByTestId('module-topics-count')).toHaveTextContent('2 работы в разделе')
    // Без «N из M тем» и прогресса раздела.
    expect(screen.queryByTestId('course-topics-counter')).toBeNull()
    const rows = within(screen.getByTestId('works-module-view')).getAllByTestId('works-module-row')
    expect(rows.map(r => r.getAttribute('data-view'))).toEqual(['list', 'list'])
    expect(rows[0].textContent).toBe('Проверочная работаПроверочная: Импульсвт 22 сент, 15:00–15:40')
    expect(rows[1]).toHaveTextContent('КР: Статикавремя ещё не назначено')
    expect(screen.queryByTestId('topic-signals')).toBeNull()
    fireEvent.click(rows[0])
    expect(await screen.findByText('страница темы')).toBeInTheDocument()
  })

  it('вид «карточки» — те же работы карточками, тоже без оценок', async () => {
    renderPage()
    fireEvent.click(worksCard())
    fireEvent.click(screen.getByTestId('view-toggle-cards'))
    const rows = within(screen.getByTestId('works-module-view')).getAllByTestId('works-module-row')
    expect(rows.map(r => r.getAttribute('data-view'))).toEqual(['cards', 'cards'])
    expect(rows[0]).toHaveTextContent('вт 22 сент, 15:00–15:40')
    expect(rows[0]).not.toHaveTextContent(/оценка|Пройдено|ДЗ/)
    fireEvent.click(rows[1])
    expect(await screen.findByText('страница темы')).toBeInTheDocument()
  })

  it('прогресс не трогаем: счётчик курса считает все темы, как раньше', () => {
    renderPage()
    expect(screen.getByTestId('course-topics-counter')).toHaveTextContent('5')
  })
})

describe('StudentCoursePage — без данных раздела', () => {
  it('RPC недоступна (миграции нет, сбой) — прежний блок «Пробники», темы на своих местах', () => {
    assessments = { status: 'error', data: null }
    renderPage()
    expect(screen.queryByTestId('assessments-section')).toBeNull()
    expect(screen.getByTestId('mock-exams-section')).toBeInTheDocument()
    expect(worksCard()).toHaveTextContent('Контрольные работы')
    fireEvent.click(screen.getByText('Механика'))
    expect(screen.getByTestId('topics-list-view')).toHaveTextContent('КР: Кинематика')
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
