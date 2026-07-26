import { sanitizeStorageFileName } from './topicMaterialItems'

/**
 * Чистые помощники для PDF-ДЗ темы.
 *
 * Здесь нет обращений к сети и — намеренно — нет копий правил доступа.
 * Что можно ученику и преподавателю, решают RLS и триггеры
 * (миграция 20260726073913_topic_homework). Функции ниже нужны, чтобы
 * показать понятный статус и не рисовать кнопку, которая заведомо
 * приведёт к отказу базы. Это UX, а не защита.
 */

export const TOPIC_HOMEWORK_BUCKET = 'topic-homework'
export const TOPIC_HOMEWORK_ATTEMPTS_BUCKET = 'topic-homework-attempts'

export type TopicHomeworkAttemptStatus =
  | 'draft'
  | 'submitted'
  | 'returned_for_revision'
  | 'accepted'

export const ATTEMPT_STATUS_LABEL: Record<TopicHomeworkAttemptStatus, string> = {
  draft: 'Черновик',
  submitted: 'Отправлено',
  returned_for_revision: 'На доработке',
  accepted: 'Принято',
}

/**
 * Те же статусы глазами преподавателя. `submitted` для ученика — «Отправлено»,
 * для преподавателя — «На проверке»: это его очередь действий.
 */
export const TEACHER_ATTEMPT_STATUS_LABEL: Record<TopicHomeworkAttemptStatus, string> = {
  draft: 'Черновик',
  submitted: 'На проверке',
  returned_for_revision: 'На доработке',
  accepted: 'Принято',
}

/** Классы бейджа статуса. Порядок ключей совпадает с ходом жизненного цикла. */
export const ATTEMPT_STATUS_TONE: Record<TopicHomeworkAttemptStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-50 text-blue-700',
  returned_for_revision: 'bg-amber-50 text-amber-700',
  accepted: 'bg-emerald-50 text-emerald-700',
}

export interface TopicHomeworkRow {
  id: string
  topic_id: string
  title: string
  instructions: string | null
  is_published: boolean
  due_at: string | null
  grade_scale: 'five' | 'hundred' | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface TopicHomeworkFileRow {
  id: string
  homework_id: string
  storage_path: string
  original_filename: string
  mime_type: string | null
  size_bytes: number | null
  position: number
  created_at: string
}

export interface TopicHomeworkAttemptRow {
  id: string
  homework_id: string
  student_id: string
  attempt_number: number
  status: TopicHomeworkAttemptStatus
  submitted_at: string | null
  created_at: string
  updated_at: string
}

export interface TopicHomeworkAttemptFileRow {
  id: string
  attempt_id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  position: number
  created_at: string
}

export interface TopicHomeworkReviewRow {
  id: string
  attempt_id: string
  reviewer_id: string
  decision: 'accepted' | 'returned_for_revision'
  comment: string | null
  score: number | null
  created_at: string
}

/** Незавершённая попытка: ученик её ещё дособирает или ждёт проверки. */
export function activeAttempt(attempts: TopicHomeworkAttemptRow[]): TopicHomeworkAttemptRow | null {
  return attempts.find(a => a.status === 'draft' || a.status === 'submitted') ?? null
}

export function acceptedAttempt(attempts: TopicHomeworkAttemptRow[]): TopicHomeworkAttemptRow | null {
  return attempts.find(a => a.status === 'accepted') ?? null
}

/**
 * Показывать ли кнопку «Сдать заново».
 *
 * Backend это же правило держит триггером `topic_homework_attempts_guard`
 * и частичными UNIQUE-индексами; здесь мы лишь не показываем кнопку,
 * нажатие которой гарантированно закончится ошибкой.
 */
export function canStartNewAttempt(attempts: TopicHomeworkAttemptRow[]): boolean {
  return !acceptedAttempt(attempts) && !activeAttempt(attempts)
}

/** Попытки от новой к старой — история читается сверху вниз. */
export function attemptsNewestFirst(attempts: TopicHomeworkAttemptRow[]): TopicHomeworkAttemptRow[] {
  return [...attempts].sort((a, b) => b.attempt_number - a.attempt_number)
}

/** Проверять можно только сданную попытку — черновики преподавателю не показываем. */
export function isReviewable(attempt: TopicHomeworkAttemptRow): boolean {
  return attempt.status === 'submitted'
}

export interface StudentSubmission {
  studentId: string
  /** Самая свежая попытка — по ней показывается текущий статус ученика. */
  latest: TopicHomeworkAttemptRow
  /** Предыдущие попытки, от новой к старой. */
  history: TopicHomeworkAttemptRow[]
}

/**
 * Собирает попытки по ученикам для преподавательского списка.
 *
 * Черновики отбрасываются: пока ученик собирает работу, преподавателю там
 * смотреть нечего. Это продуктовое правило, а не защита — RLS всё равно
 * отдаёт преподавателю только его курс, а RPC откажется проверять
 * несданную попытку.
 *
 * Сортировка: сначала те, кто ждёт проверки, потом остальные.
 */
export function groupAttemptsByStudent(attempts: TopicHomeworkAttemptRow[]): StudentSubmission[] {
  const byStudent = new Map<string, TopicHomeworkAttemptRow[]>()
  for (const a of attempts) {
    if (a.status === 'draft') continue
    const list = byStudent.get(a.student_id) ?? []
    list.push(a)
    byStudent.set(a.student_id, list)
  }

  const result: StudentSubmission[] = []
  for (const [studentId, list] of byStudent) {
    const sorted = [...list].sort((a, b) => b.attempt_number - a.attempt_number)
    result.push({ studentId, latest: sorted[0], history: sorted.slice(1) })
  }

  const weight = (s: TopicHomeworkAttemptRow) =>
    s.status === 'submitted' ? 0 : s.status === 'returned_for_revision' ? 1 : 2

  return result.sort((a, b) => {
    const diff = weight(a.latest) - weight(b.latest)
    if (diff !== 0) return diff
    return (b.latest.submitted_at ?? '').localeCompare(a.latest.submitted_at ?? '')
  })
}

/** Последний вердикт по попытке: комментарий преподавателя к возврату. */
export function latestReview(
  reviews: TopicHomeworkReviewRow[],
  attemptId: string,
): TopicHomeworkReviewRow | null {
  const forAttempt = reviews
    .filter(r => r.attempt_id === attemptId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  return forAttempt[0] ?? null
}

function safeName(fileName: string): string {
  // Кириллица в ключе Supabase Storage даёт "Invalid key" — транслитерируем.
  return sanitizeStorageFileName(fileName)
}

/** Путь задания. Первый сегмент — topic_id, на нём держится storage-политика. */
export function buildHomeworkFilePath(topicId: string, fileName: string, now: number = Date.now()): string {
  return `${topicId}/${now}_${safeName(fileName)}`
}

/** Путь работы ученика. Первый сегмент — attempt_id, на нём держится storage-политика. */
export function buildAttemptFilePath(attemptId: string, fileName: string, now: number = Date.now()): string {
  return `${attemptId}/${now}_${safeName(fileName)}`
}

export function formatBytes(bytes: number | null): string | null {
  if (bytes == null) return null
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

export type GradeScale = 'five' | 'hundred'

export const GRADE_SCALE_LABEL: Record<GradeScale, string> = {
  five: '5-балльная',
  hundred: '100-балльная',
}

export function gradeScaleMax(scale: GradeScale | null): number | null {
  if (scale === 'five') return 5
  if (scale === 'hundred') return 100
  return null
}

export function isOverdue(dueAt: string | null, today?: string): boolean {
  if (!dueAt) return false
  const dueDate = dueAt.slice(0, 10)
  const todayDate = today ?? new Date().toLocaleDateString('en-CA')
  return dueDate < todayDate
}

export function formatDue(dueAt: string | null): string | null {
  if (!dueAt) return null
  const date = new Date(dueAt)
  return `до ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
}
