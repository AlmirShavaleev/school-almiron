import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/**
 * §258. Флаги рубрик с гейтом: `has_criteria` / `has_condition` из
 * `topic_solution_state`. База до PENDING_258 этих полей не отдаёт — тогда
 * false, прежние три флага как были; отказ RPC — всё закрыто.
 */

const answer = { value: { data: null as unknown, error: null as unknown } }
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: () => Promise.resolve(answer.value) },
}))

import { useTopicSolutionState } from '@/hooks/useTopicSolutionState'

describe('useTopicSolutionState (§258)', () => {
  beforeEach(() => { answer.value = { data: null, error: null } })

  it('новые поля сервера — hasCriteria / hasCondition', async () => {
    answer.value = { data: { has_solution: true, has_homework: true, unlocked: false, has_criteria: true, has_condition: true }, error: null }
    const { result } = renderHook(() => useTopicSolutionState('t1'))
    await waitFor(() => expect(result.current.hasCriteria).toBe(true))
    expect(result.current).toMatchObject({ hasSolution: true, hasHomework: true, unlocked: false, hasCondition: true })
  })

  it('ответ старой базы (без новых полей) — новые флаги false, прежние как есть', async () => {
    answer.value = { data: { has_solution: true, has_homework: true, unlocked: true }, error: null }
    const { result } = renderHook(() => useTopicSolutionState('t1'))
    await waitFor(() => expect(result.current.unlocked).toBe(true))
    expect(result.current).toMatchObject({ hasSolution: true, hasCriteria: false, hasCondition: false })
  })

  it('отказ RPC — всё закрыто', async () => {
    answer.value = { data: null, error: { message: 'permission denied' } }
    const { result } = renderHook(() => useTopicSolutionState('t1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ hasSolution: false, unlocked: false, hasCriteria: false, hasCondition: false })
  })
})
