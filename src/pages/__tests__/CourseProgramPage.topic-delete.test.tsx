import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fromSpy = vi.fn()
const deleteTopicSpy = vi.fn()
const loadModulesSpy = vi.fn()
const { toastErrorSpy } = vi.hoisted(() => ({ toastErrorSpy: vi.fn() }))

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        const p = Promise.resolve(result)
        return p.then.bind(p)
      }
      return () => chain
    },
  })
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string; role: string } }) => unknown) =>
    selector({ profile: { id: 'teacher-1', role: 'teacher' } }),
}))

vi.mock('@/store/toastStore', () => ({
  toast: { error: toastErrorSpy, success: vi.fn(), info: vi.fn() },
}))

vi.mock('@/hooks/useCourseProgram', () => ({
  useCourseProgram: () => ({
    courses: [{ id: 'course-1', title: 'Физика', subject: 'physics', exam_type: 'ege', description: null, price: 0, duration_weeks: 36, is_active: true, owner_id: null, start_date: null, end_date: null, enrollment_open_until: null }],
    loading: false,
    loadModules: (...args: unknown[]) => loadModulesSpy(...args),
    saveCourse: vi.fn(),
    createCourse: vi.fn(),
    saveModule: vi.fn(),
    createModule: vi.fn(),
    deleteModule: vi.fn(),
    saveTopic: vi.fn(),
    createTopic: vi.fn(),
    deleteTopic: (...args: unknown[]) => deleteTopicSpy(...args),
  }),
}))

// Запрет на удаление темы считается по шаблонам и назначениям ДЗ (Homework V2),
// а не по легаси-таблице `homeworks`, как было раньше. Поэтому мок стал
// настраиваемым: тест про запрет кладёт сюда шаблон на нужную тему.
const templatesState: { rows: Array<{ topic_id: string | null; assignments_count: number; last_assigned_at: string | null }> } = { rows: [] }
vi.mock('@/hooks/useCourseHomeworkTemplates', () => ({
  useCourseHomeworkTemplates: () => ({ templates: templatesState.rows }),
}))

vi.mock('@/components/modals/TopicMaterialsModal', () => ({ TopicMaterialsModal: () => null }))
vi.mock('@/components/modals/CreateHomeworkModal', () => ({ CreateHomeworkModal: () => null }))
vi.mock('@/components/modals/AddLessonTemplateToCourseModal', () => ({ AddLessonTemplateToCourseModal: () => null }))

import { CourseProgramPage } from '@/pages/CourseProgramPage'

const modules = [
  {
    id: 'module-1',
    course_id: 'course-1',
    title: 'Модуль 1',
    order_index: 0,
    topics: [
      {
        id: 'topic-1',
        module_id: 'module-1',
        title: 'Тема 1',
        order_index: 0,
        max_score: 100,
        available_from: null,
      },
    ],
  },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <CourseProgramPage />
    </MemoryRouter>,
  )
}

async function openCourseInEditMode() {
  renderPage()
  // Карточка курса теперь ссылка, а не кнопка (см. CourseCard).
  fireEvent.click(screen.getByRole('link', { name: /Физика/i }))
  await waitFor(() => expect(loadModulesSpy).toHaveBeenCalledWith('course-1'))
  await waitFor(() => expect(screen.getByText('Модуль 1')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /Редактировать программу/i }))
  await waitFor(() => expect(screen.getByTitle(/Удалить тему|В теме \d+ шаблона? или назначения? ДЗ/)).toBeInTheDocument())
}

describe('CourseProgramPage topic deletion', () => {
  beforeEach(() => {
    templatesState.rows = []
    fromSpy.mockReset()
    deleteTopicSpy.mockReset()
    loadModulesSpy.mockReset()
    toastErrorSpy.mockReset()

    loadModulesSpy.mockResolvedValue(modules)
    deleteTopicSpy.mockResolvedValue(1)
  })

  it('disables topic deletion in UI when visible homeworks exist', async () => {
    // Два «домашних задания» на теме — это один шаблон и одно назначение.
    templatesState.rows = [{ topic_id: 'topic-1', assignments_count: 1, last_assigned_at: null }]
    fromSpy.mockImplementation((table: string) => {
      if (table === 'groups') return makeChain({ data: [], error: null })
      return makeChain({ data: [], error: null })
    })

    await openCourseInEditMode()

    // Текст подсказки изменился вместе с источником счёта: теперь он говорит
    // про шаблоны и назначения и отправляет во вкладку «Домашние задания».
    const deleteButton = screen.getByTitle(/В теме \d+ шаблона? или назначения? ДЗ\./) as HTMLButtonElement
    expect(deleteButton.disabled).toBe(true)
    fireEvent.click(deleteButton)
    expect(deleteTopicSpy).not.toHaveBeenCalled()
  })

  it('shows a friendly message for 23503 foreign key violation', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'groups') return makeChain({ data: [], error: null })
      if (table === 'homeworks') return makeChain({ data: [], error: null })
      return makeChain({ data: [], error: null })
    })
    deleteTopicSpy.mockRejectedValue({ code: '23503', message: 'insert or update on table' })

    await openCourseInEditMode()

    fireEvent.click(screen.getByTitle('Удалить тему'))

    await waitFor(() => expect(deleteTopicSpy).toHaveBeenCalledWith('topic-1'))
    expect(toastErrorSpy).toHaveBeenCalledWith('В теме есть домашние задания, удаление невозможно')
  })

  it('shows a friendly message for insufficient permissions', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'groups') return makeChain({ data: [], error: null })
      if (table === 'homeworks') return makeChain({ data: [], error: null })
      return makeChain({ data: [], error: null })
    })
    deleteTopicSpy.mockRejectedValue({ code: '42501', message: 'new row violates row-level security policy' })

    await openCourseInEditMode()

    fireEvent.click(screen.getByTitle('Удалить тему'))

    await waitFor(() => expect(deleteTopicSpy).toHaveBeenCalledWith('topic-1'))
    expect(toastErrorSpy).toHaveBeenCalledWith('Недостаточно прав')
  })

  it('shows a friendly message when delete affects zero rows', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'groups') return makeChain({ data: [], error: null })
      if (table === 'homeworks') return makeChain({ data: [], error: null })
      return makeChain({ data: [], error: null })
    })
    deleteTopicSpy.mockResolvedValue(0)

    await openCourseInEditMode()

    fireEvent.click(screen.getByTitle('Удалить тему'))

    await waitFor(() => expect(deleteTopicSpy).toHaveBeenCalledWith('topic-1'))
    expect(toastErrorSpy).toHaveBeenCalledWith('Недостаточно прав для удаления темы')
  })
})
