import { describe, expect, it } from 'vitest'
import {
  defaultCopyTitle,
  describeDateMode,
  pluralDays,
  shiftDaysBetween,
  toPlan,
} from './courseCopy'

describe('shiftDaysBetween', () => {
  it('считает разницу в днях между двумя датами', () => {
    expect(shiftDaysBetween('2025-09-01', '2026-09-01')).toBe(365)
    expect(shiftDaysBetween('2025-09-01', '2025-09-08')).toBe(7)
  })

  it('сдвиг назад — отрицательный', () => {
    expect(shiftDaysBetween('2026-09-01', '2025-09-01')).toBe(-365)
  })

  it('переход на зимнее время не сбивает счёт', () => {
    // В ночь на 26 октября в части часовых поясов сутки длятся 25 часов.
    // При счёте по локальному времени тут получалось 30.04 дня и округление
    // в неверную сторону; в UTC — ровно 31.
    expect(shiftDaysBetween('2025-10-01', '2025-11-01')).toBe(31)
  })

  it('без одной из дат сдвиг равен нулю, а не NaN', () => {
    expect(shiftDaysBetween(null, '2025-09-01')).toBe(0)
    expect(shiftDaysBetween('2025-09-01', undefined)).toBe(0)
    expect(shiftDaysBetween('не дата', '2025-09-01')).toBe(0)
  })
})

describe('pluralDays', () => {
  it('склоняет по правилам русского счёта', () => {
    expect(pluralDays(1)).toBe('день')
    expect(pluralDays(2)).toBe('дня')
    expect(pluralDays(5)).toBe('дней')
    expect(pluralDays(21)).toBe('день')
    expect(pluralDays(365)).toBe('дней')
  })

  it('одиннадцать–четырнадцать — исключение', () => {
    expect(pluralDays(11)).toBe('дней')
    expect(pluralDays(12)).toBe('дней')
    expect(pluralDays(14)).toBe('дней')
    expect(pluralDays(111)).toBe('дней')
  })
})

describe('describeDateMode', () => {
  it('говорит человеческим языком, что будет с датами', () => {
    expect(describeDateMode('clear', 0)).toContain('очищены')
    expect(describeDateMode('keep', 0)).toContain('прежними')
    expect(describeDateMode('shift', 365)).toBe('Все даты сдвинутся вперёд на 365 дней')
    expect(describeDateMode('shift', -1)).toBe('Все даты сдвинутся назад на 1 день')
  })

  it('нулевой сдвиг честно называется отсутствием сдвига', () => {
    expect(describeDateMode('shift', 0)).toContain('сдвиг равен нулю')
  })
})

describe('defaultCopyTitle', () => {
  it('добавляет пометку к названию', () => {
    expect(defaultCopyTitle('Физика 9 класс')).toBe('Физика 9 класс (копия)')
  })

  it('не вылезает за ограничение длины названия курса', () => {
    expect(defaultCopyTitle('я'.repeat(300)).length).toBeLessThanOrEqual(200)
  })
})

describe('toPlan', () => {
  it('разбирает ответ копирования курса', () => {
    const plan = toPlan({ job_id: 'j1', course_id: 'c1', files: [{ bucket: 'topic-materials', from: 'a', to: 'b' }] })
    expect(plan).toEqual({ jobId: 'j1', courseId: 'c1', topicId: undefined, files: [{ bucket: 'topic-materials', from: 'a', to: 'b' }] })
  })

  it('пустой список файлов — нормальный случай: курс без вложений', () => {
    expect(toPlan({ job_id: 'j1', course_id: 'c1' }).files).toEqual([])
  })

  it('ответ без задания — внятная ошибка здесь, а не падение позже', () => {
    expect(() => toPlan(null)).toThrow(/задание копирования/i)
    expect(() => toPlan({ course_id: 'c1' })).toThrow(/задание копирования/i)
  })
})
