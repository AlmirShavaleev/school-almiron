export interface VariantResultRow {
  tvsa_id:             string
  student_id:          string
  student_name:        string | null
  group_id:            string | null
  group_name:          string | null
  assignment_id:       string
  status:              string
  due_at:              string | null
  available_from:      string | null
  started_at:          string | null
  submitted_at:        string | null
  completed_at:        string | null
  attempts_used:       number
  variant_tasks_count: number
  // NULL = old data (before answer system); real 0 = zero score
  answered_count:      number | null
  correct_count:       number | null
  score:               number | null
  max_score:           number | null
  percentage:          number | null
  grading_status:      'not_submitted' | 'auto_graded' | 'needs_review' | 'graded' | null
  auto_score:          number | null
  manual_review_count: number | null
}

export type DisplayStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'overdue'
  | 'cancelled'

export interface ResultSummary {
  total:       number
  not_started: number
  in_progress: number
  completed:   number
  overdue:     number
  cancelled:   number
}

/** Maps raw DB status + deadline to a user-visible status bucket. */
export function deriveDisplayStatus(row: VariantResultRow, now: Date): DisplayStatus {
  if (row.status === 'cancelled') return 'cancelled'
  if (row.status === 'completed' || row.status === 'submitted') return 'completed'
  if (row.due_at && new Date(row.due_at) < now) return 'overdue'
  if (row.status === 'in_progress') return 'in_progress'
  // not_started | available
  return 'not_started'
}

export function buildResultSummary(rows: VariantResultRow[], now: Date): ResultSummary {
  const summary: ResultSummary = {
    total: rows.length,
    not_started: 0,
    in_progress: 0,
    completed: 0,
    overdue: 0,
    cancelled: 0,
  }
  for (const row of rows) {
    summary[deriveDisplayStatus(row, now)]++
  }
  return summary
}

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  not_started: 'Не начат',
  in_progress: 'В процессе',
  completed:   'Завершён',
  overdue:     'Просрочен',
  cancelled:   'Отменён',
}

export const DISPLAY_STATUS_CLASS: Record<DisplayStatus, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed:   'bg-green-100 text-green-700',
  overdue:     'bg-red-100 text-red-700',
  cancelled:   'bg-gray-100 text-gray-400',
}
