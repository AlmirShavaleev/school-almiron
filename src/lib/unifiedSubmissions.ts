export type UnifiedStatus = 'not_started' | 'submitted' | 'returned' | 'accepted' | 'rejected'
export type UnifiedSource = 'legacy' | 'collection'

export interface UnifiedSubmission {
  key: string
  source: UnifiedSource
  studentId: string
  homeworkId: string
  submissionId: string | null
  lessonId: string | null
  topicId: string | null
  courseId: string | null
  subject: string | null
  title: string
  status: UnifiedStatus
  score: number | null
  maxScore: number | null
  dueAt: string | null
  assignedAt: string
  submittedAt: string | null
  reviewedAt: string | null
  teacherComment: string | null
}

export function mapLegacyStatus(status: string | null | undefined): UnifiedStatus {
  switch (status) {
    case 'submitted': case 'under_review': case 'resubmitted': return 'submitted'
    case 'revision': case 'revision_requested': return 'returned'
    case 'checked': case 'accepted': return 'accepted'
    default: return 'not_started'
  }
}

export function mapCollectionStatus(status: string | null | undefined): UnifiedStatus {
  switch (status) {
    case 'submitted': return 'submitted'
    case 'returned': return 'returned'
    case 'accepted': return 'accepted'
    case 'rejected': return 'rejected'
    default: return 'not_started'
  }
}

export function makeUnifiedKey(source: UnifiedSource, homeworkId: string, studentId: string) {
  return `${source}:${homeworkId}:${studentId}`
}

export function mapLegacySubmission(homework: any, submission: any | null, context: {
  studentId: string; courseId?: string | null; subject?: string | null
}): UnifiedSubmission {
  return {
    key: makeUnifiedKey('legacy', homework.id, context.studentId), source: 'legacy',
    studentId: context.studentId, homeworkId: homework.id, submissionId: submission?.id ?? null,
    lessonId: homework.lesson_id ?? null, topicId: homework.topic_id ?? null,
    courseId: context.courseId ?? null, subject: context.subject ?? null,
    title: homework.title, status: mapLegacyStatus(submission?.status),
    score: submission?.score ?? null, maxScore: homework.max_score ?? null,
    dueAt: homework.due_date ?? null, assignedAt: homework.created_at,
    submittedAt: submission?.submitted_at ?? null, reviewedAt: submission?.checked_at ?? null,
    teacherComment: submission?.feedback ?? null,
  }
}

export function mapCollectionSubmission(assignment: any, submission: any | null, context: {
  studentId: string; lessonId?: string | null; topicId?: string | null;
  courseId?: string | null; subject?: string | null; title?: string | null
}): UnifiedSubmission {
  return {
    key: makeUnifiedKey('collection', assignment.id, context.studentId), source: 'collection',
    studentId: context.studentId, homeworkId: assignment.id, submissionId: submission?.id ?? null,
    lessonId: context.lessonId ?? assignment.lesson_id ?? null, topicId: context.topicId ?? null,
    courseId: context.courseId ?? null, subject: context.subject ?? null,
    title: context.title ?? 'Подборка заданий', status: mapCollectionStatus(submission?.status),
    score: submission?.score ?? null, maxScore: null, dueAt: assignment.due_date ?? null,
    assignedAt: assignment.created_at, submittedAt: submission?.submitted_at ?? null,
    reviewedAt: submission?.reviewed_at ?? null, teacherComment: submission?.teacher_comment ?? null,
  }
}

export function progressOf(assignments: UnifiedSubmission[]) {
  const assigned = assignments.length
  const completed = assignments.filter(item => item.status === 'accepted').length
  return { assigned, completed, completionPct: assigned ? Math.round(completed / assigned * 100) : 0 }
}

export function aggregateStatus(assignments: UnifiedSubmission[]): UnifiedStatus | null {
  if (!assignments.length) return null
  if (assignments.every(item => item.status === 'accepted')) return 'accepted'
  if (assignments.some(item => item.status === 'returned')) return 'returned'
  if (assignments.some(item => item.status === 'submitted')) return 'submitted'
  if (assignments.some(item => item.status === 'rejected')) return 'rejected'
  return 'not_started'
}
