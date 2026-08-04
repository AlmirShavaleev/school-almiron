import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useCourseProgram } from '@/hooks/useCourseProgram'
import { useAuthStore } from '@/store/authStore'
import { useStaffModeStore } from '@/store/staffModeStore'

/**
 * Дырка из скриншота владельца: в режиме учителя «Программа курса» показывала
 * все 8 курсов школы чужими именами. Ветки `if (role === 'teacher')` и `else`
 * в хуке были ОДИНАКОВЫЕ — обе тянули все курсы; настоящего учителя спасала
 * RLS, администратора не спасало ничто.
 */

const OWNER_ID = 'owner-profile'
const OWNER_TEACHER_ID = 'owner-teacher-row'

const COURSES = [
  { id: 'c-own',    title: 'Мой курс',       owner_id: OWNER_ID },
  { id: 'c-taught', title: 'Веду группу',    owner_id: 'someone-else' },
  { id: 'c-alien',  title: 'Чужой курс',     owner_id: 'someone-else' },
]

/**
 * Мок обязан честно отрабатывать `.eq()`: хук сначала спрашивает «мои курсы»
 * запросом `courses.eq('owner_id', me)`, и мок, игнорирующий фильтр, вернул бы
 * все курсы как «мои» — тест бы позеленел на сломанном коде.
 */
function makeChain(rows: Array<Record<string, unknown>> | Record<string, unknown> | null) {
  const eqs: Array<[string, unknown]> = []
  const chain: Record<string, unknown> = {}

  const resolve = () => {
    if (!Array.isArray(rows)) return { data: rows }
    const filtered = rows.filter(row => eqs.every(([col, val]) => row[col] === val))
    return { data: filtered }
  }

  for (const m of ['select', 'order', 'in', 'limit']) chain[m] = () => chain
  chain.eq = (column: string, value: unknown) => { eqs.push([column, value]); return chain }
  chain.maybeSingle = () => Promise.resolve(resolve())
  chain.single = () => Promise.resolve(resolve())
  chain.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled)
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      // Отдаём ВСЁ — ровно как база отдаёт администратору: RLS его не сужает.
      if (table === 'courses')  return makeChain(COURSES)
      if (table === 'teachers') return makeChain({ id: OWNER_TEACHER_ID })
      if (table === 'groups')   return makeChain([{ id: 'g1', course_id: 'c-taught', teacher_id: OWNER_TEACHER_ID }])
      return makeChain([])
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

describe('useCourseProgram под режимом представления', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useStaffModeStore.setState({ mode: 'admin', profileId: null, choiceMade: true })
    setOwner()
  })

  it('в режиме админа видны все курсы школы', async () => {
    const { result } = renderHook(() => useCourseProgram())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.courses.map(c => c.id).sort()).toEqual(['c-alien', 'c-own', 'c-taught'])
  })

  it('в режиме учителя остаются только свои: где владелец или ведёт группу', async () => {
    useStaffModeStore.setState({ mode: 'teacher', profileId: OWNER_ID, choiceMade: true })

    const { result } = renderHook(() => useCourseProgram())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const ids = result.current.courses.map(c => c.id).sort()
    expect(ids).toEqual(['c-own', 'c-taught'])
    expect(ids).not.toContain('c-alien')
  })
})
