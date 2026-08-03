import { describe, expect, it } from 'vitest'
import { normalizeAnswer, isNumeric } from '@/utils/variantAnswerNormalize'

/**
 * Файл нормализации объявляет себя зеркалом SQL-функции
 * normalize_variant_answer(). Зеркалом он не был: SQL менял ВСЕ запятые, JS —
 * только первую, и обрезал края до схлопывания пробелов, из-за чего
 * неразрывный пробел выживал (§62).
 *
 * Ожидания ниже сняты с прода после правки обеих сторон.
 */
describe('normalizeAnswer зеркалит SQL', () => {
  it('меняет все запятые, а не первую', () => {
    // SQL: replace(raw, ',', '.') — заменяет каждую.
    expect(normalizeAnswer('1,2,3')).toBe('1.2.3')
    expect(normalizeAnswer('0,5')).toBe('0.5')
  })

  it('обрезает края ПОСЛЕ схлопывания пробелов', () => {
    // Неразрывный пробел trim не берёт, но под \s попадает и становится
    // обычным. Обрезка раньше схлопывания оставляла его в начале строки, и
    // ответ переставал быть числом.
    expect(normalizeAnswer(' 6')).toBe('6')
    expect(normalizeAnswer('  36  ')).toBe('36')
    expect(normalizeAnswer('  105  ')).toBe('105')
  })

  it('после правки такие ответы снова считаются числами', () => {
    expect(isNumeric(normalizeAnswer(' 6'))).toBe(true)
    expect(isNumeric(normalizeAnswer(' 0'))).toBe(true)
  })

  it('не ломает многозначные и десятичные', () => {
    expect(normalizeAnswer('0,006\n-0,006')).toBe('0.006 -0.006')
    expect(normalizeAnswer('19; 11')).toBe('19; 11')
    expect(normalizeAnswer('1,4')).toBe('1.4')
    expect(normalizeAnswer('ДА')).toBe('да')
  })
})
