import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCourseAvailability } from './index'

describe('getCourseAvailability', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns undated when no dates', () => {
    expect(getCourseAvailability({ start_date: null, end_date: null })).toBe('undated')
  })

  it('returns upcoming when start_date is in future', () => {
    expect(getCourseAvailability({ start_date: '2025-07-01', end_date: null })).toBe('upcoming')
  })

  it('returns ended when end_date is in past', () => {
    expect(getCourseAvailability({ start_date: null, end_date: '2025-06-01' })).toBe('ended')
  })

  it('returns active when today is between start and end', () => {
    expect(getCourseAvailability({ start_date: '2025-06-01', end_date: '2025-06-30' })).toBe('active')
  })

  it('returns upcoming when start_date > today and end_date > today', () => {
    expect(getCourseAvailability({ start_date: '2025-07-01', end_date: '2025-08-01' })).toBe('upcoming')
  })

  it('returns ended when start_date < today and end_date < today', () => {
    expect(getCourseAvailability({ start_date: '2025-05-01', end_date: '2025-06-01' })).toBe('ended')
  })

  it('returns active when only start_date set and today >= start', () => {
    expect(getCourseAvailability({ start_date: '2025-06-01', end_date: null })).toBe('active')
  })

  it('returns active when only end_date set and today <= end', () => {
    expect(getCourseAvailability({ start_date: null, end_date: '2025-06-30' })).toBe('active')
  })
})
