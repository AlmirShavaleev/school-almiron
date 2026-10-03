import { describe, expect, it } from 'vitest'
import {
  couplePointsPatch,
  hasCriteriaPoints,
  pointsText,
  reviewCriteriaGrade,
  reviewTableScore,
  reviewTasksFromAi,
  stepPoints,
  type ReviewTaskRow,
} from '../homeworkReviewTasks'
import { aiTasksOf, criteriaMismatchReason, isPartialCheck, type AiJobRow } from '../aiHomeworkCheck'
import { seedDoubtPatches } from '../reviewTriage'

/**
 * §260. Баллы по критериям в таблице преподавателя: связка «балл ↔ вердикт»,
 * кнопки ±, пересчёт суммы и оценки тем же модулем, что у функции.
 */

const TABLE = [
  { min: 0, max: 4, grade: 2 }, { min: 5, max: 7, grade: 3 }, { min: 8, max: 10, grade: 4 }, { min: 11, max: 12, grade: 5 },
]
const row = (no: string, points: number | null, max: number | null, over: Partial<ReviewTaskRow> = {}): ReviewTaskRow => ({
  id: `r${no}`, attempt_id: 'a1', no, verdict: points == null ? 'unchecked' : max != null && points >= max ? 'correct' : points === 0 ? 'wrong' : 'partial',
  student_answer: null, expected_answer: null, note: null, position: Number(no) * 10, updated_by: null, updated_at: '2026-10-03T10:00:00Z',
  ...(max != null ? { points, max_points: max } : {}),
  ...over,
})
// 10А: 1–5 по 1, 6 — 2, 7 — 2, 8 — 3. Работа на 9 баллов.
const NINE = [row('1', 0, 1), row('2', 1, 1), row('3', 1, 1), row('4', 1, 1), row('5', 1, 1), row('6', 2, 2), row('7', 1, 2), row('8', 2, 3)]
const JOB = { grading: 'criteria' as const, grade_table: TABLE }

describe('couplePointsPatch: балл и вердикт едут вместе', () => {
  it('правят балл — вердикт из балла', () => {
    expect(couplePointsPatch(row('7', 1, 2), { points: 2 })).toEqual({ points: 2, verdict: 'correct' })
    expect(couplePointsPatch(row('7', 1, 2), { points: 0 })).toEqual({ points: 0, verdict: 'wrong' })
    expect(couplePointsPatch(row('8', 3, 3), { points: 2 })).toEqual({ points: 2, verdict: 'partial' })
    expect(couplePointsPatch(row('8', 3, 3), { points: null })).toEqual({ points: null, verdict: 'unchecked' })
    // «Не решено» с нулём так и остаётся «не решено».
    expect(couplePointsPatch(row('8', 0, 3, { verdict: 'unsolved' }), { points: 0 })).toEqual({ points: 0, verdict: 'unsolved' })
  })

  it('правят вердикт — балл из вердикта; «частично» сохраняет частичный балл', () => {
    expect(couplePointsPatch(row('8', 1, 3), { verdict: 'correct' })).toEqual({ verdict: 'correct', points: 3 })
    expect(couplePointsPatch(row('8', 3, 3), { verdict: 'wrong' })).toEqual({ verdict: 'wrong', points: 0 })
    expect(couplePointsPatch(row('8', 3, 3), { verdict: 'unsolved' })).toEqual({ verdict: 'unsolved', points: 0 })
    expect(couplePointsPatch(row('8', 3, 3), { verdict: 'unchecked' })).toEqual({ verdict: 'unchecked', points: null })
    expect(couplePointsPatch(row('8', 2, 3), { verdict: 'partial' })).toEqual({ verdict: 'partial', points: 2 })
    expect(couplePointsPatch(row('8', 3, 3), { verdict: 'partial' })).toEqual({ verdict: 'partial', points: 1 })
    expect(couplePointsPatch(row('6', 0, 2), { verdict: 'partial' })).toEqual({ verdict: 'partial', points: 1 })
    expect(couplePointsPatch(row('1', 1, 1), { verdict: 'partial' })).toEqual({ verdict: 'partial', points: 0.5 })
  })

  it('строка без баллов и правка не про баллы — как есть', () => {
    expect(couplePointsPatch(row('1', null, null, { verdict: 'correct' }), { verdict: 'wrong' })).toEqual({ verdict: 'wrong' })
    expect(couplePointsPatch(row('7', 1, 2), { note: 'текст' })).toEqual({ note: 'текст' })
    expect(couplePointsPatch(row('7', 1, 2), { verdict: 'correct', points: 1 })).toEqual({ verdict: 'correct', points: 1 })
  })
})

describe('± и подписи', () => {
  it('stepPoints: на балл, в пределах 0..max; «не сверено» начинает с 1 (или 0 на «−»)', () => {
    expect(stepPoints(1, 2, 1)).toBe(2)
    expect(stepPoints(2, 2, 1)).toBe(2)
    expect(stepPoints(0, 2, -1)).toBe(0)
    expect(stepPoints(null, 3, 1)).toBe(1)
    expect(stepPoints(null, 3, -1)).toBe(0)
    expect(stepPoints(0.5, 1, 1)).toBe(1)
    expect(stepPoints(0.5, 1, -1)).toBe(0)
  })

  it('pointsText: «2 из 3», «½ из 1», «? из 2», «2,5 из 3»', () => {
    expect(pointsText(2, 3)).toBe('2 из 3')
    expect(pointsText(0.5, 1)).toBe('½ из 1')
    expect(pointsText(null, 2)).toBe('? из 2')
    expect(pointsText(2.5, 3)).toBe('2,5 из 3')
  })
})

describe('reviewCriteriaGrade / reviewTableScore — сумма и оценка таблицы', () => {
  it('9 из 12 по таблице → «4»; правка ± у №1 и №7 → 11 → «5»', () => {
    expect(reviewCriteriaGrade(NINE, JOB, 'five')).toMatchObject({ grading: 'criteria', total: 9, max: 12, score: 4 })
    const edited = NINE.map(r => (r.no === '1' ? { ...r, points: 1 } : r.no === '7' ? { ...r, points: 2 } : r))
    expect(reviewTableScore(edited, 'five', JOB).score).toBe(5)
  })

  it('«не решено» — ноль, даже если балл в строке остался', () => {
    const rows = NINE.map(r => (r.no === '8' ? { ...r, verdict: 'unsolved' as const } : r))
    expect(reviewCriteriaGrade(rows, JOB, 'five')).toMatchObject({ total: 7, score: 3 })
  })

  it('проверка сказала «критерии не сошлись» — и таблица не даёт оценки, хоть ± и правят баллы', () => {
    const g = reviewCriteriaGrade(NINE, { grading: 'criteria_mismatch', grade_table: TABLE }, 'five')
    expect(g).toMatchObject({ grading: 'criteria_mismatch', score: null, total: 9 })
    expect(reviewTableScore(NINE, 'five', { grading: 'criteria_mismatch', grade_table: TABLE }).score).toBeNull()
  })

  it('без таблицы — по доле баллов; без шкалы — балла нет', () => {
    expect(reviewTableScore(NINE, 'five', { grading: 'ratio', grade_table: null }).score).toBe(4)
    expect(reviewTableScore(NINE, 'hundred', JOB).score).toBe(75)
    expect(reviewTableScore(NINE, null, JOB).score).toBeNull()
  })

  it('строка, добавленная руками без максимума, — расхождение (баллы есть не у всех)', () => {
    const rows = [...NINE, row('9', null, null, { verdict: 'correct' })]
    expect(reviewCriteriaGrade(rows, JOB, 'five')).toMatchObject({ grading: 'criteria_mismatch', score: null })
  })

  it('без баллов — прежний балл по долям, ни одной строки с максимумом', () => {
    const plain = NINE.map(({ points: _p, max_points: _m, ...r }) => r)
    expect(hasCriteriaPoints(plain)).toBe(false)
    expect(reviewCriteriaGrade(plain, JOB, 'five')).toBeNull()
    // Верных 5, частичных 2, неверное 1 → 0,75 → «4» (прежняя формула §199).
    expect(reviewTableScore(plain, 'five', JOB)).toEqual({ score: 4, criteria: null })
  })
})

describe('заполнение из слепка ИИ', () => {
  const job = (tasks: unknown[], over: Partial<AiJobRow> = {}): AiJobRow => ({
    id: 'j1', attempt_id: 'a1', status: 'done', provider: null, model: null, readable: true, suggested_score: null,
    confidence: 'medium', summary: null, last_error: null, reference_state: 'used', reference_chars: 1, worksheet_state: 'used',
    worksheet_chars: 1, tasks: tasks as AiJobRow['tasks'], accepted_at: null, created_at: '2026-10-03T10:00:00Z', completed_at: '2026-10-03T10:01:00Z',
    ...over,
  })

  it('aiTasksOf берёт годные баллы; кривые — без балла; у строк без максимума ключей нет', () => {
    const tasks = aiTasksOf(job([
      { no: '1', verdict: 'partial', points: 1, max_points: 2, student_answer: '', expected_answer: '', note: '' },
      { no: '2', verdict: 'correct', points: 'x', max_points: 1 },
      { no: '3', verdict: 'correct', points: 5, max_points: 3 },
      { no: '4', verdict: 'correct' },
    ]))!
    expect(tasks.map(t => [t.no, t.points, t.max_points])).toEqual([['1', 1, 2], ['2', null, 1], ['3', 3, 3], ['4', undefined, undefined]])
    expect('points' in tasks[3]).toBe(false)
  })

  it('reviewTasksFromAi переносит баллы, и §238 («частично» при совпавшем ответе → «верно») их не трогает', () => {
    const rows = reviewTasksFromAi([
      { no: '6', verdict: 'partial', student_answer: '112', expected_answer: '112', note: 'одна ошибка', points: 1, max_points: 2 },
      { no: '7', verdict: 'partial', student_answer: '12', expected_answer: '12', note: 'нет хода' },
    ])
    expect(rows[0]).toMatchObject({ no: '6', verdict: 'partial', points: 1, max_points: 2, note: 'одна ошибка' })
    expect(rows[1]).toMatchObject({ no: '7', verdict: 'correct', note: null })
    expect('points' in rows[1]).toBe(false)
    expect(seedDoubtPatches([
      { id: 'a', verdict: 'partial', student_answer: '112', expected_answer: '112', note: null, max_points: 2 },
      { id: 'b', verdict: 'partial', student_answer: '12', expected_answer: '12', note: null },
    ]).map(p => p.id)).toEqual(['b'])
  })

  it('пометка о расхождении — из разбора; «прочитана не вся работа» при этом не ставится', () => {
    const summary = 'Разбор\n\nПроверьте баллы: критерии прочитаны не полностью (нет баллов по критериям у заданий 8). Оценка не подставлена — сверьте баллы с критериями.'
    const j = job([{ no: '1', verdict: 'correct', points: 1, max_points: 1 }], { grading: 'criteria_mismatch', summary })
    expect(criteriaMismatchReason(j)).toBe('нет баллов по критериям у заданий 8')
    expect(isPartialCheck(j)).toBe(false)
    expect(criteriaMismatchReason(job([], { grading: 'criteria' }))).toBeNull()
    expect(criteriaMismatchReason(job([], { grading: 'criteria_mismatch', summary: 'правили руками' }))).toBe('')
    // Без расхождения прежнее правило §189 работает.
    expect(isPartialCheck(job([{ no: '1', verdict: 'unchecked' }]))).toBe(true)
  })
})
