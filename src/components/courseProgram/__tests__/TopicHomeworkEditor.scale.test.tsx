import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * §265. Шкала в редакторе ДЗ: у урока по умолчанию 100-балльная, учитель
 * может выбрать 5-балльную, пункта «Без баллов» нет; у проверочной и
 * контрольной выбора нет — плашка «5-балльная · 2–5».
 */

const state = { homework: null as any }
const updateHomework = vi.fn(async (_patch: unknown) => {})
const createHomework = vi.fn(async (..._a: unknown[]) => 'hw-new')

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => { const c: any = {}; for (const m of ['select', 'eq', 'in', 'order']) c[m] = () => c; c.then = (f: any) => Promise.resolve({ data: [], error: null }).then(f); return c },
    rpc: async () => ({ data: null, error: null }),
  },
}))
vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({
    homework: state.homework, files: [], loading: false, error: null,
    createHomework, updateHomework,
    uploadHomeworkFile: vi.fn(), deleteHomeworkFile: vi.fn(),
    notifyStudents: vi.fn(), loadNotifyTargets: vi.fn().mockResolvedValue([]),
  }),
}))
vi.mock('@/store/toastStore', () => ({ toast: { saved: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { TopicHomeworkEditor } from '@/components/courseProgram/TopicHomeworkEditor'

const hw = (over: Record<string, unknown> = {}) => ({
  id: 'hw-1', topic_id: 't1', title: 'ДЗ', instructions: null, is_published: false, due_at: null,
  grade_scale: 'hundred', opens_at: null, closes_at: null, created_by: 'u', created_at: '', updated_at: '', ...over,
})

const scaleSelect = () => screen.getByTestId('hw-grade-scale') as HTMLSelectElement

describe('Шкала баллов в редакторе ДЗ (§265)', () => {
  beforeEach(() => {
    state.homework = null
    updateHomework.mockReset().mockResolvedValue(undefined)
    createHomework.mockClear()
  })

  it('новое ДЗ к уроку — сразу 100-балльное, пунктов два, «Без баллов» нет', () => {
    render(<TopicHomeworkEditor topicId="t1" kind="lesson" />)
    expect(scaleSelect().value).toBe('hundred')
    const options = within(scaleSelect()).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['100-балльная', '5-балльная (2–5)'])
    expect(screen.queryByText('Без баллов')).not.toBeInTheDocument()
  })

  it('учитель выбрал 5-балльную — ДЗ создаётся и сохраняет five', async () => {
    render(<TopicHomeworkEditor topicId="t1" kind="lesson" />)
    await act(async () => { fireEvent.change(scaleSelect(), { target: { value: 'five' } }) })
    await waitFor(() => expect(updateHomework).toHaveBeenCalledWith({ grade_scale: 'five' }))
    expect(createHomework).toHaveBeenCalledWith('', '', { due_at: null, grade_scale: 'hundred' })
    expect(scaleSelect().value).toBe('five')
  })

  it('старое ДЗ урока без шкалы показывается 100-балльным (так его и пересчитают)', () => {
    state.homework = hw({ grade_scale: null })
    render(<TopicHomeworkEditor topicId="t1" kind="lesson" />)
    expect(scaleSelect().value).toBe('hundred')
  })

  it('сервер не дал сменить шкалу (оценки уже стоят) — выбор возвращается, причина видна', async () => {
    state.homework = hw({ grade_scale: 'hundred' })
    updateHomework.mockRejectedValueOnce(new Error('По этой работе уже выставлены оценки — шкалу сменить нельзя'))
    render(<TopicHomeworkEditor topicId="t1" kind="lesson" />)
    await act(async () => { fireEvent.change(scaleSelect(), { target: { value: 'five' } }) })
    expect(await screen.findByText(/уже выставлены оценки/)).toBeInTheDocument()
    expect(scaleSelect().value).toBe('hundred')
  })

  it.each(['check', 'control'])('у %s выбора нет — плашка «5-балльная · 2–5»', kind => {
    state.homework = hw({ grade_scale: 'five' })
    render(<TopicHomeworkEditor topicId="t1" kind={kind} />)
    expect(screen.queryByTestId('hw-grade-scale')).not.toBeInTheDocument()
    expect(screen.getByTestId('hw-grade-scale-fixed')).toHaveTextContent('5-балльная · 2–5')
  })
})
