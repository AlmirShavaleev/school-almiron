import { describe, expect, it } from 'vitest'
import { collapseToWorks, toQueueRows, type QueueRow } from './homeworkQueue'
import { buildStudentInsights, insightsForModel, scorePercent } from './studentInsights'
import type { TopicHomeworkReviewRow } from './topicHomework'

function rawAttempt(over: Record<string, unknown> = {}, topic = 'Кинематика', hwId = 'hw1') {
  return {
    id: 'a1',
    homework_id: hwId,
    student_id: 's1',
    attempt_number: 1,
    status: 'accepted',
    submitted_at: '2026-08-01T10:00:00Z',
    created_at: '2026-08-01T09:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    homework: {
      id: hwId,
      title: 'ДЗ',
      grade_scale: 'five',
      due_at: null,
      topic: { id: topic, title: topic, module: { id: 'm1', course: { id: 'c1', title: 'Физика' } } },
    },
    ...over,
  }
}

function review(attemptId: string, score: number | null, at: string): TopicHomeworkReviewRow {
  return {
    id: `r-${attemptId}`,
    attempt_id: attemptId,
    reviewer_id: 'p1',
    decision: score == null ? 'returned_for_revision' : 'accepted',
    comment: null,
    score,
    created_at: at,
  }
}

const works = (raw: Record<string, unknown>[]): QueueRow[] => collapseToWorks(toQueueRows(raw))

describe('scorePercent — разные шкалы приводятся к процентам', () => {
  it('пятёрка и сотня считаются от своего максимума', () => {
    expect(scorePercent(4, 'five')).toBe(80)
    expect(scorePercent(80, 'hundred')).toBe(80)
  })

  it('без шкалы и без балла процента нет', () => {
    expect(scorePercent(4, null)).toBeNull()
    expect(scorePercent(null, 'five')).toBeNull()
  })
})

describe('buildStudentInsights', () => {
  it('считает работы по состояниям последней попытки', () => {
    const insights = buildStudentInsights({
      works: works([
        rawAttempt({ id: 'a1', status: 'submitted' }, 'Кинематика', 'hw1'),
        rawAttempt({ id: 'a2', status: 'returned_for_revision' }, 'Динамика', 'hw2'),
        rawAttempt({ id: 'a3', status: 'accepted' }, 'Оптика', 'hw3'),
      ]),
      reviews: [],
    })

    expect(insights.works).toMatchObject({ total: 3, pending: 1, revision: 1, accepted: 1 })
    expect(insights.hasData).toBe(true)
  })

  it('возврат остаётся фактом истории даже у принятой работы', () => {
    // Работа принята со второй попытки: состояние — «принято», но далась она
    // тяжело, и это ровно то, что должен увидеть преподаватель.
    const insights = buildStudentInsights({
      works: works([
        rawAttempt({ id: 'a1', attempt_number: 1, status: 'returned_for_revision' }),
        rawAttempt({ id: 'a2', attempt_number: 2, status: 'accepted' }),
      ]),
      reviews: [review('a2', 4, '2026-08-02T10:00:00Z')],
    })

    expect(insights.works).toMatchObject({ total: 1, accepted: 1, revision: 0 })
    expect(insights.revisions).toEqual({ returnedWorks: 1, maxAttempts: 2 })
    expect(insights.weakTopics[0]).toMatchObject({ topic: 'Кинематика', returns: 1 })
  })

  it('среднее и динамика: вторая половина оценок против первой', () => {
    const insights = buildStudentInsights({
      works: works([
        rawAttempt({ id: 'a1' }, 'Т1', 'hw1'),
        rawAttempt({ id: 'a2' }, 'Т2', 'hw2'),
        rawAttempt({ id: 'a3' }, 'Т3', 'hw3'),
        rawAttempt({ id: 'a4' }, 'Т4', 'hw4'),
      ]),
      reviews: [
        review('a1', 3, '2026-08-01T10:00:00Z'),
        review('a2', 3, '2026-08-02T10:00:00Z'),
        review('a3', 5, '2026-08-03T10:00:00Z'),
        review('a4', 5, '2026-08-04T10:00:00Z'),
      ],
    })

    expect(insights.score.avgPercent).toBe(80)
    expect(insights.score.samples).toBe(4)
    expect(insights.score.trend).toBe('up')
    expect(insights.score.trendDelta).toBe(40)
  })

  it('на трёх оценках динамику не выдумывает', () => {
    const insights = buildStudentInsights({
      works: works([
        rawAttempt({ id: 'a1' }, 'Т1', 'hw1'),
        rawAttempt({ id: 'a2' }, 'Т2', 'hw2'),
        rawAttempt({ id: 'a3' }, 'Т3', 'hw3'),
      ]),
      reviews: [
        review('a1', 3, '2026-08-01T10:00:00Z'),
        review('a2', 4, '2026-08-02T10:00:00Z'),
        review('a3', 5, '2026-08-03T10:00:00Z'),
      ],
    })

    expect(insights.score.trend).toBeNull()
    expect(insights.score.trendDelta).toBeNull()
  })

  it('проседающая тема — ниже СВОЕГО среднего, а не внешней нормы', () => {
    const insights = buildStudentInsights({
      works: works([
        rawAttempt({ id: 'a1' }, 'Сильная', 'hw1'),
        rawAttempt({ id: 'a2' }, 'Сильная', 'hw2'),
        rawAttempt({ id: 'a3' }, 'Слабая', 'hw3'),
      ]),
      reviews: [
        review('a1', 5, '2026-08-01T10:00:00Z'),
        review('a2', 5, '2026-08-02T10:00:00Z'),
        review('a3', 4, '2026-08-03T10:00:00Z'),
      ],
    })

    // 80% — хорошая оценка сама по себе, но у этого ученика среднее 93%.
    expect(insights.weakTopics.map(t => t.topic)).toEqual(['Слабая'])
    expect(insights.weakTopics[0].avgPercent).toBe(80)
  })

  it('молчание считает от свежего следа: сдача или заход', () => {
    const insights = buildStudentInsights({
      works: works([rawAttempt({ id: 'a1', submitted_at: '2026-08-01T10:00:00Z' })]),
      reviews: [],
      lastVisit: '2026-08-05T10:00:00Z',
      now: new Date('2026-08-09T10:00:00Z'),
    })

    expect(insights.activity.lastSubmission).toBe('2026-08-01T10:00:00Z')
    expect(insights.activity.silentDays).toBe(4)
  })

  it('пустой ученик честно говорит, что данных нет', () => {
    const insights = buildStudentInsights({ works: [], reviews: [] })
    expect(insights.hasData).toBe(false)
    expect(insights.score.avgPercent).toBeNull()
    expect(insights.activity.silentDays).toBeNull()
  })
})

describe('insightsForModel — в запрос не уходит ничего именного', () => {
  it('ни имён, ни идентификаторов, ни дат', () => {
    const insights = buildStudentInsights({
      works: works([
        rawAttempt({ id: 'a1', student_id: 'student-uuid', status: 'returned_for_revision' }, 'Кинематика', 'hw-uuid'),
        rawAttempt({ id: 'a2', student_id: 'student-uuid', attempt_number: 2, status: 'accepted' }, 'Кинематика', 'hw-uuid'),
      ]),
      reviews: [review('a2', 4, '2026-08-02T10:00:00Z')],
      lastVisit: '2026-08-05T10:00:00Z',
      now: new Date('2026-08-09T10:00:00Z'),
    })

    const payload = JSON.stringify(insightsForModel(insights))

    // Названия тем нужны модели и разрешены вводной, всё остальное — нет.
    expect(payload).toContain('Кинематика')
    expect(payload).not.toContain('student-uuid')
    expect(payload).not.toContain('hw-uuid')
    expect(payload).not.toContain('a1')
    expect(payload).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(payload).not.toMatch(/@/)
  })
})
