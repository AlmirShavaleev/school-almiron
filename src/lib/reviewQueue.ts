import { supabase } from '@/lib/supabase'

export type ReviewQueueMode = 'pending' | 'returned' | 'checked' | 'all'
export type ReviewQueueSource = 'legacy_homework' | 'task_collection'
export type ReviewQueueStatus = 'not_submitted' | 'submitted' | 'returned' | 'accepted' | 'rejected'
export type QueueBucket = 'urgent' | 'new' | 'backlog'

export interface ReviewQueueCursor {
  mode: ReviewQueueMode
  has_sort_value: boolean
  sort_value: string | null
  source: ReviewQueueSource
  assignment_id: string
  student_id: string
}

export interface ReviewQueueRpcRow {
  source: ReviewQueueSource
  submission_id: string | null
  assignment_id: string
  student_id: string
  student_name: string
  course_id: string | null
  course_title: string | null
  group_ids: string[]
  group_titles: string[]
  topic_id: string | null
  topic_title: string | null
  lesson_id: string | null
  title: string
  due_at: string | null
  submitted_at: string | null
  reviewed_at: string | null
  status: ReviewQueueStatus
  score: number | null
  has_files: boolean
  is_overdue: boolean
}

export interface ReviewQueueItem {
  source: ReviewQueueSource
  submissionId: string | null
  assignmentId: string
  status: ReviewQueueStatus
  submittedAt: string | null
  reviewedAt: string | null
  dueDate: string | null
  bucket: QueueBucket | null
  overdue: boolean
  student: { id: string; name: string }
  course: { id: string | null; title: string | null }
  group: { id: string | null; name: string | null }
  groups: { ids: string[]; titles: string[] }
  lessonId: string | null
  topicTitle: string
  homework: { id: string; title: string }
  score: number | null
  hasFiles: boolean
}

export interface ReviewQueuePage {
  items: ReviewQueueItem[]
  hasMore: boolean
  nextCursor: ReviewQueueCursor | null
}

export interface ReviewQueueFilters {
  courseId?: string | null
  groupId?: string | null
  studentId?: string | null
  sourceType?: ReviewQueueSource | null
  statuses?: ReviewQueueStatus[] | null
  dueBefore?: string | null
  dueAfter?: string | null
  cursor?: ReviewQueueCursor | null
  limit?: number
}

export interface ReviewQueueCounts {
  pending: number
  returned: number
  checked: number
}

const DAY = 24 * 60 * 60 * 1000
const NEW_WINDOW = 3 * DAY

function parsePagePayload(payload: unknown): { items: ReviewQueueRpcRow[]; has_more: boolean; next_cursor: ReviewQueueCursor | null } {
  if (!payload || typeof payload !== 'object') {
    return { items: [], has_more: false, next_cursor: null }
  }

  const page = payload as {
    items?: ReviewQueueRpcRow[]
    has_more?: boolean
    next_cursor?: ReviewQueueCursor | null
  }

  return {
    items: page.items ?? [],
    has_more: page.has_more ?? false,
    next_cursor: page.next_cursor ?? null,
  }
}

function inferBucket(row: ReviewQueueRpcRow): QueueBucket | null {
  if (row.status !== 'submitted') return null

  const now = Date.now()
  const due = row.due_at ? new Date(row.due_at).getTime() : null
  if (due != null && (row.is_overdue || due - now < DAY)) return 'urgent'

  if (row.submitted_at && now - new Date(row.submitted_at).getTime() < NEW_WINDOW) {
    return 'new'
  }

  return 'backlog'
}

export function mapReviewQueueItem(row: ReviewQueueRpcRow): ReviewQueueItem {
  return {
    source: row.source,
    submissionId: row.submission_id,
    assignmentId: row.assignment_id,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    dueDate: row.due_at,
    bucket: inferBucket(row),
    overdue: row.is_overdue,
    student: { id: row.student_id, name: row.student_name },
    course: { id: row.course_id, title: row.course_title },
    group: { id: row.group_ids[0] ?? null, name: row.group_titles[0] ?? null },
    groups: { ids: row.group_ids ?? [], titles: row.group_titles ?? [] },
    lessonId: row.lesson_id,
    topicTitle: row.topic_title ?? '',
    homework: { id: row.assignment_id, title: row.title },
    score: row.score,
    hasFiles: row.has_files,
  }
}

export async function fetchReviewQueuePage(
  mode: ReviewQueueMode,
  filters: ReviewQueueFilters = {},
): Promise<ReviewQueuePage> {
  const db = supabase as any
  const { data, error } = await db.rpc('get_review_queue', {
    p_mode: mode,
    p_course_id: filters.courseId ?? null,
    p_group_id: filters.groupId ?? null,
    p_student_id: filters.studentId ?? null,
    p_source_type: filters.sourceType ?? null,
    p_status: filters.statuses ?? null,
    p_due_before: filters.dueBefore ?? null,
    p_due_after: filters.dueAfter ?? null,
    p_cursor: filters.cursor ?? null,
    p_limit: filters.limit ?? 50,
  })

  if (error) throw error
  const page = parsePagePayload(data)
  return {
    items: page.items.map(mapReviewQueueItem),
    hasMore: page.has_more,
    nextCursor: page.next_cursor,
  }
}

export async function fetchReviewQueueCounts(filters: Omit<ReviewQueueFilters, 'statuses' | 'cursor' | 'limit' | 'dueBefore' | 'dueAfter'> = {}): Promise<ReviewQueueCounts> {
  const db = supabase as any
  const { data, error } = await db.rpc('get_review_queue_counts', {
    p_course_id: filters.courseId ?? null,
    p_group_id: filters.groupId ?? null,
    p_student_id: filters.studentId ?? null,
    p_source_type: filters.sourceType ?? null,
  })

  if (error) throw error

  const rows = Array.isArray(data) ? data as Array<{ bucket?: string; count?: number }> : []
  const counts: ReviewQueueCounts = { pending: 0, returned: 0, checked: 0 }

  for (const row of rows) {
    const count = Number(row.count ?? 0)
    if (row.bucket === 'pending') counts.pending += count
    if (row.bucket === 'returned') counts.returned += count
    if (row.bucket === 'checked') counts.checked += count
  }

  return counts
}

