import { z } from 'zod'

/**
 * grading_spec formats per homework_template_items.grading_mode. Stored as a snapshot on the
 * immutable template version — never a live reference to a mutable catalog_task. Editing a
 * catalog task after the fact does not change already-issued assignments; only creating a new
 * template version does (create_or_update_template_draft's existing lock-once-used rule).
 *
 * IMPORTANT — this is a data contract only. No OCR/CV/AI model is called anywhere in this
 * codebase yet. An AI evaluation (once a future worker exists) is a *suggestion* stored in
 * homework_ai_item_evaluations; it never creates a homework_reviews row on its own. The only
 * path to an official grade is submit_homework_review, called by a human teacher/curator/admin.
 */

export type HomeworkGradingMode =
  | 'manual' | 'exact_answer' | 'numeric_tolerance' | 'multiple_choice' | 'formula' | 'rubric' | 'ai_assisted'

export const exactAnswerSpecSchema = z.object({
  expected: z.string().min(1),
  accepted_equivalents: z.array(z.string()).optional(),
  case_sensitive: z.boolean().optional(),
})
export type ExactAnswerSpec = z.infer<typeof exactAnswerSpecSchema>

export const numericToleranceSpecSchema = z.object({
  expected: z.number(),
  tolerance_absolute: z.number().nonnegative().optional(),
  tolerance_relative: z.number().nonnegative().optional(),
  accepted_units: z.array(z.string()).optional(),
  require_units: z.boolean().optional(),
  rounding: z.object({ decimals: z.number().int().min(0).max(10).optional() }).optional(),
})
export type NumericToleranceSpec = z.infer<typeof numericToleranceSpecSchema>

export const multipleChoiceSpecSchema = z.object({
  correct_options: z.array(z.string()).min(1),
  allow_multiple: z.boolean(),
})
export type MultipleChoiceSpec = z.infer<typeof multipleChoiceSpecSchema>

export const formulaSpecSchema = z.object({
  expected_expression: z.string().min(1),
  accepted_equivalents: z.array(z.string()).optional(),
  variables: z.array(z.string()).optional(),
})
export type FormulaSpec = z.infer<typeof formulaSpecSchema>

export const rubricCriterionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  max_score: z.number().nonnegative(),
  required: z.boolean().optional(),
})
export const rubricSpecSchema = z.object({
  criteria: z.array(rubricCriterionSchema).min(1),
})
export type RubricSpec = z.infer<typeof rubricSpecSchema>

/** Free-form: rubric/expected-answer/units policy/instructions for a future AI-assisted
 * evaluator. Deliberately loose — the shape of what "AI assistance" needs is still open. */
export const aiAssistedSpecSchema = z.object({
  rubric: rubricSpecSchema.optional(),
  expected_answer: z.string().optional(),
  units_policy: z.string().optional(),
  instructions: z.string().optional(),
}).passthrough()
export type AiAssistedSpec = z.infer<typeof aiAssistedSpecSchema>

export const manualSpecSchema = z.object({}).passthrough()

/** Picks the right schema for a grading_mode; 'manual' accepts anything (including {}). */
export function gradingSpecSchemaFor(mode: HomeworkGradingMode) {
  switch (mode) {
    case 'exact_answer': return exactAnswerSpecSchema
    case 'numeric_tolerance': return numericToleranceSpecSchema
    case 'multiple_choice': return multipleChoiceSpecSchema
    case 'formula': return formulaSpecSchema
    case 'rubric': return rubricSpecSchema
    case 'ai_assisted': return aiAssistedSpecSchema
    case 'manual':
    default:
      return manualSpecSchema
  }
}

/** Validates grading_spec against its mode's schema. Rubric criteria summing above max_score
 * is rejected rather than silently normalized — a teacher-authored mismatch should be caught
 * and fixed at authoring time, not silently rescaled behind their back. */
export function validateGradingSpec(mode: HomeworkGradingMode, spec: unknown, itemMaxScore?: number | null) {
  const schema = gradingSpecSchemaFor(mode)
  const result = schema.safeParse(spec)
  if (!result.success) return { ok: false as const, error: result.error.issues.map(i => i.message).join('; ') }

  if (mode === 'rubric' && itemMaxScore != null) {
    const total = (result.data as RubricSpec).criteria.reduce((sum, c) => sum + c.max_score, 0)
    if (total > itemMaxScore) {
      return { ok: false as const, error: `Сумма баллов критериев (${total}) превышает максимальный балл задания (${itemMaxScore})` }
    }
  }

  return { ok: true as const, data: result.data }
}

export const GRADING_MODE_LABELS: Record<HomeworkGradingMode, string> = {
  manual: 'Проверка вручную',
  exact_answer: 'Точный ответ',
  numeric_tolerance: 'Числовой ответ с допуском',
  multiple_choice: 'Выбор варианта',
  formula: 'Формула',
  rubric: 'Рубрика (критерии)',
  ai_assisted: 'С помощью AI (в будущем)',
}
