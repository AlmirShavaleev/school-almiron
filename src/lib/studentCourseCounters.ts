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

export interface CountableTopic extends TopicOpenState {
  /** У темы есть домашнее задание, ВИДИМОЕ ученику (RLS прячет черновики). */
  hasHomework: boolean
  hwStatus: TopicHwStatus | null
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
}

export const EMPTY_COUNTERS: CourseCounters = {
  openTopics: 0, totalTopics: 0, homeworkAvailable: 0, homeworkSubmitted: 0,
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

export function countTopics(
  topics: readonly CountableTopic[],
  today: string = todayLocal(),
): CourseCounters {
  let openTopics = 0
  let homeworkAvailable = 0
  let homeworkSubmitted = 0

  for (const topic of topics) {
    if (!isTopicOpen(topic, today)) continue
    openTopics += 1
    // Задание закрытой темы ученику недоступно, значит и в знаменатель «сдано
    // из доступных» оно не идёт — иначе строка требовала бы сдать то, чего он
    // ещё не видел.
    if (!topic.hasHomework) continue
    homeworkAvailable += 1
    if (isHomeworkSubmitted(topic.hwStatus)) homeworkSubmitted += 1
  }

  return { openTopics, totalTopics: topics.length, homeworkAvailable, homeworkSubmitted }
}

/** Сумма по модулям — курс считается тем же правилом, что и раздел. */
export function sumCounters(parts: readonly CourseCounters[]): CourseCounters {
  return parts.reduce<CourseCounters>((total, part) => ({
    openTopics: total.openTopics + part.openTopics,
    totalTopics: total.totalTopics + part.totalTopics,
    homeworkAvailable: total.homeworkAvailable + part.homeworkAvailable,
    homeworkSubmitted: total.homeworkSubmitted + part.homeworkSubmitted,
  }), EMPTY_COUNTERS)
}

/** Доля открытых тем — то, что рисует кольцо. */
export function openPercent(counters: CourseCounters): number {
  if (counters.totalTopics === 0) return 0
  return Math.round((counters.openTopics / counters.totalTopics) * 100)
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
