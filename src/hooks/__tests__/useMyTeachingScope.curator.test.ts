import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'
import { resetCuratorshipsCache } from '@/hooks/useMyCuratorships'
import { useAuthStore } from '@/store/authStore'
import { useStaffModeStore } from '@/store/staffModeStore'

/**
 * Кураторство-назначение (2026-08-05): куратором курса может быть ученик, и
 * его профильная роль остаётся `student`.
 *
 * Отсюда две вещи, которые обязан обеспечить scope, и обе проверяются здесь
 * поведением, а не текстом исходника:
 *
 * 1. Ученику-куратору сужение ВКЛЮЧАЕТСЯ по курируемым курсам. RLS отдаёт ему
 *    сдачи курируемого курса И его собственные — без сужения очередь проверки
 *    показала бы ему его же работы.
 * 2. Настоящему преподавателю сужение НЕ включается, даже если он вдобавок
 *    курирует чужой курс: RLS уже отдала ему ровно его курсы, а фильтр по
 *    курируемым спрятал бы его собственные.
 */

const STUDENT_ID   = 'profile-student-curator'
const TEACHER_ID   = 'profile-teacher'
const OWN_STUDENT_ROW = 'students-row-of-curator'

let curatorRows: Array<Record<string, unknown>> = []

function makeChain(rows: Array<Record<string, unknown>> | Record<string, unknown> | null) {
  const eqs: Array<[string, unknown]> = []
  const ins: Array<[string, unknown[]]> = []
  const chain: Record<string, unknown> = {}

  const resolve = () => {
    if (!Array.isArray(rows)) return { data: rows, error: null }
    const filtered = rows.filter(row =>
      eqs.every(([col, val]) => row[col] === val) &&
      ins.every(([col, vals]) => vals.includes(row[col] as never)))
    return { data: filtered, error: null }
  }

  for (const m of ['select', 'order', 'limit']) chain[m] = () => chain
  chain.eq = (column: string, value: unknown) => { eqs.push([column, value]); return chain }
  chain.in = (column: string, values: unknown[]) => { ins.push([column, values]); return chain }
  // `.maybeSingle()` в PostgREST отдаёт ОДНУ строку, а не список — мок,
  // возвращающий массив, тихо превратил бы `data.id` в undefined и покрасил
  // бы рабочий код красным.
  const one = () => {
    const r = resolve()
    return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null }
  }
  chain.maybeSingle = () => Promise.resolve(one())
  chain.single = () => Promise.resolve(one())
  chain.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled)
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'course_curators') return makeChain(curatorRows)
      if (table === 'students') return makeChain([
        { id: OWN_STUDENT_ROW, profile_id: STUDENT_ID },
      ])
      if (table === 'groups') return makeChain([
        { id: 'g-curated', course_id: 'c-curated' },
        { id: 'g-alien',   course_id: 'c-alien' },
      ])
      if (table === 'teachers') return makeChain(null)
      if (table === 'courses') return makeChain([])
      return makeChain([])
    },
  },
}))

function setProfile(id: string, role: 'student' | 'teacher') {
  useAuthStore.setState({
    profile: {
      id, role,
      email: `${id}@example.test`,
      full_name: 'Проба',
      created_at: '2026-08-05T00:00:00.000Z',
      updated_at: '2026-08-05T00:00:00.000Z',
    },
    loading: false,
  } as any)
}

describe('useMyTeachingScope и кураторство-назначение', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    resetCuratorshipsCache()
    useStaffModeStore.setState({ mode: 'admin', profileId: null, choiceMade: true })
    curatorRows = []
  })

  it('ученик без кураторства — сужать нечего', async () => {
    setProfile(STUDENT_ID, 'student')

    const { result } = renderHook(() => useMyTeachingScope())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.active).toBe(false)
    expect(result.current.courseIds).toEqual([])
  })

  it('ученик-куратор: сужение по курируемым курсам и свой students.id', async () => {
    curatorRows = [
      { course_id: 'c-curated', profile_id: STUDENT_ID, courses: { id: 'c-curated', title: 'Курирую' } },
    ]
    setProfile(STUDENT_ID, 'student')

    const { result } = renderHook(() => useMyTeachingScope())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.active).toBe(true)
    expect(result.current.courseIds).toEqual(['c-curated'])
    // Группа курируемого курса подтянута, чужая — нет.
    expect(result.current.groupIds).toEqual(['g-curated'])
    // Именно он даёт очереди убрать собственные работы куратора.
    expect(result.current.ownStudentId).toBe(OWN_STUDENT_ROW)
    // Кураторство преподавателем не делает.
    expect(result.current.teacherId).toBeNull()
  })

  it('преподавателю сужение не включается, даже если он курирует чужой курс', async () => {
    curatorRows = [
      { course_id: 'c-curated', profile_id: TEACHER_ID, courses: { id: 'c-curated', title: 'Курирую' } },
    ]
    setProfile(TEACHER_ID, 'teacher')

    const { result } = renderHook(() => useMyTeachingScope())
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Ему всё сузила RLS. Включи мы фильтр по курируемым — он потерял бы
    // собственные курсы, которых в course_curators нет.
    expect(result.current.active).toBe(false)
  })

  it('пока неизвестно, куратор ли ученик, сужение считается активным', () => {
    curatorRows = [
      { course_id: 'c-curated', profile_id: STUDENT_ID, courses: { id: 'c-curated', title: 'Курирую' } },
    ]
    setProfile(STUDENT_ID, 'student')

    const { result } = renderHook(() => useMyTeachingScope())

    // Первый кадр: ответа таблицы ещё нет. Ответить «сужать не надо» значило
    // бы на кадр показать чужие работы — поэтому active сразу true.
    expect(result.current.active).toBe(true)
    expect(result.current.loading).toBe(true)
  })
})
