import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * §113. Шаблон — главная карточка, его копии рядом под ним. Проверяем не форму
 * раскладки (её считает `courseGrouping` со своими тестами), а то, что страница
 * действительно рисует копию ПОД шаблоном, показывает бейдж и сохраняет
 * галочку «Это шаблон».
 */

const saveCourseSpy = vi.fn()

function makeChain(result: { data: unknown; error: { message?: string } | null }) {
  const chain: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        const p = Promise.resolve(result)
        return p.then.bind(p)
      }
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
  // Как на проде: копия — неактивный ЧЕРНОВИК. Ключуйся архив по is_active,
  // она уехала бы туда, и полка под шаблоном опустела бы.
  course({ id: 'copy', title: 'Физика ЕГЭ 11А класс', is_draft: true, is_active: false, copied_from_course_id: 'tpl' }),
  course({ id: 'plain', title: 'Курс сам по себе' }),
  course({ id: 'old', title: 'Убранный курс', is_active: false }),
]

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => makeChain({ data: [], error: null }) } }))

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
    saveCourse: (...args: unknown[]) => saveCourseSpy(...args),
    createCourse: vi.fn(),
    saveModule: vi.fn(), createModule: vi.fn(), deleteModule: vi.fn(),
    saveTopic: vi.fn(), createTopic: vi.fn(), deleteTopic: vi.fn(),
  }),
}))

vi.mock('@/hooks/useCourseHomeworkTemplates', () => ({ useCourseHomeworkTemplates: () => ({ templates: [] }) }))
vi.mock('@/components/modals/TopicMaterialsModal', () => ({ TopicMaterialsModal: () => null }))
vi.mock('@/components/modals/CreateHomeworkModal', () => ({ CreateHomeworkModal: () => null }))
vi.mock('@/components/modals/AddLessonTemplateToCourseModal', () => ({ AddLessonTemplateToCourseModal: () => null }))

import { CourseProgramPage } from '@/pages/CourseProgramPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <CourseProgramPage />
    </MemoryRouter>,
  )
}

describe('Список курсов: шаблон и его копии (§113)', () => {
  beforeEach(() => {
    saveCourseSpy.mockReset().mockResolvedValue(undefined)
  })

  it('копия рисуется в ветви под своим шаблоном', () => {
    renderPage()

    const shelf = screen.getByTestId('course-copies-of-tpl')
    // §114: в списке у копии короткое имя — общая с шаблоном часть отброшена.
    expect(within(shelf).getByText('11А класс')).toBeInTheDocument()
    expect(within(shelf).queryByText('Курс сам по себе')).not.toBeInTheDocument()
  })

  it('полное название копии остаётся подсказкой — короткое имя только вид', () => {
    renderPage()

    const shelf = screen.getByTestId('course-copies-of-tpl')
    expect(within(shelf).getByRole('link', { name: /11А класс/ }))
      .toHaveAttribute('title', 'Физика ЕГЭ 11А класс')
  })

  it('ветвь копий сворачивается и разворачивается нажатием', () => {
    renderPage()

    const toggle = screen.getByRole('button', { name: /Копии · 1/ })
    // По умолчанию развёрнуто: копия одна, прятать её незачем.
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('11А класс')).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('11А класс')).not.toBeInTheDocument()
    // Счётчик виден и в свёрнутом виде — иначе не понять, что там что-то есть.
    expect(screen.getByRole('button', { name: /Копии · 1/ })).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByText('11А класс')).toBeInTheDocument()
  })

  it('у шаблона бейдж «шаблон», у копии-черновика — «черновик»', () => {
    renderPage()

    expect(screen.getByText('шаблон')).toBeInTheDocument()
    expect(screen.getByText('черновик')).toBeInTheDocument()
  })

  it('копия-черновик НЕ уезжает в архив: там только убранное осознанно', () => {
    renderPage()

    expect(screen.getByText(/Архив · 1/)).toBeInTheDocument()
    expect(screen.getByText('Убранный курс')).toBeInTheDocument()
  })

  it('отдельной секции «Черновики» больше нет', () => {
    renderPage()

    expect(screen.queryByText(/Черновики ·/)).not.toBeInTheDocument()
  })

  it('курс без родства — обычной карточкой, не на полке', () => {
    renderPage()

    const shelf = screen.getByTestId('course-copies-of-tpl')
    expect(within(shelf).queryByText('Курс сам по себе')).not.toBeInTheDocument()
    expect(screen.getByText('Курс сам по себе')).toBeInTheDocument()
  })

  it('галочка «Это шаблон» сохраняется вместе с остальными настройками', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('link', { name: /Курс сам по себе/i }))
    fireEvent.click(await screen.findByRole('tab', { name: /Настройки/i }))

    const checkbox = await screen.findByTestId('course-is-template')
    expect(checkbox).not.toBeChecked()
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/i }))

    await waitFor(() => expect(saveCourseSpy).toHaveBeenCalled())
    expect(saveCourseSpy.mock.calls[0][1]).toMatchObject({ is_template: true })
  })

  it('пояснение под галочкой на месте — иначе «шаблон» читается как право', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('link', { name: /Курс сам по себе/i }))
    fireEvent.click(await screen.findByRole('tab', { name: /Настройки/i }))

    expect(await screen.findByText('Шаблон — каркас. Учеников зачисляют в копии, не в шаблон.'))
      .toBeInTheDocument()
  })
})
