import { describe, expect, it } from 'vitest'
import {
  aiCheckIsNewerThanTable,
  compareTaskNo,
  groupReviewTasks,
  fiveFromRatio,
  nextPosition,
  nextTaskNo,
  reviewTasksFromAi,
  uncheckedPackLabel,
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


/**
 * §207. «Есть более свежая проверка ИИ».
 *
 * Таблица преподавателя намеренно не перезаписывается свежим прогоном (§199),
 * и из-за этого на экране жили два спорящих ряда счётчиков. Счётчик оставлен
 * один, табличный; про устаревшую таблицу говорит эта проверка.
 */
describe('aiCheckIsNewerThanTable', () => {
  const at = (iso: string) => ({ updated_at: iso })
  const job = (over: Partial<{ status: string; completed_at: string | null }> = {}) => ({
    status: 'done',
    completed_at: '2026-09-19T12:00:00Z',
    ...over,
  })

  it('проверка завершилась после последней правки строки — таблица устарела', () => {
    expect(aiCheckIsNewerThanTable(job(), [at('2026-09-19T11:00:00Z'), at('2026-09-19T11:30:00Z')])).toBe(true)
  })

  it('таблицу правили после проверки — говорить не о чем', () => {
    expect(aiCheckIsNewerThanTable(job(), [at('2026-09-19T11:00:00Z'), at('2026-09-19T12:30:00Z')])).toBe(false)
  })

  it('таблица только что собрана из этой проверки — тоже молчим', () => {
    // Строки рождаются копией слепка, их `updated_at` позже конца прогона.
    expect(aiCheckIsNewerThanTable(job(), [at('2026-09-19T12:00:01Z')])).toBe(false)
  })

  it('таблицы нет, проверка идёт или не завершена — строки не будет', () => {
    expect(aiCheckIsNewerThanTable(job(), [])).toBe(false)
    expect(aiCheckIsNewerThanTable(job({ status: 'processing' }), [at('2020-01-01T00:00:00Z')])).toBe(false)
    expect(aiCheckIsNewerThanTable(job({ completed_at: null }), [at('2020-01-01T00:00:00Z')])).toBe(false)
    expect(aiCheckIsNewerThanTable(null, [at('2020-01-01T00:00:00Z')])).toBe(false)
  })

  it('время нечитаемо — молчим, а не гадаем', () => {
    expect(aiCheckIsNewerThanTable(job({ completed_at: 'вчера' }), [at('2026-09-19T11:00:00Z')])).toBe(false)
    expect(aiCheckIsNewerThanTable(job(), [{ updated_at: 'позавчера' }])).toBe(false)
  })
})

/** §207. Свёртка таблицы: пачка «не сверено» и пачка верных. */
describe('groupReviewTasks', () => {
  const r = (no: string, verdict: ReviewTaskRow['verdict'], note: string | null = null) =>
    row({ id: `r${no}`, no, verdict, note })

  it('подряд идущие «не сверено» с одинаковой заметкой — одна пачка', () => {
    const items = groupReviewTasks([
      r('16', 'wrong', 'Знак'),
      r('17', 'unchecked', 'нет на фото'),
      r('18', 'unchecked', 'нет на фото'),
      r('19', 'unchecked', 'нет на фото'),
    ])
    expect(items.map(i => i.kind)).toEqual(['row', 'unchecked'])
    const pack = items[1] as Extract<typeof items[number], { kind: 'unchecked' }>
    expect(pack.rows.map(x => x.no)).toEqual(['17', '18', '19'])
    expect(pack.label).toBe('Задания 17–19 не сверены: нет на фото')
  })

  it('заметки разные — строки остаются как есть', () => {
    const items = groupReviewTasks([
      r('17', 'unchecked', 'нет на фото'),
      r('18', 'unchecked', 'не разобрал почерк'),
      r('19', 'unchecked', 'нет на фото'),
    ])
    expect(items.map(i => i.kind)).toEqual(['row', 'row', 'row'])
  })

  it('одна «не сверено» подряд — это не пачка', () => {
    const items = groupReviewTasks([r('17', 'unchecked', 'нет на фото'), r('18', 'wrong')])
    expect(items.map(i => i.kind)).toEqual(['row', 'row'])
  })

  it('пустые заметки тоже одинаковы — и пачка называется без двоеточия', () => {
    const items = groupReviewTasks([r('20', 'unchecked'), r('21', 'unchecked', '   ')])
    const pack = items[0] as Extract<typeof items[number], { kind: 'unchecked' }>
    expect(pack.kind).toBe('unchecked')
    expect(pack.label).toBe('Задания 20 и 21 не сверены')
  })

  it('верные — одна пачка на месте первого верного, остальные строки целы', () => {
    const items = groupReviewTasks([
      r('1', 'correct'),
      r('2', 'wrong', 'Знак'),
      r('3', 'correct'),
      r('4', 'partial'),
      r('5', 'correct'),
    ])
    expect(items.map(i => i.kind)).toEqual(['correct', 'row', 'row'])
    const pack = items[0] as Extract<typeof items[number], { kind: 'correct' }>
    expect(pack.rows.map(x => x.no)).toEqual(['1', '3', '5'])
  })

  /**
   * Порог. Пачка «1 верное» занимает столько же места, сколько само задание,
   * и не экономит ничего — только прячет. Сворачиваем с трёх.
   */
  it('верных меньше трёх — не сворачиваем, показываем как есть', () => {
    expect(groupReviewTasks([r('1', 'correct'), r('2', 'wrong')]).map(i => i.kind))
      .toEqual(['row', 'row'])
    expect(groupReviewTasks([r('1', 'correct'), r('2', 'correct'), r('3', 'wrong')]).map(i => i.kind))
      .toEqual(['row', 'row', 'row'])
  })

  it('ровно три верных — уже пачка', () => {
    const items = groupReviewTasks([r('1', 'correct'), r('2', 'correct'), r('3', 'correct'), r('4', 'wrong')])
    expect(items.map(i => i.kind)).toEqual(['correct', 'row'])
  })

  it('верных нет — пачки нет, и ни одна строка не потеряна', () => {
    const items = groupReviewTasks([r('1', 'wrong'), r('2', 'partial')])
    expect(items.map(i => i.kind)).toEqual(['row', 'row'])
  })

  it('спрятанное верное между «не сверено» не склеивает соседей', () => {
    // Подряд считается по таблице, а не по видимой её части: иначе пачка
    // сообщала бы, что задания идут одно за другим, когда это не так.
    const items = groupReviewTasks([
      r('1', 'unchecked', 'нет на фото'),
      r('2', 'correct'), r('4', 'correct'), r('5', 'correct'),
      r('3', 'unchecked', 'нет на фото'),
    ])
    expect(items.map(i => i.kind)).toEqual(['row', 'correct', 'row'])
  })

  it('каждая строка попадает в ответ ровно один раз', () => {
    const rows = [
      r('1', 'correct'), r('2', 'correct'), r('3', 'wrong'),
      r('4', 'unchecked', 'нет'), r('5', 'unchecked', 'нет'),
      r('6', 'correct'),
    ]
    const flat = groupReviewTasks(rows).flatMap(i => (i.kind === 'row' ? [i.row] : i.rows))
    expect(flat.map(x => x.no).sort()).toEqual(['1', '2', '3', '4', '5', '6'])
  })
})

describe('uncheckedPackLabel', () => {
  it('две — через «и», больше — диапазоном', () => {
    expect(uncheckedPackLabel(['17', '18'], 'нет на фото')).toBe('Задания 17 и 18 не сверены: нет на фото')
    expect(uncheckedPackLabel(['17', '18', '19', '20', '21'], '')).toBe('Задания 17–21 не сверены')
  })
})
