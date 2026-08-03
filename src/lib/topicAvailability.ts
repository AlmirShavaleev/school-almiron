/**
 * Открытость темы на стороне клиента — зеркало SQL-функции `topic_open_now`.
 *
 * Правило одно и то же в обоих местах, и это принципиально: доступ закрывает
 * база (RLS через `course_student_can_see_topic`), а здесь решается только
 * ПОКАЗ — серая карточка, подпись, замок. Если два правила разъедутся, ученик
 * увидит открытую с виду тему с пустыми материалами, и разбираться в этом
 * придётся по логам, а не глазами.
 *
 * До появления тумблера расчёт «закрыта ли тема» был переписан руками в трёх
 * местах интерфейса (две карточки ученика и плашка в программе). Отсюда файл:
 * дальше правило меняется в одном месте.
 */

export interface TopicOpenState {
  /** null — решает дата; true/false — решение преподавателя, дата не действует. */
  is_open: boolean | null
  /** YYYY-MM-DD либо ISO-строка; сравнивается по локальной дате. */
  available_from: string | null
}

/** Сегодня как YYYY-MM-DD по ЛОКАЛЬНОЙ дате — без сдвига в UTC. */
export function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA')
}

/** Дата открытия в виде YYYY-MM-DD, если она вообще задана. */
export function availableFromDay(topic: TopicOpenState): string | null {
  return topic.available_from ? topic.available_from.slice(0, 10) : null
}

/**
 * Открыта ли тема прямо сейчас.
 *
 * `coalesce(is_open, дата пуста или наступила)` — ровно то же выражение, что
 * и в `topic_open_now`.
 */
export function isTopicOpen(topic: TopicOpenState, today: string = todayLocal()): boolean {
  if (topic.is_open !== null && topic.is_open !== undefined) return topic.is_open
  const day = availableFromDay(topic)
  return day === null || day <= today
}

/** Тема живёт по дате, а не по решению преподавателя. */
export function isDateAutomation(topic: TopicOpenState): boolean {
  return topic.is_open === null || topic.is_open === undefined
}

/**
 * Сработает ли дата в будущем сама.
 *
 * Только при автоматике: у темы с тумблером дата не действует, и обещать
 * ученику «откроется 1 сентября» было бы враньём.
 */
export function willOpenByDate(topic: TopicOpenState, today: string = todayLocal()): string | null {
  if (!isDateAutomation(topic)) return null
  const day = availableFromDay(topic)
  return day !== null && day > today ? day : null
}

/**
 * Подпись под закрытой темой для ученика.
 *
 * Дату показываем, только если она действительно откроет тему сама. В
 * остальных случаях честнее неопределённое «откроется позже», чем число,
 * которое ничего не значит.
 */
/**
 * Короткая подпись для тумблера в строке списка: «Открыта» / «Закрыта» /
 * «Откроется 1.09».
 *
 * Дату показываем только когда она действительно откроет тему сама — то же
 * условие, что и в `topicClosedLabel`, просто формат компактнее: в строке
 * таблицы «1 сентября» не помещается.
 */
export function topicToggleLabel(topic: TopicOpenState, today: string = todayLocal()): string {
  if (isTopicOpen(topic, today)) return 'Открыта'
  const day = willOpenByDate(topic, today)
  if (!day) return 'Закрыта'
  const [, m, d] = day.split('-')
  return `Откроется ${Number(d)}.${m}`
}

export function topicClosedLabel(topic: TopicOpenState, today: string = todayLocal()): string {
  const day = willOpenByDate(topic, today)
  if (!day) return 'Откроется позже'
  // Формат тот же, что был у карточек ученика до тумблера: «Откроется 1 сентября».
  const asDate = new Date(day + 'T00:00:00')
  return `Откроется ${asDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
}
