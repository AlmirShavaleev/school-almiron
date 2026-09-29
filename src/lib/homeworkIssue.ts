/**
 * §243. «Тема открыта = ДЗ выдано»: что показать учителю вместо кнопки
 * «Опубликовать».
 *
 * Выдаёт ДЗ сервер (PENDING_243: триггеры на тему и файлы задания + крон по
 * дате), учитель флаг не пишет. Здесь — ТОЛЬКО показ, тем же правилом, что у
 * сервера (`_topic_homework_autopublish`):
 *   тема открыта (`topic_open_now` — зеркало `isTopicOpen`)
 *   и есть файл задания либо это работа по времени (у неё условие часто
 *   рубрикой, и кнопка §240 выдавала её без файла).
 * Каркас не выдаётся вовсе: учеников в нём нет, ДЗ выдаётся в классах.
 *
 * Статус считается из состояния темы, а не из `is_published` строки: флаг
 * ставит триггер в той же транзакции, что и загрузку файла, но локальная
 * строка в окне темы после загрузки не перечитывается — вывод «из правила»
 * совпадает с тем, что уже записала база.
 */
import { isTopicOpen, todayLocal, willOpenByDate, type TopicOpenState } from '@/lib/topicAvailability'

export type HomeworkIssueState = 'issued' | 'closed' | 'no_files' | 'template'

export interface HomeworkIssueInfo {
  state: HomeworkIssueState
  /** Текст плашки. */
  label: string
  /** Пояснение рядом с плашкой (или null). */
  note: string | null
}

/** «6 октября» из YYYY-MM-DD — без сдвига часового пояса. */
function dayMonth(day: string): string {
  return new Date(day + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function homeworkIssueStatus(input: {
  topic: TopicOpenState
  fileCount: number
  timed: boolean
  isTemplate?: boolean
  today?: string
}): HomeworkIssueInfo {
  const today = input.today ?? todayLocal()
  if (input.isTemplate) {
    return { state: 'template', label: 'Шаблон · ДЗ выдаётся в классах', note: 'В классе ДЗ выдаётся само, когда там откроется тема.' }
  }
  if (!isTopicOpen(input.topic, today)) {
    const day = willOpenByDate(input.topic, today)
    return { state: 'closed', label: 'Не выдано · тема закрыта', note: day ? `откроется ${dayMonth(day)}` : null }
  }
  if (!input.timed && input.fileCount === 0) {
    return { state: 'no_files', label: 'Нет файлов задания', note: 'ученик увидит ДЗ, когда добавишь файл' }
  }
  return { state: 'issued', label: 'Выдано · тема открыта', note: null }
}

/**
 * «Сводка ученикам уйдёт в 14:55» — время по Москве, как считает сервер
 * (`topic_homework_digest_due_at`). Не сегодня по Москве — «завтра в 08:00»
 * или дата.
 */
export function describeDigestEta(dueAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!dueAt) return null
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return null
  // Срок прошёл, а строка ещё ждёт: крон ходит раз в 5 минут.
  if (due.getTime() <= now.getTime()) return 'Сводка ученикам уйдёт в ближайшие минуты'
  const mskDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
  const time = due.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
  const dueDay = mskDay(due)
  const today = mskDay(now)
  const tomorrow = mskDay(new Date(now.getTime() + 86400e3))
  if (dueDay === today) return `Сводка ученикам уйдёт в ${time}`
  if (dueDay === tomorrow) return `Сводка ученикам уйдёт завтра в ${time}`
  return `Сводка ученикам уйдёт ${dayMonth(dueDay)} в ${time}`
}
