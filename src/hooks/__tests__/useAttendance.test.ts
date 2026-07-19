import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAttendance } from '@/hooks/useAttendance'

const fromSpy = vi.fn()

function makeChain(result: { data: unknown; error: { message: string } | null }) {
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

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}))

describe('useAttendance', () => {
  beforeEach(() => {
    fromSpy.mockReset()
  })

  it('throws when bulk upsert returns fewer rows than requested', async () => {
    let attendanceCall = 0
    fromSpy.mockImplementation((table: string) => {
      if (table === 'group_students') {
        return makeChain({
          data: [
            { student_id: 's1', students: { profiles: { full_name: 'Анна', avatar_url: null } } },
            { student_id: 's2', students: { profiles: { full_name: 'Борис', avatar_url: null } } },
          ],
          error: null,
        })
      }
      if (table === 'attendance') {
        attendanceCall += 1
        if (attendanceCall === 1) {
          return makeChain({ data: [], error: null })
        }
        return makeChain({
          data: [{ lesson_id: 'lesson-1', student_id: 's1' }],
          error: null,
        })
      }
      return makeChain({ data: [], error: null })
    })

    const { result } = renderHook(() => useAttendance('lesson-1', 'group-1'))

    await waitFor(() => expect(result.current.students).toHaveLength(2))

    await expect(act(async () => {
      await result.current.saveAll(result.current.students)
    })).rejects.toThrow('Не все записи посещаемости были сохранены')
  })

  it('throws when bulk upsert returns the wrong composite keys', async () => {
    let attendanceCall = 0
    fromSpy.mockImplementation((table: string) => {
      if (table === 'group_students') {
        return makeChain({
          data: [
            { student_id: 's1', students: { profiles: { full_name: 'Анна', avatar_url: null } } },
            { student_id: 's2', students: { profiles: { full_name: 'Борис', avatar_url: null } } },
          ],
          error: null,
        })
      }
      if (table === 'attendance') {
        attendanceCall += 1
        if (attendanceCall === 1) {
          return makeChain({ data: [], error: null })
        }
        return makeChain({
          data: [
            { lesson_id: 'lesson-1', student_id: 's1' },
            { lesson_id: 'lesson-1', student_id: 's3' },
          ],
          error: null,
        })
      }
      return makeChain({ data: [], error: null })
    })

    const { result } = renderHook(() => useAttendance('lesson-1', 'group-1'))

    await waitFor(() => expect(result.current.students).toHaveLength(2))

    await expect(act(async () => {
      await result.current.saveAll(result.current.students)
    })).rejects.toThrow('Не все записи посещаемости были сохранены')
  })
})
