import { safeRpc } from '@/lib/safeRpc'

/**
 * Опрос о качестве урока (письмо ЛК_стиль_урок_опрос_качества.md, 16.10).
 *
 * Оценка 1–10 (§271, `topicRatings.ts`) говорит «урок плохой»; опрос — какой
 * именно материал (теория / видео / задачи / ДЗ) и где ученик застрял. Ответы
 * читает агент-методист — выгрузкой CSV со вкладки «Качество уроков».
 *
 * Пишут и читают только RPC (`save_topic_feedback`, `my_topic_feedback`,
 * `topic_feedback_for_course`; миграция PENDING_topic_feedback.sql): таблица
 * `topic_feedback` закрыта целиком. Все ответы необязательные.
 */

export type Clarity = 'full' | 'mostly' | 'partly' | 'no'
export type VideoSeen = 'full' | 'partly' | 'none'
export type VideoPace = 'slow' | 'ok' | 'fast'
export type Difficulty = 'easy' | 'ok' | 'hard'
export type HwSelf = 'all' | 'most' | 'few' | 'none'
export type HardSpot = 'theory' | 'video' | 'lesson_task' | 'hw_task' | 'examples' | 'picture' | 'nothing'
export type ErrorWhere = 'theory' | 'tasks' | 'solutions' | 'video'
export type TimeSpent = 'lt30' | '30_60' | '1_2h' | 'gt2h'

export interface FeedbackAnswers {
  clarity: Clarity | null
  video: VideoSeen | null
  video_pace: VideoPace | null
  lesson_difficulty: Difficulty | null
  hw_self: HwSelf | null
  hard_spots: HardSpot[]
  hard_lesson_task: string
  hard_hw_task: string
  found_error: boolean | null
  error_where: ErrorWhere | null
  error_task: string
  error_text: string
  time_spent: TimeSpent | null
  improve: string
}

export const EMPTY_ANSWERS: FeedbackAnswers = {
  clarity: null, video: null, video_pace: null, lesson_difficulty: null, hw_self: null,
  hard_spots: [], hard_lesson_task: '', hard_hw_task: '',
  found_error: null, error_where: null, error_task: '', error_text: '',
  time_spent: null, improve: '',
}

// ── Тексты вопросов и вариантов — ровно как в письме ─────────────────────────
export const CLARITY: ReadonlyArray<[Clarity, string]> = [['full', 'Полностью'], ['mostly', 'В основном'], ['partly', 'Частично'], ['no', 'Нет']]
export const VIDEO: ReadonlyArray<[VideoSeen, string]> = [['full', 'Посмотрел целиком'], ['partly', 'Частично'], ['none', 'Не смотрел']]
export const PACE: ReadonlyArray<[VideoPace, string]> = [['slow', 'Медленно'], ['ok', 'Нормально'], ['fast', 'Быстро']]
export const DIFFICULTY: ReadonlyArray<[Difficulty, string]> = [['easy', 'Слишком лёгкие'], ['ok', 'В самый раз'], ['hard', 'Слишком сложные']]
export const HW_SELF: ReadonlyArray<[HwSelf, string]> = [['all', 'Все'], ['most', 'Больше половины'], ['few', 'Меньше половины'], ['none', 'Ни одной']]
export const HARD_SPOTS: ReadonlyArray<[HardSpot, string]> = [
  ['theory', 'Теория'], ['video', 'Видео'], ['lesson_task', 'Решение задачи урока №'], ['hw_task', 'Задача ДЗ №'],
  ['examples', 'Не хватило примеров'], ['picture', 'Не хватило рисунка'], ['nothing', 'Ничего, всё понятно'],
]
export const ERROR_WHERE: ReadonlyArray<[ErrorWhere, string]> = [['theory', 'Теория'], ['tasks', 'Задачи'], ['solutions', 'Решения'], ['video', 'Видео']]
export const TIME_SPENT: ReadonlyArray<[TimeSpent, string]> = [['lt30', 'до 30 мин'], ['30_60', '30–60 мин'], ['1_2h', '1–2 ч'], ['gt2h', 'больше 2 ч']]

export const label = <K extends string>(list: ReadonlyArray<[K, string]>, k: K | null | undefined): string =>
  (k && list.find(([v]) => v === k)?.[1]) || ''

/** «Ничего, всё понятно» и остальные варианты «где трудно» взаимоисключают друг друга. */
export function toggleHardSpot(spots: readonly HardSpot[], s: HardSpot): HardSpot[] {
  if (spots.includes(s)) return spots.filter(x => x !== s)
  if (s === 'nothing') return ['nothing']
  return [...spots.filter(x => x !== 'nothing'), s]
}

/** Ответы → тело запроса: пустые строки уходят как null, номера и текст без лишних пробелов. */
export function toPayload(a: FeedbackAnswers): Record<string, unknown> {
  const t = (s: string) => s.trim() || null
  return {
    clarity: a.clarity,
    video: a.video,
    // Темп — только если видео смотрел.
    video_pace: a.video && a.video !== 'none' ? a.video_pace : null,
    lesson_difficulty: a.lesson_difficulty,
    hw_self: a.hw_self,
    hard_spots: a.hard_spots,
    hard_lesson_task: a.hard_spots.includes('lesson_task') ? t(a.hard_lesson_task) : null,
    hard_hw_task: a.hard_spots.includes('hw_task') ? t(a.hard_hw_task) : null,
    found_error: a.found_error,
    error_where: a.found_error ? a.error_where : null,
    error_task: a.found_error ? t(a.error_task) : null,
    error_text: a.found_error ? t(a.error_text) : null,
    time_spent: a.time_spent,
    improve: t(a.improve),
  }
}

const pick = <K extends string>(list: ReadonlyArray<[K, string]>, v: unknown): K | null =>
  typeof v === 'string' && list.some(([k]) => k === v) ? (v as K) : null
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Ответ базы (jsonb или строка ответов курса) → ответы формы. Чужие значения отбрасываем. */
export function parseAnswers(d: unknown): FeedbackAnswers {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
  const spots = Array.isArray(o.hard_spots) ? o.hard_spots : []
  return {
    clarity: pick(CLARITY, o.clarity),
    video: pick(VIDEO, o.video),
    video_pace: pick(PACE, o.video_pace),
    lesson_difficulty: pick(DIFFICULTY, o.lesson_difficulty),
    hw_self: pick(HW_SELF, o.hw_self),
    hard_spots: spots.filter((s): s is HardSpot => HARD_SPOTS.some(([k]) => k === s)),
    hard_lesson_task: str(o.hard_lesson_task),
    hard_hw_task: str(o.hard_hw_task),
    found_error: typeof o.found_error === 'boolean' ? o.found_error : null,
    error_where: pick(ERROR_WHERE, o.error_where),
    error_task: str(o.error_task),
    error_text: str(o.error_text),
    time_spent: pick(TIME_SPENT, o.time_spent),
    improve: str(o.improve),
  }
}

// ── Запросы ученика ──────────────────────────────────────────────────────────
export async function fetchMyTopicFeedback(topicId: string): Promise<{ answers: FeedbackAnswers | null; error: string | null }> {
  const { data, error } = await safeRpc('my_topic_feedback', { p_topic_id: topicId })
  if (error) return { answers: null, error: 'Не удалось загрузить опрос' }
  return { answers: data ? parseAnswers(data) : null, error: null }
}

export async function saveTopicFeedback(topicId: string, a: FeedbackAnswers): Promise<{ error: string | null }> {
  const { error } = await safeRpc('save_topic_feedback', { p_topic_id: topicId, p_answers: toPayload(a) })
  return { error: error ? 'Не удалось сохранить ответы. Попробуйте ещё раз.' : null }
}

// ── Персонал: «Качество уроков» ──────────────────────────────────────────────
export interface FeedbackRow extends FeedbackAnswers {
  topicId: string
  studentId: string
  studentName: string
  updatedAt: string
}

export function parseFeedbackRows(data: unknown): FeedbackRow[] {
  if (!Array.isArray(data)) return []
  return data.flatMap(r => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    if (typeof o.topic_id !== 'string') return []
    return [{
      ...parseAnswers(o),
      topicId: o.topic_id,
      studentId: str(o.student_id),
      studentName: str(o.student_name) || 'Ученик',
      updatedAt: str(o.updated_at),
    }]
  })
}

export async function fetchCourseFeedback(courseId: string): Promise<{ rows: FeedbackRow[]; error: string | null }> {
  const { data, error } = await safeRpc('topic_feedback_for_course', { p_course_id: courseId })
  if (error) return { rows: [], error: 'Не удалось загрузить опросы по урокам' }
  return { rows: parseFeedbackRows(data), error: null }
}

export interface QualityRow {
  topicId: string
  title: string
  moduleTitle: string
  courseOrder: number
  /** Средняя оценка 1–10 (§271) и число оценок. */
  avgRating: number | null
  ratings: number
  /** Ответов опроса. */
  answers: number
  /** % «понятно частично или нет» среди ответивших на вопрос. */
  unclearPct: number | null
  /** Сложность задач урока: сколько «легко / в самый раз / сложно». */
  difficulty: Record<Difficulty, number>
  /** % «решил сам меньше половины ДЗ» (меньше половины + ни одной). */
  hwLowPct: number | null
  /** Частые «где трудно»: подпись с номерами задач и сколько раз. */
  hardTop: Array<{ label: string; n: number }>
  errors: Array<{ studentId: string; studentName: string; where: string; task: string; text: string }>
  wishes: Array<{ studentName: string; text: string }>
  /** Проблемность: чем больше, тем выше в таблице. */
  score: number
}

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : null)

interface ModuleLike { title: string; topics: Array<{ id: string; title: string }> }

/**
 * Темы курса + ответы опроса + оценки → строки «Качества уроков».
 *
 * Проблемность: доля «непонятно» и «решил сам меньше половины ДЗ», доля
 * «слишком сложно», низкая средняя оценка и найденные ошибки. Тема без
 * ответов и оценок — 0, в конец списка.
 */
export function buildQualityRows(
  modules: ModuleLike[],
  rows: FeedbackRow[],
  ratings: ReadonlyArray<{ topicId: string; ratings: number; avg: number }>,
): QualityRow[] {
  const byTopic = new Map<string, FeedbackRow[]>()
  for (const r of rows) byTopic.set(r.topicId, [...(byTopic.get(r.topicId) ?? []), r])
  const rate = new Map(ratings.map(r => [r.topicId, r]))
  const out: QualityRow[] = []
  for (const m of modules) {
    for (const t of m.topics) {
      const fb = byTopic.get(t.id) ?? []
      const rt = rate.get(t.id)
      const clar = fb.filter(r => r.clarity)
      const unclear = clar.filter(r => r.clarity === 'partly' || r.clarity === 'no').length
      const hw = fb.filter(r => r.hw_self)
      const hwLow = hw.filter(r => r.hw_self === 'few' || r.hw_self === 'none').length
      const difficulty: Record<Difficulty, number> = { easy: 0, ok: 0, hard: 0 }
      for (const r of fb) if (r.lesson_difficulty) difficulty[r.lesson_difficulty] += 1
      const diffAnswered = difficulty.easy + difficulty.ok + difficulty.hard

      const spots = new Map<string, number>()
      for (const r of fb) {
        for (const s of r.hard_spots) {
          if (s === 'nothing') continue
          const num = s === 'lesson_task' ? r.hard_lesson_task.trim() : s === 'hw_task' ? r.hard_hw_task.trim() : ''
          const key = s === 'lesson_task' ? `Задача урока${num ? ` № ${num}` : ''}`
            : s === 'hw_task' ? `Задача ДЗ${num ? ` № ${num}` : ''}`
            : label(HARD_SPOTS, s)
          spots.set(key, (spots.get(key) ?? 0) + 1)
        }
      }
      const hardTop = [...spots].map(([l, n]) => ({ label: l, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, 5)
      const errors = fb.filter(r => r.found_error).map(r => ({
        studentId: r.studentId, studentName: r.studentName,
        where: label(ERROR_WHERE, r.error_where), task: r.error_task.trim(), text: r.error_text.trim(),
      }))
      const wishes = fb.filter(r => r.improve.trim()).map(r => ({ studentName: r.studentName, text: r.improve.trim() }))

      const unclearPct = pct(unclear, clar.length)
      const hwLowPct = pct(hwLow, hw.length)
      const hardPct = pct(difficulty.hard, diffAnswered)
      const score = fb.length + (rt?.ratings ?? 0) === 0 ? 0
        : (unclearPct ?? 0) + (hwLowPct ?? 0) + (hardPct ?? 0) / 2
          + (rt ? Math.max(0, 10 - rt.avg) * 8 : 0) + errors.length * 10

      out.push({
        topicId: t.id, title: t.title, moduleTitle: m.title, courseOrder: out.length,
        avgRating: rt ? rt.avg : null, ratings: rt?.ratings ?? 0, answers: fb.length,
        unclearPct, difficulty, hwLowPct, hardTop, errors, wishes, score: Math.round(score),
      })
    }
  }
  return out
}

/** Худшие сверху; при равенстве — по порядку курса. */
export function sortByProblem(rows: QualityRow[]): QualityRow[] {
  return [...rows].sort((a, b) => b.score - a.score || a.courseOrder - b.courseOrder)
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Выгрузка для методиста: одна строка — один ответ ученика, с разделом и
 * темой. Разделитель «;» и BOM — чтобы Excel открыл кириллицу без мастера.
 */
export function feedbackCsv(rows: FeedbackRow[], topics: ReadonlyMap<string, { title: string; moduleTitle: string }>): string {
  const head = [
    'Раздел', 'Тема', 'Ученик', 'Дата', 'Понятность', 'Видео', 'Темп видео', 'Сложность задач урока',
    'ДЗ решил сам', 'Где трудно', 'Задача урока №', 'Задача ДЗ №', 'Нашёл ошибку', 'Где ошибка', 'Ошибка: задача №',
    'Ошибка: текст', 'Время на тему', 'Что улучшить',
  ]
  const lines = rows.map(r => {
    const t = topics.get(r.topicId)
    return [
      t?.moduleTitle ?? '', t?.title ?? r.topicId, r.studentName, r.updatedAt.slice(0, 10),
      label(CLARITY, r.clarity), label(VIDEO, r.video), label(PACE, r.video_pace), label(DIFFICULTY, r.lesson_difficulty),
      label(HW_SELF, r.hw_self), r.hard_spots.map(s => label(HARD_SPOTS, s)).join(', '), r.hard_lesson_task, r.hard_hw_task,
      r.found_error == null ? '' : r.found_error ? 'Да' : 'Нет', label(ERROR_WHERE, r.error_where), r.error_task,
      r.error_text, label(TIME_SPENT, r.time_spent), r.improve,
    ].map(csvCell).join(';')
  })
  return '﻿' + [head.join(';'), ...lines].join('\r\n')
}
