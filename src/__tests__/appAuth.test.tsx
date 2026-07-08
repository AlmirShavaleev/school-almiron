import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

/**
 * AppAuth calls loadProfile() on every onAuthStateChange event, including
 * periodic TOKEN_REFRESHED events that carry the same profile row. Before the
 * fix, that meant a brand-new object reference on every refresh, which
 * ripples into every consumer with `profile` (not `profile?.id`) in a deps
 * array — see useHomeworkQueue / CreateMockExamModal. AppAuth must now skip
 * setProfile when the fetched row is field-for-field identical to what's
 * already in the store.
 */

type MockResult = { data: unknown; error: { message: string } | null }

function makeChain(result: MockResult) {
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        const p = Promise.resolve(result)
        return p.then.bind(p)
      }
      return () => chain
    },
  })
  return chain
}

let profileRow: Record<string, unknown> = { id: 'u1', email: 'a@a.com', full_name: 'Ann', role: 'teacher' }

const fromSpy = vi.fn((table: string) => {
  if (table === 'profiles') return makeChain({ data: { ...profileRow }, error: null })
  return makeChain({ data: null, error: null })
})

let authCallback: ((event: string, session: unknown) => void | Promise<void>) | null = null

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromSpy(table),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void | Promise<void>) => {
        authCallback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
  },
}))

import { AppAuth } from '@/App'
import { useAuthStore } from '@/store/authStore'

const sessionUser = { user: { id: 'u1', email: 'a@a.com' } }

async function fireAuthEvent() {
  await act(async () => {
    await authCallback!('TOKEN_REFRESHED', sessionUser)
    await Promise.resolve()
  })
}

describe('AppAuth — skips setProfile on a content-identical profile row', () => {
  beforeEach(() => {
    fromSpy.mockClear()
    profileRow = { id: 'u1', email: 'a@a.com', full_name: 'Ann', role: 'teacher' }
    useAuthStore.setState({ user: null, session: null, profile: null, loading: true })
    authCallback = null
  })

  it('sets the profile once on the first event, then ignores N same-data TOKEN_REFRESHED events', async () => {
    render(<AppAuth />)

    let setProfileCalls = 0
    const unsub = useAuthStore.subscribe((state, prevState) => {
      if (state.profile !== prevState.profile) setProfileCalls++
    })

    await fireAuthEvent() // first: null -> row, must set
    expect(setProfileCalls).toBe(1)
    expect(useAuthStore.getState().profile).toEqual(profileRow)

    for (let i = 0; i < 10; i++) await fireAuthEvent() // same row every time
    expect(setProfileCalls).toBe(1)

    unsub()
  })

  it('does set the profile when the role actually changes', async () => {
    render(<AppAuth />)
    await fireAuthEvent()

    let setProfileCalls = 0
    const unsub = useAuthStore.subscribe((state, prevState) => {
      if (state.profile !== prevState.profile) setProfileCalls++
    })

    profileRow = { ...profileRow, role: 'admin' }
    await fireAuthEvent()

    expect(setProfileCalls).toBe(1)
    expect(useAuthStore.getState().profile).toEqual(profileRow)
    unsub()
  })

  it('does set the profile when full_name changes', async () => {
    render(<AppAuth />)
    await fireAuthEvent()

    let setProfileCalls = 0
    const unsub = useAuthStore.subscribe((state, prevState) => {
      if (state.profile !== prevState.profile) setProfileCalls++
    })

    profileRow = { ...profileRow, full_name: 'Anna' }
    await fireAuthEvent()

    expect(setProfileCalls).toBe(1)
    unsub()
  })

  it('detects a brand-new column that appears on the row (no hardcoded field list)', async () => {
    render(<AppAuth />)
    await fireAuthEvent()

    let setProfileCalls = 0
    const unsub = useAuthStore.subscribe((state, prevState) => {
      if (state.profile !== prevState.profile) setProfileCalls++
    })

    profileRow = { ...profileRow, avatar_url: 'https://example.com/a.png' }
    await fireAuthEvent()

    expect(setProfileCalls).toBe(1)
    unsub()
  })
})
