import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

/**
 * §249. Вкладки курса у персонала: «Результатов тестов» нет, на их месте —
 * «Проверочные и контрольные»; старый адрес `?tab=testresults` открывает её;
 * сводка §241 над программой больше не стоит (она — во вкладке).
 */

function makeChain(result: { data: unknown; error: { message?: string } | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') { const p = Promise.resolve(result); return p.then.bind(p) }
      return () => chain
    },
  })
  return chain
}

const NOW = new Date().toISOString()
const rpcSpy = vi.fn((fn: string) => {
  if (fn === 'course_assessments_summary') {
    return Promise.resolve({ data: {
      server_now: NOW, is_template: false, group_id: 'g1', group_name: '10А', in_class: 1, mocks: [],
      works: [{ topic_id: 'kr', kind: 'control', title: 'Контрольная по механике', published: true, opens_at: NOW, closes_at: NOW, grade_scale: 'five', status: 'done', submitted: 1, pending: 0, reviewed: 1, avg_score: 5, writing: 0, personal_live: 0 }],
    }, error: null })
  }
  if (fn === 'course_assessment_grades') {
    return Promise.resolve({ data: {
      server_now: NOW, is_template: false, group_id: 'g1', group_name: '10А',
      students: [{ student_id: 's1', name: 'Ученик Первый' }],
      works: [{ topic_id: 'kr', kind: 'control', title: 'Контрольная по механике', opens_at: NOW, closes_at: NOW, grade_scale: 'five' }],
      cells: [{ topic_id: 'kr', student_id: 's1', status: 'reviewed', score: 5, attempt_id: 'a1', attempt_number: 1 }],
    }, error: null })
  }
  return Promise.resolve({ data: [], error: null })
})

vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => makeChain({ data: [], error: null }), rpc: (fn: string) => rpcSpy(fn) },
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string; role: string } }) => unknown) =>
    selector({ profile: { id: 'teacher-1', role: 'teacher' } }),
}))
vi.mock('@/store/toastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), saved: vi.fn() },
}))
vi.mock('@/hooks/useCourseProgram', () => ({
  useCourseProgram: () => ({
    courses: [{
      id: 'c1', title: 'Физика ЕГЭ 10А', subject: 'physics', exam_type: 'ege', description: null, price: 0, duration_weeks: 36,
      is_active: true, is_draft: false, is_template: false, copied_from_course_id: null, owner_id: 'teacher-1',
      start_date: null, end_date: null, enrollment_open_until: null,
    }],
    loading: false,
    loadModules: vi.fn().mockResolvedValue([]),
    saveCourse: vi.fn(), createCourse: vi.fn(),
    saveModule: vi.fn(), createModule: vi.fn(), deleteModule: vi.fn(),
    saveTopic: vi.fn(), createTopic: vi.fn(), deleteTopic: vi.fn(),
  }),
}))
vi.mock('@/hooks/useCourseHomeworkTemplates', () => ({ useCourseHomeworkTemplates: () => ({ templates: [] }) }))
vi.mock('@/components/modals/TopicMaterialsModal', () => ({ TopicMaterialsModal: () => null }))
vi.mock('@/components/modals/AddLessonTemplateToCourseModal', () => ({ AddLessonTemplateToCourseModal: () => null }))

import { CourseProgramPage } from '@/pages/CourseProgramPage'

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.search}</div>
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CourseProgramPage />
      <Where />
    </MemoryRouter>,
  )
}

const tabNames = () => screen.getAllByRole('tab').map(t => t.textContent)

beforeEach(() => rpcSpy.mockClear())

describe('Вкладка «Проверочные и контрольные» (§249)', () => {
  it('«Результатов тестов» нет; новая вкладка — после «Домашних заданий»', () => {
    renderAt('/course-program?courseId=c1')
    // §250: первой — «Курс», «Программа курса» переименована в «Сроки и статистика».
    expect(tabNames()).toEqual(['Курс', 'Сроки и статистика', 'Материалы', 'Домашние задания', 'Проверочные и контрольные', 'Ученики', 'Настройки'])
    expect(tabNames()).not.toContain('Результаты тестов')
  })

  it('старый адрес ?tab=testresults открывает «Проверочные и контрольные» с журналом', async () => {
    renderAt('/course-program?courseId=c1&tab=testresults')
    expect(screen.getByRole('tab', { name: 'Проверочные и контрольные' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByTestId('assessments-tab')).toBeInTheDocument()
    expect(await screen.findByTestId('grades-table')).toHaveTextContent('Ученик Первый')
    expect(screen.getByTestId('grades-table')).toHaveTextContent('Контрольная по механике')
  })

  it('сводки §241 над программой больше нет — и её RPC программа не зовёт', async () => {
    // §250: программа — во вкладке «Сроки и статистика» (ключ прежний, program).
    renderAt('/course-program?courseId=c1&tab=program')
    // Дождаться загрузки программы: пустой курс показывает «В курсе пока нет модулей».
    expect(await screen.findByText('В курсе пока нет модулей')).toBeInTheDocument()
    expect(screen.queryByTestId('course-assessments')).not.toBeInTheDocument()
    expect(screen.queryByTestId('assessments-tab')).not.toBeInTheDocument()
    expect(rpcSpy.mock.calls.map(c => c[0])).not.toContain('course_assessments_summary')
  })

  it('клик по вкладке пишет ключ в адрес; сводка с работами — во вкладке', async () => {
    renderAt('/course-program?courseId=c1')
    fireEvent.click(screen.getByRole('tab', { name: 'Проверочные и контрольные' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('tab=assessments'))
    expect(await screen.findByTestId('assessments-works')).toHaveTextContent('Контрольная по механике')
  })
})
