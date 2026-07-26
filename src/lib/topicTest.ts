/**
 * Чистые помощники для тестирования темы.
 *
 * Здесь нет обращений к сети и — намеренно — нет копий правил доступа.
 * Что можно ученику и преподавателю, решают RLS и триггеры на стороне БД.
 * Функции ниже нужны, чтобы показать понятный статус и правильно рендерить
 * UI на основе данных. Это UX, а не защита.
 */

export type TopicTestPartialType = 'matching' | 'multi_choice' | null

/**
 * Тест из банка (без привязки к теме).
 */
export interface TopicTestRow {
  id: string
  title: string
  description: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface TopicTestItemRow {
  id: string
  test_id: string
  task_id: string | null
  position: number
  statement_html: string
  answer_html: string
  answer_text: string
  solution_html: string | null
  partial_type: TopicTestPartialType
  max_points: number
  exam_part: number | null
  assets: any[]
  created_at: string
}

export interface TopicTestAttemptRow {
  id: string
  assignment_id: string
  student_id: string
  status: 'in_progress' | 'completed'
  started_at: string
  completed_at: string | null
  total_points: number | null
  max_points: number | null
}

export interface TopicTestAssignmentRow {
  id: string
  test_id: string
  topic_id: string
  assigned_by: string
  created_at: string
}

export interface BankTestSummary {
  id: string
  title: string
  description: string | null
  created_by: string
  created_at: string
  updated_at: string
  itemCount: number
  assignmentCount: number
}

export interface TopicTestAnswerRow {
  id: string
  attempt_id: string
  item_id: string
  answer_text: string
  awarded_points: number | null
  is_correct: boolean | null
  updated_at: string
}

/**
 * Задание глазами ученика (RPC topic_test_assignment_items).
 * Эталоны (answer_html, answer_text, solution_html) — null до завершения СВОЕЙ попытки этой привязки.
 */
export interface StudentTestItem {
  id: string
  position: number
  statement_html: string
  partial_type: TopicTestPartialType
  max_points: number
  exam_part: number | null
  assets: any[]
  answer_html: string | null
  answer_text: string | null
  solution_html: string | null
}

/**
 * Сумма максимального количества баллов по всем заданиям теста.
 */
export function totalMaxPoints(items: { max_points: number }[]): number {
  return items.reduce((sum, item) => sum + item.max_points, 0)
}

/**
 * Сортирует задания по полю position (по возрастанию).
 */
export function sortItems<T extends { position: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position)
}

/**
 * Проверяет, есть ли у задания непустой текстовый ответ.
 *
 * Ученику показываем только если есть отработанный ответ (hasAnswer = true)
 * и текст не пустой и не состоит только из HTML-тегов, пробелов и &nbsp;.
 *
 * Это клиентское зеркало серверной проверки — это UX, а не защита.
 * Саму строку-эталон проверяет база при сохранении.
 */
export function hasTextAnswer(answerHtml: string | null, hasAnswer: boolean): boolean {
  if (!hasAnswer || !answerHtml) return false

  // Убираем HTML-теги и HTML-сущности
  const text = answerHtml
    .replace(/<[^>]*>/g, '') // Убираем все HTML-теги
    .replace(/&nbsp;/g, ' ') // Заменяем &nbsp; на пробел
    .trim()

  return text.length > 0
}

/**
 * Форматирует итоговый результат в виде "6 / 7".
 */
export function formatScore(total: number | null, max: number | null): string {
  if (total == null || max == null) return '—'
  return `${total} / ${max}`
}

/**
 * Вычисляет процент правильности: (total / max) * 100.
 * Возвращает null, если некорректные аргументы или division by zero.
 */
export function scorePercent(total: number | null, max: number | null): number | null {
  if (total == null || max == null || max === 0) return null
  return Math.round((total / max) * 100)
}
