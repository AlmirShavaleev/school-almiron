import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/**
 * §260. Значок ИИ в списке очереди берёт сумму баллов по критериям — и не
 * ломается, пока миграция PENDING_260 не применена (столбцов ещё нет).
 */

let hasPointsColumns = true
const selects: string[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let columns = ''
      const chain: any = {
        select: (c: string) => { columns = c; if (table === 'topic_homework_ai_jobs') selects.push(c); return chain },
        in: () => chain,
        order: () => chain,
        then: (res: any) => {
          if (table === 'topic_homework_ai_findings') return Promise.resolve({ data: [{ job_id: 'j1' }], error: null }).then(res)
          if (columns.includes('points_total') && !hasPointsColumns) {
            return Promise.resolve({ data: null, error: { message: 'column topic_homework_ai_jobs.points_total does not exist' } }).then(res)
          }
          const row: any = { id: 'j1', attempt_id: 'a1', status: 'done', suggested_score: 4, confidence: 'high', accepted_at: null, created_at: '2026-10-03T10:00:00Z' }
          if (columns.includes('points_total')) Object.assign(row, { points_total: 9, points_max: 12, grading: 'criteria' })
          return Promise.resolve({ data: [row], error: null }).then(res)
        },
      }
      return chain
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}))

import { useQueueAiJobs } from '@/hooks/useQueueAiJobs'

describe('useQueueAiJobs — баллы по критериям', () => {
  beforeEach(() => { selects.length = 0 })

  it('столбцы есть — сумма и способ оценки в строке', async () => {
    hasPointsColumns = true
    const { result } = renderHook(() => useQueueAiJobs(['a1']))
    await waitFor(() => expect(result.current.jobs.a1).toBeTruthy())
    expect(result.current.jobs.a1).toMatchObject({ suggestedScore: 4, findings: 1, pointsTotal: 9, pointsMax: 12, grading: 'criteria' })
    expect(selects).toHaveLength(1)
  })

  it('миграция не применена — тот же запрос, что до §260, значок на месте', async () => {
    hasPointsColumns = false
    const { result } = renderHook(() => useQueueAiJobs(['a1']))
    await waitFor(() => expect(result.current.jobs.a1).toBeTruthy())
    expect(result.current.jobs.a1).toMatchObject({ suggestedScore: 4, findings: 1, pointsTotal: null, grading: null })
    expect(selects).toEqual([
      'id, attempt_id, status, suggested_score, confidence, accepted_at, created_at, points_total, points_max, grading',
      'id, attempt_id, status, suggested_score, confidence, accepted_at, created_at',
    ])
  })
})
