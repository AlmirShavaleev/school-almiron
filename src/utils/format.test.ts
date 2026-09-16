import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatTime,
  formatUpdatedAt,
  timeAgo,
  isOverdue,
  isUpcoming,
  formatCurrency,
  LEAGUE_LABELS,
  LEAGUE_COLORS,
  ROLE_LABELS,
  SUBJECT_LABELS,
  EXAM_LABELS,
  HW_STATUS_LABELS,
  HW_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
} from './format'

describe('formatDate', () => {
  it('formats date string to Russian format', () => {
    const result = formatDate('2024-03-15')
    expect(result).toMatch(/\d{1,2} мар\.?\s*2024/)
  })

  it('formats Date object', () => {
    const date = new Date(2024, 0, 5)
    const result = formatDate(date)
    expect(result).toMatch(/\d{1,2} янв\.?\s*2024/)
  })
})

describe('formatDateTime', () => {
  it('formats date with time', () => {
    const result = formatDateTime('2024-03-15T14:30:00')
    expect(result).toMatch(/\d{1,2} мар\.?\s*2024,\s*\d{2}:\d{2}/)
  })
})

describe('formatTime', () => {
  it('formats only time', () => {
    const result = formatTime('2024-03-15T14:30:00')
    expect(result).toBe('14:30')
  })
})

describe('formatUpdatedAt', () => {
  const now = new Date('2026-09-16T09:00:00')

  it('сегодняшнюю правку показывает временем', () => {
    expect(formatUpdatedAt('2026-09-16T10:16:00', now)).toBe('сегодня в 10:16')
  })

  it('вчерашнюю — тоже временем', () => {
    expect(formatUpdatedAt('2026-09-15T18:40:00', now)).toBe('вчера в 18:40')
  })

  it('«вчера» считается календарными сутками, а не «24 часами назад»', () => {
    // От 23:50 вчерашнего дня до 09:00 сегодняшнего — девять часов, но для
    // человека это всё равно «вчера».
    expect(formatUpdatedAt('2026-09-15T23:50:00', now)).toBe('вчера в 23:50')
  })

  it('старую — обычной датой, без времени суток', () => {
    expect(formatUpdatedAt('2026-09-12T10:16:00', now)).toMatch(/12 сент\.?\s*2026/)
  })
})

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-03-15T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns past time in Russian', () => {
    const result = timeAgo('2024-03-15T11:00:00')
    expect(result).toMatch(/назад/)
  })

  it('returns future time in Russian', () => {
    const result = timeAgo('2024-03-15T13:00:00')
    expect(result).toMatch(/через/)
  })
})

describe('isOverdue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-03-15T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns true for past date', () => {
    expect(isOverdue('2024-03-14')).toBe(true)
  })

  it('returns false for future date', () => {
    expect(isOverdue('2024-03-16')).toBe(false)
  })
})

describe('isUpcoming', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-03-15T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns true for future date', () => {
    expect(isUpcoming('2024-03-16')).toBe(true)
  })

  it('returns false for past date', () => {
    expect(isUpcoming('2024-03-14')).toBe(false)
  })
})

describe('formatCurrency', () => {
  it('formats number as Russian rubles', () => {
    const result = formatCurrency(1500)
    expect(result).toMatch(/1\s*500/)
    expect(result).toMatch(/₽|руб/)
  })

  it('formats zero', () => {
    const result = formatCurrency(0)
    expect(result).toMatch(/0/)
  })

  it('formats large numbers', () => {
    const result = formatCurrency(1234567)
    expect(result).toMatch(/1\s*234\s*567/)
  })
})

describe('constants', () => {
  it('LEAGUE_LABELS has all leagues', () => {
    expect(LEAGUE_LABELS).toHaveProperty('bronze')
    expect(LEAGUE_LABELS).toHaveProperty('silver')
    expect(LEAGUE_LABELS).toHaveProperty('gold')
    expect(LEAGUE_LABELS).toHaveProperty('platinum')
    expect(LEAGUE_LABELS).toHaveProperty('academic')
  })

  it('LEAGUE_COLORS has all leagues', () => {
    expect(Object.keys(LEAGUE_COLORS)).toEqual(Object.keys(LEAGUE_LABELS))
  })

  it('ROLE_LABELS has all roles', () => {
    const expectedRoles = ['student', 'parent', 'teacher', 'curator', 'admin', 'owner']
    expectedRoles.forEach(role => {
      expect(ROLE_LABELS).toHaveProperty(role)
    })
  })

  it('SUBJECT_LABELS has physics and math', () => {
    expect(SUBJECT_LABELS.physics).toBe('Физика')
    expect(SUBJECT_LABELS.math).toBe('Математика')
  })

  it('EXAM_LABELS has ege and oge', () => {
    expect(EXAM_LABELS.ege).toBe('ЕГЭ')
    expect(EXAM_LABELS.oge).toBe('ОГЭ')
  })

  it('HW_STATUS_LABELS has all statuses', () => {
    const expectedStatuses = ['not_submitted', 'submitted', 'checked', 'revision']
    expectedStatuses.forEach(status => {
      expect(HW_STATUS_LABELS).toHaveProperty(status)
    })
  })

  it('HW_STATUS_COLORS has all statuses', () => {
    expect(Object.keys(HW_STATUS_COLORS)).toEqual(Object.keys(HW_STATUS_LABELS))
  })

  it('PAYMENT_STATUS_LABELS has all statuses', () => {
    const expectedStatuses = ['pending', 'paid', 'overdue', 'refunded']
    expectedStatuses.forEach(status => {
      expect(PAYMENT_STATUS_LABELS).toHaveProperty(status)
    })
  })

  it('PAYMENT_STATUS_COLORS has all statuses', () => {
    expect(Object.keys(PAYMENT_STATUS_COLORS)).toEqual(Object.keys(PAYMENT_STATUS_LABELS))
  })
})
