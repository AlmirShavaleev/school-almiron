import { describe, it, expect } from 'vitest'

function addCount(data: any[] | null) {
  return (data || []).map(g => ({
    ...g,
    student_count: g.group_students?.length || 0,
  }))
}

describe('addCount', () => {
  it('returns empty array for null', () => {
    expect(addCount(null)).toEqual([])
  })

  it('returns empty array for empty array', () => {
    expect(addCount([])).toEqual([])
  })

  it('adds student_count from group_students', () => {
    const input = [
      {
        id: '1',
        name: 'Group A',
        group_students: [{ student_id: 's1' }, { student_id: 's2' }],
      },
    ]
    const result = addCount(input)
    expect(result[0].student_count).toBe(2)
  })

  it('sets student_count to 0 when no group_students', () => {
    const input = [
      {
        id: '1',
        name: 'Group A',
        group_students: [],
      },
    ]
    const result = addCount(input)
    expect(result[0].student_count).toBe(0)
  })

  it('sets student_count to 0 when group_students is undefined', () => {
    const input = [
      {
        id: '1',
        name: 'Group A',
      },
    ]
    const result = addCount(input)
    expect(result[0].student_count).toBe(0)
  })

  it('preserves other properties', () => {
    const input = [
      {
        id: '1',
        name: 'Group A',
        courses: { title: 'Physics' },
        group_students: [{ student_id: 's1' }],
      },
    ]
    const result = addCount(input)
    expect(result[0]).toEqual({
      id: '1',
      name: 'Group A',
      courses: { title: 'Physics' },
      group_students: [{ student_id: 's1' }],
      student_count: 1,
    })
  })

  it('handles multiple groups', () => {
    const input = [
      { id: '1', group_students: [{ student_id: 's1' }] },
      { id: '2', group_students: [] },
      { id: '3' },
    ]
    const result = addCount(input)
    expect(result.map(g => g.student_count)).toEqual([1, 0, 0])
  })
})
