import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

/**
 * §238. Первое заполнение таблицы из ИИ: «частично» при совпавшем ответе
 * ложится «верно» с заметкой «ИИ сомневается: …». Проверяем поведение хука на
 * подменённой базе, которая честно применяет фильтры `eq` к записи: правило
 * применяется только к строкам, которые создал этот вызов, и не затирает
 * чужую правку.
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
/** Что создаст RPC заполнения, если таблица пуста. */
let seedRows: Row[] = []
/** Что сделать «другому преподавателю» сразу после заполнения. */
let afterSeed: (() => void) | null = null
const updates: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
let rpcCalls = 0

const matches = (filters: Array<[string, unknown]>) => (row: Row) =>
  filters.every(([col, val]) => (row as any)[col] === val)

vi.mock('@/lib/supabase', () => {
  const api = {
    from: () => {
      const filters: Array<[string, unknown]> = []
      const chain: any = {
        select: () => chain,
        order: () => chain,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return chain },
        then: (res: any) => Promise.resolve({ data: stored.filter(matches(filters)), error: null }).then(res),
        update: (patch: Record<string, unknown>) => {
          const upFilters: Array<[string, unknown]> = []
          const up: any = {
            eq: (col: string, val: unknown) => { upFilters.push([col, val]); return up },
            then: (res: any) => {
              updates.push({ patch, filters: [...upFilters] })
              stored = stored.map(row => (matches(upFilters)(row) ? { ...row, ...patch } : row))
              return Promise.resolve({ error: null }).then(res)
            },
          }
          return up
        },
      }
      return chain
    },
    rpc: (_name: string, args: { p_attempt_id: string }) => {
      rpcCalls += 1
      if (stored.some(row => row.attempt_id === args.p_attempt_id)) return Promise.resolve({ data: 0, error: null })
      stored = seedRows.map(row => ({ ...row }))
      afterSeed?.()
      return Promise.resolve({ data: seedRows.length, error: null })
    },
  }
  return { supabase: api }
})

import { useHomeworkReviewTasks } from '@/hooks/useHomeworkReviewTasks'

const row = (over: Partial<Row>): Row => ({
  id: 'r', attempt_id: 'a1', no: '1', verdict: 'correct', student_answer: null, expected_answer: null,
  note: null, position: 10, updated_by: null, updated_at: '2026-09-27T10:00:00Z', ...over,
})

const FROM_AI: Row[] = [
  row({ id: 'r1', no: '1', verdict: 'correct', student_answer: '12', expected_answer: '12' }),
  row({ id: 'r5', no: '5', verdict: 'partial', student_answer: '4π; 3π', expected_answer: '4π; 3π', note: 'Неверный отбор: x=3π не входит в [5π/2; 4π]', position: 50 }),
  row({ id: 'r6', no: '6', verdict: 'partial', student_answer: '7', expected_answer: '8', note: 'Округление', position: 60 }),
  row({ id: 'r7', no: '7', verdict: 'partial', student_answer: 'в 144 раза', expected_answer: '144', note: '', position: 70 }),
]

describe('§238. useHomeworkReviewTasks — заполнение из ИИ со светофором', () => {
  beforeEach(() => {
    stored = []
    seedRows = FROM_AI
    afterSeed = null
    updates.length = 0
    rpcCalls = 0
  })

  it('пустая таблица: «частично» при совпавшем ответе становится «верно» с сомнением ИИ', async () => {
    const { result } = renderHook(() => useHomeworkReviewTasks('a1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(4))

    const byNo = Object.fromEntries(result.current.rows.map(r => [r.no, r]))
    expect(byNo['5']).toMatchObject({ verdict: 'correct', note: 'ИИ сомневается: Неверный отбор: x=3π не входит в [5π/2; 4π]' })
    // Ответ другой — остаётся «частично».
    expect(byNo['6']).toMatchObject({ verdict: 'partial', note: 'Округление' })
    // «в 144 раза» = «144» по compareAnswers; заметки не было — не выдумываем.
    expect(byNo['7']).toMatchObject({ verdict: 'correct', note: null })
    expect(byNo['1'].verdict).toBe('correct')

    // Запись условная — только строки, которые всё ещё «частично».
    expect(updates).toHaveLength(2)
    for (const u of updates) expect(u.filters).toContainEqual(['verdict', 'partial'])
  })

  it('готовая таблица не переписывается: заполнения нет, правок нет', async () => {
    stored = [row({ id: 'old', no: '5', verdict: 'partial', student_answer: '1', expected_answer: '1', note: 'старое' })]
    const { result } = renderHook(() => useHomeworkReviewTasks('a1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    expect(rpcCalls).toBe(0)
    expect(updates).toHaveLength(0)
    expect(result.current.rows[0]).toMatchObject({ verdict: 'partial', note: 'старое' })
  })

  it('строку успел поправить другой преподаватель — его вердикт остаётся', async () => {
    afterSeed = () => {
      stored = stored.map(r => (r.id === 'r5' ? { ...r, verdict: 'wrong', note: 'проверено вручную' } : r))
    }
    const { result } = renderHook(() => useHomeworkReviewTasks('a1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(4))
    expect(result.current.rows.find(r => r.no === '5')).toMatchObject({ verdict: 'wrong', note: 'проверено вручную' })
  })

  it('«Взять таблицу ИИ» вручную применяет то же правило', async () => {
    const { result } = renderHook(() => useHomeworkReviewTasks('a1', { seed: false }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows).toHaveLength(0)
    await act(async () => { await result.current.seedNow() })
    expect(result.current.rows.find(r => r.no === '5')?.verdict).toBe('correct')
    expect(result.current.saveState).toBe('saved')
  })
})
