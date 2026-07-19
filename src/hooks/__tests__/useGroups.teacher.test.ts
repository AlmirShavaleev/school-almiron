import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGroups } from '@/hooks/useGroups'

const fromSpy = vi.fn()
let profileState: any = { id: 'profile-1', role: 'teacher' }

function makeChain(result: any, handlers: Partial<Record<string, (...args: any[]) => any>> = {}) {
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        const p = Promise.resolve(result)
        return p.then.bind(p)
      }
      if (prop in handlers) return handlers[prop as string]
      return () => chain
    },
  })
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromSpy(...args),
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { profile: any }) => unknown) => selector({ profile: profileState }),
}))

describe('useGroups teacher filtering', () => {
  beforeEach(() => {
    profileState = { id: 'profile-1', role: 'teacher' }
    fromSpy.mockReset()
    fromSpy.mockImplementation((table: string) => {
      if (table === 'teachers') return makeChain({ data: { id: 'teacher-77' }, error: null })
      if (table === 'groups') return makeChain({ data: [{ id: 'group-1', name: '11А', group_students: [] }], error: null })
      return makeChain({ data: [], error: null })
    })
  })

  it('loads only groups for current teachers.id so student enrollment uses current teacher groups', async () => {
    const { result } = renderHook(() => useGroups())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const teacherCall = fromSpy.mock.calls.find(call => call[0] === 'teachers')
    const groupsCall = fromSpy.mock.calls.find(call => call[0] === 'groups')
    expect(teacherCall).toBeTruthy()
    expect(groupsCall).toBeTruthy()
    expect(result.current.groups[0]?.id).toBe('group-1')
  })

  it('returns no groups when current teacher row is missing', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'teachers') return makeChain({ data: null, error: null })
      if (table === 'groups') return makeChain({ data: [{ id: 'group-1', name: '11А', group_students: [] }], error: null })
      return makeChain({ data: [], error: null })
    })

    const { result } = renderHook(() => useGroups())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.groups).toEqual([])
  })
})
