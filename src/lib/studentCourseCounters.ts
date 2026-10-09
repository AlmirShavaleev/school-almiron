/**
 * Счётчики курса глазами ученика: сколько тем ему открыто и сколько домашних
 * заданий он сдал.
 *
 * Зачем отдельный модуль. До §141 главный счётчик считал ЗАДАНИЯ — домашки
 * плюс тесты — по всем темам модуля. Тестов на проде нет ни одного, а ДЗ почти
 * нигде не опубликованы (в физике 11А опубликовано 4 из 164, в математике
 * второй части — ноль), поэтому ученик видел честный, но бессмысленный «0 из
 * 0»: тем-то ему открыто 24. Теперь главное число — темы, а домашние задания
 * идут отдельной строкой.
 *
 * Правило открытости берётся из `isTopicOpen` (§59) и здесь не повторяется:
 * второй источник правды разъехался бы с базой на первом же тумблере темы.
 */
import { isTopicOpen, todayLocal, type TopicOpenState } from '@/lib/topicAvailability'
import type { TopicHwStatus } from '@/lib/studentProgram'
import { pluralTopics } from '@/lib/plural'
import type { TopicGroupKey } from '@/lib/topicProgress'

export interface CountableTopic extends TopicOpenState {
  /** У темы есть домашнее задание, ВИДИМОЕ ученику (RLS прячет черновики). */
  hasHomework: boolean
  hwStatus: TopicHwStatus | null
  /** §280. Задачи к уроку из каталога: всего и закрыто. */
  tasksTotal?: number
  tasksClosed?: number
  /** §280. Группы «Теория»/«Урок», которые у темы есть (по видимым рубрикам). */
  markableGroups?: readonly TopicGroupKey[]
  /** §280. Самоотметки ученика «Отметить как сделанное» по этой теме. */
  marks?: ReadonlySet<TopicGroupKey>
}

export interface CourseCounters {
  /** Темы, открытые ученику прямо сейчас. */
  openTopics: number
  /** Все темы курса или модуля — знаменатель кольца. */
  totalTopics: number
  /** Домашние задания, доступные ученику: тема открыта и задание опубликовано. */
  homeworkAvailable: number
  /** Из них сданные: отправлено на проверку или уже принято. */
  homeworkSubmitted: number
  /** §280. Пройденные темы — числитель кольца. */
  doneTopics: number
  /** §280. Темы, которые можно пройти (открытая пустая заготовка не в счёт) — знаменатель кольца. */
  countedTopics: number
}

export const EMPTY_COUNTERS: CourseCounters = {
  openTopics: 0, totalTopics: 0, homeworkAvailable: 0, homeworkSubmitted: 0, doneTopics: 0, countedTopics: 0,
}

/**
 * Сдано ли задание.
 *
 * `returned` не считаем сданным намеренно: работу вернули на доработку, мяч на
 * стороне ученика, и показывать её в «сдано» значило бы говорить, что дело
 * сделано. `draft` — тем более: он ещё собирает страницы.
 */
export function isHomeworkSubmitted(status: TopicHwStatus | null): boolean {
  return status === 'submitted' || status === 'accepted'
}

/**
 * §280. Пройдена ли тема — то, что считает кольцо и полоска курса.
 *
 * Решение владельца 09.10: раньше кольцо показывало долю ОТКРЫТЫХ тем, и
 * когда открыли весь курс, ученик без единой решённой задачи видел «100% ·
 * Завершён». Теперь тема пройдена, когда сделана работа:
 *   - ДЗ (обычное или автопроверка — та при закрытии всех задач сама ставит
 *     принятую попытку) отправлено или принято;
 *   - задачи к уроку из каталога закрыты все;
 *   - работы нет — отмечено «Отметить как сделанное» во всех группах темы.
 * Возвращает null, если проходить нечего (пустая тема) — такую не считаем.
 */
export function topicCompleted(topic: CountableTopic): boolean | null {
  const work: boolean[] = []
  if (topic.hasHomework) work.push(isHomeworkSubmitted(topic.hwStatus))
  const total = topic.tasksTotal ?? 0
  if (total > 0) work.push((topic.tasksClosed ?? 0) >= total)
  if (work.length > 0) return work.every(Boolean)
  const groups = topic.markableGroups ?? []
  if (groups.length === 0) return null
  return groups.every(g => topic.marks?.has(g) ?? false)
}

export function countTopics(
  topics: readonly CountableTopic[],
  today: string = todayLocal(),
): CourseCounters {
  let openTopics = 0
  let homeworkAvailable = 0
  let homeworkSubmitted = 0
  let doneTopics = 0
  let countedTopics = 0

  for (const topic of topics) {
    const open = isTopicOpen(topic, today)
    // Закрытая тема (её рубрики ученику не видны) всё равно идёт в знаменатель:
    // пройти её ещё предстоит. Открытая пустая — нет: проходить там нечего.
    const completed = open ? topicCompleted(topic) : false
    if (completed !== null) {
      countedTopics += 1
      if (completed) doneTopics += 1
    }
    if (!open) continue
    openTopics += 1
    // Задание закрытой темы ученику недоступно, значит и в знаменатель «сдано
    // из доступных» оно не идёт — иначе строка требовала бы сдать то, чего он
    // ещё не видел.
    if (!topic.hasHomework) continue
    homeworkAvailable += 1
    if (isHomeworkSubmitted(topic.hwStatus)) homeworkSubmitted += 1
  }

  return { openTopics, totalTopics: topics.length, homeworkAvailable, homeworkSubmitted, doneTopics, countedTopics }
}

/** Сумма по модулям — курс считается тем же правилом, что и раздел. */
export function sumCounters(parts: readonly CourseCounters[]): CourseCounters {
  return parts.reduce<CourseCounters>((total, part) => ({
    openTopics: total.openTopics + part.openTopics,
    totalTopics: total.totalTopics + part.totalTopics,
    homeworkAvailable: total.homeworkAvailable + part.homeworkAvailable,
    homeworkSubmitted: total.homeworkSubmitted + part.homeworkSubmitted,
    doneTopics: total.doneTopics + part.doneTopics,
    countedTopics: total.countedTopics + part.countedTopics,
  }), EMPTY_COUNTERS)
}

/** Доля открытых тем — то, что рисует кольцо. */
export function openPercent(counters: CourseCounters): number {
  if (counters.totalTopics === 0) return 0
  return Math.round((counters.openTopics / counters.totalTopics) * 100)
}

/** §280. Доля пройденных тем — то, что рисуют кольцо и полоска. */
export function donePercent(counters: CourseCounters): number {
  if (counters.countedTopics === 0) return 0
  // floor, а не round: 239 из 240 — это ещё не 100%.
  return Math.floor((counters.doneTopics / counters.countedTopics) * 100)
}

/** §280. «Завершён» — только когда пройдены все темы, которые можно пройти. */
export function isCompleted(counters: CourseCounters): boolean {
  return counters.countedTopics > 0 && counters.doneTopics >= counters.countedTopics
}

/**
 * §280. Подпись главного счётчика: «Пройдено 3 из 10 тем». Если открыто не
 * всё — хвост «· открыто 7», чтобы ученик знал, почему остальное недоступно.
 */
export function doneLabel(counters: CourseCounters): string {
  const head = `Пройдено ${counters.doneTopics} из ${pluralTopics(counters.countedTopics)}`
  return counters.openTopics < counters.totalTopics ? `${head} · открыто ${counters.openTopics}` : head
}

/**
 * Подпись строки домашних заданий. Ноль показываем словами, а не пустым
 * местом: «пока нет» — это ответ, пустота — загадка.
 */
export function homeworkLabel(counters: CourseCounters): string {
  if (counters.homeworkAvailable === 0) return 'Домашних заданий пока нет'
  return `Домашние задания: ${counters.homeworkSubmitted} из ${counters.homeworkAvailable} сдано`
}

/**
 * Подпись главного счётчика. Слово «тем», а не «заданий», — считаем темы.
 *
 * Форма слова СКЛОНЯЕТСЯ и согласуется со ВТОРЫМ числом — тем, что стоит с
 * ней рядом. Жёсткое «тем» давало «2 из 2 тем открыто»: с этим ученик и
 * написал через «Сообщить о проблеме» 09.09.
 */
export function topicsLabel(counters: CourseCounters): string {
  return `${counters.openTopics} из ${pluralTopics(counters.totalTopics)} открыто`
}
