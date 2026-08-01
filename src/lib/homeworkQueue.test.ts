import { describe, expect, it } from 'vitest'
import { courseFilterOptions, groupByDay, groupByCourse, sortQueue, toQueueRows } from './homeworkQueue'

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

describe('groupByDay', () => {
  it('работы одного дня попадают в одну группу', () => {
    const rows = toQueueRows([
      rawRow({ id: 'a1', submitted_at: '2025-11-18T09:00:00Z' }),
      rawRow({ id: 'a2', submitted_at: '2025-11-18T12:30:00Z' }),
      rawRow({ id: 'a3', submitted_at: '2025-11-18T21:00:00Z' }),
    ])
    const groups = groupByDay(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].rows).toHaveLength(3)
    expect(groups[0].rows.map(r => r.attempt.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('разные дни — разные группы, порядок исходного списка сохраняется', () => {
    const rows = toQueueRows([
      rawRow({ id: 'a1', submitted_at: '2025-11-18T09:00:00Z' }),
      rawRow({ id: 'a2', submitted_at: '2025-11-17T12:30:00Z' }),
      rawRow({ id: 'a3', submitted_at: '2025-11-18T21:00:00Z' }),
    ])
    const groups = groupByDay(rows)
    expect(groups).toHaveLength(2)
    expect(groups[0].dayKey).toBe('2025-11-18')
    expect(groups[0].rows.map(r => r.attempt.id)).toEqual(['a1', 'a3'])
    expect(groups[1].dayKey).toBe('2025-11-17')
    expect(groups[1].rows.map(r => r.attempt.id)).toEqual(['a2'])
  })

  it('день считается по локальному времени, а не по UTC', () => {
    const testIso = '2025-11-18T00:30:00Z'
    const testDate = new Date(testIso)
    const expectedLocalYear = testDate.getFullYear()
    const expectedLocalMonth = (testDate.getMonth() + 1).toString().padStart(2, '0')
    const expectedLocalDay = testDate.getDate().toString().padStart(2, '0')
    const expectedKey = `${expectedLocalYear}-${expectedLocalMonth}-${expectedLocalDay}`

    const rows = toQueueRows([rawRow({ id: 'a1', submitted_at: testIso })])
    const groups = groupByDay(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].dayKey).toBe(expectedKey)
  })

  it('подпись группы — русская дата', () => {
    const rows = toQueueRows([
      rawRow({ id: 'a1', submitted_at: '2025-11-18T10:00:00Z' }),
    ])
    const groups = groupByDay(rows)
    expect(groups).toHaveLength(1)
    // Русская локаль в этом окружении есть — проверяем месяц словом, иначе
    // подпись могла бы молча съехать на «11/18/2025» и никто бы не заметил.
    expect(groups[0].label).toMatch(/ноября 2025/)
  })

  it('работа без даты сдачи не теряется', () => {
    const rows = toQueueRows([
      rawRow({ id: 'a1', submitted_at: '2025-11-18T10:00:00Z' }),
      rawRow({ id: 'a2', submitted_at: null }),
    ])
    const groups = groupByDay(rows)
    expect(groups).toHaveLength(2)
    const unknownGroup = groups.find(g => g.dayKey === 'unknown')
    expect(unknownGroup).toBeDefined()
    expect(unknownGroup?.label).toBe('Без даты сдачи')
    expect(unknownGroup?.rows.map(r => r.attempt.id)).toEqual(['a2'])
  })
})

describe('courseFilterOptions', () => {
  it('считает работы по каждому курсу', () => {
    const algebra = rawRow({
      id: 'a1',
      homework: {
        id: 'hw1',
        title: 'ДЗ 1',
        grade_scale: null,
        topic: { id: 't1', title: 'Тема 1', module: { id: 'm1', course: { id: 'c1', title: 'Алгебра' } } },
      },
    })
    const algebra2 = rawRow({
      id: 'a2',
      homework: {
        id: 'hw2',
        title: 'ДЗ 2',
        grade_scale: null,
        topic: { id: 't2', title: 'Тема 2', module: { id: 'm1', course: { id: 'c1', title: 'Алгебра' } } },
      },
    })
    const physics = rawRow({
      id: 'a3',
      homework: {
        id: 'hw3',
        title: 'ДЗ 3',
        grade_scale: null,
        topic: { id: 't3', title: 'Тема 3', module: { id: 'm2', course: { id: 'c2', title: 'Физика' } } },
      },
    })

    const rows = toQueueRows([algebra, algebra2, physics])
    const options = courseFilterOptions(rows)

    expect(options).toHaveLength(2)
    const algebraOption = options.find(o => o.id === 'c1')
    expect(algebraOption?.count).toBe(2)
    const physicsOption = options.find(o => o.id === 'c2')
    expect(physicsOption?.count).toBe(1)
  })

  it('курсы отсортированы по названию', () => {
    const physics = rawRow({
      id: 'a1',
      homework: {
        id: 'hw1',
        title: 'ДЗ 1',
        grade_scale: null,
        topic: { id: 't1', title: 'Тема 1', module: { id: 'm1', course: { id: 'c1', title: 'Физика' } } },
      },
    })
    const algebra = rawRow({
      id: 'a2',
      homework: {
        id: 'hw2',
        title: 'ДЗ 2',
        grade_scale: null,
        topic: { id: 't2', title: 'Тема 2', module: { id: 'm2', course: { id: 'c2', title: 'Алгебра' } } },
      },
    })

    const rows = toQueueRows([physics, algebra])
    const options = courseFilterOptions(rows)

    expect(options).toHaveLength(2)
    expect(options[0].title).toBe('Алгебра')
    expect(options[1].title).toBe('Физика')
  })

  it('пустая очередь — пустой список', () => {
    const options = courseFilterOptions([])
    expect(options).toEqual([])
  })
})
