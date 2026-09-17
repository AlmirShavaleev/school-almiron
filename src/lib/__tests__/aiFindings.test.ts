import { describe, expect, it } from 'vitest'
import {
  MAX_FINDINGS,
  MAX_FORMAT_FINDINGS,
  MAX_PRAISE_FINDINGS,
  MAX_RENDER_FILES,
  UNCHECKED_LOW_CONFIDENCE_SHARE,
  answerNumber,
  answersEqual,
  compareAnswers,
  computeScore,
  contradictionPairs,
  deriveConfidence,
  filterFindings,
  fiveFromRatio,
  isPartialCheck,
  isSelfContradictoryText,
  normalizeAnswer,
  parseTasks,
  planRenderFile,
  renderDensityFor,
  renderPageCostMs,
  reconcileTasks,
  reconcileTasksDetailed,
  taskNoFromText,
  withLoweredNote,
  withUncheckedNote,
  type FindingDraft,
  type TaskRow,
} from '../../../supabase/functions/check-homework-ai/findings.ts'

/**
 * §180. ИИ-проверка v17: балл из таблицы заданий, находки без выдумок.
 * §189 (v18): вердикт не спорит с ответами, неполная проверка без балла.
 *
 * Модуль чистый ради этих тестов: `index.ts` живёт в Deno и здесь не
 * запускается. Примеры взяты из выгрузки 15 прогонов 15.09
 * (`board/ИИ_ПРОВЕРКА_ВЫГРУЗКА_15-09.md`) и из первого живого прогона v17
 * (job `e1a17336…`, Гарифуллин, «Прототипы №3, часть 2») — это настоящие
 * строки модели, а не придуманные.
 */

const task = (no: string, verdict: TaskRow['verdict'], student = '', expected = '', note = ''): TaskRow =>
  ({ no, verdict, student_answer: student, expected_answer: expected, note })

const finding = (category: FindingDraft['category'], text: string, taskNo = ''): FindingDraft =>
  ({ category, text, task: taskNo })

describe('нормализация ответов', () => {
  it('запятая и точка, пробелы, регистр, юникодный минус — одно и то же', () => {
    expect(normalizeAnswer(' 0,78 ')).toBe('0.78')
    expect(normalizeAnswer('−8')).toBe('-8')
    expect(normalizeAnswer('3 из 15')).toBe('3из15')
    expect(normalizeAnswer('А-2, Б-3')).toBe('а-2.б-3')
    expect(answersEqual('0,2', '0.20')).toBe(true)
    expect(answersEqual('-8', '−8')).toBe(true)
    expect(answersEqual('+12', '12.')).toBe(true)
  })

  it('пустое не равно ничему, разные значения не равны', () => {
    expect(answersEqual('', '')).toBe(false)
    expect(answersEqual('0,78', '')).toBe(false)
    expect(answersEqual('64', '±8')).toBe(false)
    expect(answersEqual('3 из 15', '3 из 16')).toBe(false)
  })
})

describe('таблица заданий из ответа модели', () => {
  it('чистит строки: неизвестный вердикт → unchecked, дубли схлопываются, мусор выбрасывается', () => {
    const rows = parseTasks([
      { no: 3, verdict: 'WRONG', student_answer: 0.82, expected_answer: '0,78', note: 'знак' },
      { no: '3', verdict: 'correct' },
      { no: '4', verdict: 'почти' },
      { verdict: 'correct' },
      null,
      'строка',
    ])
    expect(rows).toEqual([
      { no: '3', verdict: 'wrong', student_answer: '0.82', expected_answer: '0,78', note: 'знак' },
      { no: '4', verdict: 'unchecked', student_answer: '', expected_answer: '', note: '' },
    ])
    expect(parseTasks(undefined)).toEqual([])
    expect(parseTasks({ no: '1' })).toEqual([])
  })

  it('wrong с равными ответами становится correct; partial с равными остаётся partial (§149: верный ответ без хода)', () => {
    const rows = reconcileTasks([
      task('1', 'wrong', '0,78', '0.78'),
      task('2', 'partial', '10', '10', 'нет развёрнутого решения'),
      task('3', 'wrong', '64', '±8'),
    ])
    expect(rows.map(r => r.verdict)).toEqual(['correct', 'partial', 'wrong'])
  })
})

describe('балл из таблицы', () => {
  it('стобалльная: доля верных с половинками за partial, unchecked не в знаменателе', () => {
    // №8 Райнур: две ошибки из 16 → 88, а не 94.
    const sixteen = Array.from({ length: 16 }, (_, i) => task(String(i + 1), i < 14 ? 'correct' : 'wrong'))
    expect(computeScore(sixteen, 'hundred').score).toBe(88)
    expect(computeScore(sixteen, null).score).toBe(88)

    const withPartial = [task('1', 'correct'), task('2', 'partial'), task('3', 'wrong'), task('4', 'unchecked')]
    const s = computeScore(withPartial, 'hundred')
    expect(s).toMatchObject({ correct: 1, partial: 1, wrong: 1, unchecked: 1, counted: 3, score: 50 })
  })

  it('пятибалльная: №12 Степанов — ошибка в одной задаче из шести → 4, а не 5', () => {
    const six = Array.from({ length: 6 }, (_, i) => task(String(i + 1), i === 2 ? 'wrong' : 'correct'))
    expect(computeScore(six, 'five').score).toBe(4)
    expect(fiveFromRatio(1)).toBe(5)
    expect(fiveFromRatio(0.9)).toBe(5)
    expect(fiveFromRatio(0.7)).toBe(4)
    expect(fiveFromRatio(0.5)).toBe(3)
    expect(fiveFromRatio(0.49)).toBe(2)
    expect(fiveFromRatio(0)).toBe(2)
  })

  it('без таблицы или когда всё unchecked балла нет — не ноль', () => {
    expect(computeScore([], 'hundred').score).toBeNull()
    expect(computeScore([task('1', 'unchecked'), task('2', 'unchecked')], 'five').score).toBeNull()
  })
})

describe('текстовая страховка «X, а не X»', () => {
  it.each([
    'Здесь потеряно значение 0,04 при вычитании: должно быть 0,82 - 0,04 = 0,78, а не 0,82 - 0,04 = 0,78 — ты правильно посчитал, но записал с ошибкой.',
    'Ты написал P(все) = 0,9^3 = 0,729, но потом в вычислении 1 - 0,729 допустил ошибку — должно быть 0,271, а у тебя получилось 0,271, хотя ты записал 0,271 — проверь почерк.',
    'В задаче 4 у тебя ошибка: благоприятных мест для Сергея — 3 из 15, а не 3 из 16; правильный ответ 0,2, а не 0,2.',
    'что дало неверный ответ -8 вместо -8 (совпал случайно)',
    'в шестнадцатой перепутаны соответствия (должно быть А-2, Б-3, а не А-2, Б-3).',
    'Объем отсеченной призмы равен 1/8 объема куба, значит объем куба должен быть 88, а не 11*8=88 — тут ты случайно получил верный ответ.',
  ])('выдумка: %s', text => {
    expect(isSelfContradictoryText(text)).toBe(true)
  })

  it.each([
    'В задаче 2 ты получил -1.25, а должно быть -2.5 — ошибка в подстановке чисел.',
    'Ты неправильно нашёл b0 в задаче 7: √(4 + b0²) = 2√17 → 4 + b0² = 68 → b0² = 64 → b0 = ±8, а не 64.',
    'вероятность несовпадения должна быть 18/20, а не 2/20.',
    'В задаче 3 путь должен быть 80 м, а не 100 м — ты забыл, что от 1 до 4 с тело покоится.',
    'в третьей неверно рассчитан путь (вместо 80 м написано 100 м)',
    'Отношение объемов равно квадрату коэффициента подобия, а не самому коэффициенту. Должно быть V/V1 = 4, а не 2.',
    'Не забывай писать ОДЗ явно.',
  ])('настоящая находка остаётся: %s', text => {
    expect(isSelfContradictoryText(text)).toBe(false)
  })

  it('пары значений вынимаются из фразы', () => {
    expect(contradictionPairs('правильный ответ 0,2, а не 0,2.')).toEqual([['0,2', '0,2.']])
    expect(contradictionPairs('Не забывай писать ОДЗ явно.')).toEqual([])
  })
})

describe('номер задания из текста находки', () => {
  it('«В задаче 4 …», «задание 12», «№7»', () => {
    expect(taskNoFromText('В задаче 4 ты верно сравнил коэффициенты')).toBe('4')
    expect(taskNoFromText('Задание 12: не указана размерность')).toBe('12')
    expect(taskNoFromText('№7 — только один корень')).toBe('7')
    expect(taskNoFromText('в пункте б) задачи 6а допущена ошибка')).toBe('6а')
    expect(taskNoFromText('Здесь потерян знак')).toBe('')
  })
})

describe('фильтр находок по таблице', () => {
  it('calc/logic на строке с равными ответами — выдумка, строка становится correct', () => {
    const tasks = [
      task('3', 'wrong', '0,78', '0.78'),
      task('5', 'wrong', '0.271', '0,271'),
      task('7', 'wrong', '64', '±8'),
    ]
    const r = filterFindings([
      finding('calc', 'В задаче 3 потеряно значение при вычитании', '3'),
      finding('logic', 'В задаче 5 неверный ход', '5'),
      finding('calc', 'В задаче 7 ты нашёл 64, а нужно ±8', '7'),
    ], tasks)
    expect(r.kept.map(f => f.task)).toEqual(['7'])
    expect(r.tasks.map(t => t.verdict)).toEqual(['correct', 'correct', 'wrong'])
    expect(r.dropped).toBe(2)
    expect(r.droppedBy.contradiction).toBe(2)
  })

  it('partial с равными ответами: calc отбрасывается, logic остаётся (верный ответ, ход с изъяном)', () => {
    const tasks = [task('2', 'partial', '10', '10', 'нет хода')]
    const r = filterFindings([
      finding('calc', 'Арифметическая ошибка в задаче 2', '2'),
      finding('logic', 'В задаче 2 ход неверен, ответ совпал', '2'),
    ], tasks)
    expect(r.kept.map(f => f.category)).toEqual(['logic'])
    expect(r.tasks[0].verdict).toBe('partial')
  })

  it('ошибочные категории только на wrong/partial: на correct — долой; comment на unchecked — можно', () => {
    const tasks = [task('1', 'correct'), task('2', 'unchecked'), task('3', 'wrong')]
    const r = filterFindings([
      finding('logic', 'Ты правильно учёл, что -x²-16 всегда отрицательно', '1'),
      finding('comment', 'Здесь почерк не разобрать — проверьте вручную', '2'),
      finding('calc', 'В задаче 3 потерян знак', '3'),
    ], tasks)
    expect(r.kept.map(f => f.category)).toEqual(['comment', 'calc'])
    expect(r.droppedBy.offTable).toBe(1)
  })

  it('не больше одной calc/logic/comment на строку — первая побеждает', () => {
    const tasks = [task('3', 'wrong', '100', '80')]
    const r = filterFindings([
      finding('calc', 'В задаче 3 путь 80 м, а не 100 м', '3'),
      finding('logic', 'В задаче 3 забыл про покой', '3'),
    ], tasks)
    expect(r.kept).toHaveLength(1)
    expect(r.kept[0].category).toBe('calc')
    expect(r.droppedBy.limit).toBe(1)
  })

  it('номер задания без поля task берётся из текста', () => {
    const tasks = [task('4', 'wrong', '-5', '-10')]
    const r = filterFindings([finding('calc', 'В задаче 4 ты верно сравнил коэффициенты, но ax = -10, а не -5')], tasks)
    expect(r.kept).toHaveLength(1)
    expect(r.kept[0].task).toBe('4')
  })

  it('находка без номера при таблице остаётся: доказать выдумку нечем', () => {
    const tasks = [task('1', 'correct'), task('2', 'wrong')]
    const r = filterFindings([finding('comment', 'Здесь ты написал только ответ, без решения')], tasks)
    expect(r.kept).toHaveLength(1)
  })

  it('praise: не больше одной и только при наличии ошибки; в потолок ошибки идут раньше похвалы', () => {
    // №1 Гарифуллин: 11 praise из 12 при одной ошибке.
    const tasks = Array.from({ length: 16 }, (_, i) => task(String(i + 1), i === 6 ? 'wrong' : 'correct'))
    const raw: FindingDraft[] = [
      ...Array.from({ length: 11 }, (_, i) => finding('praise', `Отлично решена задача ${i + 1}`)),
      finding('calc', 'В задаче 7 нужно было выбрать -8', '7'),
    ]
    const r = filterFindings(raw, tasks)
    expect(r.kept.map(f => f.category)).toEqual(['calc', 'praise'])
    expect(r.dropped).toBe(10)
    expect(MAX_PRAISE_FINDINGS).toBe(1)
  })

  it('все задания верны — похвалы нет вовсе, «всё верно» скажет summary', () => {
    const tasks = [task('1', 'correct'), task('2', 'correct')]
    const r = filterFindings([finding('praise', 'Молодец, всё верно')], tasks)
    expect(r.kept).toEqual([])
    expect(r.dropped).toBe(1)
  })

  it('format — не больше двух на работу', () => {
    const tasks = [task('1', 'wrong')]
    const r = filterFindings([
      finding('format', 'Нет единиц измерения'),
      finding('format', 'Пиши ОДЗ явно'),
      finding('format', 'Подчёркивай ответ'),
    ], tasks)
    expect(r.kept).toHaveLength(MAX_FORMAT_FINDINGS)
  })

  it('текстовая выдумка отбрасывается и с таблицей, и без неё', () => {
    const text = 'правильный ответ 0,2, а не 0,2.'
    expect(filterFindings([finding('calc', text, '4')], [task('4', 'wrong', '0,2', '0,25')]).kept).toEqual([])
    expect(filterFindings([finding('calc', text)], []).droppedBy.text).toBe(1)
  })

  it('без таблицы: лимиты действуют, praise считается по оставшимся ошибкам', () => {
    const r = filterFindings([
      finding('praise', 'Хорошо'),
      finding('praise', 'Отлично'),
      finding('calc', 'В задаче 2 потерян знак'),
    ], [])
    expect(r.kept.map(f => f.category)).toEqual(['calc', 'praise'])

    const onlyPraise = filterFindings([finding('praise', 'Хорошо')], [])
    expect(onlyPraise.kept).toEqual([])
  })

  it('потолок MAX_FINDINGS — страховка после всех фильтров', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task(String(i + 1), 'wrong'))
    const raw = tasks.map(t => finding('calc', `ошибка в задаче ${t.no}`, t.no))
    const r = filterFindings(raw, tasks)
    expect(r.kept).toHaveLength(MAX_FINDINGS)
    expect(r.dropped).toBe(20 - MAX_FINDINGS)
  })
})

describe('уверенность и приписка о несверенных', () => {
  const ctx = (over: Partial<Parameters<typeof deriveConfidence>[1]> = {}) => ({
    tasks: [task('1', 'correct')],
    readable: true,
    referenceState: 'used' as const,
    pagesSkipped: false,
    ...over,
  })

  it('low при нечитаемой работе или ≥ 20 % unchecked, medium без эталона, иначе как у модели', () => {
    const three = [task('1', 'correct'), task('2', 'unchecked'), task('3', 'correct')]
    expect(deriveConfidence('high', ctx({ tasks: three }))).toBe('low')
    expect(deriveConfidence('high', ctx({ readable: false }))).toBe('low')
    expect(deriveConfidence('high', ctx())).toBe('high')
    expect(deriveConfidence('high', ctx({ referenceState: 'missing' }))).toBe('medium')
    expect(deriveConfidence('low', ctx({ tasks: [], referenceState: 'failed' }))).toBe('low')
    expect(deriveConfidence('чушь', ctx({ tasks: [] }))).toBeNull()
  })

  it('§189: непрочитанные страницы роняют уверенность независимо от таблицы', () => {
    expect(deriveConfidence('high', ctx({ pagesSkipped: true }))).toBe('low')
    expect(deriveConfidence('high', ctx({ tasks: [], pagesSkipped: true }))).toBe('low')
  })

  it('несверенные задания перечисляются в summary, при их отсутствии summary не меняется', () => {
    expect(withUncheckedNote('Разбор.', [task('1', 'correct'), task('4', 'unchecked'), task('7', 'unchecked')]))
      .toBe('Разбор.\n\nНе сверены задания (в балл не вошли): 4, 7.')
    expect(withUncheckedNote('Разбор.', [task('1', 'correct')])).toBe('Разбор.')
    expect(withUncheckedNote('', [task('2', 'unchecked')])).toBe('Не сверены задания (в балл не вошли): 2.')
  })
})

// ---------------------------------------------------------------------------
// §189 (v18)
// ---------------------------------------------------------------------------

describe('§189. число из ответа', () => {
  it('слова, единицы и разряды вокруг числа не мешают', () => {
    expect(answerNumber('в 144 раза')).toEqual({ value: 144, unit: '' })
    expect(answerNumber('3,6 куб. см')).toEqual({ value: 3.6, unit: 'куб см' })
    expect(answerNumber('в 25 раз')).toEqual({ value: 25, unit: '' })
    expect(answerNumber('12')).toEqual({ value: 12, unit: '' })
    expect(answerNumber('1 000 000 руб')).toEqual({ value: 1000000, unit: 'руб' })
    expect(answerNumber('−8')).toEqual({ value: -8, unit: '' })
    expect(answerNumber('50%')).toEqual({ value: 50, unit: '%' })
  })

  it('там, где чисел нет или их несколько, число не вытаскивается вовсе', () => {
    // Смешанная дробь, набор соответствий, диапазон, выражение — гадать нельзя.
    expect(answerNumber('2 30/49')).toBeNull()
    expect(answerNumber('А-2, Б-3')).toBeNull()
    expect(answerNumber('3 из 15')).toBeNull()
    expect(answerNumber('0,82 - 0,04')).toBeNull()
    expect(answerNumber('±8')).toBeNull()
    expect(answerNumber('да')).toBeNull()
    expect(answerNumber('')).toBeNull()
    expect(answerNumber(null)).toBeNull()
  })
})

describe('§189. сверка ответа с ожидаемым', () => {
  it.each([
    ['в 144 раза', '144'],
    ['3,6 куб. см', '3,6'],
    ['в 25 раз', '25'],
    ['0,2', '0.20'],
    ['5 м', '5 м'],
  ])('одно и то же, записанное по-разному: «%s» = «%s»', (a, b) => {
    expect(compareAnswers(a, b)).toBe('equal')
  })

  it.each([
    ['12', '30'],
    ['12', '6'],
    ['в 144 раза', '12'],
    ['3,6 куб. см', '7,2'],
  ])('разные числа: «%s» ≠ «%s»', (a, b) => {
    expect(compareAnswers(a, b)).toBe('different')
  })

  it.each([
    ['2 30/49', '98'],
    ['да', 'нет'],
    ['', ''],
    ['12', ''],
    ['±8', '8'],
    ['x = 2 и x = 3', '2'],
    ['50%', '0,5'],
    ['0,5 м', '50 см'],
  ])('сравнивать нечего — вердикт модели не трогаем: «%s» / «%s»', (a, b) => {
    expect(compareAnswers(a, b)).toBe('unknown')
  })
})

describe('§189. вердикт сверяется с ответами в обе стороны', () => {
  it('correct с разошедшимися ответами понижается до wrong, заметка сохраняется', () => {
    // Живая таблица job e1a17336…: задания 4 и 11 — «correct» при 12/30 и 12/6.
    const r = reconcileTasksDetailed([
      task('4', 'correct', '12', '30', 'ответ неверен: должно быть 30'),
      task('11', 'correct', '12', '6', 'ответ неверен: должно быть 6'),
    ])
    expect(r.tasks.map(t => t.verdict)).toEqual(['wrong', 'wrong'])
    expect(r.tasks[0].note).toBe('ответ неверен: должно быть 30')
    expect(r.lowered).toEqual(['4', '11'])
  })

  it('заметка говорит о верном ходе — понижаем до partial, а не до wrong', () => {
    const r = reconcileTasksDetailed([
      task('5', 'correct', '18', '20', 'ход верный, арифметическая ошибка в конце'),
      task('6', 'correct', '18', '20', 'верный ход, описка при переносе'),
    ])
    expect(r.tasks.map(t => t.verdict)).toEqual(['partial', 'partial'])
    expect(r.lowered).toEqual(['5', '6'])
  })

  it.each([
    ['в 144 раза', '144'],
    ['3,6 куб. см', '3,6'],
    ['2 30/49', '98'],
    ['да', 'нет'],
    ['', ''],
    ['12', ''],
  ])('correct не понижается там, где сравнивать нечего или ответы совпали: «%s» / «%s»', (student, expected) => {
    const r = reconcileTasksDetailed([task('1', 'correct', student, expected)])
    expect(r.tasks[0].verdict).toBe('correct')
    expect(r.lowered).toEqual([])
  })

  it('обратное направление §180 живо и работает по числам', () => {
    const r = reconcileTasksDetailed([
      task('1', 'wrong', '0,78', '0.78'),
      task('2', 'wrong', 'в 144 раза', '144'),
      task('3', 'partial', '10', '10', 'нет развёрнутого решения'),
      task('4', 'wrong', '64', '±8'),
    ])
    expect(r.tasks.map(t => t.verdict)).toEqual(['correct', 'correct', 'partial', 'wrong'])
    expect(r.lowered).toEqual([])
    expect(reconcileTasks(r.tasks).map(t => t.verdict)).toEqual(['correct', 'correct', 'partial', 'wrong'])
  })

  it('unchecked и partial с разошедшимися ответами не трогаем — понижать нечего', () => {
    const r = reconcileTasksDetailed([
      task('1', 'unchecked', '12', '30'),
      task('2', 'partial', '12', '30'),
      task('3', 'wrong', '12', '30'),
    ])
    expect(r.tasks.map(t => t.verdict)).toEqual(['unchecked', 'partial', 'wrong'])
    expect(r.lowered).toEqual([])
  })

  it('понижение открывает дорогу находке по этой строке: она больше не «по верному заданию»', () => {
    const tasks = [task('4', 'correct', '12', '30', 'ответ неверен: должно быть 30')]
    const r = filterFindings([finding('calc', 'В задаче 4 должно быть 30', '4')], tasks)
    expect(r.kept).toHaveLength(1)
    expect(r.tasks[0].verdict).toBe('wrong')
    expect(r.lowered).toEqual(['4'])
  })

  it('балл пересчитывается после понижений: тот самый прогон — 84, а не 97', () => {
    // 21 задание: 15 correct + 1 partial + 5 unchecked дали 97.
    const tasks: TaskRow[] = [
      ...Array.from({ length: 15 }, (_, i) => task(String(i + 1), 'correct', '7', '7')),
      task('16', 'partial', '5', '5', 'нет хода'),
      ...Array.from({ length: 5 }, (_, i) => task(String(i + 17), 'unchecked')),
    ]
    expect(computeScore(tasks, 'hundred').score).toBe(97)

    // Задания 4 и 11 на деле разошлись с ожидаемым.
    tasks[3] = task('4', 'correct', '12', '30', 'ответ неверен: должно быть 30')
    tasks[10] = task('11', 'correct', '12', '6', 'ответ неверен: должно быть 6')
    const r = reconcileTasksDetailed(tasks)
    expect(r.lowered).toEqual(['4', '11'])
    expect(computeScore(r.tasks, 'hundred').score).toBe(84)
  })

  it('поправленные задания названы в summary — число пришло не от модели', () => {
    expect(withLoweredNote('Разбор.', ['4', '11']))
      .toBe('Разбор.\n\nСистема поправила вердикт по заданиям 4, 11 (ответ не совпал с ожидаемым).')
    expect(withLoweredNote('', ['4']))
      .toBe('Система поправила вердикт по заданию 4 (ответ не совпал с ожидаемым).')
    expect(withLoweredNote('Разбор.', [])).toBe('Разбор.')
  })
})

describe('§189. проверена не вся работа — балла нет', () => {
  const full = Array.from({ length: 10 }, (_, i) => task(String(i + 1), 'correct'))

  it('непрочитанные страницы делают проверку неполной при любой таблице', () => {
    expect(isPartialCheck({ tasks: full, pagesSkipped: true })).toBe(true)
    expect(isPartialCheck({ tasks: [], pagesSkipped: true })).toBe(true)
    expect(isPartialCheck({ tasks: full, pagesSkipped: false })).toBe(false)
    expect(isPartialCheck({ tasks: [], pagesSkipped: false })).toBe(false)
  })

  it('порог по несверенным — пятая часть заданий, ровно 20 % уже считается', () => {
    expect(UNCHECKED_LOW_CONFIDENCE_SHARE).toBe(0.2)
    const twoOfTen = full.map((t, i) => (i < 2 ? task(t.no, 'unchecked') : t))
    expect(isPartialCheck({ tasks: twoOfTen, pagesSkipped: false })).toBe(true)

    const oneOfTen = full.map((t, i) => (i < 1 ? task(t.no, 'unchecked') : t))
    expect(isPartialCheck({ tasks: oneOfTen, pagesSkipped: false })).toBe(false)
  })

  it('тот самый прогон: 5 несверенных из 21 — проверка неполная, даже если страницы влезли', () => {
    const tasks = [
      ...Array.from({ length: 16 }, (_, i) => task(String(i + 1), 'correct')),
      ...Array.from({ length: 5 }, (_, i) => task(String(i + 17), 'unchecked')),
    ]
    expect(isPartialCheck({ tasks, pagesSkipped: false })).toBe(true)
  })
})

/**
 * §193. Плотность рендера зависит от объёма работы.
 *
 * Проверяем не «какие числа записаны», а поведение на границах ступеней и два
 * свойства, ради которых всё затевалось: длинная работа дешевле короткой, и
 * потолок ширины падает вместе с DPI (иначе для крупноформатных сканов
 * понижение плотности не даёт ничего — это показал замер).
 */
describe('renderDensityFor — плотность рендера по числу страниц', () => {
  it('короткая работа читается как раньше, 150 DPI', () => {
    expect(renderDensityFor(1).dpi).toBe(150)
    expect(renderDensityFor(8).dpi).toBe(150)
  })

  it('со страницы 9 и до 14 включительно — 120 DPI', () => {
    expect(renderDensityFor(9).dpi).toBe(120)
    expect(renderDensityFor(11).dpi).toBe(120)
    expect(renderDensityFor(14).dpi).toBe(120)
  })

  it('с 15 страниц — 100 DPI', () => {
    expect(renderDensityFor(15).dpi).toBe(100)
    expect(renderDensityFor(20).dpi).toBe(100)
    expect(renderDensityFor(41).dpi).toBe(100)
  })

  it('плотность не растёт с числом страниц ни на одном шаге', () => {
    let previous = Infinity
    for (let pages = 1; pages <= 60; pages += 1) {
      const { dpi } = renderDensityFor(pages)
      expect(dpi).toBeLessThanOrEqual(previous)
      previous = dpi
    }
  })

  it('потолок ширины падает вместе с DPI — иначе крупный скан не подешевеет', () => {
    const short = renderDensityFor(5)
    const medium = renderDensityFor(11)
    const long = renderDensityFor(30)
    expect(medium.maxWidth).toBeLessThan(short.maxWidth)
    expect(long.maxWidth).toBeLessThan(medium.maxWidth)
    // Пропорция та же, что у DPI: ступень означает одно и то же для листа A4 и
    // для страницы, сохранённой в крупном формате.
    for (const d of [short, medium, long]) {
      expect(d.maxWidth / d.dpi).toBeCloseTo(short.maxWidth / short.dpi, 1)
    }
  })

  it('страница дешевеет на каждой ступени: пикселей у A4 меньше, чем было', () => {
    // Ширина страницы A4 в пунктах; так же считает scale в index.ts.
    const a4Points = 595
    const pixelsFor = (pages: number) => {
      const { dpi, maxWidth } = renderDensityFor(pages)
      const scale = Math.min(dpi / 72, maxWidth / a4Points)
      return (a4Points * scale) ** 2 * Math.SQRT2
    }
    expect(pixelsFor(11)).toBeLessThan(pixelsFor(8))
    expect(pixelsFor(15)).toBeLessThan(pixelsFor(11))
    // Замер §193: 120 DPI — примерно две трети цены, 100 DPI — меньше половины.
    expect(pixelsFor(11) / pixelsFor(8)).toBeCloseTo(0.64, 1)
    expect(pixelsFor(15) / pixelsFor(8)).toBeCloseTo(0.44, 1)
  })

  it('число страниц не прочиталось — берём верхнюю ступень, от перебора страхует бюджет', () => {
    expect(renderDensityFor(0).dpi).toBe(150)
    expect(renderDensityFor(-3).dpi).toBe(150)
    expect(renderDensityFor(Number.NaN).dpi).toBe(150)
    expect(renderDensityFor(null).dpi).toBe(150)
    expect(renderDensityFor(undefined).dpi).toBe(150)
  })
})

/**
 * §196. Бюджет рендера — один на работу, а не на каждый файл.
 *
 * До §196 `RENDER_BUDGET_MS` отсчитывался внутри `renderPdfPages`, то есть
 * заново на каждый PDF: работа из трёх файлов стоила до трёх бюджетов (4,5 с)
 * при жёстком пределе 2 с процессорного времени. За пределом воркер убивают с
 * кодом 546, и задача навсегда остаётся в `processing` — преподаватель смотрит
 * на вечный спиннер (§48).
 *
 * `render` ниже повторяет цикл `collectPages` + `renderPdfPages` из `index.ts`:
 * тот живёт в Deno и в vitest не запускается, а решения из него вынесены сюда
 * (`planRenderFile`, `renderPageCostMs`). Порядок шагов в цикле держится
 * тестами: сперва потолок страниц, потом «первая страница безусловно», потом
 * дедлайн.
 */
describe('бюджет рендера — один на всю работу (§196)', () => {
  /** `RENDER_BUDGET_MS` в index.ts. */
  const BUDGET = 1500
  /** `MAX_PAGES` в index.ts — потолок страниц на работу. */
  const MAX_PAGES = 20
  /** Жёсткий предел edge-функции: за ним код 546 и вечный `processing`. */
  const CPU_LIMIT = 2000

  interface FileResult {
    no: number
    /** Файл вообще открывали? */
    opened: boolean
    /** Сколько страниц уехало модели. */
    taken: number
    total: number
  }

  const render = (pagesPerFile: readonly number[], pageCostMs: number, budgetMs = BUDGET) => {
    let spentMs = 0
    let pagesSent = 0
    let opened = 0
    const files: FileResult[] = pagesPerFile.map((total, index) => {
      const no = index + 1
      const limit = MAX_PAGES - pagesSent
      if (limit <= 0) return { no, opened: false, taken: 0, total }
      const slice = planRenderFile({
        budgetMs,
        budgetLeftMs: budgetMs - spentMs,
        filesAfter: pagesPerFile.length - no,
        pageCostMs,
        opened,
      })
      if (!slice.open) return { no, opened: false, taken: 0, total }
      opened += 1
      let elapsed = 0
      let taken = 0
      while (taken < total) {
        if (taken >= limit) break
        // Первая страница файла рендерится всегда, даже если бюджет уже вышел.
        if (taken > 0 && elapsed > slice.sliceMs) break
        elapsed += pageCostMs
        taken += 1
      }
      spentMs += elapsed
      pagesSent += taken
      return { no, opened: true, taken, total }
    })
    return { files, spentMs, pagesSent }
  }

  /** Строка в `skipped`: файл не открыли или взяли из него не всю пачку. */
  const skipped = (files: readonly FileResult[]) => files.filter(f => !f.opened || f.taken < f.total)

  it('три файла по 5 страниц: бюджет делится, а не отсчитывается заново', () => {
    const { files, spentMs, pagesSent } = render([5, 5, 5], 109)

    expect(files.map(f => f.taken)).toEqual([5, 5, 4])
    expect(pagesSent).toBe(14)
    // Главное число карточки: до §196 те же три файла стоили бы три бюджета.
    expect(spentMs).toBeLessThanOrEqual(BUDGET + 109)
    expect(spentMs).toBeLessThan(CPU_LIMIT)
    // Недобранное уезжает в приписку `skipped` — и гасит балл (§189).
    expect(skipped(files).map(f => f.no)).toEqual([3])
  })

  it('один файл на 20 страниц получает весь бюджет — как до §196', () => {
    const cost = renderPageCostMs(20)
    // Резервировать не на кого: однофайловая работа ничего не теряет.
    expect(planRenderFile({ budgetMs: BUDGET, budgetLeftMs: BUDGET, filesAfter: 0, pageCostMs: cost, opened: 0 }))
      .toEqual({ open: true, sliceMs: BUDGET })

    const { files, spentMs } = render([20], cost)
    expect(files[0].taken).toBeGreaterThan(1)
    expect(files[0].taken).toBeLessThan(20)
    expect(spentMs).toBeLessThanOrEqual(BUDGET + cost)
  })

  it('дешёвые страницы: 20-страничный файл упирается в потолок страниц, а не во время', () => {
    const { files, spentMs } = render([20], 60)
    expect(files[0].taken).toBe(MAX_PAGES)
    expect(spentMs).toBeLessThan(BUDGET)
  })

  it('восемь файлов: часть не открывается вовсе, но названы все', () => {
    const { files, spentMs } = render([10, 10, 10, 10, 10, 10, 10, 10], 109)

    expect(files.filter(f => !f.opened).length).toBeGreaterThan(0)
    // Молча пропустить файл нельзя: работа выглядела бы так, будто его не было.
    expect(skipped(files).length).toBe(8)
    expect(spentMs).toBeLessThanOrEqual(BUDGET + 109)
    expect(spentMs).toBeLessThan(CPU_LIMIT)
    // Непроверенные идут подряд с конца: пока бюджет есть, файлы открываются.
    const firstUnopened = files.findIndex(f => !f.opened)
    expect(files.slice(firstUnopened).every(f => !f.opened)).toBe(true)
  })

  it('шесть одностраничных PDF проходят целиком: план идёт по факту, а не по числу файлов', () => {
    const { files } = render([1, 1, 1, 1, 1, 1], 220)
    expect(files.map(f => f.taken)).toEqual([1, 1, 1, 1, 1, 1])
    expect(skipped(files)).toEqual([])
  })

  it('второй файл работы не исчезает: резерв переживает перебор первого', () => {
    // Две части рабочего листа по 11 страниц, цена страницы 150 DPI на проде.
    // Без поправки на перебор первый файл съедал резерв, и второй не открывался
    // вовсе — работа выглядела так, будто второй части не существует.
    const { files } = render([11, 11], 140)
    expect(files.every(f => f.opened)).toBe(true)
    expect(files.every(f => f.taken >= 1)).toBe(true)
  })

  it('три файла остаются тремя даже при самой дорогой странице', () => {
    const { files, spentMs } = render([11, 11, 11], renderPageCostMs())
    expect(files.map(f => f.opened)).toEqual([true, true, true])
    expect(files.every(f => f.taken >= 1)).toBe(true)
    expect(spentMs).toBeLessThan(CPU_LIMIT)
  })

  it('дюжина дешёвых файлов упирается в потолок открываемых файлов', () => {
    // Бюджета хватило бы на все, но каждый открытый PDF — это ещё и запуск
    // WASM-движка, которого бюджет страниц не считает.
    const { files } = render(Array.from({ length: 12 }, () => 1), 60)
    expect(files.filter(f => f.opened).length).toBe(MAX_RENDER_FILES)
    expect(skipped(files).length).toBe(12 - MAX_RENDER_FILES)
  })

  it('у каждого открытого файла есть хотя бы одна страница', () => {
    for (const pages of [[5, 5, 5], [1, 1, 1, 1, 1, 1], [12, 3], [10, 10, 10, 10, 10, 10, 10, 10], [41, 41]]) {
      for (const cost of [60, 109, 139, 220]) {
        for (const file of render(pages, cost).files) {
          if (file.opened) expect(file.taken).toBeGreaterThanOrEqual(1)
        }
      }
    }
    // Первый файл открывается всегда, даже когда бюджета нет вовсе.
    expect(planRenderFile({ budgetMs: BUDGET, budgetLeftMs: 0, filesAfter: 5, pageCostMs: 220, opened: 0 }))
      .toEqual({ open: true, sliceMs: 0 })
    expect(planRenderFile({ budgetMs: BUDGET, budgetLeftMs: 0, filesAfter: 5, pageCostMs: 220, opened: 1 }).open)
      .toBe(false)
  })

  it('перебор не больше одной страницы, сколько бы файлов ни было', () => {
    for (let count = 1; count <= 12; count += 1) {
      for (const cost of [60, 109, 139, 172, 220]) {
        const { spentMs } = render(Array.from({ length: count }, () => 10), cost)
        expect(spentMs).toBeLessThanOrEqual(BUDGET + cost)
        expect(spentMs).toBeLessThan(CPU_LIMIT)
      }
    }
  })

  it('резерв на гарантийные страницы растёт с числом оставшихся файлов', () => {
    const cost = 220
    const many = planRenderFile({ budgetMs: BUDGET, budgetLeftMs: BUDGET, filesAfter: 3, pageCostMs: cost, opened: 0 })
    const one = planRenderFile({ budgetMs: BUDGET, budgetLeftMs: BUDGET, filesAfter: 1, pageCostMs: cost, opened: 0 })
    // Резерв — по странице на каждый файл, который ещё будет открыт, плюс одна
    // на перебор текущего: цикл выходит за свою долю ровно на одну страницу.
    expect(many.sliceMs).toBe(BUDGET - 3 * cost)
    expect(one.sliceMs).toBe(BUDGET - 2 * cost)
    expect(many.sliceMs).toBeLessThan(one.sliceMs)
    // Резерв не съедает больше половины остатка: иначе первому файлу нечем
    // показать работу, а список обложек проверкой не является.
    expect(many.sliceMs).toBeGreaterThanOrEqual(BUDGET / 2)
    // Цена страницы не прочиталась — планируем по остатку, как до §196.
    expect(planRenderFile({ budgetMs: BUDGET, budgetLeftMs: 800, filesAfter: 3, pageCostMs: Number.NaN, opened: 1 }))
      .toEqual({ open: true, sliceMs: 800 })
  })

  it('цена страницы падает вместе с плотностью и не занижается при неизвестном числе страниц', () => {
    expect(renderPageCostMs(5)).toBeGreaterThan(renderPageCostMs(11))
    expect(renderPageCostMs(11)).toBeGreaterThan(renderPageCostMs(30))
    // Число страниц до открытия файла неизвестно — берём самую дорогую ступень.
    expect(renderPageCostMs()).toBe(renderPageCostMs(1))
    expect(renderPageCostMs()).toBeGreaterThanOrEqual(renderPageCostMs(41))
    // Пропорция — измеренная §193 цена полного цикла «рендер + JPEG».
    expect(renderPageCostMs(11) / renderPageCostMs(5)).toBeCloseTo(0.78, 2)
    expect(renderPageCostMs(30) / renderPageCostMs(5)).toBeCloseTo(0.63, 2)
  })
})
