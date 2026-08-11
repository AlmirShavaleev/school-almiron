/**
 * Массовая публикация ДЗ: что публикуем, что пропускаем и как об этом сказать.
 *
 * Публикация ДЗ — это ВЫДАЧА его ученикам (§58), а не пометка в карточке.
 * Поэтому второго механизма здесь нет: массовое действие делает ровно то же,
 * что кнопка в модалке темы, — переводит `topic_homework.is_published` в true.
 * Уведомления в этом контуре ручные (аккордеон оповещения, §75), триггеров на
 * публикацию у таблицы нет — значит, пачка не может разослать повторных
 * сообщений по уже опубликованным (§116).
 *
 * Функции чистые: они считают план и текст итога, но ничего не пишут.
 */

export type PublishSkipReason = 'already' | 'no_files' | 'no_homework'

export interface PublishableTopic {
  id: string
  title: string
}

export interface PublishableHomework {
  id: string
  topic_id: string
  is_published: boolean
}

export interface PublishSkip {
  topicTitle: string
  reason: PublishSkipReason
}

export interface PublishPlan {
  /** id ДЗ, которые надо опубликовать. */
  publishIds: string[]
  /** Что не тронем и почему — человеку это важнее, чем число. */
  skipped: PublishSkip[]
}

/**
 * План публикации по списку тем.
 *
 * Пропускаем осознанно и с причиной:
 *  - `no_homework` — у темы нет ДЗ вовсе, публиковать нечего;
 *  - `already` — уже опубликовано, повторная выдача ничего не меняет;
 *  - `no_files` — у ДЗ нет ни одного файла. Ровно это условие держит кнопку
 *    публикации в модалке темы: пустое задание ученику показывать нечего, и
 *    массовое действие не имеет права быть добрее одиночного.
 *
 * @param fileCountByHomework сколько файлов у каждого ДЗ; отсутствие ключа
 *        считаем нулём — ошибаться надо в сторону «не публиковать».
 */
export function planHomeworkPublish(
  topics: PublishableTopic[],
  homeworks: PublishableHomework[],
  fileCountByHomework: Record<string, number>,
): PublishPlan {
  const publishIds: string[] = []
  const skipped: PublishSkip[] = []

  for (const topic of topics) {
    const topicHomeworks = homeworks.filter(h => h.topic_id === topic.id)
    if (topicHomeworks.length === 0) {
      skipped.push({ topicTitle: topic.title, reason: 'no_homework' })
      continue
    }

    for (const hw of topicHomeworks) {
      if (hw.is_published) {
        skipped.push({ topicTitle: topic.title, reason: 'already' })
        continue
      }
      if ((fileCountByHomework[hw.id] ?? 0) === 0) {
        skipped.push({ topicTitle: topic.title, reason: 'no_files' })
        continue
      }
      publishIds.push(hw.id)
    }
  }

  return { publishIds, skipped }
}

const SKIP_LABEL: Record<PublishSkipReason, string> = {
  already: 'уже опубликовано',
  no_files: 'нет файлов задания',
  no_homework: 'ДЗ не создано',
}

export function describeSkipReason(reason: PublishSkipReason): string {
  return SKIP_LABEL[reason]
}

/**
 * Итог одной фразой: сколько опубликовано, сколько пропущено и ПОЧЕМУ.
 *
 * Число опубликованных приходит из базы (сколько строк реально изменилось), а
 * не из длины плана: между планом и записью права могли не пустить, и
 * рапортовать надо по факту.
 */
export function describePublishResult(publishedCount: number, skipped: PublishSkip[]): string {
  const head = publishedCount > 0
    ? `Опубликовано ДЗ: ${publishedCount}`
    : 'Публиковать было нечего'

  if (skipped.length === 0) return head

  const byReason = new Map<PublishSkipReason, number>()
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1)

  const tail = [...byReason.entries()]
    .map(([reason, count]) => `${describeSkipReason(reason)} — ${count}`)
    .join(', ')

  return `${head}. Пропущено ${skipped.length}: ${tail}`
}
