import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

/**
 * §260. Правка ± в таблице проверки сохраняется туда же, куда вердикт строки
 * (`topic_homework_review_tasks`, §199), — одной записью «балл + вердикт»: на
 * сервер не уходит «верно» при «1 из 2». «Заполнить заново» переносит баллы.
 */

let stored: any[] = []
const updates: Array<{ patch: any; id: string }> = []
const inserted: any[] = []

vi.mock('@/lib/supabase', () => {
  const api = {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        then: (res: any) => Promise.resolve({ data: stored, error: null }).then(res),
        delete: () => ({ eq: () => Promise.resolve({ error: null }).then(r => { stored = []; return r }) }),
        insert: (rows: any) => {
          inserted.push(rows)
          stored = (Array.isArray(rows) ? rows : [rows]).map((row: any, i: number) => ({ id: row.id ?? `new-${i}`, updated_by: null, updated_at: '2026-10-03T13:00:00Z', ...row }))
          return Promise.resolve({ error: null })
        },
        update: (patch: any) => ({ eq: (_col: string, id: string) => { updates.push({ patch, id }); return Promise.resolve({ error: null }) } }),
      }
      return chain
    },
    rpc: () => Promise.resolve({ data: 0, error: null }),
  }
  return { supabase: api }
})

import { useHomeworkReviewTasks } from '@/hooks/useHomeworkReviewTasks'

const ROW = {
  id: 'r7', attempt_id: 'a1', no: '7', verdict: 'partial', student_answer: 'T ≈ 0,67 с', expected_answer: 'T ≈ 0,67 с; v ≈ 0,38 м/с',
  note: null, position: 70, updated_by: null, updated_at: '2026-10-03T10:00:00Z', points: 1, max_points: 2,
}
const PLAIN = { ...ROW, id: 'r1', no: '1', verdict: 'correct', points: undefined, max_points: undefined }

describe('useHomeworkReviewTasks — баллы по критериям', () => {
  beforeEach(() => {
    stored = [{ ...ROW }, { ...PLAIN }]
    updates.length = 0
    inserted.length = 0
  })

  it('«+»: запись «балл + вердикт» одной правкой, строка на экране сразу «верно»', async () => {
    const { result } = renderHook(() => useHomeworkReviewTasks('a1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    await act(async () => { await result.current.patchRow('r7', { points: 2 }) })
    expect(updates).toEqual([{ id: 'r7', patch: { points: 2, verdict: 'correct' } }])
    expect(result.current.rows.find(r => r.id === 'r7')).toMatchObject({ points: 2, verdict: 'correct' })
  })

  it('вердикт кнопкой у строки с баллами пишет и балл; у строки без баллов — как раньше', async () => {
    const { result } = renderHook(() => useHomeworkReviewTasks('a1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    await act(async () => { await result.current.patchRow('r7', { verdict: 'wrong' }) })
    await act(async () => { await result.current.patchRow('r1', { verdict: 'wrong' }) })
    expect(updates).toEqual([
      { id: 'r7', patch: { verdict: 'wrong', points: 0 } },
      { id: 'r1', patch: { verdict: 'wrong' } },
    ])
  })

  it('«Заполнить заново» из проверки с баллами переносит points/max_points', async () => {
    const { result } = renderHook(() => useHomeworkReviewTasks('a1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    await act(async () => {
      await result.current.refillFromAi([
        { no: '7', verdict: 'partial', student_answer: 'T ≈ 0,67 с', expected_answer: 'T ≈ 0,67 с; v ≈ 0,38 м/с', note: '', points: 1, max_points: 2 },
        { no: '8', verdict: 'unchecked', student_answer: '', expected_answer: '', note: '', points: null, max_points: 3 },
      ])
    })
    expect(inserted.at(-1)).toEqual([
      expect.objectContaining({ no: '7', verdict: 'partial', points: 1, max_points: 2 }),
      expect.objectContaining({ no: '8', verdict: 'unchecked', points: null, max_points: 3 }),
    ])
  })
})
