import { describe, expect, it } from 'vitest'
import { formatReplay, replay, type ReplayInput } from '../svetoforReplay'

/**
 * §238. Прогон светофора на выгрузке (`scripts/svetofor-replay.mjs`) —
 * проверка на синтетике: по строке на каждый случай, числа считаются в уме.
 */

const row = (over: Partial<ReplayInput>): ReplayInput => ({
  ai_verdict: 'correct', student_answer: '1', expected_answer: '1', note: '', teacher_verdict: 'correct', ...over,
})

const ROWS: ReplayInput[] = [
  row({}),                                                            // зелёная, без правки
  row({ teacher_verdict: 'partial', attempt_id: 'a', no: '2' }),      // зелёная, ПРОПУСК
  row({ student_answer: '50%', expected_answer: '0,5' }),              // верно, записан иначе
  row({ ai_verdict: 'partial', note: 'x=3π не входит в [5π/2; 4π]' }), // ложное «частично», поймано, корни: ложная претензия
  row({ ai_verdict: 'partial', note: 'Нет хода решения', teacher_verdict: 'partial' }), // частично+совпал, человек согласен с ИИ
  row({ ai_verdict: 'partial', student_answer: '12', expected_answer: '30', teacher_verdict: 'partial' }),
  row({ ai_verdict: 'wrong', student_answer: '2', expected_answer: '3', teacher_verdict: 'wrong' }),
  row({ ai_verdict: 'wrong', note: 'x = -π/2 не входит в [-2π; -π]', teacher_verdict: 'wrong' }), // корни: верная претензия, человек согласен
  row({ ai_verdict: 'unchecked', student_answer: '', teacher_verdict: 'correct' }),
]

describe('§238. replay', () => {
  it('считает зелёные, жёлтые, пропуски, пойманные «частично» и проверку корней', () => {
    const r = replay(ROWS)
    expect(r).toMatchObject({
      total: 9, green: 2, yellow: 7,
      byReason: { partial_equal: 2, answer_differs: 1, wrong: 2, unchecked: 1, correct_other_form: 1 },
      changed: 3, greenChanged: 1, yellowChanged: 2,
      falsePartialCaught: 1, partialEqual: 2, partialEqualKept: 1,
      rootCheck: { fired: 2, falseClaim: 1, claimHolds: 1, rightByTeacher: 2 },
    })
    expect(r.misses.map(m => m.input.no)).toEqual(['2'])
  })

  it('отчёт словами называет пропуски', () => {
    const text = formatReplay(replay(ROWS), { showMisses: true })
    expect(text).toContain('в зелёных (ПРОПУСКИ): 1 из 2 зелёных (50 %)')
    expect(text).toContain('a №2: ИИ correct → partial')
  })

  it('пустая выгрузка не падает', () => {
    const r = replay([])
    expect(r.total).toBe(0)
    expect(formatReplay(r)).toContain('Строк: 0')
  })
})
