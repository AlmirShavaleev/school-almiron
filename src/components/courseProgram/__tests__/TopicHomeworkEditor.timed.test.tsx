import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * §240. Настройки работы по времени в теме копии курса: вместо дедлайна —
 * «дата / открывается / закрывается» по Москве, в шаблоне — подсказка без
 * полей, после закрытия — сводка. У урока всё как было.
 */

const state = { homework: null as any }
const updateHomework = vi.fn(async () => {})
const rpc = vi.fn(async (..._a: unknown[]): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null }))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => { const c: any = {}; for (const m of ['select', 'eq', 'in', 'order']) c[m] = () => c; c.then = (f: any) => Promise.resolve({ data: [], error: null }).then(f); return c },
    rpc: (...args: unknown[]) => rpc(...(args as [])),
  },
}))
vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({
    homework: state.homework, files: [], loading: false, error: null,
    createHomework: vi.fn(), updateHomework,
    uploadHomeworkFile: vi.fn(), deleteHomeworkFile: vi.fn(),
    notifyStudents: vi.fn(), loadNotifyTargets: vi.fn().mockResolvedValue([]),
  }),
}))
vi.mock('@/store/toastStore', () => ({ toast: { saved: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { TopicHomeworkEditor } from '@/components/courseProgram/TopicHomeworkEditor'

const base = { id: 'hw-1', topic_id: 't1', title: 'КР', instructions: null, is_published: false, due_at: null, grade_scale: 'five', created_by: 'u', created_at: '', updated_at: '' }

describe('Настройки работы по времени (§240)', () => {
  beforeEach(() => {
    state.homework = { ...base, opens_at: null, closes_at: null }
    updateHomework.mockClear()
    rpc.mockReset().mockResolvedValue({ data: null, error: null })
  })

  it('у контрольной вместо дедлайна — окно; без окна — предупреждение', () => {
    render(<TopicHomeworkEditor topicId="t1" kind="control" />)
    expect(screen.getByText('Контрольная работа')).toBeInTheDocument()
    expect(screen.getByTestId('timed-window-editor')).toBeInTheDocument()
    expect(screen.queryByLabelText('Дедлайн')).not.toBeInTheDocument()
    expect(screen.getByText(/Время не назначено/)).toBeInTheDocument()
  })

  // §243 (было §240: «опубликовать можно без файла»): кнопки нет, работа по
  // времени в открытой теме выдана и без файла — условие лежит рубрикой.
  it('без файла задания работа по времени в открытой теме выдана; в закрытой — нет', () => {
    const { unmount } = render(<TopicHomeworkEditor topicId="t1" kind="check" isOpen={true} />)
    expect(screen.getByTestId('homework-issue-state')).toHaveAttribute('data-state', 'issued')
    expect(screen.queryByText('Нет файлов задания')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Опубликовать/ })).not.toBeInTheDocument()
    unmount()
    render(<TopicHomeworkEditor topicId="t1" kind="check" isOpen={false} />)
    expect(screen.getByTestId('homework-issue-state')).toHaveTextContent('Не выдано · тема закрыта')
  })

  it('дата и время по Москве уходят моментом UTC; закрытие раньше открытия — ошибка без записи', async () => {
    render(<TopicHomeworkEditor topicId="t1" kind="control" />)
    fireEvent.change(screen.getByTestId('timed-window-date'), { target: { value: '2026-10-02' } })
    fireEvent.change(screen.getByTestId('timed-window-opens'), { target: { value: '10:45' } })
    fireEvent.change(screen.getByTestId('timed-window-closes'), { target: { value: '10:00' } })
    expect(screen.getByTestId('timed-window-error')).toHaveTextContent('позже')
    expect(updateHomework).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.change(screen.getByTestId('timed-window-opens'), { target: { value: '09:15' } })
    })
    await waitFor(() => expect(updateHomework).toHaveBeenCalledWith({
      opens_at: '2026-10-02T06:15:00.000Z', closes_at: '2026-10-02T07:00:00.000Z',
    }))
  })

  it('в шаблоне курса время не ставится — подсказка без полей', () => {
    render(<TopicHomeworkEditor topicId="t1" kind="control" isTemplate />)
    expect(screen.getByTestId('timed-window-template')).toHaveTextContent('Время ставится в курсе класса')
    expect(screen.queryByTestId('timed-window-date')).not.toBeInTheDocument()
  })

  it('после закрытия — сводка: сдали сами / автоматически / не сдали / в классе', async () => {
    state.homework = { ...base, opens_at: '2026-10-02T07:00:00.000Z', closes_at: '2026-10-02T07:45:00.000Z' }
    rpc.mockResolvedValue({
      data: { in_class: 21, submitted_self: 17, submitted_auto: 2, not_submitted: 2, personal_windows: 0, closed: true, closes_at: '2026-10-02T07:45:00.000Z' },
      error: null,
    })
    render(<TopicHomeworkEditor topicId="t1" kind="control" />)
    const summary = await screen.findByTestId('timed-summary')
    expect(summary).toHaveTextContent('17сдали сами')
    expect(summary).toHaveTextContent('2сдано автоматически в 10:45')
    expect(summary).toHaveTextContent('2не сдали')
    expect(summary).toHaveTextContent('21в классе')
    expect(rpc).toHaveBeenCalledWith('topic_homework_timed_summary', { p_homework_id: 'hw-1' })
    expect(screen.getByText(/45 минут · время московское/)).toBeInTheDocument()
  })

  it('урок — как раньше: дедлайн на месте, окна и сводки нет', () => {
    render(<TopicHomeworkEditor topicId="t1" />)
    expect(screen.getByText('Домашнее задание')).toBeInTheDocument()
    expect(screen.getByLabelText('Дедлайн')).toBeInTheDocument()
    expect(screen.queryByTestId('timed-window-editor')).not.toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalled()
  })
})
