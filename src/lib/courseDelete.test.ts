import { describe, expect, it } from 'vitest'
import { describeBlocker, describeDeletion, plural, type CourseDeleteCounts } from './courseDelete'

const counts = (over: Partial<CourseDeleteCounts> = {}): CourseDeleteCounts => ({
  modules: 0, topics: 0, materials: 0, homework: 0,
  attempts: 0, test_attempts: 0, groups: 0, lessons: 0, files: 0,
  ...over,
})

describe('plural', () => {
  it('склоняет по правилам русского счёта', () => {
    expect(plural(1, 'тема', 'темы', 'тем')).toBe('тема')
    expect(plural(3, 'тема', 'темы', 'тем')).toBe('темы')
    expect(plural(8, 'тема', 'темы', 'тем')).toBe('тем')
    expect(plural(21, 'тема', 'темы', 'тем')).toBe('тема')
  })

  it('одиннадцать–четырнадцать — исключение', () => {
    expect(plural(11, 'тема', 'темы', 'тем')).toBe('тем')
    expect(plural(13, 'тема', 'темы', 'тем')).toBe('тем')
    expect(plural(112, 'тема', 'темы', 'тем')).toBe('тем')
  })
})

describe('describeDeletion', () => {
  it('перечисляет только то, что действительно есть', () => {
    const lines = describeDeletion(counts({ topics: 8, attempts: 28, files: 5 }))
    expect(lines).toEqual(['8 тем', '28 сданных работ', '5 файлов'])
  })

  it('нулевые позиции не показываются: «0 сданных работ» пугает на пустом месте', () => {
    expect(describeDeletion(counts({ topics: 1 }))).toEqual(['1 тема'])
  })

  it('пустой курс даёт пустой список, а не строку из нулей', () => {
    expect(describeDeletion(counts())).toEqual([])
  })

  it('порядок идёт от крупного к мелкому', () => {
    const lines = describeDeletion(counts({ topics: 2, materials: 3, homework: 1, groups: 1 }))
    expect(lines).toEqual(['2 темы', '3 материала', '1 домашнее задание', '1 группа'])
  })
})

describe('describeBlocker', () => {
  it('про учеников говорит, что делать дальше', () => {
    const text = describeBlocker({ code: 'students', count: 3 })
    expect(text).toContain('3 ученика')
    expect(text).toMatch(/отчислите/i)
  })

  it('про деньги отказывает без вариантов', () => {
    expect(describeBlocker({ code: 'transactions', count: 1 })).toContain('1 денежная операция')
  })

  it('действующий курс отправляет в архив', () => {
    expect(describeBlocker({ code: 'active', count: 1 })).toMatch(/архив/i)
  })
})
