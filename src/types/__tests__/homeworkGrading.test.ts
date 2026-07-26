import { describe, expect, it } from 'vitest'
import { validateGradingSpec } from '@/types/homeworkGrading'

describe('validateGradingSpec', () => {
  it('manual: пустой grading_spec допустим', () => {
    expect(validateGradingSpec('manual', {}).ok).toBe(true)
  })

  it('exact_answer: требует expected', () => {
    expect(validateGradingSpec('exact_answer', {}).ok).toBe(false)
    expect(validateGradingSpec('exact_answer', { expected: '42' }).ok).toBe(true)
  })

  it('numeric_tolerance: корректная спецификация проходит', () => {
    const r = validateGradingSpec('numeric_tolerance', { expected: 9.8, tolerance_absolute: 0.2, rounding: { decimals: 1 } })
    expect(r.ok).toBe(true)
  })

  it('numeric_tolerance: отрицательный tolerance_absolute отклоняется', () => {
    expect(validateGradingSpec('numeric_tolerance', { expected: 9.8, tolerance_absolute: -1 }).ok).toBe(false)
  })

  it('multiple_choice: требует хотя бы один correct_options', () => {
    expect(validateGradingSpec('multiple_choice', { correct_options: [], allow_multiple: false }).ok).toBe(false)
    expect(validateGradingSpec('multiple_choice', { correct_options: ['A'], allow_multiple: false }).ok).toBe(true)
  })

  it('formula: требует expected_expression', () => {
    expect(validateGradingSpec('formula', { expected_expression: 'v = at' }).ok).toBe(true)
    expect(validateGradingSpec('formula', {}).ok).toBe(false)
  })

  it('rubric: сумма критериев в пределах max_score задания — ок', () => {
    const spec = { criteria: [{ id: 'c1', title: 'A', description: '', max_score: 5 }, { id: 'c2', title: 'B', description: '', max_score: 5 }] }
    expect(validateGradingSpec('rubric', spec, 10).ok).toBe(true)
  })

  it('rubric: сумма критериев выше max_score задания — отклоняется (не нормализуется тихо)', () => {
    const spec = { criteria: [{ id: 'c1', title: 'A', description: '', max_score: 8 }, { id: 'c2', title: 'B', description: '', max_score: 8 }] }
    const r = validateGradingSpec('rubric', spec, 10)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/превышает/)
  })

  it('rubric: без указания max_score задания сумма не проверяется', () => {
    const spec = { criteria: [{ id: 'c1', title: 'A', description: '', max_score: 100 }] }
    expect(validateGradingSpec('rubric', spec, null).ok).toBe(true)
  })

  it('ai_assisted: допускает rubric+expected_answer+произвольные поля', () => {
    const spec = { expected_answer: '9.8 м/с²', units_policy: 'СИ', instructions: 'учитывать округление' }
    expect(validateGradingSpec('ai_assisted', spec).ok).toBe(true)
  })
})
