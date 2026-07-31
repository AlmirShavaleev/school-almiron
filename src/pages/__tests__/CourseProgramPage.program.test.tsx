import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fromSpy = vi.fn()
const loadModulesSpy = vi.fn()
const createModuleSpy = vi.fn()
const createTopicSpy = vi.fn()
const saveModuleSpy = vi.fn()
const saveTopicSpy = vi.fn()
const { toastErrorSpy, toastSuccessSpy } = vi.hoisted(() => ({ toastErrorSpy: vi.fn(), toastSuccessSpy: vi.fn() }))

function makeChain(result: { data: unknown; error: { message?: string } | null }) {
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
  toast: { error: toastErrorSpy, success: toastSuccessSpy, info: vi.fn() },
}))

vi.mock('@/hooks/useCourseProgram', () => ({
  useCourseProgram: () => ({
    courses: [{ id: 'course-1', title: '10А', subject: 'physics', exam_type: 'ege', description: null, price: 0, duration_weeks: 36, is_active: true, owner_id: 'teacher-1', start_date: null, end_date: null, enrollment_open_until: null }],
    loading: false,
    loadModules: (...args: unknown[]) => loadModulesSpy(...args),
    saveCourse: vi.fn(),
    createCourse: vi.fn(),
    saveModule: (...args: unknown[]) => saveModuleSpy(...args),
    createModule: (...args: unknown[]) => createModuleSpy(...args),
    deleteModule: vi.fn(),
    saveTopic: (...args: unknown[]) => saveTopicSpy(...args),
    createTopic: (...args: unknown[]) => createTopicSpy(...args),
    deleteTopic: vi.fn(),
  }),
}))

vi.mock('@/hooks/useCourseHomeworkTemplates', () => ({
  useCourseHomeworkTemplates: () => ({ templates: [] }),
}))

vi.mock('@/components/modals/TopicMaterialsModal', () => ({ TopicMaterialsModal: () => null }))
vi.mock('@/components/modals/CreateHomeworkModal', () => ({ CreateHomeworkModal: () => null }))
vi.mock('@/components/modals/AddLessonTemplateToCourseModal', () => ({ AddLessonTemplateToCourseModal: () => null }))

import { CourseProgramPage } from '@/pages/CourseProgramPage'

const noModules: any[] = []
const moduleWithoutTopics = [
  {
    id: 'module-1',
    course_id: 'course-1',
    title: 'Модуль 1',
    order_index: 0,
    topics: [],
  },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <CourseProgramPage />
    </MemoryRouter>,
  )
}

async function openProgramForCourse() {
  renderPage()
  // Карточка курса теперь ссылка, а не кнопка (см. CourseCard).
  fireEvent.click(screen.getByRole('link', { name: /10А/i }))
  await waitFor(() => expect(loadModulesSpy).toHaveBeenCalledWith('course-1'))
}

describe('CourseProgramPage program tab empty states', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    loadModulesSpy.mockReset()
    createModuleSpy.mockReset()
    createTopicSpy.mockReset()
    saveModuleSpy.mockReset()
    saveTopicSpy.mockReset()
    toastErrorSpy.mockReset()
    toastSuccessSpy.mockReset()
    createModuleSpy.mockResolvedValue('module-new')
    createTopicSpy.mockResolvedValue('topic-new')
    saveModuleSpy.mockResolvedValue(undefined)
    saveTopicSpy.mockResolvedValue(undefined)
    fromSpy.mockImplementation((table: string) => {
      if (table === 'groups') return makeChain({ data: [], error: null })
      if (table === 'homeworks') return makeChain({ data: [], error: null })
      if (table === 'group_students') return makeChain({ data: [], error: null })
      if (table === 'homework_submissions') return makeChain({ data: [], error: null })
      return makeChain({ data: [], error: null })
    })
  })

  it('shows an add-module entry point when the course has no modules', async () => {
    loadModulesSpy.mockResolvedValue(noModules)

    await openProgramForCourse()

    await waitFor(() => expect(screen.getByText('В курсе пока нет модулей')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Добавить модуль/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Добавить модуль/i }))

    await waitFor(() => expect(createModuleSpy).toHaveBeenCalledWith('course-1', 'Новый модуль'))
  })

  it('shows add-topic control when a module exists but has no topics', async () => {
    loadModulesSpy.mockResolvedValue(moduleWithoutTopics)

    await openProgramForCourse()

    await waitFor(() => expect(screen.getByRole('button', { name: /Редактировать программу/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Редактировать программу/i }))

    await waitFor(() => expect(screen.getByText('Перетащите тему сюда')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Добавить тему/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Добавить тему/i }))

    await waitFor(() => expect(createTopicSpy).toHaveBeenCalledWith('module-1', 'Новая тема'))
  })

  it('shows a homework stats hint when the course has topics but no groups', async () => {
    loadModulesSpy.mockResolvedValue([
      {
        id: 'module-1',
        course_id: 'course-1',
        title: 'Модуль 1',
        order_index: 0,
        topics: [
          { id: 'topic-1', module_id: 'module-1', title: 'Тема 1', order_index: 0, max_score: 100, available_from: null },
        ],
      },
    ])

    await openProgramForCourse()

    await waitFor(() => expect(screen.getByText('У курса пока нет групп. Сводка по домашним заданиям показана с нулевыми значениями.')).toBeInTheDocument())
    expect(screen.getByText('Тема 1')).toBeInTheDocument()
  })

  it('shows module and topic numbers from array position in view and edit modes', async () => {
    loadModulesSpy.mockResolvedValue([
      {
        id: 'module-1',
        course_id: 'course-1',
        title: 'Механика',
        order_index: 7,
        topics: [
          { id: 'topic-1', module_id: 'module-1', title: 'Кинематика', order_index: 4, max_score: 100, available_from: null },
          { id: 'topic-2', module_id: 'module-1', title: 'Динамика', order_index: 4, max_score: 100, available_from: null },
        ],
      },
    ])

    await openProgramForCourse()

    await waitFor(() => expect(screen.getByText('Механика')).toBeInTheDocument())
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByText('1.1')).toBeInTheDocument()
    expect(screen.getByText('1.2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Редактировать программу/i }))

    await waitFor(() => expect(screen.getAllByText('1.').length).toBeGreaterThan(0))
    expect(screen.getByText('1.1')).toBeInTheDocument()
    expect(screen.getByText('1.2')).toBeInTheDocument()
  })

  it('saves topic title on blur and shows success toast', async () => {
    loadModulesSpy.mockResolvedValue([
      {
        id: 'module-1',
        course_id: 'course-1',
        title: 'Модуль 1',
        order_index: 0,
        topics: [
          { id: 'topic-1', module_id: 'module-1', title: 'Старая тема', order_index: 0, max_score: 100, available_from: null },
        ],
      },
    ])

    await openProgramForCourse()

    fireEvent.click(screen.getByRole('button', { name: /Редактировать программу/i }))
    await waitFor(() => expect(screen.getByText('Старая тема')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Старая тема'))
    const input = await screen.findByDisplayValue('Старая тема')
    fireEvent.change(input, { target: { value: 'Новое название' } })
    fireEvent.blur(input)

    await waitFor(() => expect(saveTopicSpy).toHaveBeenCalledWith('topic-1', { title: 'Новое название' }))
    expect(toastSuccessSpy).toHaveBeenCalledWith('Название сохранено')
  })
})
