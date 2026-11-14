import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const owned = vi.hoisted(() => ({
  ownStudentRow: vi.fn(),
  memberships: vi.fn(),
}))

vi.mock('@/lib/ownStudent', () => ({ ownStudentRow: owned.ownStudentRow }))
vi.mock('@/lib/studentGroupMemberships', () => ({ loadStudentGroupMemberships: owned.memberships }))

import { useStudentDashboard } from '@/hooks/useStudentDashboard'

beforeEach(() => {
  owned.ownStudentRow.mockReset()
  owned.memberships.mockReset()
})

describe('student home reuses the shared memberships loader', () => {
  it('loads cards through one shared RLS membership read', async () => {
    owned.ownStudentRow.mockResolvedValue({ data: { id: 'student-1' } })
    owned.memberships.mockResolvedValue([
      { group_id: 'group-1', groups: { id: 'group-1', courses: { id: 'math-1', title: 'Математика', subject: 'math', exam_type: 'ege' } } },
      { group_id: 'group-2', groups: { id: 'group-2', courses: { id: 'math-1', title: 'Математика', subject: 'math', exam_type: 'ege' } } },
    ])
    const { result } = renderHook(() => useStudentDashboard('profile-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(owned.ownStudentRow).toHaveBeenCalledWith('profile-1')
    expect(owned.memberships).toHaveBeenCalledOnce()
    expect(owned.memberships).toHaveBeenCalledWith('profile-1', 'student-1')
    expect(result.current.courses).toEqual([
      { groupId: 'group-1', courseId: 'math-1', courseTitle: 'Математика', subject: 'math', examType: 'ege' },
    ])
  })

  it('still shows empty courses if the student has no memberships', async () => {
    owned.ownStudentRow.mockResolvedValue({ data: { id: 'student-1' } })
    owned.memberships.mockResolvedValue([])
    const { result } = renderHook(() => useStudentDashboard('profile-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.courses).toEqual([])
  })
})
