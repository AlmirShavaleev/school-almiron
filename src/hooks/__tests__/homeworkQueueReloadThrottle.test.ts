import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const fromSpy = vi.fn()

function makeChain(result: unknown) {
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return () => chain
    },
  })
  return chain
}

const testProfile = { id: 'p1', role: 'admin' }

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: typeof testProfile }) => unknown) => selector({ profile: testProfile }),
}))

import { useHomeworkQueue } from '@/hooks/useHomeworkQueue'

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const groupsCalls = () => fromSpy.mock.calls.filter(c => c[0] === 'groups').length

describe('useHomeworkQueue focus/visibilitychange reload guard', () => {
  let now = 1_000_000

  beforeEach(() => {
    fromSpy.mockReset()
    fromSpy.mockImplementation(() => makeChain({ data: [], error: null }))
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  it('loads once on mount', async () => {
    renderHook(() => useHomeworkQueue())
    await flush()
    expect(groupsCalls()).toBe(1)
  })

  it('ignores a focus/visibilitychange burst inside the 30s throttle window', async () => {
    renderHook(() => useHomeworkQueue())
    await flush()
    expect(groupsCalls()).toBe(1)

    await act(async () => {
      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new Event('focus'))
        document.dispatchEvent(new Event('visibilitychange'))
      }
      await Promise.resolve()
    })
    expect(groupsCalls()).toBe(1)
  })

  it('refetches on focus once the 30s throttle window has passed', async () => {
    renderHook(() => useHomeworkQueue())
    await flush()
    expect(groupsCalls()).toBe(1)

    now += 31_000
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await flush()
    expect(groupsCalls()).toBe(2)
  })

  it('manual reload() always refetches, ignoring the throttle window', async () => {
    const { result } = renderHook(() => useHomeworkQueue())
    await flush()
    expect(groupsCalls()).toBe(1)

    await act(async () => { result.current.reload() })
    await flush()
    expect(groupsCalls()).toBe(2)
  })
})
