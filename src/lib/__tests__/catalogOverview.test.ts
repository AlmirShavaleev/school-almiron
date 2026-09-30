import { describe, expect, it } from 'vitest'
import {
  barTip, examBars, examChips, isDimmed, mergeNumbers, normalizeCatalogOverview, numberRange, overallRank,
  solvedCaption, strongestLabel, subjectRows, summaryChips, summaryState, untouchedMine,
  type CatalogOverview,
} from '@/lib/catalogOverview'

/**
 * §246/§246.1. Разбор ответа `catalog_my_overview()` и всё, что из него рисует
 * главная каталога. Ответ — в форме функции (snake_case, числа), как с прода.
 * С §246.1 личное — всем вошедшим, сравнение — только при compare (ученик).
 */

type RawNum = { n: number; total: number; solved?: number | null; section_id?: string | null }
const nums = (spec: Array<[number, number, number?]>): RawNum[] =>
  spec.map(([n, total, solved]) => ({ n, total, solved: solved ?? 0, section_id: `sec-${n}` }))

const rawStudent = (over: Record<string, unknown> = {}) => ({
  viewer: 'student',
  compare: true,
  min_solvers: 10,
  overall: { solved: 12, solved_7d: 5, solvers: 23, better_pct: 68 },
  exams: [
    // Порядок в ответе нарочно перемешан: раскладка обязана расставить сама.
    { subject: 'Физика', exam_type: 'ОГЭ', is_mine: false, total: 7, solved: 0, solved_7d: 0, solvers: null, better_pct: null,
      numbers: nums([[1, 2], [20, 5]]) },
    { subject: 'Математика', exam_type: 'ЕГЭ', is_mine: true, total: 15, solved: 9, solved_7d: 4, solvers: 23, better_pct: 72,
      numbers: nums([[1, 8, 6], [2, 3, 3], [12, 4, 0]]) },
    { subject: 'Физика', exam_type: 'ЕГЭ', is_mine: false, total: 3, solved: 3, solved_7d: 1, solvers: 7, better_pct: null,
      numbers: nums([[1, 3, 3]]) },
    { subject: 'Математика', exam_type: 'ОГЭ', is_mine: false, total: 2, solved: 0, solved_7d: 0, solvers: null, better_pct: null,
      numbers: nums([[1, 2]]) },
  ],
  ...over,
})

const student = (over: Record<string, unknown> = {}) => normalizeCatalogOverview(rawStudent(over)) as CatalogOverview
/** Учитель/админ после §246.1: своё решённое есть, сравнения нет, «своих» экзаменов нет. */
const staffRaw = () => ({
  viewer: 'staff', compare: false, min_solvers: 10,
  overall: { solved: 2, solved_7d: 2, solvers: null, better_pct: null },
  exams: [
    { subject: 'Математика', exam_type: 'ЕГЭ', is_mine: false, total: 15, solved: 2, solved_7d: 2, solvers: null, better_pct: null,
      numbers: nums([[1, 8, 1], [2, 3, 1], [12, 4, 0]]) },
    { subject: 'Физика', exam_type: 'ОГЭ', is_mine: false, total: 7, solved: 0, solved_7d: 0, solvers: null, better_pct: null,
      numbers: nums([[1, 2], [20, 5]]) },
  ],
})
const staff = () => normalizeCatalogOverview(staffRaw()) as CatalogOverview
const exam = (o: CatalogOverview, subject: string, examType: string) =>
  o.exams.find(e => e.subject === subject && e.examType === examType)!

describe('normalizeCatalogOverview', () => {
  it('разбирает ответ ученика и не верит мусору', () => {
    expect(normalizeCatalogOverview(null)).toBeNull()
    expect(normalizeCatalogOverview('x')).toBeNull()
    const o = student()
    expect(o.viewer).toBe('student')
    expect(o.overall).toEqual({ solved: 12, solved7d: 5, solvers: 23, betterPct: 68 })
    expect(exam(o, 'Математика', 'ЕГЭ')).toMatchObject({ isMine: true, total: 15, solved: 9, solved7d: 4, betterPct: 72 })
  })

  it('«0 %» и проценты вне 1..99 не проходят (правило §223)', () => {
    const o = student({ overall: { solved: 1, solved_7d: 0, solvers: 12, better_pct: 0 } })
    expect(o.overall?.betterPct).toBeNull()
    expect(student({ overall: { solved: 1, solved_7d: 0, solvers: 12, better_pct: 100 } }).overall?.betterPct).toBeNull()
  })

  it('учитель/админ (§246.1): своё решённое есть, сравнения нет', () => {
    const o = staff()
    expect(o.compare).toBe(false)
    expect(o.overall).toEqual({ solved: 2, solved7d: 2, solvers: null, betterPct: null })
    expect(exam(o, 'Математика', 'ЕГЭ')).toMatchObject({ solved: 2, solvers: null, betterPct: null })
    expect(exam(o, 'Математика', 'ЕГЭ').numbers.map(r => r.solved)).toEqual([1, 1, 0])
  })

  it('compare=false гасит сравнение, даже если числа пришли', () => {
    const o = normalizeCatalogOverview({ ...rawStudent(), compare: false })!
    expect(o.overall.betterPct).toBeNull()
    expect(o.overall.solvers).toBeNull()
    expect(o.exams.every(e => e.betterPct === null && e.solvers === null)).toBe(true)
  })

  it('ответ функции §246 без compare: сравнение — по viewer, у персонала решённого нет → 0', () => {
    const old: Record<string, unknown> = { ...rawStudent() }
    delete old.compare
    expect(normalizeCatalogOverview(old)!.compare).toBe(true)
    const oldStaff = normalizeCatalogOverview({
      viewer: 'staff', min_solvers: 10, overall: null,
      exams: [{ subject: 'Математика', exam_type: 'ЕГЭ', total: 3, solved: null, numbers: [{ n: 1, total: 3, solved: null, section_id: 's' }] }],
    })!
    expect(oldStaff.compare).toBe(false)
    expect(oldStaff.overall.solved).toBe(0)
    expect(oldStaff.exams[0].numbers[0].solved).toBe(0)
  })

  it('экзамен без единой задачи не рисуется', () => {
    const o = student({
      exams: [{ subject: 'Физика', exam_type: 'ЕГЭ', total: 0, numbers: [{ n: 0, total: 0, solved: 0, section_id: 'p0' }] }],
    })
    expect(o.exams).toEqual([])
  })
})

describe('mergeNumbers — несколько разделов одного номера', () => {
  it('№20 физики ОГЭ из трёх разделов — один столбик: задачи и решённое складываются, ссылка — в первый непустой', () => {
    const merged = mergeNumbers([
      { n: 20, total: 0, solved: 0, sectionId: 'pusto' },
      { n: 20, total: 125, solved: 2, sectionId: 'b' },
      { n: 1, total: 126, solved: 0, sectionId: 'one' },
      { n: 20, total: 250, solved: 1, sectionId: 'c' },
    ])
    expect(merged).toEqual([
      { n: 1, total: 126, solved: 0, sectionId: 'one' },
      { n: 20, total: 375, solved: 3, sectionId: 'b' },
    ])
  })

  it('пустой №0 и номер без задач столбика не получают', () => {
    expect(mergeNumbers([
      { n: 0, total: 0, solved: 0, sectionId: 'old' },
      { n: 3, total: 0, solved: 0, sectionId: 'empty' },
      { n: 2, total: 5, solved: 0, sectionId: 's2' },
    ]).map(r => r.n)).toEqual([2])
  })

  it('первый раздел номера непустой — ссылка на него', () => {
    expect(mergeNumbers([
      { n: 4, total: 1, solved: 0, sectionId: 'a' },
      { n: 4, total: 2, solved: 1, sectionId: 'b' },
    ])[0]).toEqual({ n: 4, total: 3, solved: 1, sectionId: 'a' })
  })
})

describe('раскладка по предметам и номерам', () => {
  it('математика, потом физика; внутри ЕГЭ, потом ОГЭ', () => {
    const rows = subjectRows(student())
    expect(rows.map(r => r.subject)).toEqual(['Математика', 'Физика'])
    expect(rows.map(r => r.exams.map(e => e.examType))).toEqual([['ЕГЭ', 'ОГЭ'], ['ЕГЭ', 'ОГЭ']])
    expect(rows.map(r => r.solved)).toEqual([9, 3])
    expect(rows.map(r => r.glyph)).toEqual(['∑', 'Φ'])
  })

  it('столбики ученика: высота от лучшего номера, не начатый — короткий серый, ссылка в раздел', () => {
    const o = student()
    const bars = examBars(exam(o, 'Математика', 'ЕГЭ'))
    expect(bars.map(b => [b.n, b.on, b.heightPx])).toEqual([[1, true, 70], [2, true, 35], [12, false, 6]])
    expect(bars[0].href).toBe('/catalog/sec-1?subject=math&exam=ege')
    expect(bars[2].tip).toBe('№12 · не начат · 4 задачи')
    expect(bars[0].tip).toBe('№1 · решено 6 из 8')
  })

  it('маленькое решённое всё равно видно (не ниже 8 px)', () => {
    const o = student({
      exams: [{ subject: 'Математика', exam_type: 'ЕГЭ', is_mine: true, total: 1300, solved: 101,
        numbers: nums([[1, 1000, 100], [2, 300, 1]]) }],
    })
    expect(examBars(o.exams[0]).map(b => b.heightPx)).toEqual([70, 8])
  })

  it('учителю столбики — тоже по его решённому (§246.1)', () => {
    const o = staff()
    const bars = examBars(exam(o, 'Математика', 'ЕГЭ'))
    expect(bars.map(b => [b.on, b.heightPx])).toEqual([[true, 70], [true, 70], [false, 6]])
    expect(bars[0].tip).toBe('№1 · решено 1 из 8')
  })

  it('подсказки: склонения из plural.ts и разряды', () => {
    expect(barTip({ n: 12, total: 503, solved: 3, sectionId: 'x' })).toBe('№12 · решено 3 из 503')
    expect(barTip({ n: 12, total: 503, solved: 0, sectionId: 'x' })).toBe('№12 · не начат · 503 задачи')
    expect(barTip({ n: 1, total: 1036, solved: 0, sectionId: 'x' })).toBe('№1 · не начат · 1\u00a0036 задач')
    expect(barTip({ n: 21, total: 1, solved: 0, sectionId: 'x' })).toBe('№21 · не начат · 1 задача')
    expect(barTip({ n: 3, total: 11, solved: 0, sectionId: 'x' })).toBe('№3 · не начат · 11 задач')
  })

  it('диапазон номеров над столбиками', () => {
    const o = student()
    expect(numberRange(exam(o, 'Математика', 'ЕГЭ'))).toBe('№1–12')
    expect(numberRange(exam(o, 'Математика', 'ОГЭ'))).toBe('№1')
  })
})

describe('чипы экзамена', () => {
  it('решает, сравнение есть: +за неделю, «больше, чем N % школы», не начатые номера', () => {
    const o = student()
    expect(examChips(o, exam(o, 'Математика', 'ЕГЭ')).map(c => c.text))
      .toEqual(['+4 за неделю', 'больше, чем 72 % школы', 'не начато: 1 номер'])
  })

  it('решающих меньше 10 — «сравнение — когда решающих будет 10+»', () => {
    const o = student()
    expect(examChips(o, exam(o, 'Физика', 'ЕГЭ')).map(c => c.text))
      .toEqual(['+1 за неделю', 'сравнение — когда решающих будет 10+'])
  })

  it('решающих 10+, но доля 0 % — про сравнение молчим', () => {
    const o = student({
      exams: [{ subject: 'Математика', exam_type: 'ЕГЭ', is_mine: true, solved: 1, solved_7d: 0, solvers: 14, better_pct: 0,
        numbers: nums([[1, 5, 1], [2, 3, 0], [3, 3, 0]]) }],
    })
    expect(examChips(o, o.exams[0]).map(c => c.text)).toEqual(['не начато: 2 номера'])
  })

  it('не начатый экзамен: свой — «пока ничего не отмечено», чужой — «не твой экзамен» и бледнее', () => {
    const o = student()
    const oge = exam(o, 'Математика', 'ОГЭ')
    expect(isDimmed(o, oge)).toBe(true)
    expect(examChips(o, oge).map(c => c.text)).toEqual(['не твой экзамен — можно потренироваться'])
    expect(isDimmed(o, exam(o, 'Математика', 'ЕГЭ'))).toBe(false)
  })

  it('у ученика без групп «своих» нет — ничего не бледнеет', () => {
    const raw = rawStudent()
    const o = normalizeCatalogOverview({ ...raw, exams: (raw.exams as Array<Record<string, unknown>>).map(e => ({ ...e, is_mine: false })) })!
    expect(o.exams.some(e => isDimmed(o, e))).toBe(false)
    expect(examChips(o, exam(o, 'Математика', 'ОГЭ')).map(c => c.text)).toEqual(['пока ничего не отмечено'])
  })

  it('учителю — неделя и не начатые номера, никакого сравнения; без «своих» ничего не бледнеет', () => {
    const o = staff()
    expect(examChips(o, exam(o, 'Математика', 'ЕГЭ')).map(c => c.text)).toEqual(['+2 за неделю', 'не начато: 1 номер'])
    expect(examChips(o, exam(o, 'Физика', 'ОГЭ')).map(c => c.text)).toEqual(['пока ничего не отмечено'])
    expect(o.exams.some(e => isDimmed(o, e))).toBe(false)
  })

  it('решающих мало, но compare=false — «когда решающих будет 10+» не пишем', () => {
    const o = normalizeCatalogOverview({ ...rawStudent(), compare: false })!
    expect(examChips(o, exam(o, 'Физика', 'ЕГЭ')).map(c => c.text)).toEqual(['+1 за неделю'])
  })
})

describe('личный итог — три состояния', () => {
  it('активный: сильнее всего, не начатые номера СВОИХ экзаменов, доля школы с названием экзамена', () => {
    const o = student()
    expect(summaryState(o)).toBe('active')
    expect(strongestLabel(o)).toBe('математика №1')
    // Свой — только математика ЕГЭ: №12 не начат.
    expect(untouchedMine(o)).toBe(1)
    expect(summaryChips(o).map(c => c.text)).toEqual(['+5 за неделю', 'сильнее всего: математика №1', 'не начаты: 1 номер'])
    expect(overallRank(o)).toEqual({ kind: 'pct', pct: 68, caption: 'учеников школы, которые решают в каталоге ЕГЭ' })
  })

  it('мало сравнения: «появится, когда будут решать хотя бы 10 (сейчас N)»', () => {
    const o = student({ overall: { solved: 12, solved_7d: 0, solvers: 5, better_pct: null } })
    expect(overallRank(o)).toEqual({
      kind: 'wait',
      text: 'Сравнение появится, когда в каталоге будут решать хотя бы 10 учеников школы (сейчас 5)',
    })
    expect(summaryChips(o).map(c => c.text)).toEqual(['сильнее всего: математика №1', 'не начаты: 1 номер'])
  })

  it('новичок: 0 задач, без чипов, сравнение — после первых задач', () => {
    const raw = rawStudent()
    const o = normalizeCatalogOverview({
      ...raw,
      overall: { solved: 0, solved_7d: 0, solvers: 0, better_pct: null },
      exams: (raw.exams as Array<{ numbers: RawNum[] } & Record<string, unknown>>).map(e => ({
        ...e, solved: 0, solved_7d: 0, better_pct: null, numbers: e.numbers.map(r => ({ ...r, solved: 0 })),
      })),
    })!
    expect(summaryState(o)).toBe('new')
    expect(summaryChips(o)).toEqual([])
    expect(strongestLabel(o)).toBeNull()
    expect(overallRank(o)).toEqual({ kind: 'wait', text: 'Сравнение со школой появится после первых решённых задач' })
  })

  it('учитель с отметками — итог как у ученика, без правой части сравнения', () => {
    const o = staff()
    expect(summaryState(o)).toBe('active')
    expect(summaryChips(o).map(c => c.text)).toEqual(['+2 за неделю', 'сильнее всего: математика №1', 'не начаты: 1 номер'])
    expect(overallRank(o)).toEqual({ kind: 'none' })
  })

  it('учитель-новичок — «0», но и «сравнение появится после первых задач» не пишем', () => {
    const raw = staffRaw()
    const o = normalizeCatalogOverview({
      ...raw, overall: { solved: 0, solved_7d: 0, solvers: null, better_pct: null },
      exams: raw.exams.map(e => ({ ...e, solved: 0, solved_7d: 0, numbers: e.numbers.map(r => ({ ...r, solved: 0 })) })),
    })!
    expect(summaryState(o)).toBe('new')
    expect(overallRank(o)).toEqual({ kind: 'none' })
  })

  it('сравнение по двум экзаменам разного типа — без названия экзамена', () => {
    const raw = rawStudent()
    const o = normalizeCatalogOverview({
      ...raw,
      exams: (raw.exams as Array<Record<string, unknown>>).map(e =>
        e.subject === 'Физика' && e.exam_type === 'ОГЭ' ? { ...e, solved: 1, numbers: nums([[1, 2, 1], [20, 5, 0]]) } : e),
    })!
    expect(overallRank(o)).toMatchObject({ kind: 'pct', caption: 'учеников школы, которые решают в каталоге' })
  })

  it('«сильнее всего» называет экзамен, только если предмет решается в обоих', () => {
    const raw = rawStudent()
    const o = normalizeCatalogOverview({
      ...raw,
      exams: (raw.exams as Array<Record<string, unknown>>).map(e =>
        e.subject === 'Математика' && e.exam_type === 'ОГЭ' ? { ...e, solved: 8, numbers: nums([[1, 2, 8]]) } : e),
    })!
    // В ЕГЭ лучший №1 = 6, в ОГЭ №1 = 8 → ОГЭ.
    expect(strongestLabel(o)).toBe('математика ОГЭ №1')
  })

  it('подпись под числом решённого склоняется', () => {
    expect(solvedCaption(0)).toBe('задач решено')
    expect(solvedCaption(1)).toBe('задача решена')
    expect(solvedCaption(3)).toBe('задачи решено')
    expect(solvedCaption(11)).toBe('задач решено')
    expect(solvedCaption(21)).toBe('задача решена')
  })
})
