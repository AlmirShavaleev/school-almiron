import { describe, expect, it } from 'vitest'
import { dayMonthShort, shortDayLabel } from '@/lib/dayLabels'

describe('подписи дня', () => {
  it('«пт, 9 окт» и «12 окт»', () => {
    expect(shortDayLabel('2026-10-09')).toBe('пт, 9 окт')
    expect(dayMonthShort('2026-10-12')).toBe('12 окт')
  })

  it('не день — пустая строка', () => {
    expect(shortDayLabel('завтра')).toBe('')
    expect(dayMonthShort('2026-10-12T10:00')).toBe('')
  })
})
