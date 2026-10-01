/**
 * §249. Журнал «Проверочные и контрольные»: раскладка ученик × работа —
 * столбцы по типу и дате, «ждёт» / «—» / «дораб.», средний только по
 * проверенным, «Сначала слабые», фильтр типа, точка у 2+ двоек, стобалльная
 * шкала; список работ с распределением 5/4/3/2 и «Проверить N».
 */
import { describe, expect, it } from 'vitest'
import {
  distributionOf, fiveOf, isJournalWork, journalMeta, journalSheet, journalView, parseGrades, toneOf, worksList, worksMeta,
  type CourseGrades, type GradeCellStatus,
} from '@/lib/courseGrades'
import { parseSummary } from '@/lib/courseAssessments'

const NOW = Date.parse('2026-10-01T09:00:00.000Z')
const DAY = 86400_000
const iso = (ms: number) => new Date(ms).toISOString()

type C = [GradeCellStatus, number | null]
const st = (id: string, name: string) => ({ student_id: id, name })
const work = (topic_id: string, kind: 'check' | 'control', title: string, opensMs: number | null, grade_scale: 'five' | 'hundred' | null = 'five') => ({
  topic_id, homework_id: `hw-${topic_id}`, kind, title, module_title: 'Модуль',
  opens_at: opensMs == null ? null : iso(opensMs), closes_at: opensMs == null ? null : iso(opensMs + 45 * 60_000), grade_scale,
})

function grades(students: { student_id: string; name: string }[], works: ReturnType<typeof work>[], cells: Record<string, Record<string, C>>): CourseGrades {
  const raw = {
    server_now: iso(NOW), is_template: false, group_id: 'g', group_name: '11А', students, works,
    cells: works.flatMap(w => students.map(s => {
      const [status, score] = cells[w.topic_id]?.[s.student_id] ?? ['none', null]
      return { topic_id: w.topic_id, student_id: s.student_id, status, score, attempt_id: status === 'none' ? null : `a-${w.topic_id}-${s.student_id}`, attempt_number: status === 'none' ? null : 1 }
    })),
  }
  const g = parseGrades(raw)
  if (!g) throw new Error('parse')
  return g
}

// Пятеро учеников, две проверочные и одна КР; даты — вперемешку с порядком в ответе.
const S = [st('s1', 'Белов Кирилл'), st('s2', 'Абрамова Софья'), st('s3', 'Гарипова Алина'), st('s4', 'Валиев Тимур'), st('s5', 'Давыдов Артём')]
const W = [
  work('kr', 'control', 'КР №1', NOW - 5 * DAY),
  work('trig', 'check', 'Тригонометрия', NOW - 3 * DAY),
  work('der', 'check', 'Производные', NOW - 10 * DAY),
  work('log', 'check', 'Логарифмы', NOW + 2 * DAY), // ещё не открылась, никто не сдавал
]
const CELLS: Record<string, Record<string, C>> = {
  der: { s1: ['reviewed', 5], s2: ['reviewed', 2], s3: ['submitted', null], s4: ['draft', null], s5: ['reviewed', 4] },
  trig: { s1: ['reviewed', 4], s2: ['reviewed', 2], s3: ['reviewed', 3], s4: ['returned', null], s5: ['none', null] },
  kr: { s1: ['reviewed', 5], s2: ['reviewed', 3], s3: ['reviewed', 2], s5: ['submitted', null] },
}
const G = grades(S, W, CELLS)

describe('parseGrades', () => {
  it('мусор — null; неизвестный статус клетки — none; числа строкой — числа', () => {
    expect(parseGrades(null)).toBeNull()
    expect(parseGrades([])).toBeNull()
    const g = parseGrades({ students: [{ student_id: 's', name: '' }], works: [{ topic_id: 't', kind: 'x' }], cells: [{ topic_id: 't', student_id: 's', status: 'weird', score: '4' }] })!
    expect(g.students[0].name).toBe('Без имени')
    expect(g.works[0].kind).toBe('check')
    expect(g.cells[0]).toMatchObject({ status: 'none', score: 4 })
  })
})

describe('журнал: столбцы', () => {
  it('сначала проверочные, потом контрольные, внутри — по дате; ещё не открывшаяся работа без сдач — не столбец', () => {
    const v = journalView(G, { kind: 'all', sort: 'name', nowMs: NOW })
    expect(v.columns.map(c => c.work.title)).toEqual(['Производные', 'Тригонометрия', 'КР №1'])
    expect(v.groups).toEqual([{ kind: 'check', title: 'Проверочные', span: 2 }, { kind: 'control', title: 'Контрольные', span: 1 }])
  })

  it('работа без окна, но со сдачей — столбец; без окна и без сдач — нет', () => {
    const w = work('n', 'control', 'Без времени', null)
    expect(isJournalWork(w, [], NOW)).toBe(false)
    expect(isJournalWork(w, [{ topic_id: 'n', student_id: 's1', status: 'draft', score: null, attempt_id: 'a', attempt_number: 1, auto_submitted: false }], NOW)).toBe(false)
    expect(isJournalWork(w, [{ topic_id: 'n', student_id: 's1', status: 'submitted', score: null, attempt_id: 'a', attempt_number: 1, auto_submitted: false }], NOW)).toBe(true)
  })

  it('фильтр типа: «Проверочные» — только они, «Контрольные» — только КР', () => {
    expect(journalView(G, { kind: 'check', sort: 'name', nowMs: NOW }).columns.map(c => c.work.title)).toEqual(['Производные', 'Тригонометрия'])
    const k = journalView(G, { kind: 'control', sort: 'name', nowMs: NOW })
    expect(k.columns.map(c => c.work.title)).toEqual(['КР №1'])
    expect(k.groups).toEqual([{ kind: 'control', title: 'Контрольные', span: 1 }])
  })
})

describe('журнал: клетки и средние', () => {
  const v = journalView(G, { kind: 'all', sort: 'name', nowMs: NOW })
  const row = (id: string) => v.rows.find(r => r.student.student_id === id)!

  it('оценка — цветом, сдал без вердикта — «ждёт», черновик и «не сдавал» — «—», возвращённая — «дораб.»', () => {
    expect(row('s1').cells.map(c => c.text)).toEqual(['5', '4', '5'])
    expect(row('s3').cells.map(c => c.kind)).toEqual(['wait', 'grade', 'grade'])
    expect(row('s4').cells.map(c => c.text)).toEqual(['—', 'дораб.', '—'])
    expect(row('s5').cells.map(c => c.text)).toEqual(['4', '—', 'ждёт'])
    const g = row('s2').cells[0]
    expect(g.kind === 'grade' && g.tone).toBe(2)
    // У клетки с попыткой — её id (для перехода в очередь проверки).
    expect(row('s3').cells[0]).toMatchObject({ kind: 'wait', attemptId: 'a-der-s3' })
  })

  it('средний ученика — только по проверенным; без оценок — null', () => {
    expect(row('s1').avg).toBeCloseTo(14 / 3)
    expect(row('s3').avg).toBeCloseTo(2.5) // «ждёт» не считается: (3 + 2) / 2
    expect(row('s5').avg).toBe(4) // «ждёт» и «—» не тянут вниз
    expect(row('s4').avg).toBeNull()
  })

  it('средний по классу: по работе — по проверенным; общий — среднее средних учеников', () => {
    expect(v.columns.map(c => c.classAvg)).toEqual(['3,7', '3,0', '3,3'])
    const avgs = [14 / 3, 7 / 3, 2.5, 4]
    expect(v.classAvg).toBeCloseTo(avgs.reduce((s, x) => s + x, 0) / 4)
  })

  it('точка у имени — две и больше двоек среди видимых столбцов', () => {
    expect(row('s2').twos).toBe(2)
    expect(row('s2').flagged).toBe(true)
    expect(row('s3').flagged).toBe(false)
    expect(v.flaggedCount).toBe(1)
    expect(journalMeta(v)).toBe('5 учеников · две и больше двоек у 1')
    // С фильтром «Контрольные» у Абрамовой двоек нет — и точки нет.
    const k = journalView(G, { kind: 'control', sort: 'name', nowMs: NOW })
    expect(k.rows.find(r => r.student.student_id === 's2')!.flagged).toBe(false)
  })
})

describe('журнал: порядок', () => {
  it('«По алфавиту» — по имени (русская сортировка)', () => {
    const v = journalView(G, { kind: 'all', sort: 'name', nowMs: NOW })
    expect(v.rows.map(r => r.student.name)).toEqual(['Абрамова Софья', 'Белов Кирилл', 'Валиев Тимур', 'Гарипова Алина', 'Давыдов Артём'])
  })

  it('«Сначала слабые» — по среднему по возрастанию, без оценок — в конце', () => {
    const v = journalView(G, { kind: 'all', sort: 'weak', nowMs: NOW })
    expect(v.rows.map(r => r.student.name)).toEqual(['Абрамова Софья', 'Гарипова Алина', 'Давыдов Артём', 'Белов Кирилл', 'Валиев Тимур'])
  })
})

describe('стобалльная шкала', () => {
  it('перевод порогами 90/70/50: в клетке — балл, цвет и средний — по переводу', () => {
    expect([95, 90, 89, 70, 69, 50, 49].map(s => fiveOf(s, 'hundred'))).toEqual([5, 5, 4, 4, 3, 3, 2])
    expect(fiveOf(4, 'five')).toBe(4)
    expect(fiveOf(4, null)).toBeNull()
    expect(toneOf(1)).toBe(2)

    const g = grades([st('a', 'А'), st('b', 'Б')], [work('p', 'check', 'Сотня', NOW - DAY, 'hundred'), work('f', 'check', 'Пятёрка', NOW - 2 * DAY)], {
      p: { a: ['reviewed', 92], b: ['reviewed', 45] },
      f: { a: ['reviewed', 3], b: ['reviewed', 2] },
    })
    const v = journalView(g, { kind: 'all', sort: 'name', nowMs: NOW })
    const a = v.rows[0], b = v.rows[1]
    expect(a.cells.map(c => c.text)).toEqual(['3', '92'])
    expect(a.cells[1]).toMatchObject({ tone: 5, five: 5 })
    expect(a.avg).toBe(4) // (3 + 5) / 2
    expect(b.twos).toBe(2) // 2 и 45 → 2
    expect(b.flagged).toBe(true)
    // Средний по классу у стобалльной — в баллах, целым.
    expect(v.columns.map(c => c.classAvg)).toEqual(['2,5', '69'])
  })

  it('принята без шкалы — «зачёт», без цвета и без среднего', () => {
    const g = grades([st('a', 'А')], [work('z', 'check', 'Без шкалы', NOW - DAY, null)], { z: { a: ['reviewed', null] } })
    const v = journalView(g, { kind: 'all', sort: 'name', nowMs: NOW })
    expect(v.rows[0].cells[0]).toMatchObject({ kind: 'grade', text: 'зачёт', tone: null })
    expect(v.rows[0].avg).toBeNull()
  })
})

describe('выгрузка', () => {
  it('таблица — то, что на экране: шапка, ученики в текущем порядке, строка среднего', () => {
    const v = journalView(G, { kind: 'check', sort: 'weak', nowMs: NOW })
    const sheet = journalSheet(v)
    expect(sheet[0][0]).toBe('Ученик')
    expect(sheet[0]).toHaveLength(4)
    expect(String(sheet[0][1])).toContain('Проверочная: Производные')
    expect(sheet[1]).toEqual(['Абрамова Софья', 2, 2, 2])
    expect(sheet.find(r => r[0] === 'Валиев Тимур')).toEqual(['Валиев Тимур', '—', 'на доработке', '—'])
    expect(sheet.find(r => r[0] === 'Гарипова Алина')![1]).toBe('ждёт проверки')
    expect(sheet[sheet.length - 1][0]).toBe('Средний по классу')
  })
})

describe('список работ', () => {
  // Как на проде (11А): одна проверочная, 24 ученика: 8×5, 2×4, 2×3, 4×2, 5 ждут, 3 не сдавали.
  const students = Array.from({ length: 24 }, (_, i) => st(`p${i}`, `Ученик ${String(i).padStart(2, '0')}`))
  const plan: C[] = [
    ...Array<C>(8).fill(['reviewed', 5]), ...Array<C>(2).fill(['reviewed', 4]), ...Array<C>(2).fill(['reviewed', 3]),
    ...Array<C>(4).fill(['reviewed', 2]), ...Array<C>(5).fill(['submitted', null]), ...Array<C>(3).fill(['none', null]),
  ]
  const der = work('der', 'check', 'Проверочная работа. Производные', NOW - 2 * DAY)
  const g = grades(students, [der], { der: Object.fromEntries(students.map((s, i) => [s.student_id, plan[i]])) })
  const summary = parseSummary({
    server_now: iso(NOW), is_template: false, group_id: 'g', group_name: '11А', in_class: 24, mocks: [],
    works: [
      { topic_id: 'der', kind: 'check', title: der.title, published: true, opens_at: der.opens_at, closes_at: der.closes_at, grade_scale: 'five', status: 'review', submitted: 21, pending: 5, reviewed: 16, avg_score: 3.875, writing: 0, personal_live: 0 },
      { topic_id: 'kr2', kind: 'control', title: 'КР №2', published: true, opens_at: iso(NOW + 3 * DAY), closes_at: iso(NOW + 3 * DAY + 3600_000), grade_scale: 'five', status: 'planned', submitted: 0, pending: 0, reviewed: 0, avg_score: null, writing: 0, personal_live: 0 },
    ],
  })!

  it('распределение 5/4/3/2 и «ждут» — из журнала', () => {
    expect(distributionOf(g, 'der')).toEqual({ five: 8, four: 2, three: 2, two: 4, wait: 5, total: 24 })
  })

  it('по дате, «Проверить N» → очередь по теме; запланированная — «Окно темы», без статистики', () => {
    const rows = worksList(summary, g, NOW)
    expect(rows.map(r => r.title)).toEqual(['Проверочная работа. Производные', 'КР №2'])
    expect(rows[0]).toMatchObject({ kind: 'check', submitted: '21 из 24', avg: '3,9', status: { text: 'проверить 5' } })
    expect(rows[0].actions).toEqual([{ kind: 'queue', label: 'Проверить 5', topicId: 'der' }])
    expect(rows[0].dist).toMatchObject({ five: 8, wait: 5 })
    expect(rows[1].actions[0]).toMatchObject({ kind: 'topic', label: 'Окно темы' })
    expect(rows[1].dist).toBeNull()
    expect(worksMeta(rows, summary)).toBe('1 проверочная · 1 контрольная · ждут проверки 5')
  })

  it('без журнала (миграция не применена) — список есть, полосок нет', () => {
    expect(worksList(summary, null, NOW).every(r => r.dist === null)).toBe(true)
  })
})
