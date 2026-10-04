import { describe, expect, it } from 'vitest'
import {
  computeScore,
  filterFindings,
  parsePoints,
  parseTasks,
  reconcileTasksDetailed,
  roundsToExpected,
  verdictFromPoints,
  type TaskRow,
} from '../../../supabase/functions/check-homework-ai/findings.ts'
import {
  CRITERIA_MISMATCH_HEAD,
  capConfidence,
  checkGradeTable,
  gradeByCriteria,
  gradeFromTable,
  parseGradeTable,
  withCriteriaNote,
  withRoundedNote,
  type GradeTableRow,
} from '../../../supabase/functions/check-homework-ai/points.ts'

/**
 * §260. ИИ ставит баллы по критериям учителя, сумму и оценку считает код.
 *
 * Фикстура — настоящие критерии проверочной 10А «Движение по окружности»
 * (03.10) и три работы на 7, 9 и 12 баллов. До §260 оценку по ним считал
 * `computeScore` (доля верных заданий, пороги 90/70/50 %), и у двоих из 11
 * учеников она выходила не та: 7 из 12 → «4» (по критериям «3»), 9 из 12 →
 * «3» (по критериям «4»).
 */

const CRITERIA_10A = [
  'Ответы и критерии. Проверочная работа «Движение по окружности», 10А.',
  'Задания 1–5 оцениваются в 1 балл.',
  'Задание 6 — 2 балла (1 балл — допущена одна ошибка).',
  'Задание 7 — 2 балла (по 1 баллу за каждую найденную величину).',
  'Задание 8 — 3 балла (по 1 баллу за каждую найденную величину).',
  'Перевод в оценку (максимум 12 баллов): 11–12 → «5», 8–10 → «4», 5–7 → «3», 0–4 → «2».',
].join('\n')

/** Таблица перевода из критериев — так, как её должна переписать модель. */
const TABLE_10A = [
  { min: 11, max: 12, grade: 5 },
  { min: 8, max: 10, grade: 4 },
  { min: 5, max: 7, grade: 3 },
  { min: 0, max: 4, grade: 2 },
]

const EXPECTED = ['T = 0,2 с; ν = 5 Гц', '3,1 м/с', '5 м/с²', 'в 9 раз', '15 оборотов', '112', 'T ≈ 0,67 с; v ≈ 0,38 м/с', 'а) 4,0 об/с; б) 250 м/с²; в) N ≈ 398']
const MAX = [1, 1, 1, 1, 1, 2, 2, 3]

/** Строки модели для работы: баллы по заданиям, ответы — как прочитаны. */
function modelTasks(points: Array<number | string>, answers: string[] = EXPECTED) {
  return points.map((p, i) => ({
    no: String(i + 1),
    // Модель пишет вердикт как придётся — код выводит его из баллов.
    verdict: 'correct',
    points: p,
    max_points: i % 2 === 0 ? MAX[i] : String(MAX[i]),
    student_answer: answers[i],
    expected_answer: EXPECTED[i],
    note: '',
  }))
}

/** Путь функции целиком: разбор → сверка с находками → сумма и оценка. */
function gradeWork(rawTasks: unknown[], extra: { gradeTable?: unknown; maxTotal?: unknown; scale?: string } = {}) {
  const tasks = filterFindings([], parseTasks(rawTasks, { points: true })).tasks
  return {
    tasks,
    grade: gradeByCriteria({
      tasks,
      gradeTable: 'gradeTable' in extra ? extra.gradeTable : TABLE_10A,
      maxTotal: 'maxTotal' in extra ? extra.maxTotal : 12,
      scale: extra.scale ?? 'five',
    }),
  }
}

// Ответы работ: где балл неполный — ответ ученика другой (иначе сверка по
// ответам подняла бы балл задания в 1 балл, и это отдельный тест).
const WORK_7 = modelTasks([1, 1, 1, 1, 1, 1, 1, 0],
  ['T = 0,2 с; ν = 5 Гц', '3,1 м/с', '5 м/с²', 'в 9 раз', '15 оборотов', '121', 'T ≈ 0,67 с', 'ν ≈ 2 об/с'])
const WORK_9 = modelTasks([0, 1, 1, 1, 1, '2', '1', 2],
  ['T = 0,2 с', '3,1 м/с', '5 м/с²', 'в 9 раз', '15 оборотов', '112', 'T ≈ 0,67 с', 'ν ≈ 4,0 об/с; a = 250 м/с²'])
const WORK_12 = modelTasks([1, 1, 1, 1, 1, 2, 2, 3])

describe('§260. проверочная 10А: 7, 9 и 12 баллов → «3», «4», «5»', () => {
  it.each([
    ['7 из 12', WORK_7, 7, 3],
    ['9 из 12', WORK_9, 9, 4],
    ['12 из 12', WORK_12, 12, 5],
  ])('%s', (_label, raw, total, mark) => {
    const { grade } = gradeWork(raw)
    expect(grade).toMatchObject({ grading: 'criteria', total, max: 12, score: mark, problem: null })
    expect(grade.gradeTable?.map(r => r.min)).toEqual([0, 5, 8, 11])
  })

  it('та же работа по прежней формуле давала не ту оценку — вот ради чего §260', () => {
    // 7 из 12: верных 5 заданий из 8, частичных 2, неверное 1 →
    // (5 + 0,5·2) / 8 = 0,75 → «4». По критериям 7 баллов — «3».
    const { tasks } = gradeWork(WORK_7)
    expect(computeScore(tasks, 'five').score).toBe(4)
    expect(gradeWork(WORK_7).grade.score).toBe(3)
  })

  it('стобалльная шкала — процент от суммы, а не по таблице', () => {
    expect(gradeWork(WORK_9, { scale: 'hundred' }).grade).toMatchObject({ grading: 'criteria', score: 75 })
    expect(gradeWork(WORK_12, { scale: 'hundred' }).grade.score).toBe(100)
  })

  it('критерии в тексте фикстуры называют ту же таблицу и тот же максимум', () => {
    // Защита от расхождения фикстуры с самой собой: таблица и максимум выше —
    // переписанные из этого текста, а не придуманные.
    expect(CRITERIA_10A).toContain('максимум 12 баллов')
    for (const row of TABLE_10A) expect(CRITERIA_10A).toContain(`${row.min}–${row.max} → «${row.grade}»`)
    expect(MAX.reduce((a, b) => a + b, 0)).toBe(12)
  })
})

describe('§260. границы таблицы перевода', () => {
  const rowsOf = (total: number): TaskRow[] => {
    // 12 заданий по 1 баллу: `total` верных.
    return Array.from({ length: 12 }, (_, i) => ({
      no: String(i + 1), verdict: i < total ? 'correct' : 'wrong', student_answer: '', expected_answer: '', note: '',
      points: i < total ? 1 : 0, max_points: 1,
    }))
  }
  it.each([
    [0, 2], [4, 2], [5, 3], [7, 3], [8, 4], [10, 4], [11, 5], [12, 5],
  ])('%i баллов → «%i»', (total, mark) => {
    expect(gradeByCriteria({ tasks: rowsOf(total), gradeTable: TABLE_10A, maxTotal: 12, scale: 'five' }).score).toBe(mark)
  })

  it('дробная сумма берётся по строке, чью нижнюю границу уже перешла: 7,5 → «3», 10,5 → «4»', () => {
    const rows = parseGradeTable(TABLE_10A)!.rows
    expect(gradeFromTable(rows, 7.5)).toBe(3)
    expect(gradeFromTable(rows, 10.5)).toBe(4)
    expect(gradeFromTable(rows, 8)).toBe(4)
  })
})

describe('§260. сверка: критерии прочитаны не полностью → оценки нет', () => {
  it('сумма максимумов ≠ max_total (выпала строка задания 8) → criteria_mismatch', () => {
    const raw = WORK_9.slice(0, 7)
    const { grade } = gradeWork(raw)
    expect(grade).toMatchObject({ grading: 'criteria_mismatch', score: null, total: 7, max: 9 })
    expect(grade.problem).toContain('сумма максимумов по заданиям 9, а в критериях максимум 12')
  })

  it('дыра в таблице (нет 8–10) → criteria_mismatch', () => {
    const table = TABLE_10A.filter(r => r.grade !== 4)
    const { grade } = gradeWork(WORK_9, { gradeTable: table })
    expect(grade.grading).toBe('criteria_mismatch')
    expect(grade.score).toBeNull()
    expect(grade.problem).toContain('пропущены баллы 8–10')
  })

  it('пересечение строк таблицы → criteria_mismatch', () => {
    const table = [...TABLE_10A.filter(r => r.grade !== 4), { min: 7, max: 10, grade: 4 }]
    const { grade } = gradeWork(WORK_9, { gradeTable: table })
    expect(grade.grading).toBe('criteria_mismatch')
    expect(grade.problem).toContain('пересекаются')
  })

  it('таблица не с нуля, не до максимума, с кривой строкой или с оценками не по порядку → criteria_mismatch', () => {
    const notFromZero = TABLE_10A.map(r => (r.min === 0 ? { ...r, min: 1 } : r))
    const short = TABLE_10A.map(r => (r.max === 12 ? { ...r, max: 11 } : r))
    const broken = [...TABLE_10A.slice(0, 3), { min: 'ноль', max: 4, grade: 2 }]
    const badGrade = TABLE_10A.map(r => (r.grade === 2 ? { ...r, grade: 7 } : r))
    const unordered = TABLE_10A.map(r => (r.grade === 3 ? { ...r, grade: 5 } : r))
    for (const table of [notFromZero, short, broken, badGrade, unordered]) {
      expect(gradeWork(WORK_9, { gradeTable: table }).grade.grading).toBe('criteria_mismatch')
    }
    // Без max_total таблица сверяется с суммой максимумов сама.
    expect(gradeWork(WORK_9, { gradeTable: short, maxTotal: null }).grade.problem)
      .toBe('таблица перевода доходит до 11, а сумма максимумов по заданиям — 12')
  })

  it('баллы есть не у всех заданий → criteria_mismatch с номерами', () => {
    const raw = WORK_9.map((t, i) => (i === 7 ? { ...t, max_points: undefined } : t))
    const { grade } = gradeWork(raw)
    expect(grade).toMatchObject({ grading: 'criteria_mismatch', score: null })
    expect(grade.problem).toBe('нет баллов по критериям у заданий 8')
  })

  it('пометка в разборе и уверенность не выше medium', () => {
    const { grade } = gradeWork(WORK_9.slice(0, 7))
    const summary = withCriteriaNote('Разбор', grade)
    expect(summary.startsWith('Разбор\n\n' + CRITERIA_MISMATCH_HEAD)).toBe(true)
    expect(summary).toContain('Оценка не подставлена')
    expect(capConfidence('high', grade)).toBe('medium')
    expect(capConfidence('low', grade)).toBe('low')
    // Без расхождения — ни пометки, ни понижения.
    const ok = gradeWork(WORK_9).grade
    expect(withCriteriaNote('Разбор', ok)).toBe('Разбор')
    expect(capConfidence('high', ok)).toBe('high')
  })

  it('checkGradeTable на годной таблице молчит', () => {
    expect(checkGradeTable(parseGradeTable(TABLE_10A)!.rows, 12)).toBeNull()
  })
})

describe('§260. без таблицы — по доле баллов, а не по числу заданий', () => {
  it('9 из 12 → 0,75 → «4»; 7 из 12 → 0,58 → «3»', () => {
    expect(gradeWork(WORK_9, { gradeTable: [], maxTotal: null }).grade).toMatchObject({ grading: 'ratio', score: 4, gradeTable: null })
    expect(gradeWork(WORK_7, { gradeTable: undefined, maxTotal: null }).grade).toMatchObject({ grading: 'ratio', score: 3 })
  })

  it('max_total без таблицы тоже сверяется', () => {
    expect(gradeWork(WORK_9, { gradeTable: [], maxTotal: 13 }).grade.grading).toBe('criteria_mismatch')
  })

  it('несверенное задание: без таблицы — ни за, ни против; с таблицей — оценки нет', () => {
    const raw = WORK_9.map((t, i) => (i === 7 ? { ...t, verdict: 'unchecked', points: null } : t))
    // Сверено 7 заданий на 9 максимальных баллов, набрано 7 → 0,78 → «4».
    expect(gradeWork(raw, { gradeTable: [], maxTotal: null }).grade).toMatchObject({ grading: 'ratio', total: 7, max: 12, score: 4 })
    expect(gradeWork(raw).grade).toMatchObject({ grading: 'criteria', total: 7, max: 12, score: null })
  })
})

describe('§260. без критериев — всё как было', () => {
  const OLD = [
    { no: '1', verdict: 'correct', student_answer: '12 м/с', expected_answer: '12 м/с', note: '' },
    { no: '2', verdict: 'partial', student_answer: '30 Н', expected_answer: '30 Н', note: 'хода нет', points: 1, max_points: 2 },
    { no: '3', verdict: 'wrong', student_answer: '−2', expected_answer: '2', note: 'знак' },
    { no: '4', verdict: 'unchecked', student_answer: '', expected_answer: '18 c', note: '' },
  ]

  it('parseTasks без флага баллов не читает их вовсе — строка та же до байта', () => {
    const tasks = parseTasks(OLD)
    expect(JSON.stringify(tasks)).toBe(JSON.stringify(OLD.map(({ points: _p, max_points: _m, ...rest }) => rest)))
    expect(tasks.some(t => 'points' in t || 'max_points' in t)).toBe(false)
  })

  it('computeScore по старой таблице — прежние числа; gradeByCriteria молчит', () => {
    const tasks = filterFindings([], parseTasks(OLD)).tasks
    expect(computeScore(tasks, 'five')).toEqual({ correct: 1, partial: 1, wrong: 1, unchecked: 1, counted: 3, ratio: 0.5, score: 3 })
    expect(computeScore(tasks, 'hundred').score).toBe(50)
    expect(gradeByCriteria({ tasks, gradeTable: TABLE_10A, maxTotal: 12, scale: 'five' }))
      .toEqual({ grading: null, total: null, max: null, score: null, gradeTable: null, problem: null })
  })
})

describe('§260. вердикт из баллов и разбор кривого JSON модели', () => {
  it('verdictFromPoints: максимум — верно, ноль — неверно, между — частично, нет балла — не сверено', () => {
    expect(verdictFromPoints(2, 2)).toBe('correct')
    expect(verdictFromPoints(0, 2)).toBe('wrong')
    expect(verdictFromPoints(1, 3)).toBe('partial')
    expect(verdictFromPoints(null, 3)).toBe('unchecked')
  })

  it('вердикт модели не важен: «верно» при 1 из 2 становится «частично»', () => {
    const [row] = parseTasks([{ no: '6', verdict: 'correct', points: 1, max_points: 2, student_answer: '121', expected_answer: '112' }], { points: true })
    expect(row).toMatchObject({ verdict: 'partial', points: 1, max_points: 2 })
  })

  it.each([
    [2, 2], ['2', 2], ['2,5', 2.5], ['1 балл', 1], [' 3 балла ', 3], [0, 0], ['0', 0],
    ['2 из 3', null], ['1–2', null], [-1, null], ['-1', null], [Number.NaN, null], [Infinity, null],
    ['', null], [null, null], [undefined, null], [{}, null], [true, null], ['два', null], [1000, null],
  ])('parsePoints(%j) → %j', (raw, expected) => {
    expect(parsePoints(raw)).toBe(expected)
  })

  it('кривые баллы: нет балла — по вердикту (верно → максимум, неверно → 0, частично → не сверено); больше максимума — максимум', () => {
    const rows = parseTasks([
      { no: '1', verdict: 'correct', points: 'много', max_points: 2 },
      { no: '2', verdict: 'wrong', max_points: '2' },
      { no: '3', verdict: 'partial', max_points: 3 },
      { no: '4', verdict: 'unchecked', points: 1, max_points: 1 },
      { no: '5', points: 5, max_points: 3 },
      { no: '6', points: 1, max_points: 'два' },
      { no: '7', points: 1, max_points: 0 },
    ], { points: true })
    expect(rows.map(r => [r.no, r.verdict, r.points, r.max_points])).toEqual([
      ['1', 'correct', 2, 2],
      ['2', 'wrong', 0, 2],
      ['3', 'unchecked', null, 3],
      ['4', 'unchecked', null, 1],
      ['5', 'correct', 3, 3],
      // Без годного максимума баллов у строки нет — сверка назовёт её.
      ['6', 'unchecked', undefined, undefined],
      ['7', 'unchecked', undefined, undefined],
    ])
  })

  it('отсутствие полей корня: нет grade_table и max_total — оценка по доле', () => {
    const tasks = parseTasks(WORK_12, { points: true })
    expect(gradeByCriteria({ tasks, gradeTable: undefined, maxTotal: undefined, scale: 'five' }))
      .toMatchObject({ grading: 'ratio', score: 5, total: 12, max: 12 })
  })

  it('parseGradeTable: строки-числа и запасные имена; пусто — таблицы нет', () => {
    expect(parseGradeTable([{ from: '0', to: '4', mark: '2' }, { min: 5, max: 12, grade: 4 }])).toEqual({
      rows: [{ min: 0, max: 4, grade: 2 }, { min: 5, max: 12, grade: 4 }] satisfies GradeTableRow[], broken: false,
    })
    expect(parseGradeTable([])).toBeNull()
    expect(parseGradeTable('11–12 → 5')).toBeNull()
    expect(parseGradeTable([{ min: 8, max: 7, grade: 4 }])).toEqual({ rows: [], broken: true })
  })
})

describe('§260. сверка ответов при баллах', () => {
  it('ответ совпал, а 0 баллов: на 1 балл — поднимаем до полного; на 2+ — не трогаем', () => {
    const rows = parseTasks([
      { no: '3', points: 0, max_points: 1, student_answer: '5 м/с²', expected_answer: '5 м/с²' },
      { no: '6', points: 0, max_points: 2, student_answer: '112', expected_answer: '112', note: 'нет решения' },
    ], { points: true })
    const r = reconcileTasksDetailed(rows)
    expect(r.tasks.map(t => [t.no, t.verdict, t.points])).toEqual([['3', 'correct', 1], ['6', 'wrong', 0]])
    expect(r.lowered).toEqual([])
  })

  it('ответ разошёлся, а балл полный: на 1 балл — ноль; на 2+ — «не сверено» без балла', () => {
    const rows = parseTasks([
      { no: '2', points: 1, max_points: 1, student_answer: '2,9 м/с', expected_answer: '3,1 м/с' },
      { no: '6', points: 2, max_points: 2, student_answer: '120', expected_answer: '112' },
    ], { points: true })
    const r = reconcileTasksDetailed(rows)
    expect(r.tasks.map(t => [t.no, t.verdict, t.points])).toEqual([['2', 'wrong', 0], ['6', 'unchecked', null]])
    expect(r.lowered).toEqual(['2', '6'])
  })

  it('неокруглённый ответ судится одинаково у всех: «3,14» при «3,1» — полный балл и пометка', () => {
    // 03.10: один и тот же ответ модель назвала верным, частичным и неверным.
    const variants = [
      { verdict: 'correct', points: 1 },
      { verdict: 'partial', points: 0 },
      { verdict: 'wrong', points: 0 },
    ]
    for (const v of variants) {
      const rows = parseTasks([{ no: '2', ...v, max_points: 1, student_answer: '3,14 м/с', expected_answer: '3,1 м/с' }], { points: true })
      const r = reconcileTasksDetailed(rows)
      expect(r.tasks[0]).toMatchObject({ verdict: 'correct', points: 1 })
      expect(r.rounded).toEqual(['2'])
      expect(r.lowered).toEqual([])
    }
    expect(withRoundedNote('', ['2'])).toContain('в задании 2 — засчитано как верный')
  })

  it('roundsToExpected: только точнее эталона и только к нему', () => {
    expect(roundsToExpected('3,14 м/с', '3,1 м/с')).toBe(true)
    expect(roundsToExpected('0,667', '0,67')).toBe(true)
    expect(roundsToExpected('3,16', '3,1')).toBe(false)
    expect(roundsToExpected('3', '3,1')).toBe(false)
    expect(roundsToExpected('3,1', '3,1')).toBe(false)
    expect(roundsToExpected('3,14 см', '3,1 м')).toBe(false)
    expect(roundsToExpected('T = 0,2 с; ν = 5 Гц', 'T = 0,2 с')).toBe(false)
  })

  it('без баллов сверка прежняя: неокруглённый ответ не трогает вердикт строки', () => {
    const r = reconcileTasksDetailed(parseTasks([{ no: '2', verdict: 'correct', student_answer: '3,14', expected_answer: '3,1' }]))
    expect(r.tasks[0].verdict).toBe('wrong')
    expect(r.rounded).toEqual([])
  })
})

describe('§265. 5-балльная работа: оценка ИИ не ниже 2', () => {
  // Таблица перевода из критериев с «1» за 0–2 балла: так бывает в чужих критериях, но
  // 5-балльной работе сервер ставит только 2–5 (topic_homework_reviews_scale_trg).
  const TABLE_WITH_ONE = [
    { min: 0, max: 2, grade: 1 },
    { min: 3, max: 4, grade: 2 },
    { min: 5, max: 7, grade: 3 },
    { min: 8, max: 10, grade: 4 },
    { min: 11, max: 12, grade: 5 },
  ]
  const rowsOf = (total: number): TaskRow[] => Array.from({ length: 12 }, (_, i) => ({
    no: String(i + 1), verdict: i < total ? 'correct' : 'wrong', student_answer: '', expected_answer: '', note: '',
    points: i < total ? 1 : 0, max_points: 1,
  }))

  it.each([[0, 2], [2, 2], [3, 2], [6, 3], [12, 5]])('%i баллов по таблице с «1» → «%i»', (total, mark) => {
    expect(gradeByCriteria({ tasks: rowsOf(total), gradeTable: TABLE_WITH_ONE, maxTotal: 12, scale: 'five' }).score).toBe(mark)
  })

  it('стобалльной работе таблица не мешает: 2 из 12 → 17', () => {
    expect(gradeByCriteria({ tasks: rowsOf(2), gradeTable: TABLE_WITH_ONE, maxTotal: 12, scale: 'hundred' }).score).toBe(17)
  })

  it('без таблицы и по доле заданий 5-балльная тоже не ниже 2', () => {
    expect(gradeByCriteria({ tasks: rowsOf(0), gradeTable: null, maxTotal: 12, scale: 'five' }).score).toBe(2)
    expect(computeScore(rowsOf(0), 'five').score).toBe(2)
    expect(computeScore(rowsOf(0), 'hundred').score).toBe(0)
  })
})
