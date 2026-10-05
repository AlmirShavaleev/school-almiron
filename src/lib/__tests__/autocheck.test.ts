import { describe, expect, it } from 'vitest'
import {
  answerFormatError,
  asFreshStudent,
  autocheckErrorMessage,
  autocheckGrade,
  autocheckSummary,
  formatCorrectAnswer,
  normalizeLessonFormat,
  parseAutocheckResults,
  parseAutocheckState,
  parseDigitsAnswer,
  parseNumberAnswer,
  sortResults,
} from '@/lib/autocheck'

/**
 * §266. Разбор ввода ученика (то же правило, что у сервера —
 * autocheck_number_of / autocheck_digits_of в PENDING_266.sql, пробы — в
 * supabase/tests/avtoproverka_266/probes.out, блок 0) и итог урока.
 */
describe('parseNumberAnswer — запятая/точка, пробелы, минус', () => {
  it.each([
    ['100', 100],
    ['100,0', 100],
    [' 1 200,5 ', 1200.5],
    ['1 200', 1200],
    ['− 12,5', -12.5],
    ['–12.5', -12.5],
    ['-12.5', -12.5],
    ['+3', 3],
    ['.5', 0.5],
    ['5.', 5],
  ])('«%s» → %s', (raw, expected) => {
    expect(parseNumberAnswer(raw)).toBe(expected)
  })

  it.each(['', 'abc', '12 м', '1e3', '1,2,3', '--1', '1-2'])('«%s» — не число', raw => {
    expect(parseNumberAnswer(raw)).toBeNull()
  })
})

describe('parseDigitsAnswer — строка цифр, разделители не важны', () => {
  it.each([
    ['13', '13'],
    ['1 3', '13'],
    ['1,3;4', '134'],
    ['1.3', '13'],
  ])('«%s» → %s', (raw, expected) => {
    expect(parseDigitsAnswer(raw)).toBe(expected)
  })
  it.each(['', '13а', 'тридцать', '-13'])('«%s» — не цифры', raw => {
    expect(parseDigitsAnswer(raw)).toBeNull()
  })
})

describe('answerFormatError — что сказать до запроса', () => {
  it('пусто, не число, не цифры; годный ответ — без ошибки', () => {
    expect(answerFormatError('number', '  ')).toBe('Введите ответ')
    expect(answerFormatError('number', 'сто')).toBe('Введите число')
    expect(answerFormatError('number', '−12,5')).toBeNull()
    expect(answerFormatError('digits', '1a')).toBe('Введите цифры ответа')
    expect(answerFormatError('digits', '2 4')).toBeNull()
  })
})

describe('autocheckGrade — round(100 × решённые / все)', () => {
  it.each([
    [3, 4, 75],
    [4, 5, 80],
    [1, 8, 13],
    [1, 3, 33],
    [2, 3, 67],
    [0, 4, 0],
    [4, 4, 100],
  ])('%i из %i → %i', (solved, total, grade) => {
    expect(autocheckGrade(solved, total)).toBe(grade)
  })
  it('задач нет — оценки нет', () => {
    expect(autocheckGrade(0, 0)).toBeNull()
  })
})

const RAW_STATE = {
  topic_id: 't1',
  is_staff: false,
  total: 2,
  solved: 1,
  closed: 1,
  finished: false,
  grade: null,
  tasks: [
    {
      id: 'b', code: '1.4.1-Д-02', position: 2, statement_path: 'p/2.svg', answer_type: 'number', digits_any_order: false,
      unit: 'мин', attempts_used: 1, attempts_left: 2, solved: false, closed: false,
      answers: [{ attempt_no: 1, answer: '7', correct: false }],
      answer_value: null, answer_tol: null, answer_text: null, solution_path: null,
    },
    {
      id: 'a', code: '1.4.1-Д-01', position: 1, statement_path: 'p/1.svg', answer_type: 'number', digits_any_order: false,
      unit: 'м', attempts_used: 2, attempts_left: 1, solved: true, closed: true,
      answers: [{ attempt_no: 1, answer: '99', correct: false }, { attempt_no: 2, answer: '100', correct: true }],
      answer_value: 100, answer_tol: 0, answer_text: null, solution_path: 'p/1s.svg',
    },
  ],
}

describe('parseAutocheckState', () => {
  it('задачи по порядку, эталон и решение — только где пришли', () => {
    const s = parseAutocheckState(RAW_STATE)!
    expect(s.tasks.map(t => t.code)).toEqual(['1.4.1-Д-01', '1.4.1-Д-02'])
    expect(s.tasks[0]).toMatchObject({ closed: true, solved: true, answerValue: 100, solutionPath: 'p/1s.svg', attemptsLeft: 1 })
    expect(s.tasks[1]).toMatchObject({ closed: false, answerValue: null, solutionPath: null, attemptsLeft: 2 })
    expect(s.tasks[1].answers).toEqual([{ attemptNo: 1, answer: '7', correct: false }])
  })
  it('не объект — null', () => {
    expect(parseAutocheckState(null)).toBeNull()
    expect(parseAutocheckState('x')).toBeNull()
  })
  it('предпросмотр персонала: эталоны и состояние сброшены как у нового ученика', () => {
    const staff = parseAutocheckState({ ...RAW_STATE, is_staff: true })!
    const fresh = asFreshStudent(staff)
    expect(fresh.isStaff).toBe(false)
    expect(fresh.tasks.every(t => t.answerValue === null && t.solutionPath === null && !t.closed && t.attemptsLeft === 3 && t.answers.length === 0)).toBe(true)
    expect(fresh.solved).toBe(0)
  })
})

describe('подписи', () => {
  it('эталон словами', () => {
    expect(formatCorrectAnswer({ answerType: 'number', answerValue: -12.5, answerTol: 0.05, answerText: null, digitsAnyOrder: false, unit: 'м/с' }))
      .toBe('−12,5 ± 0,05 м/с')
    expect(formatCorrectAnswer({ answerType: 'number', answerValue: 100, answerTol: 0, answerText: null, digitsAnyOrder: false, unit: 'м' })).toBe('100 м')
    expect(formatCorrectAnswer({ answerType: 'digits', answerValue: null, answerTol: 0, answerText: '31', digitsAnyOrder: true, unit: null }))
      .toBe('31 (порядок не важен)')
    expect(formatCorrectAnswer({ answerType: 'number', answerValue: null, answerTol: null, answerText: null, digitsAnyOrder: false, unit: null })).toBeNull()
  })
  it('«Решено N из M · оценка …»', () => {
    expect(autocheckSummary({ solved: 1, total: 4, finished: false, grade: null })).toBe('Решено 1 из 4 · оценка после всех задач')
    expect(autocheckSummary({ solved: 3, total: 4, finished: true, grade: 75 })).toBe('Решено 3 из 4 · оценка 75 из 100')
  })
  it('ошибки сервера → человеческий текст', () => {
    expect(autocheckErrorMessage('AUTOCHECK_CLOSED: задача уже закрыта')).toBe('Задача уже закрыта — попыток больше нет')
    expect(autocheckErrorMessage('AUTOCHECK_FORMAT: введите число')).toBe('Введите число')
    expect(autocheckErrorMessage('Нет доступа к этой задаче')).toBe('Нет доступа к этой задаче')
    expect(autocheckErrorMessage('network')).toBe('Не удалось проверить ответ. Попробуйте ещё раз')
  })
  it('пометка урока: только training / ege', () => {
    expect(normalizeLessonFormat('training')).toBe('training')
    expect(normalizeLessonFormat('ege')).toBe('ege')
    expect(normalizeLessonFormat(null)).toBeNull()
    expect(normalizeLessonFormat('lesson')).toBeNull()
  })
})

describe('результаты класса', () => {
  const raw = {
    tasks: [{ id: 't2', code: 'B', position: 2 }, { id: 't1', code: 'A', position: 1 }],
    students: [
      { student_id: 's1', name: 'Яна', attempts: 4, solved: 2, closed: 2, finished: true, grade: 100,
        cells: [{ task_id: 't1', attempts: 1, solved: true, closed: true }] },
      { student_id: 's2', name: 'Борис', attempts: 6, solved: 0, closed: 2, finished: true, grade: 0, cells: [] },
      { student_id: 's3', name: 'Аня', attempts: 0, solved: 0, closed: 0, finished: false, grade: null, cells: [] },
    ],
  }
  it('разбор: задачи по порядку, клетки по задаче', () => {
    const r = parseAutocheckResults(raw)
    expect(r.tasks.map(t => t.code)).toEqual(['A', 'B'])
    expect(r.students[0].cells.get('t1')).toEqual({ taskId: 't1', attempts: 1, solved: true, closed: true })
  })
  it('«Сначала слабые»: по итогу, не закончившие — в конце; «По имени» — алфавит', () => {
    const r = parseAutocheckResults(raw)
    expect(sortResults(r.students, 'grade').map(s => s.name)).toEqual(['Борис', 'Яна', 'Аня'])
    expect(sortResults(r.students, 'name').map(s => s.name)).toEqual(['Аня', 'Борис', 'Яна'])
  })
})
