/**
 * §288. Открытие уроков «по прохождению» — что показать ученику.
 *
 * Открыт ли урок, решает база (`my_course_topic_locks` → `_progress_state`, то же
 * определение, что в воротах RLS). Здесь — только слова: подпись под замком и
 * «Открыт урок «…»» после закрытия предыдущего. Функции — чистые; сеть — только
 * fetchCourseTopicLocks внизу.
 */
import { supabase } from '@/lib/supabase'

export type OpenReason = 'manual' | 'first2' | 'date' | 'prev_closed' | null

/** Строка ответа `my_course_topic_locks`. */
export interface TopicLock {
  topic_id: string
  title: string | null
  open: boolean
  reason: OpenReason
  closed: boolean
  percent: number | null
  after_topic_id: string | null
  after_title: string | null
  /** YYYY-MM-DD: плановая дата урока, если задана. */
  opens_on: string | null
}

export interface CourseTopicLocks {
  mode: 'schedule' | 'progress'
  /** Персонал курса: расчёт «ученик с нулевым прогрессом». */
  preview?: boolean
  topics: TopicLock[]
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

function dayLabel(day: string): string {
  const [, m, d] = day.slice(0, 10).split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`
}

/**
 * Подпись под замком: «Откроется после урока «N»», «… или 12 октября»,
 * «Откроется 12 октября». Сегодняшняя и прошедшая дата урок уже открыли бы,
 * поэтому в подписи — только будущая.
 */
export function progressNote(lock: TopicLock, today: string = new Date().toLocaleDateString('en-CA')): string | null {
  if (lock.open) return null
  const date = lock.opens_on && lock.opens_on.slice(0, 10) > today ? dayLabel(lock.opens_on) : null
  if (lock.after_title && date) return `Откроется после урока «${lock.after_title}» или ${date}`
  if (lock.after_title) return `Откроется после урока «${lock.after_title}»`
  if (date) return `Откроется ${date}`
  return 'Откроется позже'
}

/** Темы программы с решением базы (курс «по прохождению»); иначе — как есть. */
export function withProgressLocks<T extends { id: string }>(
  topics: T[],
  locks: CourseTopicLocks | null | undefined,
): Array<T & { progress?: { open: boolean; note: string | null } }> {
  if (!locks || locks.mode !== 'progress') return topics
  const byId = new Map(locks.topics.map((l) => [l.topic_id, l]))
  return topics.map((t) => {
    const l = byId.get(t.id)
    return l ? { ...t, progress: { open: l.open, note: progressNote(l) } } : t
  })
}

const SEEN_KEY = (courseId: string, who: string) => `progress-open:${who}:${courseId}`

/**
 * Какие уроки открылись с прошлого визита — для «Открыт урок «…»». Помним
 * открытые в браузере (по ученику и курсу). Первый визит — ничего не
 * показываем, только запоминаем. Открытые «первыми двумя» и вручную раньше
 * ученик уже видел — сообщаем о тех, что открылись прохождением или датой.
 */
export function takeNewlyOpened(courseId: string, who: string, locks: CourseTopicLocks): TopicLock[] {
  if (locks.mode !== 'progress' || locks.preview) return []
  const open = locks.topics.filter((l) => l.open)
  let seen: string[] | null
  try {
    const raw = localStorage.getItem(SEEN_KEY(courseId, who))
    seen = raw ? (JSON.parse(raw) as string[]) : null
  } catch {
    seen = null
  }
  try {
    localStorage.setItem(SEEN_KEY(courseId, who), JSON.stringify(open.map((l) => l.topic_id)))
  } catch {
    /* хранилище недоступно — просто без сообщения */
  }
  if (!seen) return []
  const had = new Set(seen)
  return open.filter((l) => !had.has(l.topic_id) && l.reason !== 'first2')
}

/** Текст сообщения: «Открыт урок «N»» / «Открыты уроки: «A», «B»». */
export function openedMessage(titles: string[]): string | null {
  if (titles.length === 0) return null
  if (titles.length === 1) return `Открыт урок «${titles[0]}»`
  return `Открыты уроки: ${titles.map((t) => `«${t}»`).join(', ')}`
}

/** Замки курса; любой сбой (нет функции, нет сети) — null: программа по датам. */
export async function fetchCourseTopicLocks(courseId: string): Promise<CourseTopicLocks | null> {
  try {
    const res = await supabase.rpc('my_course_topic_locks' as never, { p_course_id: courseId } as never)
    if (!res || res.error) return null
    const data = res.data as CourseTopicLocks | null
    return data && Array.isArray(data.topics) ? data : null
  } catch {
    return null
  }
}

// ── персонал курса: режим, «Прохождение», ручные отметки ──────────────────

export type CellState = 'closed' | 'pending_review' | 'open' | 'locked'
export type HwState = 'none' | 'draft' | 'submitted' | 'returned' | 'accepted'
/** Ячейка матрицы: [состояние, причина открытия, задач осталось, ДЗ, %, ручная отметка]. */
export type MatrixCell = [CellState, OpenReason, number, HwState, number | null, 'open' | 'closed' | null]

export interface ProgressMatrix {
  mode: 'schedule' | 'progress'
  topics: Array<{ id: string; title: string; module_id: string; module_title: string }>
  students: Array<{
    id: string
    full_name: string | null
    email: string | null
    last_closed_at: string | null
    closed: number
    cells: MatrixCell[]
  }>
}

const REASON_TEXT: Record<Exclude<OpenReason, null>, string> = {
  first2: 'открыт: один из первых двух уроков раздела',
  date: 'открыт: наступила дата урока',
  prev_closed: 'открыт: закрыт предыдущий урок',
  manual: 'открыт вручную',
}

const HW_TEXT: Record<HwState, string | null> = {
  none: 'ДЗ не сдано',
  draft: 'ДЗ в черновике',
  submitted: 'ДЗ на проверке',
  returned: 'ДЗ возвращено на доработку',
  accepted: null,
}

/** Подсказка к ячейке: причина открытия или чего не хватает до закрытия. */
export function cellHint(cell: MatrixCell): string {
  const [state, reason, left, hw, pct, ovr] = cell
  const parts: string[] = []
  if (state === 'closed') parts.push(pct == null ? 'урок закрыт' : `урок закрыт, ${pct} %`)
  else if (state === 'locked') parts.push(ovr === 'closed' ? 'закрыт вручную' : 'заблокирован: не закрыт предыдущий урок')
  else if (reason) parts.push(REASON_TEXT[reason])
  if (state !== 'closed') {
    if (left > 0) parts.push(`осталось задач автопроверки: ${left}`)
    const h = HW_TEXT[hw]
    if (h && hw !== 'none') parts.push(h)
    else if (h && left === 0 && state !== 'locked') parts.push(h)
  }
  if (ovr === 'open' && reason !== 'manual') parts.push('есть ручная отметка «открыт»')
  return parts.join('; ')
}

/** «Застрял»: ни одного закрытого урока за последние N дней (или вообще). */
export function isStuck(s: Pick<ProgressMatrix['students'][number], 'last_closed_at'>, days: number, now: Date = new Date()): boolean {
  if (!s.last_closed_at) return true
  return now.getTime() - new Date(s.last_closed_at).getTime() > days * 86_400_000
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never)
  if (error) throw new Error(error.message)
  return data as T
}

export function fetchCourseProgressMatrix(courseId: string): Promise<ProgressMatrix> {
  return call('course_progress_matrix', { p_course_id: courseId })
}

/** state: 'open' | 'closed' | null (снять отметку). */
export function setTopicOverride(studentId: string, topicId: string, state: 'open' | 'closed' | null, note: string | null = null) {
  return call('staff_topic_override_set', { p_student_id: studentId, p_topic_id: topicId, p_state: state, p_note: note })
}

export function openTopicForCourse(topicId: string): Promise<number> {
  return call('staff_topic_open_for_course', { p_topic_id: topicId })
}

export function openModuleForStudent(studentId: string, moduleId: string): Promise<number> {
  return call('staff_module_open_for_student', { p_student_id: studentId, p_module_id: moduleId })
}

/** Режим курса; нет строки — 'schedule' (по датам). */
export async function fetchCourseUnlockMode(courseId: string): Promise<'schedule' | 'progress'> {
  const { data, error } = await supabase
    .from('course_unlock_modes' as never)
    .select('mode')
    .eq('course_id', courseId)
    .maybeSingle()
  if (error) return 'schedule'
  return (data as { mode?: string } | null)?.mode === 'progress' ? 'progress' : 'schedule'
}

export function setCourseUnlockMode(courseId: string, mode: 'schedule' | 'progress'): Promise<string> {
  return call('admin_course_unlock_mode_set', { p_course_id: courseId, p_mode: mode })
}
