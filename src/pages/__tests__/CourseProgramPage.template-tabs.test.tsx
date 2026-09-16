import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * §174. Каркас курса — без ученических вкладок: «Домашние задания»,
 * «Результаты тестов», «Ученики» живут в классах-копиях. Вместо них — строка
 * со ссылками на классы. `COURSE_TABS` не трогаем: `?tab=students` на каркасе
 * просто открывает «Программу курса».
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

const course = (over: Record<string, unknown>) => ({
  id: 'x', title: 'x', subject: 'physics', exam_type: 'ege', description: null,
  price: 0, duration_weeks: 36, is_active: true, is_draft: false,
  is_template: false, copied_from_course_id: null, owner_id: 'teacher-1',
  start_date: null, end_date: null, enrollment_open_until: null,
  ...over,
})

const COURSES = [
  course({ id: 'tpl', title: 'Физика ЕГЭ Шаблон', is_template: true }),
  course({ id: 'c10a', title: 'Физика ЕГЭ 10А', copied_from_course_id: 'tpl' }),
  course({ id: 'c11a', title: 'Физика ЕГЭ 11А', copied_from_course_id: 'tpl' }),
  // Архивная копия — не класс, куда идут смотреть учеников.
  course({ id: 'old', title: 'Физика ЕГЭ 2025', copied_from_course_id: 'tpl', is_active: false }),
  course({ id: 'lonely', title: 'Каркас без копий', is_template: true }),
  course({ id: 'plain', title: 'Обычный курс' }),
]

vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => makeChain({ data: [], error: null }), rpc: () => Promise.resolve({ data: [], error: null }) },
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
    courses: COURSES,
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
vi.mock('@/components/courseProgram/CourseStudentsSection', () => ({
  CourseStudentsSection: () => <div data-testid="students-section" />,
}))

import { CourseProgramPage } from '@/pages/CourseProgramPage'

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CourseProgramPage />
    </MemoryRouter>,
  )
}

const tabNames = () => screen.getAllByRole('tab').map(t => t.textContent)

describe('Каркас курса без ученических вкладок (§174)', () => {
  it('на каркасе нет вкладок «Домашние задания», «Результаты тестов», «Ученики»', () => {
    renderAt('/course-program?courseId=tpl')
    expect(tabNames()).toEqual(['Программа курса', 'Материалы', 'Настройки'])
  })

  it('в обычном курсе все вкладки на месте', () => {
    renderAt('/course-program?courseId=plain')
    expect(tabNames()).toEqual([
      'Программа курса', 'Материалы', 'Домашние задания', 'Результаты тестов', 'Ученики', 'Настройки',
    ])
    expect(screen.queryByTestId('template-classes-row')).not.toBeInTheDocument()
  })

  it('строка под шапкой перечисляет активные классы-копии ссылками на курс', () => {
    renderAt('/course-program?courseId=tpl')
    const row = screen.getByTestId('template-classes-row')
    expect(row).toHaveTextContent('Каркас курса: ученики, домашние задания и результаты — в классах:')

    const links = within(row).getAllByRole('link')
    // Короткие имена (§114), полные — подсказкой; архивной копии нет.
    expect(links.map(l => l.textContent)).toEqual(['10А', '11А'])
    expect(links[0]).toHaveAttribute('href', '/course-program?courseId=c10a')
    expect(links[0]).toHaveAttribute('title', 'Физика ЕГЭ 10А')
    expect(row).not.toHaveTextContent('2025')
  })

  it('каркас без копий — «копий курса пока нет»', () => {
    renderAt('/course-program?courseId=lonely')
    const row = screen.getByTestId('template-classes-row')
    expect(row).toHaveTextContent('копий курса пока нет')
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
  })

  it('?tab=students на каркасе открывает «Программу курса», а не ученический раздел', () => {
    renderAt('/course-program?courseId=tpl&tab=students')
    expect(screen.getByRole('tab', { name: 'Программа курса' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('students-section')).not.toBeInTheDocument()
  })

  it('?tab=students в обычном курсе по-прежнему открывает учеников', () => {
    renderAt('/course-program?courseId=plain&tab=students')
    expect(screen.getByRole('tab', { name: 'Ученики' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('students-section')).toBeInTheDocument()
  })
})
