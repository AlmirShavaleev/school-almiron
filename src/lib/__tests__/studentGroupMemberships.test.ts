import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ calls: 0, fail: false }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'group_students') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => {
            mock.calls++
            if (mock.fail) return Promise.resolve({ data: null, error: { message: 'network error' } })
            return Promise.resolve({
              data: [{ group_id: 'g1', groups: {
                id: 'g1', name: 'Математика', course_id: 'c1',
                courses: { id: 'c1', title: 'ЕГЭ', subject: 'math', exam_type: 'ege' },
              } }],
              error: null,
            })
          },
        }),
      }
    },
  },
}))

import {
  getCachedStudentCourseGroup,
  loadStudentGroupMemberships,
  resetStudentGroupMembershipsCache,
} from '@/lib/studentGroupMemberships'

beforeEach(() => {
  mock.calls = 0
  mock.fail = false
  resetStudentGroupMembershipsCache()
})

describe('student group memberships — short-lived request deduplication', () => {
  it('coalesces concurrent reads and reuses the snapshot within eight seconds', async () => {
    const first = loadStudentGroupMemberships('p1', 's1')
    const second = loadStudentGroupMemberships('p1', 's1')
    expect(first).toBe(second)
    const rows = await first
    expect(mock.calls).toBe(1)
    expect(rows?.[0].group_id).toBe('g1')
    expect(await loadStudentGroupMemberships('p1', 's1')).toEqual(rows)
    expect(mock.calls).toBe(1)
    expect(getCachedStudentCourseGroup('p1', 's1', 'g1')?.id).toBe('g1')
  })

  it('never shares the list between different students or profiles', async () => {
    await loadStudentGroupMemberships('p1', 's1')
    await loadStudentGroupMemberships('p2', 's1')
    await loadStudentGroupMemberships('p1', 's2')
    expect(mock.calls).toBe(3)
    expect(getCachedStudentCourseGroup('p2', 's2', 'g1')).toBeNull()
    expect(getCachedStudentCourseGroup('p1', 's1', 'missing')).toBeNull()
  })

  it('refreshes after the short cache lifetime and explicit invalidation', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000)
    await loadStudentGroupMemberships('p1', 's1')
    now.mockReturnValue(9_001)
    expect(getCachedStudentCourseGroup('p1', 's1', 'g1')).toBeNull()
    await loadStudentGroupMemberships('p1', 's1')
    expect(mock.calls).toBe(2)
    resetStudentGroupMembershipsCache()
    await loadStudentGroupMemberships('p1', 's1')
    expect(mock.calls).toBe(3)
    now.mockRestore()
  })

  it('does not cache failures, allowing the next call to retry', async () => {
    mock.fail = true
    expect(await loadStudentGroupMemberships('p1', 's1')).toBeNull()
    mock.fail = false
    expect((await loadStudentGroupMemberships('p1', 's1'))?.[0].group_id).toBe('g1')
    expect(mock.calls).toBe(2)
  })
})
