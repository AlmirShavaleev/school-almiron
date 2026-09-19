import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

/**
 * §207. «Заполнить заново из неё» — единственное место, где таблица
 * преподавателя стирается целиком. Проверяем, что стирается она ровно тогда,
 * когда это удалось заменить, и что при отказе строки возвращаются: правки
 * человека здесь стоят дороже свежести данных.
 */

type Row = {
  id: string
  attempt_id: string
  no: string
  verdict: string
  student_answer: string | null
  expected_answer: string | null
  note: string | null
  position: number
  updated_by: string | null
  updated_at: string
}

let stored: Row[] = []
let insertFails = false
const inserted: any[] = []

vi.mock('@/lib/supabase', () => {
  const api = {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        then: (res: any) => Promise.resolve({ data: stored, error: null }).then(res),
        delete: () => ({
          eq: () => Promise.resolve({ error: null }).then(r => { stored = []; return r }),
        }),
        insert: (rows: any) => {
          inserted.push(rows)
          if (insertFails) return Promise.resolve({ error: { message: 'нет прав' } })
          const list = Array.isArray(rows) ? rows : [rows]
          stored = list.map((row: any, i: number) => ({
            id: row.id ?? `new-${i}`,
            updated_by: null,
            updated_at: '2026-09-19T13:00:00Z',
            ...row,
          }))
          return Promise.resolve({ error: null })
        },
        update: () => chain,
      }
      return chain
    },
    rpc: () => Promise.resolve({ error: null }),
  }
  return { supabase: api }
})

import { useHomeworkReviewTasks } from '@/hooks/useHomeworkReviewTasks'
import type { AiTaskRow } from '@/lib/aiHomeworkCheck'

const HAND_EDITED: Row[] = [
  {
    id: 'r1', attempt_id: 'a1', no: '1', verdict: 'wrong',
    student_answer: '2', expected_answer: '3', note: 'правка преподавателя',
    position: 10, updated_by: 'teacher', updated_at: '2026-09-19T10:00:00Z',
  },
]

const FRESH: AiTaskRow[] = [
  { no: '1', verdict: 'correct', student_answer: '3', expected_answer: '3', note: '' },
  { no: '2', verdict: 'partial', student_answer: '7', expected_answer: '8', note: 'Округление' },
]

describe('useHomeworkReviewTasks — заполнить заново из свежей проверки', () => {
  beforeEach(() => {
    stored = [...HAND_EDITED]
    inserted.length = 0
    insertFails = false
  })

  it('заменяет таблицу целиком строками названного прогона', async () => {
    const { result } = renderHook(() => useHomeworkReviewTasks('a1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    await act(async () => { await result.current.refillFromAi(FRESH) })

    expect(result.current.rows.map(r => [r.no, r.verdict])).toEqual([['1', 'correct'], ['2', 'partial']])
    expect(result.current.saveState).toBe('saved')
  })

  it('вставка не удалась — прежние строки возвращаются на место', async () => {
    const { result } = renderHook(() => useHomeworkReviewTasks('a1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    insertFails = true

    await act(async () => { await result.current.refillFromAi(FRESH) })

    expect(result.current.saveState).toBe('error')
    expect(result.current.rows.map(r => r.note)).toEqual(['правка преподавателя'])
    // Возврат ушёл в базу теми же строками, а не выдумкой.
    expect(inserted.at(-1)[0]).toMatchObject({ id: 'r1', no: '1', note: 'правка преподавателя' })
  })

  it('слепка нет — не трогаем ничего', async () => {
    const { result } = renderHook(() => useHomeworkReviewTasks('a1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    let ok = true
    await act(async () => { ok = await result.current.refillFromAi([]) })

    expect(ok).toBe(false)
    expect(inserted).toHaveLength(0)
    expect(result.current.rows).toHaveLength(1)
  })
})
