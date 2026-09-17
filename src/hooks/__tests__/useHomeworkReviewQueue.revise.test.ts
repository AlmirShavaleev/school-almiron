import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useHomeworkReviewQueue } from '@/hooks/useHomeworkReviewQueue'

/**
 * §198. Работу, возвращённую на доработку, теперь можно принять как есть —
 * но только пока она последняя. Чтобы не показывать преподавателю кнопку,
 * которая кончится отказом базы, очередь обязана знать про попытку новее; а
 * та, пока ученик собирает файлы, лежит в статусе `draft`, которого очередь
 * раньше не запрашивала вовсе.
 *
 * Проверяем именно поведение хука: черновик приезжает, но строкой списка и
 * состоянием работы не становится — только отметкой.
 */

const HOMEWORK = {
  id: 'hw1',
  title: 'ДЗ',
  grade_scale: null,
  due_at: null,
  topic: { id: 't1', title: 'Тема', module: { id: 'm1', course: { id: 'c1', title: 'Курс' } } },
}

function attempt(over: Record<string, unknown>) {
  return {
    id: 'a1',
    student_id: 's1',
    homework_id: 'hw1',
    attempt_number: 1,
    status: 'returned_for_revision',
    submitted_at: '2026-09-15T10:00:00.000Z',
    created_at: '2026-09-15T09:00:00.000Z',
    updated_at: '2026-09-15T10:00:00.000Z',
    homework: HOMEWORK,
    ...over,
  }
}

const ATTEMPTS = [
  // работа, которую ученик уже начал переделывать
  attempt({ id: 'returned-with-draft', student_id: 's1' }),
  attempt({ id: 'fresh-draft', student_id: 's1', attempt_number: 2, status: 'draft', submitted_at: null }),
  // работа, которая так и лежит на доработке
  attempt({ id: 'returned-alone', student_id: 's2' }),
]

vi.mock('@/hooks/useMyTeachingScope', () => ({
  useMyTeachingScope: () => ({
    active: false, loading: false, teacherId: null,
    courseIds: [], groupIds: [], ownStudentId: null, readOnly: false,
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'in', 'order', 'eq']) chain[m] = () => chain
      chain.then = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({
          data: table === 'topic_homework_attempts' ? ATTEMPTS : [],
          error: null,
        }).then(onFulfilled)
      return chain
    },
  },
}))

describe('очередь проверки: возвращённые работы и новая попытка', () => {
  it('черновик не попадает ни в строки, ни в счётчики', async () => {
    const { result } = renderHook(() => useHomeworkReviewQueue('returned_for_revision'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.all.map(r => r.attempt.id).sort())
      .toEqual(['returned-alone', 'returned-with-draft'])
    expect(result.current.counts).toEqual({
      submitted: 0, returned_for_revision: 2, accepted: 0,
    })
  })

  it('вкладка «На доработке» отдаёт обе работы', async () => {
    const { result } = renderHook(() => useHomeworkReviewQueue('returned_for_revision'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.rows).toHaveLength(2)
  })

  it('у работы с начатой пересдачей стоит отметка «есть попытка новее»', async () => {
    const { result } = renderHook(() => useHomeworkReviewQueue('returned_for_revision'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const withDraft = result.current.rows.find(r => r.attempt.id === 'returned-with-draft')
    const alone = result.current.rows.find(r => r.attempt.id === 'returned-alone')

    expect(withDraft?.newerAttempt?.id).toBe('fresh-draft')
    expect(alone?.newerAttempt ?? null).toBe(null)
  })
})
