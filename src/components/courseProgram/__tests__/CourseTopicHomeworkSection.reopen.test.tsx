import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * §240. «Открыть заново» — там, где учитель видит учеников по работе (раздел
 * «ДЗ» курса). Только у работы по времени и только ученику без сданной
 * работы; личное время видно в строке и снимается. Правила держит сервер
 * (topic_homework_set_personal_window) — здесь экран не предлагает лишнего.
 */

const rpc = vi.fn(async (..._a: unknown[]) => ({ data: null, error: null as { message: string } | null }))
const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))

const MODULES = [{
  id: 'mod-1',
  title: 'Работы',
  topics: [
    { id: 't-kr', title: 'Контрольная. Кинематика', is_open: true, available_from: null, kind: 'control' },
    { id: 't-l', title: 'Законы Ньютона', is_open: true, available_from: null, kind: 'lesson' },
  ],
}]
const ROSTER = ['s1', 's2', 's3'].map((id, i) => ({ student_id: id, students: { id, profiles: { full_name: ['Кузнецова', 'Смирнов', 'Петров'][i] } } }))
const HOMEWORKS = [
  { id: 'h-kr', topic_id: 't-kr', title: 'КР', grade_scale: 'five', is_published: true, opens_at: '2026-10-02T07:00:00.000Z', closes_at: '2026-10-02T07:45:00.000Z' },
  { id: 'h-l', topic_id: 't-l', title: 'ДЗ', grade_scale: 'five', is_published: true, opens_at: null, closes_at: null },
]
const ATTEMPTS = [
  // s1 сдал сам, s2 — автоматически, у s3 ничего
  { id: 'a1', homework_id: 'h-kr', student_id: 's1', attempt_number: 1, status: 'submitted', submitted_at: '2026-10-02T07:40:00Z', auto_submitted: false, topic_homework_reviews: [] },
  { id: 'a2', homework_id: 'h-kr', student_id: 's2', attempt_number: 1, status: 'submitted', submitted_at: '2026-10-02T07:45:00Z', auto_submitted: true, topic_homework_reviews: [] },
]
let windows: unknown[] = []

function selectChain(rows: unknown) {
  const c: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'group_students') return selectChain(ROSTER)
      if (table === 'topic_homework') return selectChain(HOMEWORKS)
      if (table === 'topic_homework_attempts') return selectChain(ATTEMPTS)
      if (table === 'topic_homework_files') return selectChain([])
      if (table === 'topic_homework_personal_windows') return selectChain(windows)
      return selectChain([])
    },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))
vi.mock('@/store/toastStore', () => ({
  toast: { success: toastSuccess, error: toastError, info: vi.fn(), saved: vi.fn(), warning: vi.fn() },
}))
vi.mock('@/components/courseProgram/TopicOpenToggle', () => ({ TopicOpenToggle: () => null }))

import { CourseTopicHomeworkSection } from '@/components/courseProgram/CourseTopicHomeworkSection'

async function openTopic(title: string) {
  render(<CourseTopicHomeworkSection courseId="c1" modules={MODULES} />)
  fireEvent.click(await screen.findByText(title))
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

describe('«Открыть заново» у работы по времени (§240)', () => {
  beforeEach(() => {
    windows = []
    rpc.mockReset().mockResolvedValue({ data: null, error: null })
    toastSuccess.mockReset(); toastError.mockReset()
  })

  it('плашка типа и общее время в строке темы', async () => {
    render(<CourseTopicHomeworkSection courseId="c1" modules={MODULES} />)
    expect(await screen.findByTestId('hw-section-kind')).toHaveTextContent('КР')
    expect(screen.getByText('пт 2 окт, 10:00–10:45')).toBeInTheDocument()
  })

  it('кнопка — только у того, кто не сдал; автосдача подписана', async () => {
    await openTopic('Контрольная. Кинематика')
    expect(within(rowOf('Петров')).getByTestId('hw-reopen')).toBeInTheDocument()
    expect(within(rowOf('Кузнецова')).queryByTestId('hw-reopen')).not.toBeInTheDocument()
    expect(within(rowOf('Смирнов')).queryByTestId('hw-reopen')).not.toBeInTheDocument()
    expect(within(rowOf('Смирнов')).getByText('Сдано автоматически')).toBeInTheDocument()
  })

  it('своё время по Москве уходит в RPC', async () => {
    await openTopic('Контрольная. Кинематика')
    fireEvent.click(within(rowOf('Петров')).getByTestId('hw-reopen'))
    const form = screen.getByTestId('hw-reopen-form')
    fireEvent.change(within(form).getByLabelText('Дата'), { target: { value: '2026-10-05' } })
    fireEvent.change(within(form).getByLabelText('Открывается'), { target: { value: '15:00' } })
    fireEvent.change(within(form).getByLabelText('Закрывается'), { target: { value: '15:45' } })
    await act(async () => { fireEvent.click(screen.getByTestId('hw-reopen-save')) })
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('topic_homework_set_personal_window', {
      p_homework_id: 'h-kr', p_student_id: 's3', p_opens_at: '2026-10-05T12:00:00.000Z', p_closes_at: '2026-10-05T12:45:00.000Z',
    }))
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('отказ сервера виден в форме', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'У ученика уже есть сданная работа — открыть заново нельзя' } })
    await openTopic('Контрольная. Кинематика')
    fireEvent.click(within(rowOf('Петров')).getByTestId('hw-reopen'))
    await act(async () => { fireEvent.click(screen.getByTestId('hw-reopen-save')) })
    expect(await screen.findByText(/открыть заново нельзя/)).toBeInTheDocument()
  })

  it('личное время видно в строке и снимается', async () => {
    windows = [{ homework_id: 'h-kr', student_id: 's3', opens_at: '2026-10-05T12:00:00.000Z', closes_at: '2026-10-05T12:45:00.000Z' }]
    await openTopic('Контрольная. Кинематика')
    expect(within(rowOf('Петров')).getByTestId('hw-personal-window')).toHaveTextContent('лично: пн 5 окт, 15:00–15:45')
    await act(async () => { fireEvent.click(within(rowOf('Петров')).getByText('Снять')) })
    expect(rpc).toHaveBeenCalledWith('topic_homework_clear_personal_window', { p_homework_id: 'h-kr', p_student_id: 's3' })
  })

  it('у урока ничего нового: ни колонки «Время», ни кнопки', async () => {
    await openTopic('Законы Ньютона')
    expect(screen.queryByText('Время')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hw-reopen')).not.toBeInTheDocument()
  })
})
