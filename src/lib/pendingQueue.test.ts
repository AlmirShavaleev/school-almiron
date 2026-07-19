import { describe, expect, it } from 'vitest'
import { getQueueItemReviewPath, resolveNextQueueItem, type QueueItem } from '@/lib/pendingQueue'

const legacyItem = (submissionId: string): QueueItem => ({
  source: 'legacy_homework',
  submissionId,
  assignmentId: 'hw-1',
  status: 'submitted',
  submittedAt: null,
  reviewedAt: null,
  dueDate: null,
  bucket: 'new',
  overdue: false,
  student: { id: 'student-1', name: 'Ученик' },
  course: { id: 'course-1', title: 'Курс' },
  group: { id: 'group-1', name: 'Группа' },
  groups: { ids: ['group-1'], titles: ['Группа'] },
  lessonId: null,
  homework: { id: 'hw-1', title: 'ДЗ' },
  topicTitle: '',
  score: null,
  hasFiles: false,
})

const collectionItem = (submissionId: string): QueueItem => ({
  source: 'task_collection',
  submissionId,
  assignmentId: 'assignment-2',
  status: 'submitted',
  submittedAt: null,
  reviewedAt: null,
  dueDate: null,
  bucket: 'new',
  overdue: false,
  student: { id: 'student-2', name: 'Ученик 2' },
  course: { id: 'course-2', title: 'Курс 2' },
  group: { id: 'group-2', name: 'Группа 2' },
  groups: { ids: ['group-2'], titles: ['Группа 2'] },
  lessonId: null,
  homework: { id: 'assignment-2', title: 'Подборка' },
  topicTitle: '',
  score: null,
  hasFiles: false,
})

describe('pendingQueue resolver', () => {
  it('returns the next item after the current queue work', () => {
    const items = [legacyItem('sub-1'), collectionItem('task-sub-2')]
    expect(resolveNextQueueItem(items, { submissionId: 'sub-1', source: 'legacy_homework' })?.submissionId).toBe('task-sub-2')
  })

  it('falls back to the first pending item when the current work is missing', () => {
    const items = [collectionItem('task-sub-9')]
    expect(resolveNextQueueItem(items, { submissionId: 'sub-missing', source: 'legacy_homework' })?.submissionId).toBe('task-sub-9')
  })

  it('returns null for an empty queue', () => {
    expect(resolveNextQueueItem([], { submissionId: 'sub-1', source: 'legacy_homework' })).toBeNull()
  })

  it('builds review paths for both systems', () => {
    expect(getQueueItemReviewPath(legacyItem('sub-1'))).toBe('/homeworks/hw-1/review/group-1/student-1')
    expect(getQueueItemReviewPath(collectionItem('task-sub-2'))).toBe('/review-submissions/task-sub-2')
  })
})
