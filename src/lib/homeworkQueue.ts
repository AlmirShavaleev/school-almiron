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
  topicId: string
  topicTitle: string
  courseId: string
  courseTitle: string
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
