import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useGroups } from '@/hooks/useGroups'
import { useAuthStore } from '@/store/authStore'
import { useStaffModeStore } from '@/store/staffModeStore'

/**
 * Смысл проверки: под админской RLS база отдаёт владельцу всю школу. Значит
 * «только своё» в режиме учителя обязано стоять в ЗАПРОСЕ клиента — иначе в
 * учительском кабинете вылезут чужие группы. Тест ловит именно это: смотрит,
 * ушёл ли фильтр по teacher_id.
 */

const OWNER_ID = 'owner-profile'
const OWNER_TEACHER_ID = 'owner-teacher-row'

const calls: Array<{ table: string; filters: Record<string, unknown> }> = []

function makeChain(table: string, result: unknown) {
  const filters: Record<string, unknown> = {}
  calls.push({ table, filters })

  const chain: Record<string, unknown> = {}
  const passthrough = ['select', 'order', 'in', 'limit']
  for (const method of passthrough) {
    chain[method] = () => chain
  }
  chain.eq = (column: string, value: unknown) => { filters[column] = value; return chain }
  chain.single = () => Promise.resolve(result)
  chain.maybeSingle = () => Promise.resolve(result)
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'teachers') return makeChain(table, { data: { id: OWNER_TEACHER_ID } })
      return makeChain(table, { data: [] })
    },
  },
}))

function setOwner() {
  useAuthStore.setState({
    profile: {
      id: OWNER_ID,
      email: 'owner@almiron.ru',
      full_name: 'Шавалеев Альмир',
      role: 'admin',
      created_at: '2026-08-04T00:00:00.000Z',
      updated_at: '2026-08-04T00:00:00.000Z',
    },
    loading: false,
  } as any)
}

describe('useGroups под режимом представления', () => {
  beforeEach(() => {
    calls.length = 0
    localStorage.clear()
    sessionStorage.clear()
    useStaffModeStore.setState({ mode: 'admin', profileId: null, choiceMade: true })
    setOwner()
  })

  it('в режиме админа группы не сужаются по преподавателю', async () => {
    const { result } = renderHook(() => useGroups())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const groupCalls = calls.filter(c => c.table === 'groups')
    expect(groupCalls.length).toBeGreaterThan(0)
    expect(groupCalls.every(c => c.filters.teacher_id === undefined)).toBe(true)
    expect(calls.some(c => c.table === 'teachers')).toBe(false)
  })

  it('в режиме учителя запрос сужается по своей строке teachers', async () => {
    useStaffModeStore.setState({ mode: 'teacher', profileId: OWNER_ID, choiceMade: true })

    const { result } = renderHook(() => useGroups())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(calls.some(c => c.table === 'teachers')).toBe(true)
    const groupCalls = calls.filter(c => c.table === 'groups')
    expect(groupCalls.some(c => c.filters.teacher_id === OWNER_TEACHER_ID)).toBe(true)
  })
})
