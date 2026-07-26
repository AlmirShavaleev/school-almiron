import { describe, expect, it } from 'vitest'
import { groupByCourse, sortQueue, toQueueRows } from './homeworkQueue'

function rawRow(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    homework_id: 'hw1',
    student_id: 's1',
    attempt_number: 1,
    status: 'submitted',
    submitted_at: '2026-07-20T10:00:00Z',
    created_at: '2026-07-20T09:00:00Z',
    updated_at: '2026-07-20T10:00:00Z',
    homework: {
      id: 'hw1',
      title: 'ДЗ по кинематике',
      grade_scale: null,
      topic: { id: 't1', title: 'Кинематика', module: { id: 'm1', course: { id: 'c1', title: 'Физика ОГЭ' } } },
    },
    ...over,
  }
}

describe('toQueueRows', () => {
  it('разворачивает вложенный join в плоскую строку', () => {
    const rows = toQueueRows([rawRow()])
    expect(rows).toHaveLength(1)
    expect(rows[0].attempt.id).toBe('a1')
    expect(rows[0].homeworkTitle).toBe('ДЗ по кинематике')
    expect(rows[0].gradeScale).toBe(null)
    expect(rows[0].topicTitle).toBe('Кинематика')
    expect(rows[0].courseTitle).toBe('Физика ОГЭ')
    // homework не должен протечь в attempt
    expect((rows[0].attempt as any).homework).toBeUndefined()
  })

  it('отбрасывает строки с оборванным join, не роняя остальные', () => {
    const broken = rawRow({ id: 'a2', homework: { id: 'hw2', title: 'x', topic: null } })
    const rows = toQueueRows([rawRow(), broken])
    expect(rows).toHaveLength(1)
    expect(rows[0].attempt.id).toBe('a1')
  })
})

describe('sortQueue', () => {
  it('старые сдачи выше новых', () => {
    const rows = toQueueRows([
      rawRow({ id: 'new', submitted_at: '2026-07-25T10:00:00Z' }),
      rawRow({ id: 'old', submitted_at: '2026-07-19T10:00:00Z' }),
    ])
    expect(sortQueue(rows).map(r => r.attempt.id)).toEqual(['old', 'new'])
  })
})

describe('groupByCourse', () => {
  it('группирует по курсу, сохраняя порядок очереди', () => {
    const other = rawRow({
      id: 'a3',
      homework: {
        id: 'hw3',
        title: 'ДЗ',
        grade_scale: null,
        topic: { id: 't2', title: 'Проценты', module: { id: 'm2', course: { id: 'c2', title: 'Математика ОГЭ' } } },
      },
    })
    const groups = groupByCourse(toQueueRows([rawRow(), other, rawRow({ id: 'a4' })]))
    expect(groups).toHaveLength(2)
    expect(groups[0].courseTitle).toBe('Физика ОГЭ')
    expect(groups[0].rows.map(r => r.attempt.id)).toEqual(['a1', 'a4'])
    expect(groups[1].rows.map(r => r.attempt.id)).toEqual(['a3'])
  })
})
