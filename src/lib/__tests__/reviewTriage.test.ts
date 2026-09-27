import { describe, expect, it } from 'vitest'
import {
  acceptSuggestionPatch,
  checkRootClaim,
  classifyRow,
  inInterval,
  parseInterval,
  parseMathValue,
  seedDoubtPatches,
  seededVerdict,
  triageRank,
} from '../reviewTriage'
import { reviewTasksFromAi } from '../homeworkReviewTasks'

const PI = Math.PI

describe('§238. числа из записи ИИ', () => {
  it.each([
    ['3π', 3 * PI],
    ['5π/2', 2.5 * PI],
    ['-π/4', -PI / 4],
    ['−π/4', -PI / 4],
    ['15π/4', 3.75 * PI],
    ['-2π/3', (-2 * PI) / 3],
    ['π', PI],
    ['2', 2],
    ['0,5', 0.5],
    ['-1.25', -1.25],
    ['7/2', 3.5],
    ['3pi/2', 1.5 * PI],
    ['3*π/2', 1.5 * PI],
  ])('«%s»', (raw, value) => {
    expect(parseMathValue(raw)).toBeCloseTo(value, 12)
  })

  it.each(['', 'πk', '2πk', 'x', '√2', '3π/0', '*π'])('не число: «%s»', raw => {
    expect(parseMathValue(raw)).toBeNull()
  })
})

describe('§238. промежутки', () => {
  it('скобки задают концы', () => {
    const i = parseInterval('(0; 7π/2]')!
    expect(i).toMatchObject({ lo: 0, loClosed: false, hiClosed: true })
    expect(inInterval(3.5 * PI, i)).toBe(true)
    expect(inInterval(0, i)).toBe(false)
  })

  it('граница закрытого отрезка входит, открытого — нет, с допуском на плавающую точку', () => {
    const closed = parseInterval('[-2π; -π/2]')!
    expect(inInterval(-1.5 * PI, closed)).toBe(true)
    expect(inInterval(-PI / 2, closed)).toBe(true)
    const open = parseInterval('(-2π; -π/2)')!
    expect(inInterval(-PI / 2, open)).toBe(false)
  })

  it('разделитель — точка с запятой или запятая', () => {
    expect(parseInterval('[-2π, -π]')).toMatchObject({ lo: -2 * PI, hi: -PI })
    expect(parseInterval('[0,5; 2]')).toMatchObject({ lo: 0.5, hi: 2 })
  })

  it('перевёрнутый промежуток — не промежуток', () => {
    expect(parseInterval('[4π; 5π/2]')).toBeNull()
  })
})

describe('§238. утверждения ИИ про отбор корней — примеры с прода', () => {
  it('«x=3π не входит в [5π/2; 4π]» — ложь: входит', () => {
    const check = checkRootClaim('Неверный отбор: x=3π не входит в [5π/2; 4π]')
    expect(check).toMatchObject({ value: '3π', interval: '[5π/2; 4π]', claimedInside: false, actual: true, verdict: 'false_claim' })
    expect(check?.claim).toBe('3π не входит в [5π/2; 4π]')
  })

  it('«-3π/2 не входит в [-2π; -π/2] … закрытый отрезок» — ложь', () => {
    const check = checkRootClaim('ошибка в отборе: -3π/2 не входит в [-2π; -π/2], так как это закрытый отрезок')
    expect(check).toMatchObject({ value: '−3π/2', interval: '[−2π; −π/2]', actual: true, verdict: 'false_claim' })
  })

  it('«включил 7π/2, хотя интервал открытый» при (0; 7π/2] — ложь', () => {
    const check = checkRootClaim('в ответе ученик включил 7π/2, хотя интервал открытый: (0; 7π/2]')
    expect(check).toMatchObject({ value: '7π/2', interval: '(0; 7π/2]', claimedInside: false, actual: true, verdict: 'false_claim' })
  })

  it('«x = -π/2 не входит в [-2π; -π], так как это граница» — по факту верно', () => {
    const check = checkRootClaim('x = -π/2 не входит в [-2π; -π], так как это граница')
    expect(check).toMatchObject({ claimedInside: false, actual: false, verdict: 'claim_holds' })
  })

  it('«7π/4 не входит в отрезок [3π/2; 3π]» — ложь', () => {
    const check = checkRootClaim('Отбор корней неверен: 7π/4 не входит в отрезок [3π/2; 3π]')
    expect(check).toMatchObject({ value: '7π/4', interval: '[3π/2; 3π]', verdict: 'false_claim' })
  })
})

describe('§238. утверждения ИИ — свои случаи', () => {
  it('«входит» без «не»: утверждение, что корень входит', () => {
    expect(checkRootClaim('Ученик потерял корень 2π, хотя он входит в [π; 3π]')).toBeNull()
    expect(checkRootClaim('Потерян корень: 2π входит в [π; 3π]')).toMatchObject({ claimedInside: true, actual: true, verdict: 'claim_holds' })
    expect(checkRootClaim('Лишний корень? 4π входит в [π; 3π]')).toMatchObject({ claimedInside: true, actual: false, verdict: 'false_claim' })
  })

  it('«не принадлежит промежутку», «не лежит на отрезке», «не попадает»', () => {
    expect(checkRootClaim('-π/4 не принадлежит промежутку [-π; 0]')).toMatchObject({ actual: true, verdict: 'false_claim' })
    expect(checkRootClaim('15π/4 не лежит на отрезке [3π; 4π]')).toMatchObject({ actual: true, verdict: 'false_claim' })
    expect(checkRootClaim('корень -2π/3 не попадает в [0; π]')).toMatchObject({ actual: false, verdict: 'claim_holds' })
  })

  it('символы ∉ и ∈', () => {
    expect(checkRootClaim('3π ∉ [5π/2; 4π]')).toMatchObject({ claimedInside: false, verdict: 'false_claim' })
    expect(checkRootClaim('5π ∈ [5π/2; 4π]')).toMatchObject({ claimedInside: true, verdict: 'false_claim' })
  })

  it('граница открытого конца: ИИ права', () => {
    expect(checkRootClaim('7π/2 не входит в (0; 7π/2)')).toMatchObject({ actual: false, verdict: 'claim_holds' })
  })

  it('обычные числа и десятичные', () => {
    expect(checkRootClaim('x = 2,5 не входит в [2; 3]')).toMatchObject({ actual: true, verdict: 'false_claim' })
    expect(checkRootClaim('x=-1 не входит в [0; 5]')).toMatchObject({ actual: false, verdict: 'claim_holds' })
  })

  it('запись через pi и через юникодный минус', () => {
    expect(checkRootClaim('x = 3pi/2 не входит в [pi; 2pi]')).toMatchObject({ actual: true, verdict: 'false_claim' })
    expect(checkRootClaim('x = −3π/2 не входит в [−2π; −π]')).toMatchObject({ actual: true, verdict: 'false_claim' })
  })

  it('из двух утверждений первым показывается ложное', () => {
    const check = checkRootClaim('x = 5π не входит в [π; 3π]; x = 2π не входит в [π; 3π]')
    expect(check).toMatchObject({ value: '2π', verdict: 'false_claim' })
  })

  it('не разобрали — ничего не придумываем', () => {
    expect(checkRootClaim('')).toBeNull()
    expect(checkRootClaim(null)).toBeNull()
    expect(checkRootClaim('Нет хода решения')).toBeNull()
    // Серия корней, а не число.
    expect(checkRootClaim('x = πk не входит в [0; π]')).toBeNull()
    // Промежуток без числа рядом с глаголом.
    expect(checkRootClaim('Отбор сделан неверно на отрезке [π; 2π]')).toBeNull()
    // «Включил» и «открытый», но промежутков два — какой имела в виду модель, неизвестно.
    expect(checkRootClaim('ученик включил 7π/2, хотя интервал открытый: (0; 7π/2] и [π; 2π]')).toBeNull()
    // Тире в предложении — не минус.
    expect(checkRootClaim('Ответ — 3π не входит в [5π/2; 4π]')).toMatchObject({ value: '3π', actual: true })
  })

})

describe('§238. светофор строки', () => {
  it('зелёная — только «верно» при совпавшем ответе', () => {
    expect(classifyRow({ aiVerdict: 'correct', studentAnswer: '12 м/с', expectedAnswer: '12 м/с', note: '' }))
      .toMatchObject({ light: 'green', reason: null, suggested: null, match: 'equal' })
    // «в 144 раза» и «144» — одно и то же по compareAnswers (§189).
    expect(classifyRow({ aiVerdict: 'correct', studentAnswer: 'в 144 раза', expectedAnswer: '144', note: '' }).light).toBe('green')
  })

  it('«верно», но код ответ не подтвердил — жёлтая «записан иначе»', () => {
    expect(classifyRow({ aiVerdict: 'correct', studentAnswer: '50%', expectedAnswer: '0,5', note: '' }))
      .toMatchObject({ light: 'yellow', reason: 'correct_other_form', suggested: 'correct', match: 'unknown' })
    expect(classifyRow({ aiVerdict: 'correct', studentAnswer: '', expectedAnswer: '4', note: '' }).reason).toBe('correct_other_form')
  })

  it('«частично» при совпавшем ответе — жёлтая, предложено «верно»', () => {
    const t = classifyRow({ aiVerdict: 'partial', studentAnswer: '4π; 3π; 15π/4', expectedAnswer: '4π; 3π; 15π/4', note: 'Неверный отбор: x=3π не входит в [5π/2; 4π]' })
    expect(t).toMatchObject({ light: 'yellow', reason: 'partial_equal', suggested: 'correct' })
    expect(t.rootCheck).toMatchObject({ verdict: 'false_claim', actual: true })
  })

  it('«частично» с другим ответом — предложено «частично»', () => {
    expect(classifyRow({ aiVerdict: 'partial', studentAnswer: '12', expectedAnswer: '30', note: '' }))
      .toMatchObject({ light: 'yellow', reason: 'answer_differs', suggested: 'partial', match: 'different' })
  })

  it('«неверно» — жёлтая, предложено «неверно»; ложная претензия при совпавшем ответе — «верно»', () => {
    expect(classifyRow({ aiVerdict: 'wrong', studentAnswer: '−3,8', expectedAnswer: '−4,5', note: '' }))
      .toMatchObject({ light: 'yellow', reason: 'wrong', suggested: 'wrong' })
    expect(classifyRow({ aiVerdict: 'wrong', studentAnswer: '7π/4', expectedAnswer: '7π/4', note: '7π/4 не входит в [3π/2; 3π]' }))
      .toMatchObject({ reason: 'wrong', suggested: 'correct' })
  })

  it('«не сверено» и задания, которого нет у ИИ, — жёлтые без предложения', () => {
    expect(classifyRow({ aiVerdict: 'unchecked', studentAnswer: '', expectedAnswer: '0,125', note: 'не разобрал почерк' }))
      .toMatchObject({ light: 'yellow', reason: 'unchecked', suggested: null })
    expect(classifyRow({ aiVerdict: null, studentAnswer: '5', expectedAnswer: '5', note: null }))
      .toMatchObject({ light: 'yellow', reason: 'unchecked', suggested: null })
  })

  it('проверка корней цвет не меняет: ложная претензия у «верно» остаётся зелёной строкой', () => {
    const t = classifyRow({ aiVerdict: 'correct', studentAnswer: '3π', expectedAnswer: '3π', note: '3π не входит в [5π/2; 4π]' })
    expect(t.light).toBe('green')
    expect(t.rootCheck?.verdict).toBe('false_claim')
  })

  it('«частично при совпавшем» — первыми, зелёные — последними', () => {
    const partialEqual = classifyRow({ aiVerdict: 'partial', studentAnswer: '1', expectedAnswer: '1', note: '' })
    const wrong = classifyRow({ aiVerdict: 'wrong', studentAnswer: '1', expectedAnswer: '2', note: '' })
    const green = classifyRow({ aiVerdict: 'correct', studentAnswer: '1', expectedAnswer: '1', note: '' })
    expect([triageRank(partialEqual), triageRank(wrong), triageRank(green)]).toEqual([0, 1, 2])
  })
})

describe('§238. заполнение таблицы из ИИ', () => {
  it('«частично» при совпавшем ответе ложится «верно» БЕЗ заметки ИИ — её видит ученик', () => {
    expect(seededVerdict({ verdict: 'partial', student_answer: '30 Н', expected_answer: '30 Н', note: 'Нет хода решения' }))
      .toEqual({ verdict: 'correct', note: null })
    expect(seededVerdict({ verdict: 'partial', student_answer: 'в 144 раза', expected_answer: '144', note: 'x=3π не входит в [5π/2; 4π]' }))
      .toEqual({ verdict: 'correct', note: null })
  })

  it('остальное — как было, с заметкой ИИ', () => {
    expect(seededVerdict({ verdict: 'partial', student_answer: '12', expected_answer: '30', note: 'n' })).toEqual({ verdict: 'partial', note: 'n' })
    expect(seededVerdict({ verdict: 'wrong', student_answer: '1', expected_answer: '2', note: 'знак' })).toEqual({ verdict: 'wrong', note: 'знак' })
    expect(seededVerdict({ verdict: 'correct', student_answer: '1', expected_answer: '1', note: '' })).toEqual({ verdict: 'correct', note: null })
  })

  it('«Заполнить заново из ИИ» (reviewTasksFromAi) применяет то же правило', () => {
    const rows = reviewTasksFromAi([
      { no: '1', verdict: 'partial', student_answer: '4π', expected_answer: '4π', note: 'x=3π не входит в [5π/2; 4π]' },
      { no: '2', verdict: 'partial', student_answer: '1', expected_answer: '2', note: 'ход неверный' },
    ])
    expect(rows.map(r => [r.no, r.verdict, r.note])).toEqual([
      ['1', 'correct', null],
      ['2', 'partial', 'ход неверный'],
    ])
  })

  it('правки к только что заполненной таблице: только «частично» при совпавшем ответе, с текущей заметкой для условной записи', () => {
    expect(seedDoubtPatches([
      { id: 'a', verdict: 'partial', student_answer: '1', expected_answer: '1', note: 'претензия ИИ' },
      { id: 'b', verdict: 'partial', student_answer: '1', expected_answer: '2', note: 'x' },
      { id: 'c', verdict: 'correct', student_answer: '1', expected_answer: '1', note: null },
    ])).toEqual([{ id: 'a', note: 'претензия ИИ', patch: { verdict: 'correct', note: null } }])
  })
})

describe('§238. кнопка «Поставить …»', () => {
  const AI = 'Неверный отбор: x=3π не входит в [5π/2; 4π]'

  it('«верно» стирает заметку, если в ней дословно текст ИИ', () => {
    expect(acceptSuggestionPatch('correct', AI, AI)).toEqual({ verdict: 'correct', note: null })
    // Пробелы по краям срезают и RPC заполнения, и разбор слепка.
    expect(acceptSuggestionPatch('correct', `  ${AI} `, AI)).toEqual({ verdict: 'correct', note: null })
  })

  it('заметку преподавателя не трогает', () => {
    expect(acceptSuggestionPatch('correct', `${AI} — проверил, отбор верный`, AI)).toEqual({ verdict: 'correct' })
    expect(acceptSuggestionPatch('correct', 'Своё замечание', AI)).toEqual({ verdict: 'correct' })
    expect(acceptSuggestionPatch('correct', null, AI)).toEqual({ verdict: 'correct' })
  })

  it('у ИИ заметки нет — нечего сверять, заметку не трогает', () => {
    expect(acceptSuggestionPatch('correct', 'текст', '')).toEqual({ verdict: 'correct' })
  })

  it('другие предложения заметку не трогают: объяснение ошибки ученику нужно', () => {
    expect(acceptSuggestionPatch('wrong', AI, AI)).toEqual({ verdict: 'wrong' })
    expect(acceptSuggestionPatch('partial', AI, AI)).toEqual({ verdict: 'partial' })
  })
})
