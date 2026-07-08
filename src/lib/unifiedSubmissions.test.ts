import { describe, expect, it } from 'vitest'
import {
  aggregateStatus, makeUnifiedKey, mapCollectionStatus, mapLegacyStatus, progressOf,
  type UnifiedSubmission,
} from './unifiedSubmissions'

describe('unified status mapping', () => {
  it.each([
    [null, 'not_started'], ['not_submitted', 'not_started'],
    ['submitted', 'submitted'], ['under_review', 'submitted'], ['resubmitted', 'submitted'],
    ['revision', 'returned'], ['revision_requested', 'returned'],
    ['checked', 'accepted'], ['accepted', 'accepted'],
  ])('maps legacy %s -> %s', (input, expected) => expect(mapLegacyStatus(input)).toBe(expected))

  it.each([
    [null, 'not_started'], ['submitted', 'submitted'], ['returned', 'returned'],
    ['accepted', 'accepted'], ['rejected', 'rejected'],
  ])('maps collection %s -> %s', (input, expected) => expect(mapCollectionStatus(input)).toBe(expected))
})

const item = (status: UnifiedSubmission['status'], key: string = status): UnifiedSubmission => ({
  key, source: 'collection', studentId: 's', homeworkId: key, submissionId: null,
  lessonId: null, topicId: null, courseId: null, subject: null, title: key, status,
  score: null, maxScore: null, dueAt: null, assignedAt: '2026-01-01',
  submittedAt: null, reviewedAt: null, teacherComment: null,
})

describe('unified progress', () => {
  it('uses completed / assigned and keeps empty input stable', () => {
    expect(progressOf([])).toEqual({ assigned: 0, completed: 0, completionPct: 0 })
    expect(progressOf([item('accepted', '1'), item('submitted', '2')]))
      .toEqual({ assigned: 2, completed: 1, completionPct: 50 })
  })

  it('aggregates every assignment instead of last assignment per topic', () => {
    const rows = [item('accepted', '1'), item('returned', '2')]
    expect(progressOf(rows).assigned).toBe(2)
    expect(aggregateStatus(rows)).toBe('returned')
  })

  it('uses mandatory composite key and never deduplicates sources', () => {
    expect(makeUnifiedKey('legacy', 'h', 's')).toBe('legacy:h:s')
    expect(makeUnifiedKey('collection', 'h', 's')).toBe('collection:h:s')
  })
})
