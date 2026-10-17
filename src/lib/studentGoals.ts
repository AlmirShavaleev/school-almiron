import { supabase } from '@/lib/supabase'
import { safeRpc } from '@/lib/safeRpc'
import { plural } from '@/lib/plural'

/**
 * Учебные цели в два уровня (письмо ЛК_стиль_настройки_ученика.md, правка
 * 16.10 15:46).
 *
 *  · Цель на экзамен — ставит ученик: «Сдать физику на 80+».
 *    `student_exam_goals` (subject, goal), пишет `set_my_exam_goal` — уже есть.
 *  · Цели недели — ставит САМ ученик (правка 16.10 17:45), преподаватель
 *    только видит. Набор стандартный, 3 цели с одним числом: заходить N дней
 *    (3–6), пройти N тем (2–5), решить N задач (10/20/30/50). Повторяются
 *    каждую неделю; изменения — со следующего понедельника. Миграция
 *    PENDING_goals_v2.sql, прогресс считает база.
 */

export type GoalSubject = 'math' | 'physics'
export type WeeklyKind = 'days' | 'topics' | 'tasks'

export interface ExamGoal { subject: GoalSubject; goal: number }
export interface WeeklyGoal { kind: WeeklyKind; target: number; progress: number; done: boolean }
/** Свои цели недели ученика: действующие сейчас, отложенные на следующий понедельник и прогресс. */
export interface MyWeekly {
  current: GoalNumbers | null
  next: { validFrom: string; nums: GoalNumbers } | null
  goals: WeeklyGoal[]
}
/** Числа целей: null — цель выключена. */
export type GoalNumbers = Record<WeeklyKind, number | null>

export const SUBJECT_LABEL: Record<GoalSubject, string> = { math: 'математика', physics: 'физика' }
/** «Сдать физику на 80+» — винительный падеж. */
export const SUBJECT_ACC: Record<GoalSubject, string> = { math: 'математику', physics: 'физику' }
export const EXAM_PRESETS = [60, 70, 80, 90] as const
export const WEEKLY_KINDS: readonly WeeklyKind[] = ['days', 'topics', 'tasks']
export const WEEKLY_OPTIONS: Record<WeeklyKind, readonly number[]> = { days: [3, 4, 5, 6], topics: [2, 3, 4, 5], tasks: [10, 20, 30, 50] }
export const NO_GOALS: GoalNumbers = { days: null, topics: null, tasks: null }

const isSubject = (v: unknown): v is GoalSubject => v === 'math' || v === 'physics'
const isKind = (v: unknown): v is WeeklyKind => v === 'days' || v === 'topics' || v === 'tasks'
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const obj = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>

export function parseWeeklyGoals(data: unknown): WeeklyGoal[] {
  if (!Array.isArray(data)) return []
  return data.flatMap(r => {
    const o = obj(r)
    return isKind(o.kind) ? [{ kind: o.kind, target: Math.max(1, num(o.target)), progress: Math.max(0, num(o.progress)), done: o.done === true }] : []
  })
}

export function parseGoalNumbers(data: unknown): GoalNumbers {
  const o = obj(data)
  const pick = (k: WeeklyKind) => (WEEKLY_OPTIONS[k].includes(num(o[k])) ? num(o[k]) : null)
  return { days: pick('days'), topics: pick('topics'), tasks: pick('tasks') }
}

export function parseExamGoals(data: unknown): ExamGoal[] {
  if (!Array.isArray(data)) return []
  return data.flatMap(r => {
    const o = obj(r)
    return isSubject(o.subject) && num(o.goal) > 0 ? [{ subject: o.subject, goal: num(o.goal) }] : []
  })
}

/** «Заходить на платформу 4 дня в неделю», «Пройти 3 темы за неделю», «Решить 30 задач в тренировке». */
export function weeklyGoalTitle(kind: WeeklyKind, n: number): string {
  if (kind === 'days') return `Заходить на платформу ${n} ${plural(n, 'день', 'дня', 'дней')} в неделю`
  if (kind === 'topics') return `Пройти ${n} ${plural(n, 'тему', 'темы', 'тем')} за неделю`
  return `Решить ${n} ${plural(n, 'задачу', 'задачи', 'задач')} в тренировке`
}

/** «3 из 5 дней», «2 из 3 тем», «12 из 30 задач». Сверх цели — «5 из 5». */
export function weeklyProgressLabel(g: Pick<WeeklyGoal, 'kind' | 'progress' | 'target'>): string {
  const p = Math.min(g.progress, g.target)
  const unit = g.kind === 'days' ? plural(g.target, 'дня', 'дней', 'дней')
    : g.kind === 'topics' ? plural(g.target, 'темы', 'тем', 'тем')
    : plural(g.target, 'задачи', 'задач', 'задач')
  return `${p} из ${g.target} ${unit}`
}

/** «Цели недели: выполнено k из n» — для списка учеников у преподавателя. */
export function weeklySummaryLabel(done: number, total: number): string {
  return total === 0 ? '' : `${done} из ${total}`
}

/** «Цель: физика 80+». */
export const examGoalLabel = (g: ExamGoal) => `Цель: ${SUBJECT_LABEL[g.subject]} ${g.goal}+`

/**
 * На чём основана оценка пути к цели: последний пробник предмета, если есть
 * результат; иначе «пройдено N из M тем курса» (как в «Моих курсах»).
 */
export function goalBasis(
  mock: { score: number; max: number } | null,
  course: { done: number; total: number } | null,
): string | null {
  if (mock && mock.max > 0) return `последний пробник: ${mock.score} из ${mock.max} первичных`
  if (course && course.total > 0) return `пройдено ${course.done} из ${course.total} ${plural(course.total, 'темы', 'тем', 'тем')} курса`
  return null
}

// ── Запросы ученика ──────────────────────────────────────────────────────────
export async function fetchMyWeeklyGoals(): Promise<{ data: MyWeekly | null; error: string | null }> {
  const { data, error } = await safeRpc('my_weekly_goals')
  if (error) return { data: null, error: 'Не удалось загрузить цели недели' }
  const o = obj(data)
  const n = o.next ? obj(o.next) : null
  return {
    data: {
      current: o.current ? parseGoalNumbers(o.current) : null,
      next: n && typeof n.valid_from === 'string' ? { validFrom: n.valid_from, nums: parseGoalNumbers(n) } : null,
      goals: parseWeeklyGoals(o.goals),
    },
    error: null,
  }
}

/** Новые числа — со следующего понедельника (если на эту неделю целей не было — сразу). */
export async function setMyWeeklyGoals(g: GoalNumbers): Promise<{ validFrom: string | null; error: string | null }> {
  const { data, error } = await safeRpc('set_my_weekly_goals', { p_days: g.days, p_topics: g.topics, p_tasks: g.tasks })
  return error ? { validFrom: null, error: 'Не удалось сохранить цели' } : { validFrom: typeof data === 'string' ? data : null, error: null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export async function fetchMyExamGoals(profileId: string): Promise<ExamGoal[]> {
  try {
    const { data, error } = await db.from('student_exam_goals').select('subject, goal').eq('profile_id', profileId)
    return error ? [] : parseExamGoals(data)
  } catch { return [] }
}

/** null — убрать цель. Пишет только `set_my_exam_goal` (ученик курса ЕГЭ этого предмета). */
export async function setMyExamGoal(subject: GoalSubject, goal: number | null): Promise<{ error: string | null }> {
  const { error } = await safeRpc('set_my_exam_goal', { p_subject: subject, p_goal: goal })
  return { error: error ? 'Не удалось сохранить цель' : null }
}

// ── Персонал: только чтение ──────────────────────────────────────────────────
export interface StaffGoals {
  exam: ExamGoal[]
  goals: WeeklyGoal[]
  history: Array<{ weekStart: string; total: number; done: number }>
}

export async function fetchStudentGoalsForStaff(studentId: string): Promise<{ data: StaffGoals | null; error: string | null }> {
  const { data, error } = await safeRpc('student_goals_for_staff', { p_student_id: studentId })
  if (error) return { data: null, error: 'Не удалось загрузить цели ученика' }
  const o = obj(data)
  return {
    data: {
      exam: parseExamGoals(o.exam),
      goals: parseWeeklyGoals(o.goals),
      history: (Array.isArray(o.history) ? o.history : []).map(h => {
        const x = obj(h)
        return { weekStart: typeof x.week_start === 'string' ? x.week_start : '', total: num(x.total), done: num(x.done) }
      }),
    },
    error: null,
  }
}

export async function fetchCourseGoalsSummary(courseId: string): Promise<Map<string, { goals: number; done: number; behind: boolean }> | null> {
  const { data, error } = await safeRpc('course_goals_summary', { p_course_id: courseId })
  if (error || !Array.isArray(data)) return null
  return new Map(data.flatMap(r => {
    const o = obj(r)
    return typeof o.student_id === 'string' ? [[o.student_id, { goals: num(o.goals), done: num(o.done), behind: o.behind === true }] as const] : []
  }))
}
