import { describe, expect, it } from 'vitest'
import {
  collapseToWorks, countByTab, courseFilterOptions, groupByDay, groupByCourse, rowsOfTab,
  sortQueue, toQueueRows,
} from './homeworkQueue'

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

describe('collapseToWorks — строка списка это работа, а не попытка', () => {
  /**
   * Работа = пара «ДЗ + ученик», и ДЗ приезжает вложенным join'ом — подменять
   * надо именно его, иначе поле `homework_id` попытки ни на что не влияет.
   */
  const attemptOf = (homeworkId: string, studentId: string, over: Record<string, unknown>) =>
    rawRow({
      student_id: studentId,
      homework_id: homeworkId,
      homework: {
        id: homeworkId,
        title: 'ДЗ по кинематике',
        grade_scale: null,
        topic: { id: 't1', title: 'Кинематика', module: { id: 'm1', course: { id: 'c1', title: 'Физика ОГЭ' } } },
      },
      ...over,
    })

  /** Настоящая пара из прода: ДЗ eff729e1…, ученик 0a68deab…, №1 → №2. */
  const pair = [
    attemptOf('eff729e1', '0a68deab', {
      id: '92c7f235', attempt_number: 1, status: 'returned_for_revision',
      submitted_at: '2026-08-04T18:57:33Z',
    }),
    attemptOf('eff729e1', '0a68deab', {
      id: '857a7192', attempt_number: 2, status: 'accepted',
      submitted_at: '2026-08-04T19:06:47Z',
    }),
  ]

  it('пересданная работа — одна строка в состоянии последней попытки', () => {
    const works = collapseToWorks(toQueueRows(pair))
    expect(works).toHaveLength(1)
    expect(works[0].attempt.id).toBe('857a7192')
    expect(works[0].attempt.status).toBe('accepted')
    expect(works[0].history.map(a => a.id)).toEqual(['92c7f235'])
  })

  it('порядок попыток на входе не меняет результат', () => {
    const reversed = collapseToWorks(toQueueRows([pair[1], pair[0]]))
    expect(reversed).toHaveLength(1)
    expect(reversed[0].attempt.id).toBe('857a7192')
    expect(reversed[0].history.map(a => a.id)).toEqual(['92c7f235'])
  })

  it('разные ученики одного ДЗ — разные работы', () => {
    const works = collapseToWorks(toQueueRows([
      ...pair,
      attemptOf('eff729e1', 's2', { id: 'other', attempt_number: 1 }),
    ]))
    expect(works).toHaveLength(2)
    expect(works.map(w => w.history.length).sort()).toEqual([0, 1])
  })

  it('счётчики вкладок считают работы: пара не висит на двух сразу', () => {
    // Слепок прода 04.08: 18 попыток, 12 работ — 3 ждут, 0 на доработке,
    // 9 приняты. До §83 вкладки показывали 3/6/9 по попыткам.
    const raw = [
      ...pair,
      attemptOf('hw-a', 'st-a', { id: 'p1', attempt_number: 1, status: 'submitted' }),
      attemptOf('hw-b', 'st-a', { id: 'p2', attempt_number: 1, status: 'accepted' }),
    ]
    const works = collapseToWorks(toQueueRows(raw))
    expect(countByTab(works)).toEqual({ submitted: 1, returned_for_revision: 0, accepted: 2 })
    expect(rowsOfTab(works, 'returned_for_revision')).toHaveLength(0)
  })
})

describe('вкладки состояний', () => {
  const rows = toQueueRows([
    rawRow({ id: 'a1', status: 'submitted' }),
    rawRow({ id: 'a2', status: 'returned_for_revision' }),
    rawRow({ id: 'a3', status: 'accepted' }),
    rawRow({ id: 'a4', status: 'accepted' }),
  ])

  it('rowsOfTab отдаёт работы только своего состояния', () => {
    expect(rowsOfTab(rows, 'submitted').map(r => r.attempt.id)).toEqual(['a1'])
    expect(rowsOfTab(rows, 'returned_for_revision').map(r => r.attempt.id)).toEqual(['a2'])
    expect(rowsOfTab(rows, 'accepted').map(r => r.attempt.id)).toEqual(['a3', 'a4'])
  })

  it('countByTab считает все три состояния, включая нулевые', () => {
    expect(countByTab(rows)).toEqual({ submitted: 1, returned_for_revision: 1, accepted: 2 })
    expect(countByTab([])).toEqual({ submitted: 0, returned_for_revision: 0, accepted: 0 })
  })

  it('черновики в счётчики не попадают — их преподаватель не видит', () => {
    const withDraft = toQueueRows([rawRow({ id: 'd1', status: 'draft' }), ...[]])
    expect(countByTab(withDraft)).toEqual({ submitted: 0, returned_for_revision: 0, accepted: 0 })
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
  /**
   * Моменты задаём ЛОКАЛЬНЫМ временем и переводим в ISO, а не пишем «...Z»
   * руками: группировка идёт по дню преподавателя, и жёстко зашитый UTC делал
   * тест зависимым от часового пояса машины — на московской он падал, хотя
   * функция работала правильно.
   */
  const local = (y: number, m: number, d: number, h: number, min = 0) =>
    new Date(y, m - 1, d, h, min).toISOString()

  it('работы одного дня попадают в одну группу', () => {
    const rows = toQueueRows([
      rawRow({ id: 'a1', submitted_at: local(2025, 11, 18, 9) }),
      rawRow({ id: 'a2', submitted_at: local(2025, 11, 18, 12, 30) }),
      rawRow({ id: 'a3', submitted_at: local(2025, 11, 18, 21) }),
    ])
    const groups = groupByDay(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].rows).toHaveLength(3)
    expect(groups[0].rows.map(r => r.attempt.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('разные дни — разные группы, порядок исходного списка сохраняется', () => {
    const rows = toQueueRows([
      rawRow({ id: 'a1', submitted_at: local(2025, 11, 18, 9) }),
      rawRow({ id: 'a2', submitted_at: local(2025, 11, 17, 12, 30) }),
      rawRow({ id: 'a3', submitted_at: local(2025, 11, 18, 21) }),
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
