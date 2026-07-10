import { describe, expect, it } from 'vitest'
import { getQueueItemReviewPath, resolveNextQueueItem, type QueueItem } from '@/lib/pendingQueue'

const legacyItem = (submissionId: string): QueueItem => ({
  source: 'legacy',
  submissionId,
  status: 'submitted',
  submittedAt: null,
  reviewedAt: null,
  dueDate: null,
  bucket: 'new',
  overdue: false,
  student: { id: 'student-1', name: 'Ученик' },
  group: { id: 'group-1', name: 'Группа' },
  homework: { id: 'hw-1', title: 'ДЗ' },
  topicTitle: '',
  score: null,
})

const collectionItem = (submissionId: string): QueueItem => ({
  source: 'collection',
  submissionId,
  status: 'submitted',
  submittedAt: null,
  reviewedAt: null,
  dueDate: null,
  bucket: 'new',
  overdue: false,
  student: { id: 'student-2', name: 'Ученик 2' },
  group: { id: 'group-2', name: 'Группа 2' },
  homework: { id: 'assignment-2', title: 'Подборка' },
  topicTitle: '',
  score: null,
})

describe('pendingQueue resolver', () => {
  it('returns the next item after the current queue work', () => {
    const items = [legacyItem('sub-1'), collectionItem('task-sub-2')]
    expect(resolveNextQueueItem(items, { submissionId: 'sub-1', source: 'legacy' })?.submissionId).toBe('task-sub-2')
  })

  it('falls back to the first pending item when the current work is missing', () => {
    const items = [collectionItem('task-sub-9')]
    expect(resolveNextQueueItem(items, { submissionId: 'sub-missing', source: 'legacy' })?.submissionId).toBe('task-sub-9')
  })

  it('returns null for an empty queue', () => {
    expect(resolveNextQueueItem([], { submissionId: 'sub-1', source: 'legacy' })).toBeNull()
  })

  it('builds review paths for both systems', () => {
    expect(getQueueItemReviewPath(legacyItem('sub-1'))).toBe('/homeworks/hw-1/review/group-1/student-1')
    expect(getQueueItemReviewPath(collectionItem('task-sub-2'))).toBe('/review-submissions/task-sub-2')
  })
})
