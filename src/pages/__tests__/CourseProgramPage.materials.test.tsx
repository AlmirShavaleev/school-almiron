import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fromSpy = vi.fn()
const loadModulesSpy = vi.fn()

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
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
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
    deleteTopic: vi.fn(),
  }),
}))

vi.mock('@/components/modals/TopicMaterialsModal', () => ({
  TopicMaterialsModal: ({ open, topicTitle, moduleTitle }: { open: boolean; topicTitle: string; moduleTitle: string }) => (
    open ? <div data-testid="topic-materials-modal">{topicTitle} / {moduleTitle}</div> : null
  ),
}))
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

const emptyModules = [
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

async function openMaterialsTab() {
  renderPage()
  // Карточка курса теперь ссылка, а не кнопка: обычный клик проваливает в
  // курс, Ctrl+клик открывает его в новой вкладке браузера.
  fireEvent.click(screen.getByRole('link', { name: /Физика/i }))
  await waitFor(() => expect(loadModulesSpy).toHaveBeenCalledWith('course-1'))
  await waitFor(() => expect(screen.getByText('Модуль 1')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('tab', { name: /Материалы/i }))
}

describe('CourseProgramPage materials tab', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    loadModulesSpy.mockReset()
    loadModulesSpy.mockResolvedValue(modules)
  })

  it('keeps the topics table visible when there are topics but no materials', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'groups') return makeChain({ data: [], error: null })
      if (table === 'topic_materials') return makeChain({ data: [], error: null })
      return makeChain({ data: [], error: null })
    })

    await openMaterialsTab()

    await waitFor(() => expect(screen.getByText(/Материалов пока нет\./)).toBeInTheDocument())
    expect(screen.getByText('Тема 1')).toBeInTheDocument()
    expect(screen.getByText('Модуль 1')).toBeInTheDocument()
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument()
  })

  it('opens the same topic materials modal when a topic row is clicked', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'groups') return makeChain({ data: [], error: null })
      if (table === 'topic_materials') return makeChain({ data: [], error: null })
      return makeChain({ data: [], error: null })
    })

    await openMaterialsTab()
    await waitFor(() => expect(screen.getByText('Тема 1')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Тема 1'))

    await waitFor(() => expect(screen.getByTestId('topic-materials-modal')).toHaveTextContent('Тема 1 / Модуль 1'))
  })

  it('shows an error banner when materials query fails but keeps the topics table visible', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'groups') return makeChain({ data: [], error: null })
      if (table === 'topic_materials') return makeChain({ data: null, error: { message: 'db failed' } })
      return makeChain({ data: [], error: null })
    })

    await openMaterialsTab()

    await waitFor(() => expect(screen.getByText('Не удалось загрузить материалы курса')).toBeInTheDocument())
    expect(screen.getByText('Тема 1')).toBeInTheDocument()
    expect(screen.getByText('Модуль 1')).toBeInTheDocument()
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument()
  })

  it('shows a full empty state and links back to the program when there are no topics', async () => {
    loadModulesSpy.mockResolvedValue(emptyModules)
    fromSpy.mockImplementation((table: string) => {
      if (table === 'groups') return makeChain({ data: [], error: null })
      return makeChain({ data: [], error: null })
    })

    await openMaterialsTab()

    await waitFor(() => expect(screen.getByText('Материалов пока нет')).toBeInTheDocument())
    expect(screen.getByText('Сначала добавьте в курс модули и темы, чтобы их можно было наполнить материалами.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Перейти к программе/i }))

    await waitFor(() => expect(screen.getByRole('tab', { name: /Программа курса/i })).toHaveClass('border-primary-600'))
  })
})
