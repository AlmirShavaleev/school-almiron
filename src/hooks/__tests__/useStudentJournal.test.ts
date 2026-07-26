import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useStudentJournal } from '@/hooks/useStudentJournal'

let rpcResult: { data: unknown; error: { message: string } | null } = { data: null, error: null }
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: () => Promise.resolve(rpcResult) },
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { profile: { id: string } }) => unknown) => sel({ profile: { id: 'p1' } }),
}))

function baseJournal(overrides: Record<string, unknown> = {}) {
  return {
    student: { id: 's1', full_name: 'Иван', target_exam: null, target_subject: null, groups: null },
    summary: {
      lessons_completed: 0, present_count: 0, late_count: 0, absent_count: 0, excused_count: 0,
      attended: 0, missed: 0, attendance_pct: null, hw_assigned: 0, hw_submitted_ever: 0,
      hw_accepted: 0, hw_returned: 0, hw_rejected: 0, hw_overdue: 0, hw_on_time: 0,
      hw_with_due_date: 0, avg_score: null, scored_count: 0,
    },
    lessons: null, assignments: null, trend: null,
    ...overrides,
  }
}

beforeEach(() => { rpcResult = { data: null, error: null } })

describe('useStudentJournal', () => {
  it('RPC вернул null вместо массива groups/lessons/assignments/trend — нормализуется в []', async () => {
    rpcResult = { data: baseJournal(), error: null }
    const { result } = renderHook(() => useStudentJournal('s1', '30d'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.journal?.student.groups).toEqual([])
    expect(result.current.journal?.lessons).toEqual([])
    expect(result.current.journal?.assignments).toEqual([])
    expect(result.current.journal?.trend).toEqual([])
  })

  it('пустой журнал (данные уже []) остаётся []', async () => {
    rpcResult = { data: baseJournal({ lessons: [], assignments: [], trend: [], student: { id: 's1', full_name: 'Иван', target_exam: null, target_subject: null, groups: [] } }), error: null }
    const { result } = renderHook(() => useStudentJournal('s1', 'all'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.journal?.student.groups).toEqual([])
    expect(result.current.journal?.lessons).toEqual([])
  })

  it('RPC вернул error — journal остаётся null, error выставлен', async () => {
    rpcResult = { data: null, error: { message: 'boom' } }
    const { result } = renderHook(() => useStudentJournal('s1', '30d'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.journal).toBeNull()
    expect(result.current.error).toBe('boom')
  })
})
