/**
 * §274. Карточка урока в программе курса ученика — чистые правила.
 *
 * Что внутри урока (плашки «Видео», «Теория», «Задачи · 7», «ДЗ», «Тест») и
 * одна строка состояния («ДЗ до пт, 10 окт», «Сдано», «Просрочено»,
 * «Откроется 12 окт»). Отрисовка — `components/courseProgram/LessonCard.tsx`.
 *
 * Плашки «Решение ДЗ» и «Ответы и критерии» не рисуем намеренно (§182):
 * до сдачи ДЗ разбор закрыт (`GATED_SECTION`), а обещание «решение есть»
 * подталкивает списать.
 */
import { parseBunnyVideoUrl } from './bunnyVideoUrl'
import { dueDateKey } from './homeworkDeadline'
import { isTopicOpen, willOpenByDate, type TopicOpenState } from './topicAvailability'
import { dayMonthShort, shortDayLabel } from './studentCalendar'
import type { TopicSection } from './topicMaterialItems'
import type { TopicHwStatus } from './studentProgram'

// ─── Превью видео ───────────────────────────────────────────────────────────

/**
 * guid первого видео Bunny каждой темы (по `position`). Внешние ссылки
 * (YouTube и пр.) превью не дают — у такой темы будет заглушка.
 */
export function firstVideoGuidByTopic(
  rows: readonly { topic_id: string; kind: string; url?: string | null; position?: number | null }[],
): Map<string, string> {
  const best = new Map<string, { guid: string; pos: number }>()
  for (const r of rows) {
    if (r.kind !== 'video') continue
    const ref = parseBunnyVideoUrl(r.url)
    if (!ref) continue
    const pos = r.position ?? Number.MAX_SAFE_INTEGER
    const cur = best.get(r.topic_id)
    if (!cur || pos < cur.pos) best.set(r.topic_id, { guid: ref.guid, pos })
  }
  return new Map([...best].map(([k, v]) => [k, v.guid]))
}

/**
 * Хост pull-зоны библиотеки Bunny Stream (`vz-<…>.b-cdn.net`). В коде его не
 * было: плеер и статистика ходят через `iframe.mediadelivery.net` и API. Пока
 * переменная не задана — превью нет, карточка рисует заглушку с номером урока.
 */
const BUNNY_CDN_HOST: string = String(import.meta.env.VITE_BUNNY_CDN_HOST ?? '')
  .trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')

/** `https://<cdn>/<guid>/thumbnail.jpg` — стандартная обложка Bunny; null без хоста. */
export function bunnyThumbnailUrl(guid: string | null | undefined, host: string = BUNNY_CDN_HOST): string | null {
  if (!guid || !host) return null
  return `https://${host}/${guid}/thumbnail.jpg`
}

// ─── Что внутри ─────────────────────────────────────────────────────────────

export type LessonChipKey = 'video' | 'theory' | 'tasks' | 'homework' | 'test'

export interface LessonChip {
  key: LessonChipKey
  label: string
}

export interface LessonCardTopic extends TopicOpenState {
  sections: Set<TopicSection>
  lesson_format?: string | null
  hw_id: string | null
  hw_due_at: string | null
  hw_status: TopicHwStatus | null
  hw_score: number | null
  hw_max: number | null
  test_assignment_id: string | null
  test_status: string | null
  tasks_total: number
  tasks_closed: number
}

/** Плашки «что внутри» в учебном порядке: видео → теория → задачи → ДЗ → тест. */
export function lessonChips(topic: LessonCardTopic): LessonChip[] {
  const chips: LessonChip[] = []
  const s = topic.sections
  if (s.has('video')) chips.push({ key: 'video', label: 'Видео' })
  const theory = s.has('theory'), notes = s.has('notes')
  if (theory || notes) chips.push({ key: 'theory', label: theory && notes ? 'Теория и конспект' : theory ? 'Теория' : 'Конспект' })
  if (topic.tasks_total > 0) chips.push({ key: 'tasks', label: `Задачи · ${topic.tasks_total}` })
  else if (s.has('tasks') || s.has('worksheet_tasks')) chips.push({ key: 'tasks', label: 'Задачи' })
  // §266. У тренировочного урока ДЗ — задачи с автопроверкой.
  if (topic.hw_id) chips.push({ key: 'homework', label: topic.lesson_format === 'training' ? 'ДЗ с автопроверкой' : 'ДЗ' })
  if (topic.test_assignment_id) chips.push({ key: 'test', label: 'Тест' })
  return chips
}

// ─── Строка состояния ───────────────────────────────────────────────────────

export type LessonTone = 'locked' | 'done' | 'wait' | 'warn' | 'bad' | 'todo' | 'none'

export interface LessonStatus {
  label: string
  tone: LessonTone
}

/**
 * Одна строка «что с уроком». Порядок важен: закрытость → ДЗ (самое срочное) →
 * задачи к уроку. `today` — по Москве («YYYY-MM-DD»), им же считается срок ДЗ
 * (§259); открытость — общим правилом `isTopicOpen` (§59), как у списка.
 */
export function lessonStatus(topic: LessonCardTopic, today: string, openToday?: string): LessonStatus | null {
  if (!isTopicOpen(topic, openToday)) {
    const day = willOpenByDate(topic, openToday)
    return { label: day ? `Откроется ${dayMonthShort(day)}` : 'Откроется позже', tone: 'locked' }
  }
  if (topic.hw_id) {
    const training = topic.lesson_format === 'training'
    switch (topic.hw_status) {
      case 'accepted':
        if (training) return { label: topic.hw_score != null ? `Задачи решены · ${topic.hw_score}/100` : 'Задачи решены', tone: 'done' }
        return { label: topic.hw_score != null && topic.hw_max != null ? `ДЗ принято · ${topic.hw_score}/${topic.hw_max}` : 'ДЗ принято', tone: 'done' }
      case 'submitted':
        return { label: 'Сдано · на проверке', tone: 'wait' }
      case 'returned':
        return { label: 'ДЗ вернули — доработать', tone: 'warn' }
      default: {
        const due = dueDateKey(topic.hw_due_at)
        const draft = topic.hw_status === 'draft' ? ' · черновик' : ''
        if (!due) return { label: `${training ? 'Задачи' : 'ДЗ'} без срока${draft}`, tone: 'todo' }
        if (due < today) return { label: `Просрочено · срок был ${dayMonthShort(due)}`, tone: 'bad' }
        if (due === today) return { label: `${training ? 'Задачи' : 'ДЗ'} до сегодня${draft}`, tone: 'warn' }
        return { label: `${training ? 'Задачи' : 'ДЗ'} до ${shortDayLabel(due)}${draft}`, tone: 'todo' }
      }
    }
  }
  if (topic.test_assignment_id && topic.test_status === 'completed') return { label: 'Тест пройден', tone: 'done' }
  if (topic.tasks_total > 0 && topic.tasks_closed >= topic.tasks_total) return { label: 'Все задачи решены', tone: 'done' }
  return null
}

/** Доля решённых задач к уроку, 0–100; null — задач нет. */
export function tasksPercent(topic: Pick<LessonCardTopic, 'tasks_total' | 'tasks_closed'>): number | null {
  if (topic.tasks_total <= 0) return null
  return Math.min(100, Math.round((topic.tasks_closed / topic.tasks_total) * 100))
}
