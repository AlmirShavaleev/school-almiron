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

let role = 'admin'

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}))

// Mirrors AppAuth: every call returns a brand-new profile object reference,
// even when the underlying id/role haven't changed (e.g. on TOKEN_REFRESHED).
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string; role: string } }) => unknown) =>
    selector({ profile: { id: 'p1', role } }),
}))

import { useHomeworks } from '@/hooks/useHomeworks'

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const homeworksCalls = () => fromSpy.mock.calls.filter(c => c[0] === 'homeworks').length

describe('useHomeworks — does not refetch on a same-id/role profile object replacement', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    fromSpy.mockImplementation(() => makeChain({ data: [], error: null }))
    role = 'admin'
  })

  it('loads once on mount', async () => {
    renderHook(() => useHomeworks())
    await flush()
    expect(homeworksCalls()).toBe(1)
  })

  it('ignores re-renders that hand back a new profile object with the same id/role', async () => {
    const { rerender } = renderHook(() => useHomeworks())
    await flush()
    expect(homeworksCalls()).toBe(1)

    // Simulate AppAuth calling setProfile() with a fresh object on repeated
    // auth events (e.g. TOKEN_REFRESHED) — same id/role, new reference.
    await act(async () => {
      for (let i = 0; i < 10; i++) rerender()
      await Promise.resolve()
    })
    expect(homeworksCalls()).toBe(1)
  })

  it('refetches when the role actually changes', async () => {
    const { rerender } = renderHook(() => useHomeworks())
    await flush()
    expect(homeworksCalls()).toBe(1)

    role = 'teacher'
    await act(async () => { rerender() })
    await flush()
    expect(homeworksCalls()).toBe(2)
  })

  it('manual reload() always refetches', async () => {
    const { result } = renderHook(() => useHomeworks())
    await flush()
    expect(homeworksCalls()).toBe(1)

    await act(async () => { result.current.reload() })
    await flush()
    expect(homeworksCalls()).toBe(2)
  })
})
