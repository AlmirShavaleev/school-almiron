/**
 * §221. Пробник как урок в курсе — чистая логика экрана.
 *
 * Время здесь ничего не решает: что принять, а что нет, решает база по
 * своему now() (PENDING_221.sql). Экран получает от базы и границы окна, и
 * её же «сейчас» (`server_now`) и считает таймер от смещения часов — так
 * переведённые часы на телефоне меняют только отображение, но не правила.
 */
import { sanitizeStorageFileName } from '@/lib/topicMaterialItems'

export const MOCK_EXAMS_BUCKET = 'mock-exams'

/** Строка `my_mock_exams(group)` — пробник в программе курса. */
export interface MockLessonListRow {
  id: string
  title: string
  module_id: string
  module_position: number
  starts_at: string
  ends_at: string
  photos_until: string
  submitted_at: string | null
  has_work: boolean
  notified: boolean
  server_now: string
}

export interface MockLessonPhoto {
  id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  position: number
  created_at: string
}

/** Ответ `my_mock_exam(exam)` — страница пробника у ученика. Ключа здесь нет. */
export interface MockLessonState {
  id: string
  title: string
  group_id: string | null
  /** Свой id ученика — для пути фото в бакете. */
  student_id: string
  template_title: string | null
  task_count: number
  part1_last: number
  part2_max: number[]
  starts_at: string | null
  ends_at: string | null
  photos_until: string | null
  server_now: string
  condition_path: string | null
  answers: (string | null)[]
  submitted_at: string | null
  updated_at: string | null
  notified: boolean
  photos: MockLessonPhoto[]
}

export interface MockLessonResultTask {
  n: number
  max: number
  points: number | null
  answer: string | null
  correct: string | null
}

/** Ответ `my_mock_exam_result(exam)`: до «Уведомить» — только `pending`. */
export type MockLessonResult =
  | { status: 'pending' }
  | {
    status: 'ready'
    title: string
    notified_at: string
    score: number | null
    max_score: number | null
    primary_score: number | null
    part1_score: number | null
    part2_score: number | null
    part1_last: number
    solution_path: string | null
    tasks: MockLessonResultTask[]
  }

export type MockLessonStatus =
  /** До начала. */
  | 'upcoming'
  /** Идёт, работа не сдана. */
  | 'open'
  /** Сдана, фото ещё можно догрузить. */
  | 'submitted'
  /** Время вышло без сдачи, фото ещё можно догрузить. */
  | 'time_up'
  /** Всё закрыто, работа у преподавателя. */
  | 'checking'
  /** Всё закрыто, работы нет. */
  | 'missed'
  /** Результат отправлен. */
  | 'result'

interface StatusInput {
  starts_at: string | null
  ends_at: string | null
  photos_until: string | null
  submitted_at: string | null
  has_work: boolean
  notified: boolean
}

/** Где пробник сейчас — по серверному «сейчас», переданному снаружи. */
export function lessonStatus(e: StatusInput, nowMs: number): MockLessonStatus {
  if (e.notified) return 'result'
  const starts = ms(e.starts_at)
  const ends = ms(e.ends_at)
  const until = ms(e.photos_until)
  if (starts == null || ends == null || until == null) return 'upcoming'
  if (nowMs < starts) return 'upcoming'
  if (nowMs < ends && !e.submitted_at) return 'open'
  if (nowMs < until) return e.submitted_at ? 'submitted' : 'time_up'
  return e.has_work || e.submitted_at ? 'checking' : 'missed'
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Смещение часов устройства от часов базы. Прибавляется к `Date.now()`:
 * `serverNow = Date.now() + offset`.
 */
export function clockOffset(serverNowIso: string, clientNowMs: number): number {
  const s = ms(serverNowIso)
  return s == null ? 0 : s - clientNowMs
}

/** «2:47:15» — сколько осталось; отрицательное — «0:00:00». */
export function formatCountdown(leftMs: number): string {
  const total = Math.max(0, Math.floor(leftMs / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** «2 ч 47 мин» — для строки в программе курса, где секунды мешают. */
export function formatLeftShort(leftMs: number): string {
  const mins = Math.max(0, Math.ceil(leftMs / 60000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m} мин`
}

const MSK = 'Europe/Moscow'

/** «14:00» по Москве: школа живёт по московскому времени. */
export function mskTime(iso: string | null | undefined): string {
  const t = ms(iso)
  if (t == null) return '—'
  return new Date(t).toLocaleTimeString('ru-RU', { timeZone: MSK, hour: '2-digit', minute: '2-digit' })
}

/** «18.10» по Москве. */
export function mskDay(iso: string | null | undefined): string {
  const t = ms(iso)
  if (t == null) return '—'
  return new Date(t).toLocaleDateString('ru-RU', { timeZone: MSK, day: '2-digit', month: '2-digit' })
}

/** «18 октября» по Москве. */
export function mskDayLong(iso: string | null | undefined): string {
  const t = ms(iso)
  if (t == null) return '—'
  return new Date(t).toLocaleDateString('ru-RU', { timeZone: MSK, day: 'numeric', month: 'long' })
}

/**
 * Значение для `<input type="datetime-local">` — московское время пробника.
 * Москва без перехода на летнее время с 2014 года: UTC+3 круглый год.
 */
export function toMskInput(iso: string | null | undefined): string {
  const t = ms(iso)
  if (t == null) return ''
  const d = new Date(t + 3 * 3600 * 1000)
  return d.toISOString().slice(0, 16)
}

/** Обратно: «2026-10-18T10:00» (по Москве) → ISO. Пусто или мусор — null. */
export function fromMskInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const t = new Date(`${value}:00+03:00`).getTime()
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Подпись состояния для строки в программе курса. */
export function lessonStatusLabel(e: StatusInput, nowMs: number): string {
  const st = lessonStatus(e, nowMs)
  switch (st) {
    case 'upcoming': return `откроется ${mskDay(e.starts_at)} в ${mskTime(e.starts_at)}`
    case 'open': return `идёт, осталось ${formatLeftShort((ms(e.ends_at) ?? nowMs) - nowMs)}`
    case 'submitted': return 'сдан'
    case 'time_up': return 'время вышло'
    case 'checking': return 'на проверке'
    case 'missed': return 'не сдан'
    case 'result': return 'результат'
  }
}

/**
 * Номера пустых ответов бланка — для подтверждения «пустой №9 засчитается
 * как нерешённый». Пробелы — тоже пусто: база их так же обрезает.
 */
export function emptyAnswers(answers: (string | null | undefined)[], count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) if (!(answers[i] ?? '').trim()) out.push(i + 1)
  return out
}

/**
 * Ключ, вставленный из Excel: строкой (через табы) или столбцом (через
 * переводы строк). Пробел внутри ответа — не разделитель: у ЕГЭ бывают
 * ответы из двух чисел. Лишнее сверх числа полей отбрасывается и считается,
 * недостающее — пусто.
 */
export function parseKeyPaste(text: string, count: number): { answers: string[]; extra: number } | null {
  const raw = text.replace(/\r/g, '')
  if (!/[\t\n]/.test(raw.replace(/\n+$/, ''))) return null
  const cells = raw.replace(/\n+$/, '').split(/[\t\n]/).map(c => c.trim())
  const answers = Array.from({ length: count }, (_, i) => cells[i] ?? '')
  return { answers, extra: Math.max(0, cells.length - count) }
}

/**
 * Пробники среди тем раздела: пробник идёт после последней темы с
 * `order_index <= module_position` — то же правило, что в комментарии к
 * колонке в PENDING_221.sql. Порядок тем не меняется.
 */
export function placeInModule<T extends { order_index: number }, E extends { module_position: number; starts_at: string }>(
  topics: T[],
  exams: E[],
): ({ kind: 'topic'; topic: T } | { kind: 'exam'; exam: E })[] {
  const sortedExams = exams.slice().sort((a, b) => a.module_position - b.module_position || a.starts_at.localeCompare(b.starts_at))
  const out: ({ kind: 'topic'; topic: T } | { kind: 'exam'; exam: E })[] = []
  let k = 0
  for (const topic of topics) {
    while (k < sortedExams.length && sortedExams[k].module_position < topic.order_index) {
      out.push({ kind: 'exam', exam: sortedExams[k++] })
    }
    out.push({ kind: 'topic', topic })
  }
  while (k < sortedExams.length) out.push({ kind: 'exam', exam: sortedExams[k++] })
  return out
}

/** Путь фото второй части: второй и третий сегменты держат политику бакета. */
export function mockPhotoPath(examId: string, studentId: string, fileName: string, now: number = Date.now()): string {
  return `${examId}/photos/${studentId}/${now}_${sanitizeStorageFileName(fileName)}`
}

/** Путь условия или решения. */
export function mockExamFilePath(examId: string, kind: 'condition' | 'solution', fileName: string, now: number = Date.now()): string {
  return `${examId}/${kind}/${now}_${sanitizeStorageFileName(fileName)}`
}
