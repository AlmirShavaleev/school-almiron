import { describe, it, expect } from 'vitest'
import {
  stripHtmlSimple,
  normalizeAnswer,
  isNumeric,
  isAutoCheckable,
} from '../variantAnswerNormalize'

// ── stripHtmlSimple ──────────────────────────────────────────────────────────

describe('stripHtmlSimple', () => {
  it('removes simple tags', () => {
    expect(stripHtmlSimple('<p>42</p>')).toBe('42')
  })

  it('removes nested tags', () => {
    expect(stripHtmlSimple('<div><span>19,5</span></div>')).toBe('19,5')
  })

  it('trims whitespace', () => {
    expect(stripHtmlSimple('  <b> 7 </b>  ')).toBe('7')
  })

  it('returns plain text unchanged (trimmed)', () => {
    expect(stripHtmlSimple('  hello  ')).toBe('hello')
  })
})

// ── normalizeAnswer ──────────────────────────────────────────────────────────

describe('normalizeAnswer', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normalizeAnswer('  42  ')).toBe('42')
  })

  it('replaces decimal comma with dot', () => {
    expect(normalizeAnswer('19,5')).toBe('19.5')
  })

  it('lowercases input', () => {
    expect(normalizeAnswer('ABC')).toBe('abc')
  })

  it('collapses internal whitespace', () => {
    expect(normalizeAnswer('a  b   c')).toBe('a b c')
  })

  it('handles negative numbers', () => {
    expect(normalizeAnswer('-3,14')).toBe('-3.14')
  })

  it('handles empty string', () => {
    expect(normalizeAnswer('')).toBe('')
  })

  it('handles already-dot decimal', () => {
    expect(normalizeAnswer('3.14')).toBe('3.14')
  })
})

// ── isNumeric ────────────────────────────────────────────────────────────────

describe('isNumeric', () => {
  it('integer is numeric', () => {
    expect(isNumeric('42')).toBe(true)
  })

  it('decimal with dot is numeric', () => {
    expect(isNumeric('3.14')).toBe(true)
  })

  it('negative integer is numeric', () => {
    expect(isNumeric('-7')).toBe(true)
  })

  it('negative decimal is numeric', () => {
    expect(isNumeric('-3.14')).toBe(true)
  })

  it('empty string is NOT numeric', () => {
    expect(isNumeric('')).toBe(false)
  })

  it('text is NOT numeric', () => {
    expect(isNumeric('abc')).toBe(false)
  })

  it('partial number with text is NOT numeric', () => {
    expect(isNumeric('42abc')).toBe(false)
  })

  it('comma decimal is NOT numeric (must be pre-normalised)', () => {
    expect(isNumeric('3,14')).toBe(false)
  })

  it('leading plus is NOT numeric', () => {
    expect(isNumeric('+5')).toBe(false)
  })

  it('two dots are NOT numeric', () => {
    expect(isNumeric('3.1.4')).toBe(false)
  })
})

// ── isAutoCheckable ──────────────────────────────────────────────────────────

describe('isAutoCheckable', () => {
  it('numeric answer HTML is auto-checkable', () => {
    expect(isAutoCheckable('<p>42</p>')).toBe(true)
  })

  it('decimal comma in HTML is auto-checkable (normalised to dot)', () => {
    expect(isAutoCheckable('<p>19,5</p>')).toBe(true)
  })

  it('text answer is NOT auto-checkable', () => {
    expect(isAutoCheckable('<p>скорость</p>')).toBe(false)
  })

  it('null is NOT auto-checkable', () => {
    expect(isAutoCheckable(null)).toBe(false)
  })

  it('empty string is NOT auto-checkable', () => {
    expect(isAutoCheckable('')).toBe(false)
  })

  it('expression like "2+3" is NOT auto-checkable', () => {
    expect(isAutoCheckable('<p>2+3</p>')).toBe(false)
  })

  it('negative number in HTML is auto-checkable', () => {
    expect(isAutoCheckable('<span>-7</span>')).toBe(true)
  })
})

// ── Source checks ─────────────────────────────────────────────────────────────

import { readFileSync } from 'fs'
import path from 'path'

const UTIL_SRC = readFileSync(
  path.resolve(__dirname, '../variantAnswerNormalize.ts'),
  'utf-8'
)

describe('variantAnswerNormalize source', () => {
  it('exports stripHtmlSimple', () => {
    expect(UTIL_SRC).toContain('export function stripHtmlSimple')
  })

  it('exports normalizeAnswer', () => {
    expect(UTIL_SRC).toContain('export function normalizeAnswer')
  })

  it('exports isNumeric', () => {
    expect(UTIL_SRC).toContain('export function isNumeric')
  })

  it('exports isAutoCheckable', () => {
    expect(UTIL_SRC).toContain('export function isAutoCheckable')
  })

  it('numeric regex is strict full-string match', () => {
    // Must have ^ and $ anchors to prevent partial matches
    expect(UTIL_SRC).toContain('^-?[0-9]+')
    expect(UTIL_SRC).toContain('$')
  })
})
