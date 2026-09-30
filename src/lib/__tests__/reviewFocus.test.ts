import { describe, expect, it } from 'vitest'
import {
  FOCUS_VERDICT_KEYS, aiHintsByRow, aiLineText, focusCounts, hasAiHint, isTypingTarget, stepIndex, stripTone,
} from '@/lib/reviewFocus'
import { reviewHeaderLine, type QueueRow } from '@/lib/homeworkQueue'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'
import type { AiFindingRow, AiTaskRow } from '@/lib/aiHomeworkCheck'

/** §248. Правила спокойного экрана проверки — без React. */

const row = (no: string, verdict: ReviewTaskRow['verdict'], student = '1', expected = '1'): ReviewTaskRow => ({
  id: `r${no}`, attempt_id: 'a', no, verdict, student_answer: student, expected_answer: expected,
  note: null, position: 0, updated_by: null, updated_at: '',
})

describe('клавиши и полоса', () => {
  it('1/2/3 — в порядке кнопок макета: верно, частично, неверно; 4 и 5 клавиш нет', () => {
    expect(FOCUS_VERDICT_KEYS).toEqual({ '1': 'correct', '2': 'partial', '3': 'wrong' })
  })

  it('цвет клетки — вердикт, всё непроверенное — нейтрально', () => {
    expect(['correct', 'partial', 'wrong', 'unchecked', 'unsolved'].map(v => stripTone(v as never)))
      .toEqual(['ok', 'part', 'bad', 'neutral', 'neutral'])
  })

  it('сводка — три основных вердикта', () => {
    expect(focusCounts([row('1', 'correct'), row('2', 'correct'), row('3', 'wrong'), row('4', 'unsolved')]))
      .toEqual({ correct: 2, partial: 0, wrong: 1 })
  })

  it('шаг не выходит за края', () => {
    expect(stepIndex(0, -1, 5)).toBe(0)
    expect(stepIndex(4, 1, 5)).toBe(4)
    expect(stepIndex(2, 1, 5)).toBe(3)
    expect(stepIndex(0, 1, 0)).toBe(-1)
  })
})

describe('подсказки ИИ', () => {
  const ai: AiTaskRow[] = [
    { no: '1', verdict: 'correct', student_answer: '1', expected_answer: '1', note: '' },
    { no: '№ 2', verdict: 'wrong', student_answer: '1', expected_answer: '2', note: 'знак' },
    { no: '3', verdict: 'partial', student_answer: '5', expected_answer: '5', note: '' },
  ]
  const finding = { id: 'f', task: '1', text: 'В задаче 1 …' } as AiFindingRow

  it('заметка модели и неразобранные находки — по номеру задания, «№ 2» и «2» одно', () => {
    const hints = aiHintsByRow([row('1', 'correct'), row('2', 'wrong', '1', '2'), row('3', 'correct', '5', '5'), row('4', 'unchecked')], ai, [finding])
    expect(hints.get('r1')).toMatchObject({ note: '', suggestions: 1, known: true })
    expect(hints.get('r2')).toMatchObject({ note: 'знак', suggestions: 0 })
    expect(hints.get('r4')?.known).toBe(false)
    expect(['r1', 'r2', 'r3', 'r4'].map(id => hasAiHint(hints.get(id)))).toEqual([true, true, false, false])
  })

  it('строка «ИИ»: заметка, а без неё — сомнение светофора, которого в таблице не осталось', () => {
    const hints = aiHintsByRow([row('2', 'wrong', '1', '2'), row('3', 'correct', '5', '5'), row('1', 'correct')], ai, [])
    expect(aiLineText(hints.get('r2'))).toBe('знак')
    // §238: «частично» при совпавшем ответе легло в таблицу «верно» — сомнение ИИ видно здесь.
    expect(aiLineText(hints.get('r3'))).toContain('«частично», но ответ совпал')
    expect(aiLineText(hints.get('r1'))).toBeNull()
  })

  it('черновика ИИ нет — подсказок нет', () => {
    const hints = aiHintsByRow([row('1', 'correct')], null, [])
    expect(hints.get('r1')).toMatchObject({ note: '', suggestions: 0, triage: null })
    expect(aiLineText(hints.get('r1'))).toBeNull()
  })
})

describe('поле ввода глушит клавиши экрана', () => {
  it('input, textarea, select, contenteditable и всё внутри data-review-keys="off"', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const select = document.createElement('select')
    const box = document.createElement('div')
    box.setAttribute('data-review-keys', 'off')
    const inside = document.createElement('button')
    box.appendChild(inside)
    const plain = document.createElement('button')
    document.body.append(input, area, select, box, plain)
    expect([input, area, select, inside].every(isTypingTarget)).toBe(true)
    expect(isTypingTarget(plain)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('мелкая строка шапки', () => {
  const base = {
    attempt: { id: 'a', attempt_number: 1, submitted_at: '2026-09-28T09:00:00Z', auto_submitted: false },
    homeworkTitle: 'Проверочная «Производная»', topicTitle: 'Производная', courseTitle: '11А',
    dueAt: '2026-09-29T00:00:00Z',
  } as unknown as QueueRow

  it('группа · сдано дата, в срок — без темы и числа листов', () => {
    const line = reviewHeaderLine(base)
    expect(line).toMatch(/^11А · сдано 28 сент\.?, в срок$/)
  })

  it('с опозданием и повторная попытка', () => {
    const late = { ...base, dueAt: '2026-09-27T00:00:00Z', attempt: { ...base.attempt, attempt_number: 2 } } as QueueRow
    expect(reviewHeaderLine(late)).toMatch(/^11А · попытка №2 · сдано 28 сент\.?, с опозданием$/)
  })
})
