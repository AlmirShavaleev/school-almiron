import { describe, expect, it } from 'vitest'
import {
  compareTaskNo,
  fiveFromRatio,
  nextPosition,
  nextTaskNo,
  reviewTasksFromAi,
  reviewTasksScore,
  sortReviewTasks,
  summarizeReviewTasks,
  type ReviewTaskRow,
} from '@/lib/homeworkReviewTasks'
import type { AiTaskRow } from '@/lib/aiHomeworkCheck'

/**
 * §199. Таблица проверки преподавателя.
 *
 * Главное здесь — балл: он считается ТОЙ ЖЕ формулой, что у ИИ
 * (`check-homework-ai/findings.ts`), и расхождение между ними значило бы, что
 * «по таблице получается N» врёт.
 */

const row = (over: Partial<ReviewTaskRow> = {}): ReviewTaskRow => ({
  id: 'r1',
  attempt_id: 'a1',
  no: '1',
  verdict: 'correct',
  student_answer: null,
  expected_answer: null,
  note: null,
  position: 10,
  updated_by: null,
  updated_at: '2026-09-17T10:00:00Z',
  ...over,
})

describe('summarizeReviewTasks', () => {
  it('считает по вердиктам, включая несверенные', () => {
    expect(summarizeReviewTasks([
      row({ verdict: 'correct' }),
      row({ verdict: 'wrong' }),
      row({ verdict: 'partial' }),
      row({ verdict: 'unchecked' }),
    ])).toEqual({ correct: 1, wrong: 1, partial: 1, unchecked: 1, total: 4 })
  })
})

describe('fiveFromRatio — пороги §180', () => {
  it('5 от 90 %, 4 от 70 %, 3 от 50 %, ниже 2', () => {
    expect(fiveFromRatio(1)).toBe(5)
    expect(fiveFromRatio(0.9)).toBe(5)
    expect(fiveFromRatio(0.89)).toBe(4)
    expect(fiveFromRatio(0.7)).toBe(4)
    expect(fiveFromRatio(0.69)).toBe(3)
    expect(fiveFromRatio(0.5)).toBe(3)
    expect(fiveFromRatio(0.49)).toBe(2)
    expect(fiveFromRatio(0)).toBe(2)
  })
})

describe('reviewTasksScore', () => {
  it('частично — половина задания', () => {
    const rows = [
      row({ verdict: 'correct' }),
      row({ verdict: 'correct' }),
      row({ verdict: 'partial' }),
      row({ verdict: 'wrong' }),
    ]
    // (2 + 0,5) / 4 = 0,625 → 3 по пятибалльной, 63 по сотенной
    expect(reviewTasksScore(rows, 'five').score).toBe(3)
    expect(reviewTasksScore(rows, 'hundred').score).toBe(63)
  })

  it('несверенные не идут ни за, ни против — они вне знаменателя', () => {
    const rows = [
      row({ verdict: 'correct' }),
      row({ verdict: 'correct' }),
      row({ verdict: 'unchecked' }),
      row({ verdict: 'unchecked' }),
    ]
    const score = reviewTasksScore(rows, 'hundred')
    expect(score.counted).toBe(2)
    expect(score.score).toBe(100)
  })

  it('пустая таблица и таблица из одних несверенных дают null, а не 0', () => {
    expect(reviewTasksScore([], 'five').score).toBeNull()
    expect(reviewTasksScore([row({ verdict: 'unchecked' })], 'five').score).toBeNull()
  })

  it('шкалы у курса нет — балла тоже нет', () => {
    expect(reviewTasksScore([row({ verdict: 'correct' })], null).score).toBeNull()
  })

  it('смена вердикта строки меняет балл', () => {
    const before = [row({ no: '1' }), row({ no: '2', verdict: 'correct' })]
    expect(reviewTasksScore(before, 'five').score).toBe(5)
    const after = before.map(r => (r.no === '2' ? { ...r, verdict: 'wrong' as const } : r))
    expect(reviewTasksScore(after, 'five').score).toBe(3)
  })
})

describe('порядок строк', () => {
  it('сначала position, при равных — номер по-человечески', () => {
    const rows = [
      row({ id: 'b', no: '10', position: 10 }),
      row({ id: 'a', no: '2', position: 10 }),
      row({ id: 'c', no: '1', position: 20 }),
    ]
    expect(sortReviewTasks(rows).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('«2» раньше «10», а не после, как при сравнении строк', () => {
    expect(compareTaskNo('2', '10')).toBeLessThan(0)
    expect(compareTaskNo('10', '10a')).toBeLessThan(0)
  })
})

describe('новая строка', () => {
  it('номер — следующий за самым большим', () => {
    expect(nextTaskNo([row({ no: '1' }), row({ no: '7' }), row({ no: '3' })])).toBe('8')
    expect(nextTaskNo([])).toBe('1')
  })

  it('буквенный номер не ломает нумерацию', () => {
    expect(nextTaskNo([row({ no: '12a' })])).toBe('13')
  })

  it('position — в конец, с запасом', () => {
    expect(nextPosition([row({ position: 10 }), row({ position: 30 })])).toBe(40)
    expect(nextPosition([])).toBe(10)
  })
})

describe('reviewTasksFromAi', () => {
  it('копирует слепок построчно, пустые строки превращая в null', () => {
    const ai: AiTaskRow[] = [
      { no: '1', verdict: 'correct', student_answer: '5', expected_answer: '5', note: '' },
      { no: '2', verdict: 'wrong', student_answer: '', expected_answer: '8', note: 'Знак' },
    ]
    expect(reviewTasksFromAi(ai)).toEqual([
      { no: '1', verdict: 'correct', student_answer: '5', expected_answer: '5', note: null, position: 10 },
      { no: '2', verdict: 'wrong', student_answer: null, expected_answer: '8', note: 'Знак', position: 20 },
    ])
  })
})
