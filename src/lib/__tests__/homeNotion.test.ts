import { describe, expect, it } from 'vitest'
import { examWidget, schoolYearPercent } from '@/lib/examDates'
import { DAY_PHRASES, activityDaysFor, monthGrid, phraseOfDay } from '@/lib/homeNotion'
import type { ActivityDay } from '@/lib/studentActivity'

// Главная «как в Notion» (письмо 16.10): виджет «До ЕГЭ», фраза дня, календарь месяца.
describe('до ЕГЭ', () => {
  it('ближайший экзамен крупно, доля учебного года 1 сент → дата ЕГЭ, чипы по предметам', () => {
    const w = examWidget('2026-10-16', ['physics', 'math', 'physics', 'russian'])!
    expect(w.main).toMatchObject({ days: 228, daysWord: 'дней', of: 'по физике', dateLabel: '≈ 1 июня' })
    expect(w.yearPercent).toBe(16)
    expect(w.chips.map(c => c.label)).toEqual(['Физика · 228 дн', 'Математика · 228 дн'])
  })
  it('нет физики/математики или экзамен прошёл — виджета нет', () => {
    expect(examWidget('2026-10-16', ['russian'])).toBeNull()
    expect(examWidget('2027-06-01', ['physics'])).toBeNull()
  })
  it('доля года в пределах 0..100', () => {
    expect(schoolYearPercent('2026-08-01', '2027-06-01')).toBe(0)
    expect(schoolYearPercent('2027-06-10', '2027-06-01')).toBe(100)
  })
})

describe('фраза дня', () => {
  it('одна на день, меняется на следующий', () => {
    expect(phraseOfDay('2026-10-16')).toBe(phraseOfDay('2026-10-16'))
    expect(phraseOfDay('2026-10-16')).not.toBe(phraseOfDay('2026-10-17'))
    expect(DAY_PHRASES.length).toBeGreaterThanOrEqual(10)
  })
})

describe('календарь месяца', () => {
  const day = (d: string, level: ActivityDay['level'], extra: Partial<ActivityDay> = {}): [string, ActivityDay] =>
    [d, { day: d, level, solved: 0, future: false, today: false, ...extra }]
  it('октябрь 2026 начинается с четверга; будущие дни пустые; счёт дней с занятиями', () => {
    const days = new Map([day('2026-10-01', 1), day('2026-10-14', 3), day('2026-10-15', 0, { today: true })])
    const m = monthGrid('2026-10-15', 0, days)
    expect(m.title).toBe('Октябрь 2026')
    expect(m.weeks[0].slice(0, 3)).toEqual([null, null, null])
    expect(m.weeks[0][3]?.n).toBe(1)
    expect(m.weeks.flat().find(c => c?.n === 20)?.info?.future).toBe(true)
    expect(m.activeDays).toBe(2)
  })
  it('листание назад: месяц и год', () => {
    expect(monthGrid('2026-01-10', 1, new Map()).title).toBe('Декабрь 2025')
  })
  it('истории хватает на 3 месяца назад с 1-го числа', () => {
    expect(activityDaysFor('2026-10-16')).toBe(108) // 1 июля … 16 октября: 31 + 31 + 30 + 16
  })
})
