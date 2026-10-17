import { describe, expect, it } from 'vitest'
import { activityGrid, mondayOf, shortDay } from '@/lib/studentActivity'

/** Этап 2 ЛК (письмо 15.10): посещения по дням — чистые правила. */

describe('даты', () => {
  it('понедельник недели и короткая дата', () => {
    expect(mondayOf('2026-10-15')).toBe('2026-10-12')
    expect(mondayOf('2026-10-12')).toBe('2026-10-12')
    expect(mondayOf('2026-10-18')).toBe('2026-10-12')
    expect(shortDay('2026-10-26')).toBe('26 окт')
  })
})

describe('посещения по дням', () => {
  it('12 недель по 7 дней, последняя — текущая; уровни: заходил / задачи', () => {
    const g = activityGrid({
      today: '2026-10-15', streak: 2, record: 5,
      visits: ['2026-10-14', '2026-10-15'], solved: [{ day: '2026-10-15', n: 12 }, { day: '2026-10-10', n: 3 }],
    }, '2000-01-01')
    expect(g.weeks).toHaveLength(12)
    expect(g.weeks.every(w => w.length === 7)).toBe(true)
    const days = g.weeks.flat()
    const at = (d: string) => days.find(x => x.day === d)!
    expect(at('2026-10-14').level).toBe(1)
    expect(at('2026-10-15').level).toBe(4)
    expect(at('2026-10-10').level).toBe(2)
    expect(at('2026-10-16').future).toBe(true)
    expect(g.activeDays).toBe(3)
    expect([g.streak, g.record]).toEqual([2, 5])
  })

  it('нет ответа — пустая карта на «сегодня» клиента', () => {
    const g = activityGrid(null, '2026-10-15')
    expect(g.weeks.flat().every(d => d.level === 0)).toBe(true)
    expect(g.weeks[11][0].day).toBe('2026-10-12')
  })
})
