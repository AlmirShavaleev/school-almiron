/**
 * Прогресс ученика: что считается сделанным и когда тема завершена.
 *
 * Одно место на всё приложение — и на страницу темы, и на «Мой прогресс», и на
 * карточку ученика у персонала. Правило «тема завершена» ровно то же, что
 * увидит ученик на вкладках; вторая копия разъехалась бы с первой правкой
 * (урок §21/§29, §100).
 *
 * Состояние раздела — ФУНКЦИЯ, а не запись в таблице. Сейчас всё, кроме ДЗ, —
 * самоотметка ученика, ДЗ засчитывается только принятой работой. Когда у
 * тестирования появятся настоящие прохождения, `test` переедет в вычисляемые
 * ровно здесь: схема отметок при этом не меняется, просто перестаём писать в
 * неё строки этого раздела.
 */
import type { TopicSection } from '@/lib/topicMaterialItems'

/** Разделы, состояние которых НЕ спрашивают у ученика. */
export const COMPUTED_SECTIONS: readonly TopicSection[] = ['homework'] as const

export function isSelfMarkable(section: TopicSection): boolean {
  return !COMPUTED_SECTIONS.includes(section)
}

export interface TopicProgress {
  /** Разделы, которые у темы РЕАЛЬНО есть: пустая рубрика не блокирует тему. */
  sections: TopicSection[]
  /** Самоотметки ученика по этой теме. */
  marks: ReadonlySet<TopicSection>
  /** Принята ли работа по ДЗ темы. Для темы без ДЗ значения не имеет. */
  homeworkAccepted: boolean
}

/**
 * Какие разделы у темы есть на самом деле.
 *
 * Отличается от набора вкладок сознательно: вкладка «Видео» на странице темы
 * стоит всегда, даже когда видео нет (§121 — её исчезновение читали как
 * пропажу раздела). Требовать отметку у пустой рубрики нельзя, иначе тема
 * никогда не завершится.
 */
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

/** Сделан ли раздел. ДЗ — только принятой работой, остальное — самоотметкой. */
export function sectionDone(section: TopicSection, progress: TopicProgress): boolean {
  if (section === 'homework') return progress.homeworkAccepted
  return progress.marks.has(section)
}

/**
 * Тема завершена: отмечены ВСЕ её разделы и принято ДЗ, если оно есть.
 *
 * Тема без единого раздела завершённой не считается — отмечать в ней нечего,
 * и «завершено» там означало бы «преподаватель ещё ничего не выложил».
 * В долю прогресса такие темы не идут вовсе (см. `courseProgress`).
 */
export function topicDone(progress: TopicProgress): boolean {
  if (progress.sections.length === 0) return false
  return progress.sections.every(section => sectionDone(section, progress))
}

/**
 * Прогресс курса — доля ЗАВЕРШЁННЫХ ТЕМ, а не отмеченных разделов.
 *
 * Решение владельца 12.08: 90% разделов при несданных ДЗ читались бы как
 * «почти всё», хотя главное не сделано.
 *
 * Пустые темы (без разделов) не попадают ни в числитель, ни в знаменатель:
 * иначе процент падал бы от того, что преподаватель завёл тему заранее.
 */
export function courseProgress(topics: TopicProgress[]): {
  done: number
  total: number
  percent: number
} {
  const meaningful = topics.filter(t => t.sections.length > 0)
  const done = meaningful.filter(topicDone).length
  const total = meaningful.length
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}
