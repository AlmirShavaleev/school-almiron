import { describe, it, expect } from 'vitest'
import {
  sectionsFromMaterials, homeworkStatus, statusAttempt, reviewOfAttempt,
  homeworkMax, testStatus, testPercent, topicProgress,
} from './studentProgram'
import type { TopicHomeworkAttemptRow, TopicHomeworkReviewRow } from './topicHomework'

function attempt(p: Partial<TopicHomeworkAttemptRow> & { attempt_number: number; status: TopicHomeworkAttemptRow['status'] }): TopicHomeworkAttemptRow {
  return {
    id: `a${p.attempt_number}`,
    homework_id: 'hw-1',
    student_id: 'st-1',
    submitted_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...p,
  }
}

function review(p: Partial<TopicHomeworkReviewRow> & { attempt_id: string; created_at: string }): TopicHomeworkReviewRow {
  return {
    id: `r-${p.attempt_id}-${p.created_at}`,
    reviewer_id: 'prof-1',
    decision: 'accepted',
    comment: null,
    score: null,
    ...p,
  }
}

describe('sectionsFromMaterials', () => {
  it('складывает рубрики по темам и знает только четыре рубрики материалов', () => {
    const map = sectionsFromMaterials([
      { topic_id: 't1', kind: 'file', section: 'notes' },
      { topic_id: 't1', kind: 'file', section: 'tasks' },
      { topic_id: 't2', kind: 'file', section: 'solution' },
    ])
    expect([...map.t1]).toEqual(expect.arrayContaining(['notes', 'tasks']))
    expect([...map.t2]).toEqual(['solution'])
  })

  it('видео определяется по kind, а не по рубрике — плитка «Видео» пишет ссылку', () => {
    const map = sectionsFromMaterials([{ topic_id: 't1', kind: 'video', section: null }])
    expect(map.t1.has('video')).toBe(true)
  })

  it('чужие значения section игнорируются (в БД NULL или одна из четырёх)', () => {
    const map = sectionsFromMaterials([{ topic_id: 't1', kind: 'text', section: 'homework' }])
    expect(map.t1.size).toBe(0)
  })

  it('темы без материалов в карту не попадают', () => {
    expect(sectionsFromMaterials([])).toEqual({})
  })
})

describe('homeworkStatus', () => {
  it('без попыток — «не сдано»', () => {
    expect(homeworkStatus([])).toBe('not_started')
  })

  it('черновик виден как черновик, а не как «не сдано»', () => {
    expect(homeworkStatus([attempt({ attempt_number: 1, status: 'draft' })])).toBe('draft')
  })

  it('сданная попытка — «на проверке»', () => {
    expect(homeworkStatus([attempt({ attempt_number: 1, status: 'submitted' })])).toBe('submitted')
  })

  it('возврат — «доработать»', () => {
    expect(homeworkStatus([attempt({ attempt_number: 1, status: 'returned_for_revision' })])).toBe('returned')
  })

  it('accepted побеждает даже если это не последняя по номеру попытка', () => {
    const attempts = [
      attempt({ attempt_number: 2, status: 'returned_for_revision' }),
      attempt({ attempt_number: 1, status: 'accepted' }),
    ]
    expect(homeworkStatus(attempts)).toBe('accepted')
  })

  it('среди незавершённых берётся самая свежая попытка', () => {
    const attempts = [
      attempt({ attempt_number: 1, status: 'returned_for_revision' }),
      attempt({ attempt_number: 2, status: 'submitted' }),
    ]
    expect(homeworkStatus(attempts)).toBe('submitted')
  })
})

describe('statusAttempt / reviewOfAttempt', () => {
  it('вердикт показывается по принятой попытке', () => {
    const attempts = [
      attempt({ id: 'old', attempt_number: 1, status: 'accepted' }),
      attempt({ id: 'new', attempt_number: 2, status: 'draft' }),
    ]
    expect(statusAttempt(attempts)?.id).toBe('old')
  })

  it('если принятой нет — по самой свежей', () => {
    const attempts = [
      attempt({ id: 'old', attempt_number: 1, status: 'returned_for_revision' }),
      attempt({ id: 'new', attempt_number: 2, status: 'submitted' }),
    ]
    expect(statusAttempt(attempts)?.id).toBe('new')
  })

  it('берётся последний вердикт по попытке', () => {
    const reviews = [
      review({ attempt_id: 'a1', created_at: '2026-07-01T10:00:00Z', comment: 'старый' }),
      review({ attempt_id: 'a1', created_at: '2026-07-02T10:00:00Z', comment: 'новый' }),
      review({ attempt_id: 'a2', created_at: '2026-07-03T10:00:00Z', comment: 'чужой' }),
    ]
    expect(reviewOfAttempt(reviews, 'a1')?.comment).toBe('новый')
  })

  it('без попытки вердикта нет', () => {
    expect(reviewOfAttempt([], null)).toBeNull()
    expect(statusAttempt([])).toBeNull()
  })
})

describe('homeworkMax', () => {
  it('шкала 5 и 100 дают максимум, отсутствие шкалы — null (ДЗ без баллов)', () => {
    expect(homeworkMax('five')).toBe(5)
    expect(homeworkMax('hundred')).toBe(100)
    expect(homeworkMax(null)).toBeNull()
  })
})

describe('testStatus / testPercent', () => {
  it('нет попытки — тест не начат', () => {
    expect(testStatus(null)).toBe('not_started')
  })

  it('незавершённая попытка — в процессе, завершённая — completed', () => {
    expect(testStatus({ status: 'in_progress' })).toBe('in_progress')
    expect(testStatus({ status: 'completed' })).toBe('completed')
  })

  it('процент считается только при известном ненулевом максимуме', () => {
    expect(testPercent(7, 10)).toBe(70)
    expect(testPercent(null, 10)).toBeNull()
    expect(testPercent(5, 0)).toBeNull()
    expect(testPercent(5, null)).toBeNull()
  })
})

describe('topicProgress', () => {
  it('тема без ДЗ и теста не добавляет заданий в кольцо прогресса', () => {
    expect(topicProgress({ hasHomework: false, hwStatus: null, hasTest: false, testStatus: null }))
      .toEqual({ assigned: 0, completed: 0 })
  })

  it('ДЗ и тест считаются по одному заданию каждый', () => {
    expect(topicProgress({ hasHomework: true, hwStatus: 'submitted', hasTest: true, testStatus: 'not_started' }))
      .toEqual({ assigned: 2, completed: 0 })
  })

  it('выполнено = принятое ДЗ + завершённый тест', () => {
    expect(topicProgress({ hasHomework: true, hwStatus: 'accepted', hasTest: true, testStatus: 'completed' }))
      .toEqual({ assigned: 2, completed: 2 })
  })

  it('сданное, но не принятое ДЗ выполненным не считается', () => {
    expect(topicProgress({ hasHomework: true, hwStatus: 'submitted', hasTest: false, testStatus: null }))
      .toEqual({ assigned: 1, completed: 0 })
  })
})
