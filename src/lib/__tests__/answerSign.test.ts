import { describe, expect, it } from 'vitest'
import { hasLeadingMinus, toggleMinus } from '../answerSign'

describe('§267 toggleMinus', () => {
  it('ставит минус в начало', () => {
    expect(toggleMinus('0,6')).toBe('-0,6')
    expect(toggleMinus('')).toBe('-')
    expect(toggleMinus('  70')).toBe('-70')
  })
  it('убирает любой минус', () => {
    expect(toggleMinus('-0,6')).toBe('0,6')
    expect(toggleMinus('−4')).toBe('4')
    expect(toggleMinus('–7')).toBe('7')
    expect(toggleMinus('-')).toBe('')
  })
  it('распознаёт минус', () => {
    expect(hasLeadingMinus('-1')).toBe(true)
    expect(hasLeadingMinus('1-2')).toBe(false)
  })
})
