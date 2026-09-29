import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const rpcSpy = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => fromSpy(table), rpc: (fn: string, args: unknown) => rpcSpy(fn, args) },
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
vi.mock('@/components/modals/AddLessonTemplateToCourseModal', () => ({ AddLessonTemplateToCourseModal: () => null }))

import { CourseProgramPage } from '@/pages/CourseProgramPage'

// §242. Вкладка «Программа курса» у персонала: над программой — статистика
// курса, в таблице тем — новые столбцы вместо «Шаблоны / Назначения /
// Последнее назначение». Без миграции (RPC отвечает ошибкой) — прежняя таблица.
const MODULES = [{
  id: 'module-1', course_id: 'course-1', title: 'Механика', order_index: 0,
  topics: [{ id: 'topic-1', module_id: 'module-1', title: 'Кинематика', order_index: 0, max_score: 100, available_from: null, is_open: true }],
}]

function stats(fn: string, args: { p_period: string }) {
  if (fn === 'course_stats_summary') {
    return { data: {
      period: args.p_period, from: null, to: '2026-09-29', in_class: 2, active: 1, views: 3, views_prev: 1,
      video_seconds: 600, video_done: 1, submitted: 1, accepted: 1, returned: 0, pending: 0, pending_oldest_at: null,
      avg_five: 5, avg_five_count: 1, avg_hundred: null, avg_hundred_count: 0,
      days: [{ day: '2026-09-29', active: 1 }], quiet: [], no_hw_14: [],
    }, error: null }
  }
  if (fn === 'course_stats_topics') {
    return { data: { period: args.p_period, in_class: 2, topics: [
      { topic_id: 'topic-1', timed: false, opened: 1, videos: 1, video_done: 1, video_started: 0, hw: true, grade_scale: 'five', submitted: 1, avg_score: 5, pending: 0 },
    ] }, error: null }
  }
  return { data: null, error: { message: 'not found' } }
}

async function openCourse() {
  render(<MemoryRouter><CourseProgramPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('link', { name: /10А/i }))
  await waitFor(() => expect(loadModulesSpy).toHaveBeenCalledWith('course-1'))
}

describe('CourseProgramPage — статистика курса (§242)', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    loadModulesSpy.mockReset()
    rpcSpy.mockReset()
    localStorage.clear()
    fromSpy.mockImplementation(() => makeChain({ data: [], error: null }))
    loadModulesSpy.mockResolvedValue(MODULES)
  })

  it('панель над программой и новые столбцы вместо старых', async () => {
    rpcSpy.mockImplementation((fn: string, args: { p_period: string }) => Promise.resolve(stats(fn, args)))
    await openCourse()
    expect(await screen.findByTestId('course-stats')).toHaveTextContent('Статистика курса · 2 ученика')
    const row = await screen.findByTestId('stats-topic-row')
    await waitFor(() => expect(within(row).getByTestId('stat-opened')).toHaveAttribute('data-value', '1/2'))
    expect(screen.getByRole('columnheader', { name: 'Видео досмотрели' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Шаблоны' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Последнее назначение' })).not.toBeInTheDocument()
    // Название темы по-прежнему открывает окно темы, а не раскрытие.
    expect(within(row).getByRole('button', { name: 'Кинематика' })).toBeInTheDocument()
  })

  it('RPC статистики нет — прежняя таблица программы', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'Could not find the function' } })
    await openCourse()
    expect(await screen.findByRole('columnheader', { name: 'Шаблоны' })).toBeInTheDocument()
    expect(screen.getByText('Кинематика')).toBeInTheDocument()
    expect(screen.queryByTestId('course-stats')).not.toBeInTheDocument()
  })

  it('в режиме редактирования статистики нет', async () => {
    rpcSpy.mockImplementation((fn: string, args: { p_period: string }) => Promise.resolve(stats(fn, args)))
    await openCourse()
    await screen.findByTestId('course-stats')
    fireEvent.click(screen.getByRole('button', { name: /Редактировать программу/i }))
    await waitFor(() => expect(screen.queryByTestId('course-stats')).not.toBeInTheDocument())
  })
})
