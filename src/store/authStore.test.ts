import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from './authStore'

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      session: null,
      profile: null,
      loading: true,
    })
  })

  it('has correct initial state', () => {
    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.session).toBeNull()
    expect(state.profile).toBeNull()
    expect(state.loading).toBe(true)
  })

  it('setUser updates user', () => {
    const mockUser = { id: 'u1', email: 'test@test.com' } as any
    useAuthStore.getState().setUser(mockUser)
    expect(useAuthStore.getState().user).toEqual(mockUser)
  })

  it('setSession updates session', () => {
    const mockSession = { access_token: 'abc' } as any
    useAuthStore.getState().setSession(mockSession)
    expect(useAuthStore.getState().session).toEqual(mockSession)
  })

  it('setProfile updates profile', () => {
    const mockProfile = { id: 'p1', role: 'student', full_name: 'Test' } as any
    useAuthStore.getState().setProfile(mockProfile)
    expect(useAuthStore.getState().profile).toEqual(mockProfile)
  })

  it('setLoading updates loading', () => {
    useAuthStore.getState().setLoading(false)
    expect(useAuthStore.getState().loading).toBe(false)
  })

  it('role returns null when no profile', () => {
    expect(useAuthStore.getState().role).toBeNull()
  })

  it('role is null when profile has no role', () => {
    useAuthStore.getState().setProfile({ id: 'p1' } as any)
    expect(useAuthStore.getState().role).toBeNull()
  })

  it('reset clears all state', () => {
    useAuthStore.getState().setUser({ id: 'u1' } as any)
    useAuthStore.getState().setProfile({ id: 'p1', role: 'teacher' } as any)
    useAuthStore.getState().setLoading(false)

    useAuthStore.getState().reset()

    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.session).toBeNull()
    expect(state.profile).toBeNull()
    expect(state.loading).toBe(false)
  })

  it('reset sets loading to false', () => {
    useAuthStore.getState().setLoading(true)
    useAuthStore.getState().reset()
    expect(useAuthStore.getState().loading).toBe(false)
  })
})
