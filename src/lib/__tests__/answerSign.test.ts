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

import { collapseLeadingMinus } from '@/lib/answerSign'

describe('§273 collapseLeadingMinus', () => {
  it('несколько минусов в начале — один «-»', () => {
    expect(collapseLeadingMinus('--2,3')).toBe('-2,3')
    expect(collapseLeadingMinus('−-2,3')).toBe('-2,3')
    expect(collapseLeadingMinus('- −2,3')).toBe('-2,3')
    expect(collapseLeadingMinus('−2,3')).toBe('-2,3')
  })
  it('без минуса и с минусом не в начале — без изменений', () => {
    expect(collapseLeadingMinus('2,3')).toBe('2,3')
    expect(collapseLeadingMinus('1-2')).toBe('1-2')
    expect(collapseLeadingMinus('  12')).toBe('  12')
  })
})
