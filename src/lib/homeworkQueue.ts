/**
 * Чистые помощники общей очереди проверки ДЗ.
 *
 * Очередь — это все сданные (`submitted`) попытки по всем темам курсов
 * преподавателя. Кто именно видит попытки, решает RLS (те же политики, что
 * кормят проверку внутри темы); здесь только формирование и порядок списка.
 */
import type { TopicHomeworkAttemptRow } from '@/lib/topicHomework'

/** Строка очереди: попытка + контекст (ДЗ → тема → курс), пришедший из join'а. */
export interface QueueRow {
  attempt: TopicHomeworkAttemptRow
  homeworkId: string
  homeworkTitle: string
  gradeScale: 'five' | 'hundred' | null
  /** Срок сдачи ДЗ — нужен, чтобы отметить в списке опоздавших. */
  dueAt: string | null
  topicId: string
  topicTitle: string
  courseId: string
  courseTitle: string
}

/**
 * Работу уже проверил кто-то другой.
 *
 * `topic_homework_review_attempt` меняет статус только `where status =
 * 'submitted'` и, не найдя строки, падает с «Попытка не в статусе "сдано"».
 * Это и есть защита от двойного вердикта: второй проверяющий не перезапишет
 * решение первого. Опознаём этот случай по тексту, потому что своего кода
 * ошибки у него нет — а отличать его надо, иначе преподаватель получит
 * непонятную техническую фразу вместо объяснения.
 */
export function isAlreadyReviewedError(error: unknown): boolean {
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error ?? '')
  return message.includes('не в статусе')
}

/**
 * Сдано ли позже срока. Сравниваем именно момент СДАЧИ с дедлайном, а не
 * «сейчас» с дедлайном: работа уже сдана, и для преподавателя важно, опоздал
 * ли ученик, а не сколько времени прошло с тех пор.
 */
export function isSubmittedLate(row: QueueRow): boolean {
  const { dueAt } = row
  const submittedAt = row.attempt.submitted_at
  if (!dueAt || !submittedAt) return false
  return new Date(submittedAt).getTime() > new Date(dueAt).getTime()
}

/**
 * Разворачивает ответ PostgREST с вложенными join'ами в плоскую строку.
 * Строки с неполным контекстом (оборванный join) отбрасываются, чтобы одна
 * битая запись не роняла всю очередь.
 */
export function toQueueRows(raw: unknown[]): QueueRow[] {
  const rows: QueueRow[] = []
  for (const item of raw as any[]) {
    const hw = item?.homework
    const topic = hw?.topic
    const course = topic?.module?.course
    if (!hw?.id || !topic?.id || !course?.id) continue
    const { homework: _hw, ...attempt } = item
    rows.push({
      attempt: attempt as TopicHomeworkAttemptRow,
      homeworkId: hw.id,
      homeworkTitle: hw.title ?? 'Домашнее задание',
      gradeScale: hw.grade_scale ?? null,
      dueAt: hw.due_at ?? null,
      topicId: topic.id,
      topicTitle: topic.title ?? 'Тема',
      courseId: course.id,
      courseTitle: course.title ?? 'Курс',
    })
  }
  return rows
}

/**
 * Порядок очереди: кто дольше ждёт — тот выше. Так преподаватель разгребает
 * хвост честно, а не только свежие сдачи.
 */
export function sortQueue(rows: QueueRow[]): QueueRow[] {
  return [...rows].sort((a, b) =>
    (a.attempt.submitted_at ?? '').localeCompare(b.attempt.submitted_at ?? ''),
  )
}

/**
 * Группировка по дню сдачи.
 *
 * День берём по локальному времени преподавателя, а не по UTC: работа, сданная
 * в 23:30 по Москве, для него сдана сегодня, и в списке она должна стоять под
 * сегодняшним числом. Ключ — YYYY-MM-DD из локальных частей даты, потому что
 * `toISOString()` пересчитал бы в UTC и увёл вечерние сдачи в следующий день.
 */
export function groupByDay(rows: QueueRow[]): Array<{ dayKey: string; label: string; rows: QueueRow[] }> {
  const groups = new Map<string, { dayKey: string; label: string; rows: QueueRow[] }>()
  for (const row of rows) {
    const raw = row.attempt.submitted_at
    const date = raw ? new Date(raw) : null
    const valid = date && !Number.isNaN(date.getTime())
    const dayKey = valid ? localDayKey(date) : 'unknown'
    const label = valid
      ? date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'Без даты сдачи'
    const g = groups.get(dayKey) ?? { dayKey, label, rows: [] }
    g.rows.push(row)
    groups.set(dayKey, g)
  }
  return Array.from(groups.values())
}

function localDayKey(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

/**
 * Курсы, встречающиеся в очереди, со счётчиком работ. Именно из очереди, а не
 * из всего списка курсов: выпадающий список, где половина пунктов ничего не
 * фильтрует, только мешает.
 */
export function courseFilterOptions(rows: QueueRow[]): Array<{ id: string; title: string; count: number }> {
  const map = new Map<string, { id: string; title: string; count: number }>()
  for (const row of rows) {
    const item = map.get(row.courseId) ?? { id: row.courseId, title: row.courseTitle, count: 0 }
    item.count += 1
    map.set(row.courseId, item)
  }
  return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}

/** Группировка по курсу для заголовков секций; порядок внутри — как в очереди. */
export function groupByCourse(rows: QueueRow[]): Array<{ courseId: string; courseTitle: string; rows: QueueRow[] }> {
  const groups = new Map<string, { courseId: string; courseTitle: string; rows: QueueRow[] }>()
  for (const row of rows) {
    const g = groups.get(row.courseId) ?? { courseId: row.courseId, courseTitle: row.courseTitle, rows: [] }
    g.rows.push(row)
    groups.set(row.courseId, g)
  }
  return Array.from(groups.values())
}
