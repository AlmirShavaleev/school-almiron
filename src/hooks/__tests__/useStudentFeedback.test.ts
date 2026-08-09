import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const insertSpy = vi.fn()
const invokeSpy = vi.fn()
const rows = [
  { id: 'n2', student_id: 's1', author_id: 'p1', kind: 'saved', body: 'свежая', model: null, created_at: '2026-08-08T10:00:00Z' },
  { id: 'n1', student_id: 's1', author_id: 'p1', kind: 'saved', body: 'прошлая', model: null, created_at: '2026-08-01T10:00:00Z' },
  { id: 'd1', student_id: 's1', author_id: null, kind: 'ai_draft', body: 'черновик', model: 'qwen', created_at: '2026-08-07T10:00:00Z' },
]

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
      }),
      insert: (payload: unknown) => {
        insertSpy(payload)
        return Promise.resolve({ error: null })
      },
    }),
    functions: { invoke: (...args: unknown[]) => invokeSpy(...args) },
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'p1' } }),
}))

import { useStudentFeedback } from '@/hooks/useStudentFeedback'

describe('useStudentFeedback — версии, а не перезапись', () => {
  beforeEach(() => {
    insertSpy.mockReset()
    invokeSpy.mockReset()
  })

  it('текущий текст — последняя сохранённая версия, черновик отдельно', async () => {
    const { result } = renderHook(() => useStudentFeedback('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.current?.body).toBe('свежая')
    expect(result.current.saved).toHaveLength(2)
    // Черновик ИИ в «сохранённые» не попадает — его туда переносит человек.
    expect(result.current.draft?.body).toBe('черновик')
  })

  it('сохранение ВСТАВЛЯЕТ новую версию от своего имени, а не правит старую', async () => {
    const { result } = renderHook(() => useStudentFeedback('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.save('  новая заметка  ') })

    expect(insertSpy).toHaveBeenCalledWith({
      student_id: 's1',
      author_id: 'p1',
      kind: 'saved',
      body: 'новая заметка',
    })
  })

  it('пустую заметку не сохраняет', async () => {
    const { result } = renderHook(() => useStudentFeedback('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.save('   ')).rejects.toThrow(/[Пп]уст/)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('черновик зовёт функцию с идентификатором ученика и цифрами', async () => {
    invokeSpy.mockResolvedValue({ data: { text: 'разбор модели' }, error: null })
    const { result } = renderHook(() => useStudentFeedback('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let text = ''
    await act(async () => { text = await result.current.generate({ works: { total: 3 } }) })

    expect(text).toBe('разбор модели')
    expect(invokeSpy).toHaveBeenCalledWith('student-feedback-ai', {
      body: { student_id: 's1', insights: { works: { total: 3 } } },
    })
  })

  it('пустой ответ модели — ошибка, а не сохранённая пустота', async () => {
    invokeSpy.mockResolvedValue({ data: { text: '   ' }, error: null })
    const { result } = renderHook(() => useStudentFeedback('s1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.generate({})).rejects.toThrow(/пустой ответ/)
  })
})
