export type HomeworkV2Category =
  | 'not_published' | 'new' | 'to_do' | 'under_review' | 'returned_for_revision' | 'checked'

export interface HomeworkV2Row {
  assignment_id: string
  template_id: string
  template_version_id: string
  template_title: string
  course_id: string
  group_id: string
  group_name: string
  student_id: string
  student_name: string
  status: 'draft' | 'published' | 'closed' | 'cancelled'
  publish_at: string
  due_at: string
  due_at_override: string | null
  effective_due_at: string
  viewed_at: string | null
  is_excused: boolean
  max_attempts: number | null
  allow_late_submission: boolean
  attempts_count: number
  latest_attempt_id: string | null
  latest_attempt_number: number | null
  latest_attempt_status: 'draft' | 'submitted' | 'under_review' | 'returned_for_revision' | 'accepted' | 'rejected' | null
  latest_submitted_at: string | null
  latest_score: number | null
  latest_review_decision: 'accepted' | 'returned_for_revision' | 'rejected' | null
  latest_review_comment: string | null
  latest_reviewed_at: string | null
  category: HomeworkV2Category
  overdue: boolean
}

export const HW_V2_CATEGORY_LABELS: Record<HomeworkV2Category, string> = {
  not_published: 'Не опубликовано',
  new: 'Новые',
  to_do: 'Нужно сдать',
  under_review: 'На проверке',
  returned_for_revision: 'На доработке',
  checked: 'Проверено',
}
