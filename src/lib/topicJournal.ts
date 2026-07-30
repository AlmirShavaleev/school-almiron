/**
 * Журнал ученика по новому контуру: ДЗ тем и тесты тем.
 *
 * Источник — RPC `get_student_topic_journal` (миграция 20260727151836).
 * Права проверяет она сама (сам ученик / admin|owner / преподаватель группы),
 * фронт их не дублирует. Здесь только типы и чистые преобразования для UI.
 */

import type { GradeScale } from './topicHomework'

export type JournalHwStatus = 'not_started' | 'draft' | 'submitted' | 'returned' | 'accepted'
export type JournalTestStatus = 'not_started' | 'in_progress' | 'completed'

export interface TopicJournalHomework {
  homework_id:    string
  title:          string
  topic_id:       string
  topic_title:    string
  module_title:   string | null
  course_id:      string
  course_title:   string
  due_at:         string | null
  grade_scale:    GradeScale | null
  status:         JournalHwStatus
  score:          number | null
  comment:        string | null
  submitted_at:   string | null
  reviewed_at:    string | null
  attempts_count: number
  is_overdue:     boolean
}

export interface TopicJournalTest {
  assignment_id: string
  test_id:       string
  test_title:    string
  topic_id:      string
  topic_title:   string
  course_id:     string
  course_title:  string
  status:        JournalTestStatus
  total_points:  number | null
  max_points:    number | null
  percent:       number | null
  started_at:    string | null
  completed_at:  string | null
}

export interface TopicJournalSummary {
  hw_total:          number
  hw_accepted:       number
  hw_submitted:      number
  hw_returned:       number
  hw_pending:        number
  hw_overdue:        number
  avg_score_five:    number | null
  avg_score_hundred: number | null
  tests_total:       number
  tests_completed:   number
  tests_avg_percent: number | null
}

export interface TopicJournal {
  homework: TopicJournalHomework[]
  tests:    TopicJournalTest[]
  summary:  TopicJournalSummary
}

export const EMPTY_SUMMARY: TopicJournalSummary = {
  hw_total: 0, hw_accepted: 0, hw_submitted: 0, hw_returned: 0, hw_pending: 0, hw_overdue: 0,
  avg_score_five: null, avg_score_hundred: null,
  tests_total: 0, tests_completed: 0, tests_avg_percent: null,
}

/**
 * RPC отдаёт NULL, когда вызывающему журнал не положен, и может отдать
 * jsonb без части ключей — нормализуем один раз на границе данных, чтобы
 * компоненты работали с массивами, а не с «может быть null».
 */
export function normalizeTopicJournal(raw: unknown): TopicJournal | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Partial<TopicJournal>
  return {
    homework: Array.isArray(data.homework) ? data.homework : [],
    tests: Array.isArray(data.tests) ? data.tests : [],
    summary: { ...EMPTY_SUMMARY, ...(data.summary ?? {}) },
  }
}

export const JOURNAL_HW_STATUS_LABEL: Record<JournalHwStatus, string> = {
  not_started: 'Не сдано',
  draft: 'Черновик',
  submitted: 'На проверке',
  returned: 'На доработке',
  accepted: 'Принято',
}

export const JOURNAL_HW_STATUS_TONE: Record<JournalHwStatus, string> = {
  not_started: 'bg-gray-100 text-gray-600 border-gray-200',
  draft: 'bg-sky-50 text-sky-700 border-sky-200',
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  returned: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

export const JOURNAL_TEST_STATUS_LABEL: Record<JournalTestStatus, string> = {
  not_started: 'Не пройден',
  in_progress: 'Начат',
  completed: 'Пройден',
}

export const JOURNAL_TEST_STATUS_TONE: Record<JournalTestStatus, string> = {
  not_started: 'bg-gray-100 text-gray-600 border-gray-200',
  in_progress: 'bg-sky-50 text-sky-700 border-sky-200',
  completed: 'bg-indigo-50 text-indigo-700 border-indigo-200',
}

/** Оценка за ДЗ в виде «4 / 5». NULL, если шкалы нет или балл не выставлен. */
export function formatHomeworkScore(row: Pick<TopicJournalHomework, 'score' | 'grade_scale'>): string | null {
  if (row.score == null) return null
  const max = row.grade_scale === 'five' ? 5 : row.grade_scale === 'hundred' ? 100 : null
  return max == null ? String(row.score) : `${row.score} / ${max}`
}

/** Список курсов журнала — для фильтра. Порядок стабильный: как встретились. */
export function journalCourses(journal: TopicJournal): { id: string; title: string }[] {
  const seen = new Map<string, string>()
  for (const h of journal.homework) if (!seen.has(h.course_id)) seen.set(h.course_id, h.course_title)
  for (const t of journal.tests) if (!seen.has(t.course_id)) seen.set(t.course_id, t.course_title)
  return [...seen].map(([id, title]) => ({ id, title }))
}

/** ДЗ, которое ждёт действия ученика: не начато, черновик или возвращено. */
export function needsAction(row: TopicJournalHomework): boolean {
  return row.status === 'not_started' || row.status === 'draft' || row.status === 'returned'
}

export interface HomeworkBuckets {
  /** Нужно сделать: не начато / черновик / возвращено. Просроченные — первыми. */
  todo: TopicJournalHomework[]
  /** Сдано, ждёт вердикта. */
  awaiting: TopicJournalHomework[]
  /** Принято. Свежепроверенные сверху. */
  done: TopicJournalHomework[]
}

/** Просроченное вперёд, затем по дедлайну; работы без срока — в конец. */
function byDue(a: TopicJournalHomework, b: TopicJournalHomework): number {
  if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1
  if (!a.due_at && !b.due_at) return 0
  if (!a.due_at) return 1
  if (!b.due_at) return -1
  return a.due_at.localeCompare(b.due_at)
}

function byReviewedDesc(a: TopicJournalHomework, b: TopicJournalHomework): number {
  return (b.reviewed_at ?? '').localeCompare(a.reviewed_at ?? '')
}

/**
 * Раскладка ДЗ для страницы «Домашние задания» ученика.
 *
 * Чистая функция, а не часть хука: именно порядок внутри корзин легко сломать
 * (просрочка должна быть выше близкого дедлайна), и проверять это удобнее
 * напрямую. Сортировка не мутирует вход.
 */
export function splitHomeworkBuckets(rows: TopicJournalHomework[]): HomeworkBuckets {
  return {
    todo: rows.filter(needsAction).slice().sort(byDue),
    awaiting: rows.filter(r => r.status === 'submitted').slice().sort(byDue),
    done: rows.filter(r => r.status === 'accepted').slice().sort(byReviewedDesc),
  }
}

export function filterByCourse(journal: TopicJournal, courseId: string | null): TopicJournal {
  if (!courseId) return journal
  return {
    homework: journal.homework.filter(h => h.course_id === courseId),
    tests: journal.tests.filter(t => t.course_id === courseId),
    summary: journal.summary,
  }
}
