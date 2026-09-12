import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * §164. Раздел «Задачи» на теме: вход в каталог вместо модалки, состав набора,
 * порядок и снятие задачи.
 *
 * Модалка выбора готового тестирования убрана — два входа к одному держать
 * нельзя, а неудобным был именно этот. Проверяем, что её нет, а то, что уже
 * было привязано, никуда не делось.
 */

const rpcSpy = vi.fn()
const navigateSpy = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => rpcSpy(fn, args),
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({
          data: { id: 'topic-1', title: 'Равноускоренное движение', modules: { course_id: 'c1', courses: { title: 'Физика ЕГЭ 11А' } } },
          error: null,
        }) }),
      }),
    }),
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateSpy }
})

vi.mock('@/hooks/useTopicTest', () => ({
  useTopicTestAssignment: () => ({
    assignment: null, hasAttempts: false, loading: false, error: null,
    attach: vi.fn(), detach: vi.fn(),
  }),
  useTestBank: () => ({ tests: [], loading: false }),
}))

vi.mock('@/hooks/useVariantTopicAttach', () => ({
  useTopicVariantAttachment: () => ({
    attached: [], groups: [], loading: false, error: null, busy: false,
    attach: vi.fn(), detach: vi.fn(),
  }),
}))

vi.mock('@/hooks/useTopicTaskProgress', () => ({
  useTopicTaskProgress: () => ({
    tasks_total: 2, students_total: 16, students_started: 12,
    students_done: 3, closed_auto: 20, closed_self: 4,
  }),
}))

vi.mock('@/store/toastStore', () => ({
  toast: { saved: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { TopicTestEditor } from '@/components/courseProgram/TopicTestEditor'
import { useAttachTargetStore } from '@/store/attachStore'

const TASKS = [
  {
    item_id: 'i1', item_position: 1, task_id: 't1', external_id: '1001',
    statement_html: '<p>Тело движется равноускоренно…</p>', exam_part: 1, max_points: 1,
    auto_checkable: true, answers_count: 0, closed_count: 0,
  },
  {
    item_id: 'i2', item_position: 2, task_id: 't2', external_id: '1002',
    statement_html: '<p>Докажите, что…</p>', exam_part: 2, max_points: 3,
    auto_checkable: false, answers_count: 4, closed_count: 1,
  },
]

describe('Раздел «Задачи» на теме (§164)', () => {
  beforeEach(() => {
    rpcSpy.mockReset()
    navigateSpy.mockReset()
    window.localStorage.clear()
    useAttachTargetStore.getState().clearTarget()
    rpcSpy.mockImplementation((fn: string) =>
      fn === 'topic_tasks_for_staff'
        ? Promise.resolve({ data: TASKS, error: null })
        : Promise.resolve({ data: null, error: null })
    )
  })

  const renderEditor = () => render(
    <MemoryRouter>
      <TopicTestEditor topicId="topic-1" />
    </MemoryRouter>
  )

  it('модалки выбора тестирования больше нет — вместо неё вход в каталог', async () => {
    renderEditor()
    await screen.findByTestId('topic-tasks-staff')

    expect(screen.queryByText('Привязать тестирование')).not.toBeInTheDocument()
    expect(screen.getByTestId('pick-in-catalog')).toHaveTextContent('Подобрать в каталоге')
    // Тест из банка — чужая механика, её не трогали.
    expect(screen.getByText('Прикрепить тест из банка')).toBeInTheDocument()
  })

  it('«Подобрать в каталоге» запоминает тему и уводит в каталог', async () => {
    renderEditor()
    await screen.findByTestId('topic-tasks-staff')

    fireEvent.click(screen.getByTestId('pick-in-catalog'))

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/catalog?attachTo=topic-1'))
    expect(useAttachTargetStore.getState().target).toEqual({
      topicId: 'topic-1',
      topicTitle: 'Равноускоренное движение',
      courseTitle: 'Физика ЕГЭ 11А',
      returnTo: '/course-program?courseId=c1&materialsTopic=topic-1&tile=test',
    })
  })

  it('видно, что прикреплено и как это решают', async () => {
    renderEditor()
    const block = await screen.findByTestId('topic-tasks-staff')

    expect(block).toHaveTextContent('Задач к уроку: 2')
    expect(block).toHaveTextContent('решают 12 из 16')
    expect(block).toHaveTextContent('автопроверка')
    expect(block).toHaveTextContent('самопроверка по решению')
  })

  it('порядок меняется соседями: у первой нет «выше», у последней — «ниже»', async () => {
    renderEditor()
    await screen.findByTestId('topic-tasks-staff')

    const up   = screen.getAllByTitle('Выше')
    const down = screen.getAllByTitle('Ниже')
    expect(up[0]).toBeDisabled()
    expect(down[1]).toBeDisabled()

    fireEvent.click(down[0])
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('topic_task_move_item', {
      p_topic_id: 'topic-1', p_item_id: 'i1', p_delta: 1,
    }))
  })

  it('задачу без ответов снимает сразу, с ответами — только после подтверждения', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    rpcSpy.mockImplementation((fn: string, args: { p_item_id?: string; p_force?: boolean }) => {
      if (fn === 'topic_tasks_for_staff') return Promise.resolve({ data: TASKS, error: null })
      if (fn === 'topic_task_detach_item' && args.p_item_id === 'i2' && !args.p_force) {
        return Promise.resolve({ data: null, error: { message: 'HAS_ANSWERS:4' } })
      }
      return Promise.resolve({ data: null, error: null })
    })

    renderEditor()
    await screen.findByTestId('topic-tasks-staff')

    fireEvent.click(screen.getAllByTitle('Убрать из темы')[1])

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(
      'По этой задаче уже есть ответы (4). Убрать задачу вместе с ними?'
    ))
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('topic_task_detach_item', {
      p_topic_id: 'topic-1', p_item_id: 'i2', p_force: true,
    }))

    confirmSpy.mockRestore()
  })
})
