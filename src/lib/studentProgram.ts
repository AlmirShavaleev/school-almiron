/**
 * Чистые помощники для карточек прогресса ученика (StudentCoursePage).
 *
 * Источник данных — новый контур: topic_material_items (рубрики), topic_homework
 * (+ попытки и вердикты) и topic_test_assignments (+ попытки). Старая таблица
 * topic_materials и Homework V1/подборки здесь не участвуют вовсе.
 *
 * Сеть и правила доступа сюда не заходят: что ученику видно, решают RLS
 * (topic_*_student_select). Ниже — только приведение строк к тому, что рисуется
 * на карточке, чтобы это можно было проверить тестами без базы.
 */

import type { TopicMaterialSection } from './topicMaterialItems'
import type { TopicHomeworkAttemptRow, TopicHomeworkReviewRow, GradeScale } from './topicHomework'
import { gradeScaleMax } from './topicHomework'

/** Рубрики темы = плитки модалки преподавателя (§10.1), один в один. */
export type TopicSection = TopicMaterialSection | 'video' | 'homework' | 'test'

export const TOPIC_SECTION_ORDER: readonly TopicSection[] = [
  'notes', 'theory', 'tasks', 'homework', 'solution', 'video', 'test',
] as const

/**
 * Статус ДЗ темы глазами ученика.
 * `not_started` — задание есть, попыток нет; `draft` — попытка начата, но не сдана.
 */
export type TopicHwStatus = 'not_started' | 'draft' | 'submitted' | 'returned' | 'accepted'

/** Статус теста темы: попытка одна на привязку (§10.2). */
export type TopicTestStatus = 'not_started' | 'in_progress' | 'completed'

/** Строка topic_material_items в объёме, нужном для рубрик. */
export interface MaterialSectionRow {
  topic_id: string
  kind: string
  section: string | null
}

const MATERIAL_SECTIONS: readonly string[] = ['notes', 'theory', 'tasks', 'solution']

/**
 * Рубрики, заполненные материалами. Видео — по kind, а не по рубрике:
 * плитка «Видео» в модалке преподавателя пишет ссылку, а не файл в рубрику.
 */
export function sectionsFromMaterials(rows: MaterialSectionRow[]): Record<string, Set<TopicSection>> {
  const map: Record<string, Set<TopicSection>> = {}
  for (const row of rows) {
    const set = (map[row.topic_id] ||= new Set<TopicSection>())
    if (row.section && MATERIAL_SECTIONS.includes(row.section)) set.add(row.section as TopicSection)
    if (row.kind === 'video') set.add('video')
  }
  return map
}

/**
 * Статус ДЗ по попыткам одного ученика.
 *
 * `accepted` — терминальный (пересдача запрещена триггером), поэтому он
 * побеждает независимо от номера попытки. В остальном смотрим на свежайшую.
 */
export function homeworkStatus(attempts: TopicHomeworkAttemptRow[]): TopicHwStatus {
  if (attempts.length === 0) return 'not_started'
  if (attempts.some(a => a.status === 'accepted')) return 'accepted'
  const latest = [...attempts].sort((a, b) => b.attempt_number - a.attempt_number)[0]
  switch (latest.status) {
    case 'draft': return 'draft'
    case 'submitted': return 'submitted'
    case 'returned_for_revision': return 'returned'
    default: return 'not_started'
  }
}

/** Попытка, по которой показывается вердикт: принятая, иначе самая свежая. */
export function statusAttempt(attempts: TopicHomeworkAttemptRow[]): TopicHomeworkAttemptRow | null {
  if (attempts.length === 0) return null
  return attempts.find(a => a.status === 'accepted')
    ?? [...attempts].sort((a, b) => b.attempt_number - a.attempt_number)[0]
}

/** Последний вердикт по попытке — из него берутся балл и комментарий. */
export function reviewOfAttempt(
  reviews: TopicHomeworkReviewRow[],
  attemptId: string | null,
): TopicHomeworkReviewRow | null {
  if (!attemptId) return null
  return reviews
    .filter(r => r.attempt_id === attemptId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
}

/** Максимум по шкале ДЗ. NULL-шкала = ДЗ без баллов, «N из —» рисовать нельзя. */
export function homeworkMax(scale: GradeScale | null): number | null {
  return gradeScaleMax(scale)
}

export function testStatus(attempt: { status: string } | null | undefined): TopicTestStatus {
  if (!attempt) return 'not_started'
  return attempt.status === 'completed' ? 'completed' : 'in_progress'
}

/** Процент за тест. NULL, если тест не завершён или максимум неизвестен/нулевой. */
export function testPercent(points: number | null, maxPoints: number | null): number | null {
  if (points == null || !maxPoints) return null
  return Math.round((points / maxPoints) * 100)
}

export interface TopicWorkload {
  hasHomework: boolean
  hwStatus: TopicHwStatus | null
  hasTest: boolean
  testStatus: TopicTestStatus | null
}

/**
 * Счётчик «заданий» темы для колец прогресса: ДЗ и тест считаются по одному.
 * Выполненным считается принятое ДЗ и завершённый тест — то же, что видит ученик
 * на карточке, без скрытых весов.
 */
export function topicProgress(topic: TopicWorkload): { assigned: number; completed: number } {
  let assigned = 0
  let completed = 0
  if (topic.hasHomework) {
    assigned += 1
    if (topic.hwStatus === 'accepted') completed += 1
  }
  if (topic.hasTest) {
    assigned += 1
    if (topic.testStatus === 'completed') completed += 1
  }
  return { assigned, completed }
}
