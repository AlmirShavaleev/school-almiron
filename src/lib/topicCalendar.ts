/**
 * Главная ученика, этап 2 ЛК (письмо ЛК_стиль_добавить_активность_и_календарь_тем.md,
 * 15.10): «Календарь тем» и «Посещения по дням». Здесь — только чистые
 * преобразования; сеть — в useTopicCalendar / useStudentActivity.
 *
 * Календарь курса ПО РАСПИСАНИЮ — недели учебного плана (§151:
 * `course_study_plans.start_date` — понедельник, `course_study_plan_items.week_no`,
 * личные сдвиги `course_study_plan_overrides`), номер недели — как
 * `study_plan_current_week()`: floor((сегодня по Москве − старт) / 7) + 1.
 * Плана у курса нет — недели по датам открытия тем (`available_from`).
 * Открыта ли тема — `isTopicOpen` (зеркало `topic_open_now`).
 *
 * Курс ПО ПРОХОЖДЕНИЮ (§288) — дат нет: открытость решает база
 * (`my_course_topic_locks`). Показываем «Сейчас открыто» и следующие 3 урока с
 * подписью под замком; в пробном периоде (`demo`) закрытые уроки откроются
 * только с подпиской.
 */
import { isTopicOpen } from '@/lib/topicAvailability'
import { progressNote, type CourseTopicLocks } from '@/lib/progressUnlock'

const DAY = 86_400_000
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

const dayMs = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, dd)
}
export const addDays = (d: string, n: number) => new Date(dayMs(d) + n * DAY).toISOString().slice(0, 10)
/** Понедельник недели дня (YYYY-MM-DD). */
export const mondayOf = (d: string) => addDays(d, -((new Date(dayMs(d)).getUTCDay() + 6) % 7))

/** «13 окт», «13–19 окт», «27 окт – 2 ноя». */
export function shortDay(d: string): string {
  const [, m, dd] = d.split('-').map(Number)
  return `${dd} ${MONTHS[m - 1]}`
}
export function weekRange(start: string): string {
  const end = addDays(start, 6)
  const [, m1, d1] = start.split('-').map(Number)
  const [, m2, d2] = end.split('-').map(Number)
  return m1 === m2 ? `${d1}–${d2} ${MONTHS[m2 - 1]}` : `${shortDay(start)} – ${shortDay(end)}`
}

// ── по расписанию ─────────────────────────────────────────────────────────

export interface CalTopicRow {
  id: string
  title: string
  is_open: boolean | null
  available_from: string | null
  /** Порядок в программе: модуль, затем тема. */
  order: number
}

export interface PlanItem { topic_id: string; week_no: number }
export interface PlanOverride { topic_id: string; week_no: number | null; removed: boolean }

export interface CalTopic {
  id: string
  title: string
  open: boolean
  /** Закрыта — когда откроется (YYYY-MM-DD), если известно. */
  opensOn: string | null
}

export interface CalWeek {
  no: number
  start: string
  current: boolean
  past: boolean
  topics: CalTopic[]
}

function calTopic(t: CalTopicRow, today: string, fallbackOpen: string | null): CalTopic {
  const open = isTopicOpen(t, today)
  const date = t.available_from ? t.available_from.slice(0, 10) : fallbackOpen
  return { id: t.id, title: t.title, open, opensOn: open ? null : (date && date > today ? date : null) }
}

/** Окно недель: 2 назад, текущая, 4 вперёд — в пределах непустых недель. */
const BACK = 2
const AHEAD = 4

/**
 * Недели плана вокруг текущей. `start` — понедельник старта плана. Если план
 * ещё не начался — показываются первые недели, закончился — последние.
 */
export function planWeeks(
  start: string,
  items: PlanItem[],
  overrides: PlanOverride[],
  topics: CalTopicRow[],
  today: string,
): CalWeek[] {
  const byId = new Map(topics.map(t => [t.id, t]))
  const weekOf = new Map(items.map(i => [i.topic_id, i.week_no]))
  for (const o of overrides) {
    if (o.removed) weekOf.delete(o.topic_id)
    else if (o.week_no != null) weekOf.set(o.topic_id, o.week_no)
  }
  const byWeek = new Map<number, CalTopicRow[]>()
  for (const [id, w] of weekOf) {
    const t = byId.get(id)
    if (!t) continue
    byWeek.set(w, [...(byWeek.get(w) ?? []), t])
  }
  if (byWeek.size === 0) return []
  const weeks = [...byWeek.keys()].sort((a, b) => a - b)
  const first = weeks[0], last = weeks[weeks.length - 1]
  const cur = Math.floor((dayMs(today) - dayMs(start)) / (7 * DAY)) + 1
  const center = Math.min(Math.max(cur, first), last)
  let from = Math.max(first, center - BACK)
  const to = Math.min(last, from + BACK + AHEAD)
  from = Math.max(first, to - BACK - AHEAD)
  const out: CalWeek[] = []
  for (let no = from; no <= to; no++) {
    const ws = addDays(start, 7 * (no - 1))
    const list = (byWeek.get(no) ?? []).slice().sort((a, b) => a.order - b.order)
    out.push({ no, start: ws, current: no === cur, past: no < cur, topics: list.map(t => calTopic(t, today, ws)) })
  }
  return out
}

/** Плана нет — недели по датам открытия тем (понедельник даты). */
export function dateWeeks(topics: CalTopicRow[], today: string): CalWeek[] {
  const thisMonday = mondayOf(today)
  const byWeek = new Map<string, CalTopicRow[]>()
  for (const t of topics) {
    if (!t.available_from) continue
    const m = mondayOf(t.available_from.slice(0, 10))
    byWeek.set(m, [...(byWeek.get(m) ?? []), t])
  }
  const out: CalWeek[] = []
  for (let k = -BACK; k <= AHEAD; k++) {
    const ws = addDays(thisMonday, 7 * k)
    const list = (byWeek.get(ws) ?? []).slice().sort((a, b) => a.order - b.order)
    out.push({ no: k, start: ws, current: k === 0, past: k < 0, topics: list.map(t => calTopic(t, today, null)) })
  }
  return out.some(w => w.topics.length > 0) ? out : []
}

// ── по прохождению ────────────────────────────────────────────────────────

export interface ProgressView {
  /** Открыты сейчас и ещё не пройдены. */
  open: CalTopic[]
  done: number
  /** Следующие закрытые уроки (до трёх) с подписью под замком. */
  next: Array<CalTopic & { note: string }>
  /** Закрытых всего (для «и ещё N»). */
  lockedTotal: number
}

export const TRIAL_LOCK_NOTE = 'Откроется с подпиской'

export function progressView(locks: CourseTopicLocks, demo: boolean, today: string): ProgressView {
  const open = locks.topics.filter(l => l.open && !l.closed)
  const locked = locks.topics.filter(l => !l.open)
  return {
    open: open.map(l => ({ id: l.topic_id, title: l.title ?? 'Урок', open: true, opensOn: null })),
    done: locks.topics.filter(l => l.closed).length,
    next: locked.slice(0, 3).map(l => ({
      id: l.topic_id, title: l.title ?? 'Урок', open: false, opensOn: l.opens_on,
      note: demo ? TRIAL_LOCK_NOTE : (progressNote(l, today) ?? 'Откроется позже'),
    })),
    lockedTotal: locked.length,
  }
}

// ── посещения по дням ─────────────────────────────────────────────────────

export interface ActivityRaw {
  today?: string
  from?: string
  streak?: number
  record?: number
  visits?: string[]
  solved?: Array<{ day: string; n: number }>
}

export interface ActivityDay {
  day: string
  /** 0 — не заходил, 1 — заходил, 2..4 — решал задачи (1–4, 5–9, 10+). */
  level: 0 | 1 | 2 | 3 | 4
  solved: number
  future: boolean
}

export interface ActivityGrid {
  /** Колонки-недели (пн…вс), старые слева. */
  weeks: ActivityDay[][]
  streak: number
  record: number
  activeDays: number
}

function level(visited: boolean, n: number): ActivityDay['level'] {
  if (n >= 10) return 4
  if (n >= 5) return 3
  if (n >= 1) return 2
  return visited ? 1 : 0
}

/** Ответ `student_home_activity(84)` → 12 недель по 7 дней, последняя — текущая. */
export function activityGrid(raw: ActivityRaw | null | undefined, todayFallback: string, weeksCount = 12): ActivityGrid {
  const today = raw?.today?.slice(0, 10) ?? todayFallback
  const visits = new Set((raw?.visits ?? []).map(d => String(d).slice(0, 10)))
  const solved = new Map((raw?.solved ?? []).map(s => [String(s.day).slice(0, 10), Number(s.n) || 0]))
  const firstMonday = addDays(mondayOf(today), -7 * (weeksCount - 1))
  const weeks: ActivityDay[][] = []
  let activeDays = 0
  for (let w = 0; w < weeksCount; w++) {
    const col: ActivityDay[] = []
    for (let d = 0; d < 7; d++) {
      const day = addDays(firstMonday, w * 7 + d)
      const n = solved.get(day) ?? 0
      const future = day > today
      const lv = future ? 0 : level(visits.has(day), n)
      if (lv > 0) activeDays++
      col.push({ day, level: lv, solved: n, future })
    }
    weeks.push(col)
  }
  return { weeks, streak: raw?.streak ?? 0, record: raw?.record ?? 0, activeDays }
}
