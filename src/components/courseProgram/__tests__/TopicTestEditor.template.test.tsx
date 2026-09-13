import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * §172. Задачи темы-отражения задаются в каркасе.
 *
 * В классе их видно, но не правят: ни «Подобрать в каталоге», ни стрелок, ни
 * крестика. Причина — не техническая: локальная правка тихо делает из отражения
 * своё, и через месяц никто не помнит, почему в 10А другой набор.
 */

const rpcSpy = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => rpcSpy(fn, args),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  },
}))

vi.mock('@/hooks/useTopicTest', () => ({
  useTopicTestAssignment: () => ({
    assignment: null, hasAttempts: false, loading: false, error: null, attach: vi.fn(), detach: vi.fn(),
  }),
  useTestBank: () => ({ tests: [], loading: false }),
}))

vi.mock('@/hooks/useVariantTopicAttach', () => ({
  useTopicVariantAttachment: () => ({
    attached: [], groups: [], loading: false, error: null, busy: false, attach: vi.fn(), detach: vi.fn(),
  }),
}))

vi.mock('@/hooks/useTopicTaskProgress', () => ({
  useTopicTaskProgress: () => null,
}))

vi.mock('@/store/toastStore', () => ({
  toast: { saved: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { TopicTestEditor } from '@/components/courseProgram/TopicTestEditor'

const TASKS = [
  {
    item_id: 'i1', item_position: 1, task_id: 't1', external_id: '1001',
    statement_html: '<p>Задача из каркаса</p>', exam_part: 1, max_points: 1,
    auto_checkable: true, answers_count: 0, closed_count: 0,
  },
]

function mockRpc(link: Record<string, unknown>) {
  rpcSpy.mockImplementation((fn: string) => {
    if (fn === 'topic_tasks_for_staff')  return Promise.resolve({ data: TASKS, error: null })
    if (fn === 'topic_template_link')    return Promise.resolve({ data: link, error: null })
    return Promise.resolve({ data: null, error: null })
  })
}

const renderEditor = () => render(
  <MemoryRouter>
    <TopicTestEditor topicId="copy-1" />
  </MemoryRouter>
)

describe('Задачи темы-отражения (§172)', () => {
  beforeEach(() => { rpcSpy.mockReset() })

  it('в классе вместо подбора — дорога в шаблон', async () => {
    mockRpc({ is_template: false, source_topic_id: 'tpl-1', source_course: 'Физика ЕГЭ Шаблон', copies: [], issues: [] })
    renderEditor()

    const link = await screen.findByTestId('tasks-in-template')
    expect(link).toHaveTextContent('Задачи задаются в шаблоне')
    expect(link).toHaveAttribute('href', '/course-program?materialsTopic=tpl-1&tile=test')
    expect(screen.queryByTestId('pick-in-catalog')).not.toBeInTheDocument()
  })

  it('в классе нет ни порядка, ни снятия задачи', async () => {
    mockRpc({ is_template: false, source_topic_id: 'tpl-1', source_course: null, copies: [], issues: [] })
    renderEditor()

    await screen.findByTestId('topic-tasks-staff')
    expect(screen.queryByTitle('Выше')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Ниже')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Убрать из темы')).not.toBeInTheDocument()
    expect(screen.getByTestId('topic-tasks-staff')).toHaveTextContent('из шаблона')
  })

  it('в самом каркасе всё на месте: подбор, порядок, снятие', async () => {
    mockRpc({ is_template: true, source_topic_id: null, source_course: null, copies: [{ topic_id: 'c1', course: '10А' }], issues: [] })
    renderEditor()

    await screen.findByTestId('topic-tasks-staff')
    expect(screen.getByTestId('pick-in-catalog')).toBeInTheDocument()
    expect(screen.getByTitle('Убрать из темы')).toBeInTheDocument()
    expect(screen.queryByTestId('tasks-in-template')).not.toBeInTheDocument()
  })

  it('тема без каркаса работает как раньше', async () => {
    mockRpc({ is_template: false, source_topic_id: null, source_course: null, copies: [], issues: [] })
    renderEditor()

    await screen.findByTestId('topic-tasks-staff')
    expect(screen.getByTestId('pick-in-catalog')).toBeInTheDocument()
    expect(screen.getByTitle('Выше')).toBeInTheDocument()
  })
})
