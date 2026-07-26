import type { CatalogTask } from '@/hooks/useCatalog'
import type { HomeworkGradingMode } from '@/types/homeworkGrading'

function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface GradingAutofillResult {
  max_score: number | null
  grading_mode: HomeworkGradingMode
  grading_spec: Record<string, unknown>
}

/**
 * Best-effort heuristic seed for grading settings from a catalog task. The teacher confirms
 * or edits everything before saving — this only saves typing for the common cases, it is not
 * a source of truth. answer_html/grade_criteria_html are raw HTML from the catalog, stripped
 * to plain text here; that text is NOT guaranteed to be a clean single expected value, hence
 * "недостаточно данных → manual" as the fallback whenever the shape is ambiguous.
 */
export function autofillGradingFromCatalogTask(task: CatalogTask): GradingAutofillResult {
  const maxScore = task.max_points ?? null
  const plainAnswer = stripHtml(task.answer_html)

  if (task.partial_type === 'multi_choice') {
    return {
      max_score: maxScore,
      grading_mode: 'multiple_choice',
      grading_spec: { correct_options: plainAnswer ? [plainAnswer] : [], allow_multiple: false },
    }
  }

  // Part 1 (short-answer) tasks with a plain answer: numeric if it parses as a number,
  // otherwise treat as an exact string match.
  if ((task.exam_part === 1 || task.exam_part == null) && task.has_answer && plainAnswer) {
    const numeric = Number(plainAnswer.replace(',', '.'))
    if (plainAnswer.length < 40 && !Number.isNaN(numeric) && /^-?\d+([.,]\d+)?$/.test(plainAnswer)) {
      return {
        max_score: maxScore,
        grading_mode: 'numeric_tolerance',
        grading_spec: { expected: numeric, tolerance_absolute: 0 },
      }
    }
    if (plainAnswer.length < 60) {
      return {
        max_score: maxScore,
        grading_mode: 'exact_answer',
        grading_spec: { expected: plainAnswer },
      }
    }
  }

  // Part 2 (extended solution) with ФИПИ grading criteria: seed one rubric criterion from
  // the raw criteria text — the teacher is expected to split/edit this into real criteria.
  if (task.grade_criteria_html) {
    return {
      max_score: maxScore,
      grading_mode: 'rubric',
      grading_spec: {
        criteria: [{
          id: 'criterion-1',
          title: 'Критерии ФИПИ',
          description: stripHtml(task.grade_criteria_html),
          max_score: maxScore ?? 0,
        }],
      },
    }
  }

  return { max_score: maxScore, grading_mode: 'manual', grading_spec: {} }
}
