/**
 * Состояние ДЗ темы одной строкой — для списков программы курса (§117).
 *
 * До сих пор в строке темы было видно только «Открыта/Закрыта», а есть ли у
 * темы задание — приходилось выяснять, проваливаясь в модалку. Три состояния
 * различаются честно, потому что для преподавателя это три разные ситуации:
 * задания нет вовсе; задание есть, но лежит черновиком и ученику не выдано;
 * задание опубликовано — вот тогда и только тогда осмысленен дедлайн.
 *
 * Функции чистые: данные для них грузятся ОДНИМ запросом на курс (§117), а не
 * запросом на строку — тем 169, и запрос в строке убил бы страницу.
 */

export type TopicHomeworkState = 'none' | 'draft' | 'published'

export interface TopicHomeworkRow {
  topic_id: string
  is_published: boolean
  due_at: string | null
}

export interface TopicHomeworkBadgeInfo {
  state: TopicHomeworkState
  /** Подпись состояния. */
  label: string
  /** Дедлайн — только у опубликованного и только если он задан. */
  dueLabel: string | null
}

/** Человеческая дата дедлайна: «до 14 сентября». Год добавляем, если он не текущий. */
export function formatDueDate(value: string | null | undefined, today: Date = new Date()): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const sameYear = date.getFullYear() === today.getFullYear()
  const text = date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  return `до ${text}`
}

/**
 * Что показать в строке темы.
 *
 * Дедлайн без задания не показываем вовсе, а пустой дедлайн не рисуем
 * прочерком-заглушкой: пустое место честнее, чем «—», которое читается как
 * «данные не загрузились».
 *
 * У темы теоретически может быть несколько строк ДЗ (исторически это не
 * запрещено). Берём опубликованную, если такая есть: для ученика тема уже
 * «с заданием», и показывать «черновик» было бы враньём.
 */
export function describeTopicHomework(
  rows: TopicHomeworkRow[],
  today: Date = new Date(),
): TopicHomeworkBadgeInfo {
  if (rows.length === 0) {
    return { state: 'none', label: 'ДЗ нет', dueLabel: null }
  }

  const published = rows.find(r => r.is_published)
  if (!published) {
    return { state: 'draft', label: 'ДЗ черновик', dueLabel: null }
  }

  return {
    state: 'published',
    label: 'ДЗ',
    dueLabel: formatDueDate(published.due_at, today),
  }
}

/** Группировка одного запроса на курс по темам — чтобы строка ничего не грузила. */
export function groupHomeworkByTopic(rows: TopicHomeworkRow[]): Record<string, TopicHomeworkRow[]> {
  const map: Record<string, TopicHomeworkRow[]> = {}
  for (const row of rows) {
    ;(map[row.topic_id] ??= []).push(row)
  }
  return map
}
