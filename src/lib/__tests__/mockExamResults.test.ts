/**
 * §215. Правила строки результата пробника (board/067).
 *
 * До §215 этих правил не было вовсе: модалка писала в несуществующую колонку
 * `feedback`, и любое сохранение кончалось `alert`-ом с текстом ошибки базы.
 * За три месяца при девяти заведённых пробниках в таблице осталось ноль строк.
 */
import { describe, expect, it } from 'vitest'
import {
  checkResultRow,
  isBlankRow,
  scoreIsNew,
  type MockExamResultDraft,
} from '@/lib/mockExamResults'

const draft = (over: Partial<MockExamResultDraft> = {}): MockExamResultDraft => ({
  score: '', part1: '', part2: '', notes: '', ...over,
})

const MAX = 100

describe('§215 — пустая строка', () => {
  it('ничего не введено — не ошибка и не запись', () => {
    const check = checkResultRow(draft(), MAX)
    expect(check.blank).toBe(true)
    expect(check.value).toBeNull()
    expect(check.error).toBeNull()
  })

  it('пробелы — та же пустота', () => {
    expect(isBlankRow(draft({ score: '  ', notes: '   ' }))).toBe(true)
  })

  it('заполнено хоть что-то — уже не пустая', () => {
    expect(isBlankRow(draft({ notes: 'болел' }))).toBe(false)
    expect(isBlankRow(draft({ part1: '7' }))).toBe(false)
  })
})

describe('§215 — общий балл обязателен', () => {
  it('заметка без балла — ошибка у балла, а не молчаливая потеря ввода', () => {
    const check = checkResultRow(draft({ notes: 'разобрать вторую часть' }), MAX)
    expect(check.value).toBeNull()
    expect(check.error).toEqual({ field: 'score', message: 'Впишите общий балл' })
  })

  it('часть без общего балла — тоже ошибка', () => {
    expect(checkResultRow(draft({ part1: '12' }), MAX).error?.field).toBe('score')
  })
})

describe('§215 — проверка ввода', () => {
  it('балл выше максимума не проходит', () => {
    const check = checkResultRow(draft({ score: '101' }), MAX)
    expect(check.value).toBeNull()
    expect(check.error).toEqual({ field: 'score', message: 'Не больше 100' })
  })

  it('ровно максимум — проходит', () => {
    expect(checkResultRow(draft({ score: '100' }), MAX).value?.score).toBe(100)
  })

  it('отрицательный балл не проходит', () => {
    expect(checkResultRow(draft({ score: '-3' }), MAX).error)
      .toEqual({ field: 'score', message: 'Балл не может быть отрицательным' })
  })

  it('не целое и мусор не проходят — «12abc» это не 12', () => {
    expect(checkResultRow(draft({ score: '12abc' }), MAX).error?.message).toBe('Только целое число')
    expect(checkResultRow(draft({ score: '7,5' }), MAX).error?.message).toBe('Только целое число')
    expect(checkResultRow(draft({ score: 'пять' }), MAX).error?.message).toBe('Только целое число')
  })

  it('часть выше максимума не проходит, и ошибка у ЭТОЙ части', () => {
    expect(checkResultRow(draft({ score: '50', part1: '101' }), MAX).error?.field).toBe('part1')
    expect(checkResultRow(draft({ score: '50', part2: '-1' }), MAX).error?.field).toBe('part2')
  })

  it('сумма частей больше общего балла — ошибка на обеих частях', () => {
    const check = checkResultRow(draft({ score: '50', part1: '30', part2: '25' }), MAX)
    expect(check.value).toBeNull()
    expect(check.error).toEqual({ field: 'parts', message: 'Сумма частей больше общего балла' })
  })

  it('сумма ровно равна общему — это норма', () => {
    expect(checkResultRow(draft({ score: '50', part1: '30', part2: '20' }), MAX).error).toBeNull()
  })

  it('сумма меньше общего — тоже норма: деление бывает неполным', () => {
    expect(checkResultRow(draft({ score: '50', part1: '10' }), MAX).error).toBeNull()
  })
})

describe('§215 — что уезжает в базу', () => {
  it('имена полей — колонки таблицы, а не выдуманные', () => {
    const check = checkResultRow(draft({ score: '42', part1: '20', part2: '22', notes: ' болел ' }), MAX)
    expect(check.value).toEqual({
      score: 42,
      part1_score: 20,
      part2_score: 22,
      notes: 'болел',
    })
    // Ключа `feedback` — того самого, из-за которого три месяца ничего не
    // сохранялось, — в записи нет.
    expect(Object.keys(check.value!)).not.toContain('feedback')
  })

  it('незаполненные части уходят как null, а не как ноль', () => {
    // Пустое поле части значит «деления нет», а не «ноль баллов».
    const check = checkResultRow(draft({ score: '42' }), MAX)
    expect(check.value).toEqual({ score: 42, part1_score: null, part2_score: null, notes: null })
  })

  it('пустая заметка — null, а не пустая строка', () => {
    expect(checkResultRow(draft({ score: '1', notes: '   ' }), MAX).value?.notes).toBeNull()
  })

  it('ноль — полноценный балл, а не «не заполнено»', () => {
    const check = checkResultRow(draft({ score: '0' }), MAX)
    expect(check.blank).toBe(false)
    expect(check.value?.score).toBe(0)
  })
})

describe('§215 — кому слать уведомление', () => {
  const value = (score: number) => ({ score, part1_score: null, part2_score: null, notes: null })

  it('балла раньше не было — шлём', () => {
    expect(scoreIsNew(value(80), undefined)).toBe(true)
    expect(scoreIsNew(value(80), null)).toBe(true)
  })

  it('балл изменился — шлём', () => {
    expect(scoreIsNew(value(81), { score: 80 })).toBe(true)
  })

  it('балл тот же — НЕ шлём: правка опечатки не должна будить всю группу', () => {
    expect(scoreIsNew(value(80), { score: 80 })).toBe(false)
  })

  it('поменялись только части или заметка — не шлём: в уведомлении стоит балл', () => {
    const changedParts = { score: 80, part1_score: 40, part2_score: 40, notes: 'дописал' }
    expect(scoreIsNew(changedParts, { score: 80 })).toBe(false)
  })
})
