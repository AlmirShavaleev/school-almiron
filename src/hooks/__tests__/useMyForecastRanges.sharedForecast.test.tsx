import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const deps = vi.hoisted(() => ({
  fetch: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: deps.rpc } }))
vi.mock('@/lib/scoreForecast', () => ({ fetchMyScoreForecast: deps.fetch }))
import { useMyForecastRanges } from '@/hooks/useMyForecastRanges'

beforeEach(() => {
  deps.fetch.mockReset()
  deps.rpc.mockReset()
})

describe('forecast on student home', () => {
  it('reuses goal forecast instead of issuing another stored or evidence RPC', async () => {
    const stored = [{ subject: 'math', low: 55, high: 67, ready: true }]
    const { result } = renderHook(() => useMyForecastRanges(true, stored as never))
    await waitFor(() => expect(result.current).toEqual([{ subject: 'math', low: 55, high: 67 }]))
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(deps.rpc).not.toHaveBeenCalled()
  })

  it('uses evidence fallback but does not retry the missing stored forecast', async () => {
    deps.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } })
    const { result } = renderHook(() => useMyForecastRanges(true, null))
    await waitFor(() => expect(result.current).toEqual([]))
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(deps.rpc).toHaveBeenCalledOnce()
    expect(deps.rpc).toHaveBeenCalledWith('student_exam_forecast_evidence')
  })
})
