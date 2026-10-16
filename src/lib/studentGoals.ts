import { supabase } from '@/lib/supabase'
import { safeRpc } from '@/lib/safeRpc'
import { plural } from '@/lib/plural'

/**
 * Учебные цели в два уровня (письмо ЛК_стиль_настройки_ученика.md, 16.10).
 *
 *  · Глобальная — результат на экзамене по предмету: «Сдать физику на 80+».
 *    `student_exam_goals` (subject, goal), пишет `set_my_exam_goal` — уже есть.
 *  · Регулярные — цели недели, повторяются каждую неделю, пока ученик их не
 *    поменяет: по номерам ЕГЭ, «пройти тему(ы) курса», «решить N задач»,
 *    «заниматься N дней». `student_regular_goals` (миграция
 *    PENDING_goals_v2.sql): прогресс за текущую неделю считает база.
 *
 * Персонал видит цели только на чтение: `student_goals_for_staff`,
 * `course_goals_summary`.
 */

export type GoalKind = 'numbers' | 'topics' | 'tasks' | 'days'
export type GoalSubject = 'math' | 'physics'

export interface RegularGoal {
  id: string
  kind: GoalKind
  subject: GoalSubject | null
  numbers: number[]
  topicIds: string[]
  topicTitles: string[]
  target: number
  progress: number
  done: boolean
}

export interface ExamGoal { subject: GoalSubject; goal: number }

export const SUBJECT_LABEL: Record<GoalSubject, string> = { math: 'математика', physics: 'физика' }
/** «Сдать физику на 80+» — винительный падеж. */
export const SUBJECT_ACC: Record<GoalSubject, string> = { math: 'математику', physics: 'физику' }
export const EXAM_PRESETS = [60, 70, 80, 90] as const
export const KIND_LABEL: Record<GoalKind, string> = {
  numbers: 'Номера ЕГЭ', topics: 'Темы курса', tasks: 'Задачи', days: 'Дни занятий',
}

const isSubject = (v: unknown): v is GoalSubject => v === 'math' || v === 'physics'
const isKind = (v: unknown): v is GoalKind => v === 'numbers' || v === 'topics' || v === 'tasks' || v === 'days'
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

export function parseRegularGoals(data: unknown): RegularGoal[] {
  if (!Array.isArray(data)) return []
  return data.flatMap(r => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    if (typeof o.id !== 'string' || !isKind(o.kind)) return []
    return [{
      id: o.id,
      kind: o.kind,
      subject: isSubject(o.subject) ? o.subject : null,
      numbers: Array.isArray(o.numbers) ? o.numbers.map(num).filter(n => n > 0) : [],
      topicIds: Array.isArray(o.topic_ids) ? o.topic_ids.filter((x): x is string => typeof x === 'string') : [],
      topicTitles: Array.isArray(o.topic_titles) ? o.topic_titles.filter((x): x is string => typeof x === 'string') : [],
      target: Math.max(1, num(o.target)),
      progress: Math.max(0, num(o.progress)),
      done: o.done === true,
    }]
  })
}

export function parseExamGoals(data: unknown): ExamGoal[] {
  if (!Array.isArray(data)) return []
  return data.flatMap(r => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    return isSubject(o.subject) && num(o.goal) > 0 ? [{ subject: o.subject, goal: num(o.goal) }] : []
  })
}

/** «Решить 10 задач № 3, 7 · физика», «Пройти тему «…»», «Заниматься 4 дня в неделю». */
export function goalTitle(g: Pick<RegularGoal, 'kind' | 'subject' | 'numbers' | 'topicTitles' | 'target'>): string {
  const subj = g.subject ? ` · ${SUBJECT_LABEL[g.subject]}` : ''
  switch (g.kind) {
    case 'numbers':
      return `Решить ${g.target} ${plural(g.target, 'задачу', 'задачи', 'задач')} № ${g.numbers.join(', ')}${subj}`
    case 'topics':
      return g.topicTitles.length === 1
        ? `Пройти тему «${g.topicTitles[0]}»`
        : `Пройти ${g.topicTitles.length || g.target} ${plural(g.topicTitles.length || g.target, 'тему', 'темы', 'тем')} курса`
    case 'tasks':
      return `Решить ${g.target} ${plural(g.target, 'задачу', 'задачи', 'задач')} в тренировке${subj}`
    case 'days':
      return `Заниматься ${g.target} ${plural(g.target, 'день', 'дня', 'дней')} в неделю`
  }
}

/** «3 из 10». Прогресс сверх цели не показываем — «10 из 10». */
export function goalProgressLabel(g: Pick<RegularGoal, 'progress' | 'target'>): string {
  return `${Math.min(g.progress, g.target)} из ${g.target}`
}

/** «Цели недели: выполнено k из n» — для списка учеников у преподавателя. */
export function weeklySummaryLabel(done: number, total: number): string {
  return total === 0 ? 'нет целей' : `${done} из ${total}`
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
export async function fetchMyRegularGoals(): Promise<{ goals: RegularGoal[]; error: string | null }> {
  const { data, error } = await safeRpc('my_regular_goals')
  if (error) return { goals: [], error: 'Не удалось загрузить цели недели' }
  return { goals: parseRegularGoals(data), error: null }
}

export interface GoalDraft {
  id: string | null
  kind: GoalKind
  subject: GoalSubject | null
  numbers: number[]
  topicIds: string[]
  target: number
}

export async function saveRegularGoal(d: GoalDraft): Promise<{ error: string | null }> {
  const { error } = await safeRpc('set_my_regular_goal', {
    p_id: d.id, p_kind: d.kind, p_subject: d.subject, p_numbers: d.numbers, p_topic_ids: d.topicIds, p_target: d.target,
  })
  return { error: error ? 'Не удалось сохранить цель' : null }
}

export async function deleteRegularGoal(id: string): Promise<{ error: string | null }> {
  const { error } = await safeRpc('delete_my_regular_goal', { p_id: id })
  return { error: error ? 'Не удалось удалить цель' : null }
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

/** Открытые ученику темы — для цели «пройти тему(ы) курса». */
export async function fetchGoalTopics(): Promise<Array<{ id: string; title: string; moduleTitle: string }>> {
  const { data: ids } = await safeRpc('student_visible_topics')
  if (!Array.isArray(ids) || ids.length === 0) return []
  try {
    const { data } = await db.from('topics').select('id, title, order_index, module:modules(title, order_index)').in('id', ids)
    type Row = { id: string; title: string; order_index: number; module: { title: string; order_index: number } | null }
    return ((data ?? []) as Row[])
      .sort((a, b) => (a.module?.order_index ?? 0) - (b.module?.order_index ?? 0) || a.order_index - b.order_index)
      .map(t => ({ id: t.id, title: t.title, moduleTitle: t.module?.title ?? '' }))
  } catch { return [] }
}

// ── Персонал ─────────────────────────────────────────────────────────────────
export async function fetchStudentGoalsForStaff(studentId: string): Promise<{ exam: ExamGoal[]; weekly: RegularGoal[]; error: string | null }> {
  const { data, error } = await safeRpc('student_goals_for_staff', { p_student_id: studentId })
  if (error) return { exam: [], weekly: [], error: 'Не удалось загрузить цели ученика' }
  const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return { exam: parseExamGoals(o.exam), weekly: parseRegularGoals(o.weekly), error: null }
}

export async function fetchCourseGoalsSummary(courseId: string): Promise<Map<string, { goals: number; done: number }> | null> {
  const { data, error } = await safeRpc('course_goals_summary', { p_course_id: courseId })
  if (error || !Array.isArray(data)) return null
  return new Map(data.flatMap(r => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    return typeof o.student_id === 'string' ? [[o.student_id, { goals: num(o.goals), done: num(o.done) }] as const] : []
  }))
}
