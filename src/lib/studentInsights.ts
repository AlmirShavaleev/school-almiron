/**
 * Разбор по одному ученику: цифры для карточки преподавателя.
 *
 * Только чистые функции — источник данных выбирает хук, а модель ИИ получает
 * ровно то, что здесь посчитано (и ничего именного, см. `insightsForModel`).
 *
 * Это НЕ школьная статистика: агрегаты по школе живут отдельно у админ-чата.
 * Здесь всё сводится к одному человеку.
 */
import { isSubmittedLate, type QueueRow } from '@/lib/homeworkQueue'
import { levelJumpSignals, type LevelJumpSignal } from '@/lib/attentionSignals'
import type { TopicHomeworkAttemptStatus, TopicHomeworkReviewRow } from '@/lib/topicHomework'

export interface ScoredWork {
  topic: string
  percent: number
  /** Момент вердикта — по нему строится динамика. */
  at: string
}

export interface WeakTopic {
  topic: string
  /** Средний процент по теме; null — оценок не было, тема попала за возвраты. */
  avgPercent: number | null
  returns: number
}

export interface StudentInsights {
  works: {
    total: number
    pending: number
    revision: number
    accepted: number
    /** Сдано позже срока — считаем по последней попытке работы. */
    late: number
  }
  score: {
    avgPercent: number | null
    samples: number
    /** Динамика: сравнение первой половины оценок со второй. */
    trend: 'up' | 'down' | 'flat' | null
    trendDelta: number | null
    recent: ScoredWork[]
  }
  revisions: {
    /** Работы, которые хоть раз возвращали. */
    returnedWorks: number
    maxAttempts: number
  }
  weakTopics: WeakTopic[]
  /**
   * Резкие скачки уровня между соседними проверенными работами. Это сигнал
   * «стоит посмотреть», а не вывод: так же выглядит и человек, который
   * наконец разобрался в теме.
   */
  levelJumps: LevelJumpSignal[]
  activity: {
    lastSubmission: string | null
    lastVisit: string | null
    /** Дней с последнего следа жизни: сдача или заход, что свежее. */
    silentDays: number | null
  }
  /** Есть ли вообще на чём строить разбор. */
  hasData: boolean
}

/** Максимум шкалы. `null` — у ДЗ оценки не предусмотрено. */
export function scoreMaxOf(gradeScale: 'five' | 'hundred' | null): number | null {
  if (gradeScale === 'five') return 5
  if (gradeScale === 'hundred') return 100
  return null
}

/**
 * Балл в проценты. Пятёрка и сотня в одной средней — это сложение разных
 * величин, поэтому приводим всё к доле от максимума своей шкалы.
 */
export function scorePercent(score: number | null, gradeScale: 'five' | 'hundred' | null): number | null {
  const max = scoreMaxOf(gradeScale)
  if (score == null || max == null || max === 0) return null
  return Math.round((score / max) * 100)
}

/** Последний вердикт попытки. Копия правила `latestReview`, но по массиву. */
function reviewOf(reviews: TopicHomeworkReviewRow[], attemptId: string): TopicHomeworkReviewRow | null {
  let best: TopicHomeworkReviewRow | null = null
  for (const r of reviews) {
    if (r.attempt_id !== attemptId) continue
    if (!best || r.created_at.localeCompare(best.created_at) > 0) best = r
  }
  return best
}

function daysBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso).getTime()
  if (Number.isNaN(from)) return 0
  return Math.max(0, Math.floor((now.getTime() - from) / 86_400_000))
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length)
}

/**
 * Сводка по ученику.
 *
 * `works` — уже схлопнутые работы (`collapseToWorks`, §88): состояние работы —
 * состояние последней попытки. Своей копии этого правила здесь нет сознательно.
 */
export function buildStudentInsights({
  works, reviews, lastVisit = null, now = new Date(),
}: {
  works: QueueRow[]
  reviews: TopicHomeworkReviewRow[]
  lastVisit?: string | null
  now?: Date
}): StudentInsights {
  const countOf = (status: TopicHomeworkAttemptStatus) =>
    works.filter(w => w.attempt.status === status).length

  const scored: ScoredWork[] = []
  const byTopic = new Map<string, { percents: number[]; returns: number }>()
  let returnedWorks = 0
  let maxAttempts = 0
  let lastSubmission: string | null = null

  for (const work of works) {
    const attempts = [work.attempt, ...work.history]
    maxAttempts = Math.max(maxAttempts, attempts.length)

    // Возврат — это факт истории работы, а не её текущее состояние: работу
    // могли вернуть, а потом принять, и она всё равно далась тяжело.
    const returns = attempts.filter(a => a.status === 'returned_for_revision').length
    if (returns > 0) returnedWorks += 1

    const topic = work.topicTitle
    const bucket = byTopic.get(topic) ?? { percents: [], returns: 0 }
    bucket.returns += returns

    const review = reviewOf(reviews, work.attempt.id)
    const percent = scorePercent(review?.score ?? null, work.gradeScale)
    if (percent != null && review) {
      scored.push({ topic, percent, at: review.created_at })
      bucket.percents.push(percent)
    }
    byTopic.set(topic, bucket)

    const submitted = work.attempt.submitted_at
    if (submitted && (!lastSubmission || submitted.localeCompare(lastSubmission) > 0)) {
      lastSubmission = submitted
    }
  }

  scored.sort((a, b) => a.at.localeCompare(b.at))
  const avgPercent = avg(scored.map(s => s.percent))

  // Динамика имеет смысл, только когда половинки не вырождаются в одну оценку.
  let trend: StudentInsights['score']['trend'] = null
  let trendDelta: number | null = null
  if (scored.length >= 4) {
    const half = Math.floor(scored.length / 2)
    const first = avg(scored.slice(0, half).map(s => s.percent))
    const second = avg(scored.slice(scored.length - half).map(s => s.percent))
    if (first != null && second != null) {
      trendDelta = second - first
      trend = trendDelta >= 5 ? 'up' : trendDelta <= -5 ? 'down' : 'flat'
    }
  }

  // «Проседает» — ниже СВОЕГО среднего, а не ниже какой-то внешней нормы:
  // у сильного ученика 80% при среднем 95% тоже провал, у слабого — рост.
  const weakTopics: WeakTopic[] = []
  for (const [topic, bucket] of byTopic) {
    const topicAvg = avg(bucket.percents)
    const belowOwn = topicAvg != null && avgPercent != null && topicAvg < avgPercent
    const repeated = bucket.returns > 0
    if (belowOwn || repeated) weakTopics.push({ topic, avgPercent: topicAvg, returns: bucket.returns })
  }
  weakTopics.sort((a, b) => {
    if (b.returns !== a.returns) return b.returns - a.returns
    return (a.avgPercent ?? 101) - (b.avgPercent ?? 101)
  })

  const lastTrace = [lastSubmission, lastVisit]
    .filter((v): v is string => !!v)
    .sort((a, b) => b.localeCompare(a))[0] ?? null

  return {
    works: {
      total: works.length,
      pending: countOf('submitted'),
      revision: countOf('returned_for_revision'),
      accepted: countOf('accepted'),
      late: works.filter(isSubmittedLate).length,
    },
    score: {
      avgPercent,
      samples: scored.length,
      trend,
      trendDelta,
      recent: scored.slice(-5).reverse(),
    },
    revisions: { returnedWorks, maxAttempts },
    weakTopics: weakTopics.slice(0, 5),
    levelJumps: levelJumpSignals(scored),
    activity: {
      lastSubmission,
      lastVisit,
      silentDays: lastTrace ? daysBetween(lastTrace, now) : null,
    },
    hasData: works.length > 0,
  }
}

/**
 * Что уходит в модель. ОБЕЗЛИЧЕННО: ни имени, ни почты, ни идентификаторов —
 * только счётчики, проценты, названия тем и интервалы в днях. Модель видит
 * «ученика», а не человека (требование вводной, та же планка, что у
 * ИИ-проверки работ).
 *
 * Даты тоже не отдаём: точный момент сдачи — след конкретного человека, а для
 * вывода «давно не появлялся» хватает числа дней.
 */
export function insightsForModel(insights: StudentInsights): Record<string, unknown> {
  return {
    works: insights.works,
    average_percent: insights.score.avgPercent,
    graded_works: insights.score.samples,
    trend: insights.score.trend,
    trend_delta: insights.score.trendDelta,
    recent_percents: insights.score.recent.map(r => r.percent),
    returned_works: insights.revisions.returnedWorks,
    max_attempts: insights.revisions.maxAttempts,
    weak_topics: insights.weakTopics.map(t => ({
      topic: t.topic,
      average_percent: t.avgPercent,
      returns: t.returns,
    })),
    // Скачки уровня — для пункта «на что обратить внимание» в черновике.
    // Только числа и название темы: кто именно так прыгнул, модели знать
    // незачем и не из чего.
    level_jumps: insights.levelJumps.map(j => ({
      from_percent: j.fromPercent,
      to_percent: j.toPercent,
      topic: j.topic,
    })),
    days_since_last_trace: insights.activity.silentDays,
  }
}
