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

/**
 * Что принимаем как файл — и задания от преподавателя, и сдачи ученика:
 * PDF и картинки (фото работы с телефона). Ни бакет, ни RLS тип файла не
 * ограничивают — это чисто подсказка для системного пикера (на мобильном
 * с image/* обычно предлагает камеру наравне с галереей).
 */
export const HOMEWORK_FILE_ACCEPT = 'application/pdf,image/*'

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

/** Что ученик вправе приложить к работе: PDF и любые картинки. */
export function isAcceptedHomeworkFile(file: File): boolean {
  const type = (file.type || '').toLowerCase()
  if (type === 'application/pdf' || type.startsWith('image/')) return true
  // Некоторые браузеры и Android-галереи отдают пустой type — судим по имени.
  return /\.(pdf|png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(file.name)
}

/**
 * Скриншот из буфера обмена приходит без осмысленного имени — обычно
 * «image.png», а при вставке нескольких подряд все они называются одинаково.
 * Даём человекочитаемое имя с номером: в списке приложенного видно, что это
 * разные снимки. (Коллизий в Storage и так нет — buildAttemptFilePath
 * добавляет к пути метку времени.)
 */
export function namePastedFile(file: File, index: number): File {
  const looksGeneric = !file.name || /^image\.\w+$/i.test(file.name)
  if (!looksGeneric) return file
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
  return new File([file], `Снимок экрана ${index + 1}.${ext}`, { type: file.type })
}

/**
 * Разделяет выбранное на «можно приложить» и «нельзя». Отдельная чистая
 * функция, потому что источников теперь три — кнопка выбора, перетаскивание
 * и вставка из буфера, — и правило отбора у них обязано быть одним.
 */
export function splitHomeworkFiles(files: File[]): { accepted: File[]; rejected: File[] } {
  const accepted: File[] = []
  const rejected: File[] = []
  for (const f of files) (isAcceptedHomeworkFile(f) ? accepted : rejected).push(f)
  return { accepted, rejected }
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
  // due_at — календарная дата (тип date), а не момент времени. `new Date(str)`
  // трактует и 'YYYY-MM-DD', и метку с 'Z' как UTC, поэтому в поясах восточнее
  // Гринвича (например, у владельца — Москва, UTC+3) '2026-08-01T23:59:59Z'
  // уезжал бы на «2 августа». Берём только дату и собираем локальную полночь —
  // день дедлайна одинаков в любом часовом поясе.
  const [y, m, d] = dueAt.slice(0, 10).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `до ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
}

export type DueUrgencyLevel = 'none' | 'calm' | 'soon' | 'overdue'

export interface DueUrgency {
  level: DueUrgencyLevel
  days: number
}

/**
 * Категоризирует срок выполнения для отображения баннера.
 *
 * Дни считаются по локальной полуночи: если дедлайн 10 августа,
 * то сегодня (9 августа) до него остаётся 1 день.
 *
 * @param dueAt строка даты в формате YYYY-MM-DD, или null
 * @param today опциональная текущая дата (для тестов); по умолчанию берётся сегодня
 * @returns объект с уровнем срочности и количеством дней
 */
export function dueUrgency(dueAt: string | null, today?: string): DueUrgency {
  if (!dueAt) return { level: 'none', days: 0 }

  // Получаем локальную дату сегодня в формате YYYY-MM-DD
  const todayDate = today ?? new Date().toLocaleDateString('en-CA')
  const dueDate = dueAt.slice(0, 10)

  // Вычисляем разницу в днях
  const todayMs = new Date(todayDate).getTime()
  const dueMs = new Date(dueDate).getTime()
  const diffMs = dueMs - todayMs
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000))

  // Категоризируем по количеству дней
  if (days > 3) return { level: 'calm', days }
  if (days >= 0) return { level: 'soon', days }
  return { level: 'overdue', days: Math.abs(days) }
}

/**
 * Имя для картинки, вставленной из буфера обмена.
 *
 * Скриншоты приходят безымянными или как `image.png` / «Снимок экрана…» —
 * то есть все одинаковые. В списке файлов ДЗ это стопка неразличимых строк,
 * поэтому подставляем читаемое имя со временем. Файл, у которого имя
 * осмысленное (скопировали из проводника), не трогаем.
 *
 * `now` и `index` — параметры, чтобы функция была чистой и тестируемой:
 * index различает несколько картинок из одной вставки.
 */
export function nameForPastedImage(fileName: string, mimeType: string, index = 0, now: Date = new Date()): string {
  if (fileName && !/^(image|снимок экрана)[.\s]/i.test(fileName)) return fileName

  const ext = (mimeType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png'
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  const suffix = index > 0 ? `-${index + 1}` : ''
  return `screenshot-${stamp}${suffix}.${ext}`
}
