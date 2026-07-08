/**
 * assigned_collections.status describes the assignment's own lifecycle
 * (created by the teacher), NOT any individual student's progress.
 * It is never derived from a single student's submission or grade —
 * that would be incorrect for group assignments (one student's action
 * cannot flip the state for the whole group).
 */
export type AssignedStatus = 'active' | 'closed' | 'cancelled'

/**
 * task_submissions.status describes ONE student's progress on ONE assignment.
 * Absence of a row means "not started" (not_started is a UI-derived state,
 * not a stored value).
 *
 * Allowed transitions:
 *   (no row) --submit_task_solution--> submitted
 *   submitted --grade_task_submission(accepted)--> accepted   (terminal, locked)
 *   submitted --grade_task_submission(rejected)--> rejected   (terminal, locked)
 *   submitted --grade_task_submission(returned)--> returned
 *   returned  --submit_task_solution-->            submitted  (resubmission allowed)
 *   accepted/rejected/submitted -> submit_task_solution is REJECTED by the RPC
 */
export type SubmissionStatus = 'submitted' | 'returned' | 'accepted' | 'rejected'

/** UI-only status including the "no submission yet" case */
export type DisplaySubmissionStatus = 'not_started' | SubmissionStatus

export interface AssignedCollection {
  id:            string
  collection_id: string
  teacher_id:    string
  student_id:    string | null
  group_id:      string | null
  due_date:      string | null
  status:        AssignedStatus
  created_at:    string
}

export interface TaskSubmission {
  id:              string
  assigned_id:     string
  student_id:      string
  answers:         Record<string, string>
  files:           string[]
  submitted_at:    string
  status:          SubmissionStatus
  teacher_comment: string | null
  score:           number | null
  reviewed_at:     string | null
  created_at:      string
  updated_at:      string
}

/** Row returned by get_assignment_roster RPC — per-student status for a (possibly group) assignment */
export interface RosterRow {
  student_id:    string
  full_name:     string
  submission_id: string | null
  status:        DisplaySubmissionStatus
  submitted_at:  string | null
  score:         number | null
}

/** Row returned by get_student_assignment_tasks RPC — safe subset, no answer/solution */
export interface StudentAssignmentTask {
  item_id:         string
  catalog_task_id: string
  item_position:   number
  custom_number:   string | null
  external_id:     number
  subject:         string
  exam_type:       string
  statement_html:  string
  has_answer:      boolean
  has_solution:    boolean
  assets:          { id: string; tex_session_id: number; kind: string; storage_path: string; alt: string | null; position: number }[]
}

export const SUBMISSION_STATUS_LABELS: Record<DisplaySubmissionStatus, string> = {
  not_started: 'Не начал',
  submitted:   'На проверке',
  returned:    'Возвращено на доработку',
  accepted:    'Принято',
  rejected:    'Отклонено',
}

export const ASSIGNED_STATUS_LABELS: Record<AssignedStatus, string> = {
  active:    'Активно',
  closed:    'Закрыто',
  cancelled: 'Отменено',
}
