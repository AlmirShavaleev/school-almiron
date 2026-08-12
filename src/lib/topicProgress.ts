/**
 * Прогресс ученика: что считается сделанным и когда тема завершена.
 *
 * Одно место на всё приложение — и на страницу темы, и на «Мой прогресс», и на
 * карточку ученика у персонала. Правило «тема завершена» ровно то же, что
 * увидит ученик на вкладках; вторая копия разъехалась бы с первой правкой
 * (урок §21/§29, §100).
 *
 * ОТМЕТКА СТОИТ НА ГРУППЕ, А НЕ НА РУБРИКЕ (правка §122 по просмотру владельца
 * 12.08). Отмечать каждую вкладку отдельно оказалось неудобно, а собирать
 * группу из порубричных отметок нельзя: кнопка группы записала бы в базу то,
 * чего человек по отдельности не отмечал, и любое изменение состава группы
 * (а он менялся — §100, §121) двигало бы завершённость задним числом. Одна
 * отметка = одно действие человека.
 *
 * Состояние группы — ФУНКЦИЯ, а не запись: «Домашнее задание» засчитывается
 * принятой работой и в таблицу отметок не попадает никогда.
 */
import {
  TOPIC_SECTION_GROUPS,
  type TopicSection,
  type TopicSectionGroup,
} from '@/lib/topicMaterialItems'

export type TopicGroupKey = TopicSectionGroup['key']

/** Группы, которые отмечает сам ученик. «Домашнее задание» считает система. */
export const MARKABLE_GROUPS: readonly TopicGroupKey[] = ['theory', 'lesson'] as const

export function isSelfMarkable(group: TopicGroupKey): boolean {
  return MARKABLE_GROUPS.includes(group)
}

export interface TopicProgress {
  /**
   * Группы, которые у темы РЕАЛЬНО есть: пустая группа не блокирует тему и
   * кнопки не имеет — отмечать в ней нечего.
   */
  groups: TopicGroupKey[]
  /** Самоотметки ученика по этой теме. */
  marks: ReadonlySet<TopicGroupKey>
  /** Принята ли работа по ДЗ темы. Для темы без ДЗ значения не имеет. */
  homeworkAccepted: boolean
}

/**
 * Какие группы у темы есть на самом деле — по тем рубрикам, что у неё
 * действительно наполнены.
 *
 * Отличается от набора вкладок сознательно: вкладка «Видео» на странице темы
 * стоит всегда, даже когда видео нет (§121 — её исчезновение читали как
 * пропажу раздела). Требовать отметку у пустой группы нельзя, иначе тема
 * никогда не завершится.
 *
 * Тестирование ни в одну группу §121 не входит, поэтому на завершённость не
 * влияет и отметки не имеет.
 */
export function topicGroups(sections: readonly TopicSection[]): TopicGroupKey[] {
  return TOPIC_SECTION_GROUPS
    .filter(group => group.sections.some(s => sections.includes(s)))
    .map(group => group.key)
}

/** Какие рубрики у темы есть. Вход для `topicGroups`. */
export function topicSections(input: {
  hasVideo: boolean
  /** Сколько материалов в каждой рубрике. */
  sectionCounts: Partial<Record<TopicSection, number>>
  /** «Решение ДЗ» существует, даже если закрыто гейтом (§95). */
  hasSolution?: boolean
  hasHomework: boolean
  hasTest: boolean
}): TopicSection[] {
  const out: TopicSection[] = []
  if (input.hasVideo) out.push('video')

  for (const [section, count] of Object.entries(input.sectionCounts)) {
    if (section === 'solution') continue
    if ((count ?? 0) > 0) out.push(section as TopicSection)
  }
  if (input.hasSolution || (input.sectionCounts.solution ?? 0) > 0) out.push('solution')

  if (input.hasHomework) out.push('homework')
  if (input.hasTest) out.push('test')
  return out
}

/** Сделана ли группа. ДЗ — только принятой работой, остальное — самоотметкой. */
export function groupDone(group: TopicGroupKey, progress: TopicProgress): boolean {
  if (group === 'homework') return progress.homeworkAccepted
  return progress.marks.has(group)
}

/**
 * Тема завершена: отмечены обе отмечаемые группы (те, что у темы есть) И
 * принято ДЗ, если оно есть.
 *
 * Тема, где отмечать нечего и ДЗ нет (например, только тестирование или пустая
 * заготовка), завершённой не считается — «завершено» там означало бы
 * «преподаватель ещё ничего не выложил». В долю прогресса такие темы не идут
 * вовсе (см. `courseProgress`).
 */
export function topicDone(progress: TopicProgress): boolean {
  if (progress.groups.length === 0) return false
  return progress.groups.every(group => groupDone(group, progress))
}

/**
 * Прогресс курса — доля ЗАВЕРШЁННЫХ ТЕМ, а не отмеченных групп.
 *
 * Решение владельца 12.08: 90% разделов при несданных ДЗ читались бы как
 * «почти всё», хотя главное не сделано.
 *
 * Темы без единой группы не попадают ни в числитель, ни в знаменатель: иначе
 * процент падал бы от того, что преподаватель завёл тему заранее.
 */
export function courseProgress(topics: TopicProgress[]): {
  done: number
  total: number
  percent: number
} {
  const meaningful = topics.filter(t => t.groups.length > 0)
  const done = meaningful.filter(topicDone).length
  const total = meaningful.length
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}
