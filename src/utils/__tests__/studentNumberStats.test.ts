import { describe, expect, it } from 'vitest'
import { formatRatio, getNumberRecommendation, getNumberTrafficLight, type StudentNumberStatRow } from '../studentNumberStats'

function makeRow(overrides: Partial<StudentNumberStatRow> = {}): StudentNumberStatRow {
  return {
    section_id: 'sec-1',
    exam_number: 13,
    section_title: 'Задание 13',
    subject: 'physics',
    exam_type: 'ege',
    solved_count: 5,
    fully_correct_count: 0,
    partial_count: 0,
    wrong_count: 0,
    earned_points: 0,
    max_points: 10,
    success_ratio: 0,
    last_solved_at: null,
    ...overrides,
  }
}

describe('student number stats helpers', () => {
  it('marks low-sample rows as gray', () => {
    expect(getNumberTrafficLight(makeRow({ solved_count: 4, success_ratio: 95 }))).toBe('gray')
  })

  it('maps enough attempts into traffic lights by ratio', () => {
    expect(getNumberTrafficLight(makeRow({ success_ratio: 82 }))).toBe('green')
    expect(getNumberTrafficLight(makeRow({ success_ratio: 65 }))).toBe('yellow')
    expect(getNumberTrafficLight(makeRow({ success_ratio: 35 }))).toBe('red')
  })

  it('builds repeat/support/strong recommendations', () => {
    expect(getNumberRecommendation(makeRow({ solved_count: 5, success_ratio: 40 }))?.kind).toBe('repeat')
    expect(getNumberRecommendation(makeRow({ solved_count: 3, success_ratio: 55 }))?.kind).toBe('support')
    expect(getNumberRecommendation(makeRow({ solved_count: 6, success_ratio: 85 }))?.kind).toBe('strong')
  })

  it('formats ratios for UI', () => {
    expect(formatRatio(57.25)).toBe('57.3%')
    expect(formatRatio(null)).toBe('—')
  })
})
