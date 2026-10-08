import { safeRpc } from '@/lib/safeRpc'

/**
 * §271. Оценка урока учеником: 1–10 звёзд, без текста.
 *
 * Пишет и читает только RPC (`rate_topic`, `my_topic_rating`,
 * `topic_ratings_summary`): таблица `topic_ratings` закрыта целиком, имён
 * учеников персонал не видит — только сводку по уроку.
 */

export const TOPIC_RATING_MAX = 10

/** Среднее ниже этого — урок помечается «переработать» (решение владельца). */
export const TOPIC_RATING_REWORK_BELOW = 7

export const TOPIC_RATING_PREVIEW_NOTE = 'В предпросмотре оценку не ставят'

/** Оценки 1..10 — для звёзд и распределения. */
export const TOPIC_RATING_VALUES: readonly number[] = Array.from({ length: TOPIC_RATING_MAX }, (_, i) => i + 1)

function isRating(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= TOPIC_RATING_MAX
}

/** Своя оценка урока или null — ещё не оценивал (или функции ещё нет). */
export async function fetchMyTopicRating(topicId: string): Promise<{ rating: number | null; error: string | null }> {
  const { data, error } = await safeRpc('my_topic_rating', { p_topic_id: topicId })
  if (error) return { rating: null, error: error.message }
  return { rating: isRating(data) ? data : null, error: null }
}

/** Поставить или поменять оценку. Ошибка — текстом для ученика. */
export async function rateTopic(topicId: string, rating: number): Promise<{ rating: number | null; error: string | null }> {
  const { data, error } = await safeRpc('rate_topic', { p_topic_id: topicId, p_rating: rating })
  if (error) return { rating: null, error: 'Не удалось сохранить оценку. Попробуйте ещё раз.' }
  const saved = (data as { rating?: unknown } | null)?.rating
  return { rating: isRating(saved) ? saved : rating, error: null }
}

// ── Сводка для персонала ─────────────────────────────────────────────────────

export interface TopicRatingSummary {
  topicId: string
  ratings: number
  avg: number
  /** dist[i] — сколько поставили i + 1 звёзд. Ровно 10 чисел. */
  dist: number[]
  lastAt: string | null
}

export function parseTopicRatingSummary(data: unknown): TopicRatingSummary[] {
  if (!Array.isArray(data)) return []
  const out: TopicRatingSummary[] = []
  for (const raw of data as Array<Record<string, unknown>>) {
    const topicId = typeof raw?.topic_id === 'string' ? raw.topic_id : null
    const ratings = Number(raw?.ratings ?? 0)
    if (!topicId || !(ratings > 0)) continue
    const dist = TOPIC_RATING_VALUES.map((_, i) => {
      const n = Array.isArray(raw.dist) ? Number(raw.dist[i] ?? 0) : 0
      return Number.isFinite(n) ? n : 0
    })
    out.push({
      topicId,
      ratings,
      avg: Number(raw.avg_rating ?? 0),
      dist,
      lastAt: typeof raw.last_at === 'string' ? raw.last_at : null,
    })
  }
  return out
}

export async function fetchTopicRatingsSummary(courseId: string): Promise<{ rows: TopicRatingSummary[]; error: string | null }> {
  const { data, error } = await safeRpc('topic_ratings_summary', { p_course_id: courseId })
  if (error) return { rows: [], error: 'Не удалось загрузить оценки уроков' }
  return { rows: parseTopicRatingSummary(data), error: null }
}

/** Строка таблицы «Оценки уроков»: тема курса + её сводка (или пусто). */
export interface TopicRatingRow {
  topicId: string
  title: string
  moduleTitle: string
  /** Порядок урока в курсе (модуль, затем тема) — для сортировки «по порядку». */
  courseOrder: number
  ratings: number
  avg: number | null
  dist: number[]
  lastAt: string | null
}

interface ModuleLike {
  title: string
  topics: Array<{ id: string; title: string }>
}

/** Модули и темы курса (уже в порядке курса) + сводка → строки таблицы. */
export function buildTopicRatingRows(modules: ModuleLike[], summary: TopicRatingSummary[]): TopicRatingRow[] {
  const byTopic = new Map(summary.map(s => [s.topicId, s]))
  const rows: TopicRatingRow[] = []
  for (const m of modules) {
    for (const t of m.topics) {
      const s = byTopic.get(t.id)
      rows.push({
        topicId: t.id,
        title: t.title,
        moduleTitle: m.title,
        courseOrder: rows.length,
        ratings: s?.ratings ?? 0,
        avg: s ? s.avg : null,
        dist: s?.dist ?? TOPIC_RATING_VALUES.map(() => 0),
        lastAt: s?.lastAt ?? null,
      })
    }
  }
  return rows
}

export type TopicRatingSort = 'worst' | 'course'

/**
 * «Сначала низкие»: оценённые уроки по возрастанию среднего (при равном — у
 * кого больше оценок, тот выше: сигнал надёжнее), неоценённые — в конце в
 * порядке курса. «По порядку курса» — как в программе.
 */
export function sortTopicRatingRows(rows: TopicRatingRow[], sort: TopicRatingSort): TopicRatingRow[] {
  const copy = [...rows]
  if (sort === 'course') return copy.sort((a, b) => a.courseOrder - b.courseOrder)
  return copy.sort((a, b) => {
    if (a.avg == null || b.avg == null) {
      if (a.avg == null && b.avg == null) return a.courseOrder - b.courseOrder
      return a.avg == null ? 1 : -1
    }
    return a.avg - b.avg || b.ratings - a.ratings || a.courseOrder - b.courseOrder
  })
}

/**
 * Сравниваем то, что видно на экране (один знак): иначе 6,95 показалось бы
 * «7,0 · переработать».
 */
export function needsRework(row: Pick<TopicRatingRow, 'avg'>): boolean {
  return row.avg != null && Math.round(row.avg * 10) / 10 < TOPIC_RATING_REWORK_BELOW
}

/** Среднее с одним знаком после запятой: 6,5. */
export function formatTopicRatingAvg(avg: number): string {
  return avg.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
