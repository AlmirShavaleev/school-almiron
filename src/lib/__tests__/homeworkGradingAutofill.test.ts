import { describe, expect, it } from 'vitest'
import { autofillGradingFromCatalogTask } from '@/lib/homeworkGradingAutofill'
import type { CatalogTask } from '@/hooks/useCatalog'

function task(overrides: Partial<CatalogTask>): CatalogTask {
  return {
    id: 't1', external_id: 1, section_id: 's1', subject: 'Математика', exam_type: 'ЕГЭ',
    statement_html: '<p>условие</p>', answer_html: null, solution_html: null,
    solution_plan_html: null, grade_criteria_html: null, has_answer: false, has_solution: false,
    position: 1, exam_part: 1, max_points: null,
    ...overrides,
  }
}

describe('autofillGradingFromCatalogTask', () => {
  it('короткий числовой ответ -> numeric_tolerance', () => {
    const r = autofillGradingFromCatalogTask(task({ has_answer: true, answer_html: '42', max_points: 1 }))
    expect(r.grading_mode).toBe('numeric_tolerance')
    expect((r.grading_spec as any).expected).toBe(42)
  })

  it('короткий числовой ответ с запятой -> numeric_tolerance с точкой', () => {
    const r = autofillGradingFromCatalogTask(task({ has_answer: true, answer_html: '9,8', max_points: 2 }))
    expect(r.grading_mode).toBe('numeric_tolerance')
    expect((r.grading_spec as any).expected).toBeCloseTo(9.8)
  })

  it('короткий текстовый ответ -> exact_answer', () => {
    const r = autofillGradingFromCatalogTask(task({ has_answer: true, answer_html: 'параллелограмм', max_points: 1 }))
    expect(r.grading_mode).toBe('exact_answer')
    expect((r.grading_spec as any).expected).toBe('параллелограмм')
  })

  it('multi_choice partial_type -> multiple_choice', () => {
    const r = autofillGradingFromCatalogTask(task({ partial_type: 'multi_choice', has_answer: true, answer_html: 'АБВ', max_points: 2 }))
    expect(r.grading_mode).toBe('multiple_choice')
    expect((r.grading_spec as any).correct_options).toEqual(['АБВ'])
  })

  it('есть grade_criteria_html -> rubric с одним seed-критерием', () => {
    const r = autofillGradingFromCatalogTask(task({
      exam_part: 2, has_answer: false, max_points: 4,
      grade_criteria_html: '<p>1) Верный ход решения — 2 балла<br>2) Верный ответ — 2 балла</p>',
    }))
    expect(r.grading_mode).toBe('rubric')
    const spec = r.grading_spec as any
    expect(spec.criteria).toHaveLength(1)
    expect(spec.criteria[0].max_score).toBe(4)
    expect(spec.criteria[0].description).toContain('Верный ход решения')
  })

  it('недостаточно данных -> manual', () => {
    const r = autofillGradingFromCatalogTask(task({ has_answer: false, answer_html: null, grade_criteria_html: null }))
    expect(r.grading_mode).toBe('manual')
    expect(r.grading_spec).toEqual({})
  })

  it('max_score переносится из max_points во всех ветках', () => {
    expect(autofillGradingFromCatalogTask(task({ max_points: 7 })).max_score).toBe(7)
    expect(autofillGradingFromCatalogTask(task({ max_points: null })).max_score).toBeNull()
  })

  it('slippage guard: слишком длинный "короткий" ответ падает в manual, не в exact_answer', () => {
    const longAnswer = 'x'.repeat(80)
    const r = autofillGradingFromCatalogTask(task({ has_answer: true, answer_html: longAnswer, max_points: 1 }))
    expect(r.grading_mode).toBe('manual')
  })

  it('snapshot: изменение исходного task-объекта после вызова не переписывает уже возвращённый результат (чистая функция)', () => {
    const original = task({ has_answer: true, answer_html: '42', max_points: 5 })
    const result = autofillGradingFromCatalogTask(original)
    ;(original as any).answer_html = '999'
    ;(original as any).max_points = 999
    expect((result.grading_spec as any).expected).toBe(42)
    expect(result.max_score).toBe(5)
  })
})
