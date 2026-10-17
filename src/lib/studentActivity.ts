/**
 * «Посещения по дням» на главной ученика (этап 2 ЛК, письмо
 * ЛК_стиль_добавить_активность_и_календарь_тем.md, 15.10): ответ
 * `student_home_activity(84)` → карта 12 недель. Чистые преобразования; сеть —
 * в useStudentActivity. «Календарь тем» живёт в программе курса
 * (src/lib/courseRoadmap.ts).
 */
import { plural } from '@/lib/plural'

const DAY = 86_400_000
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

const dayMs = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, dd)
}
export const addDays = (d: string, n: number) => new Date(dayMs(d) + n * DAY).toISOString().slice(0, 10)
/** Понедельник недели дня (YYYY-MM-DD). */
export const mondayOf = (d: string) => addDays(d, -((new Date(dayMs(d)).getUTCDay() + 6) % 7))

/** «13 окт». */
export function shortDay(d: string): string {
  const [, m, dd] = d.split('-').map(Number)
  return `${dd} ${MONTHS[m - 1]}`
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
  today: boolean
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
      col.push({ day, level: lv, solved: n, future, today: day === today })
    }
    weeks.push(col)
  }
  return { weeks, streak: raw?.streak ?? 0, record: raw?.record ?? 0, activeDays }
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** Подсказка клетки: «среда, 14 октября: 6 задач» — как было на главной до «лёгкой» (§254). */
export function dayLabel(d: Pick<ActivityDay, 'day' | 'level' | 'solved' | 'future' | 'today'>): string {
  const [, m, dd] = d.day.split('-').map(Number)
  const head = `${d.today ? 'сегодня, ' : ''}${WEEKDAYS[new Date(dayMs(d.day)).getUTCDay()]}, ${dd} ${MONTHS_GEN[m - 1]}`
  if (d.future) return `${head}: ещё впереди`
  if (d.solved > 0) return `${head}: ${d.solved} ${plural(d.solved, 'задача', 'задачи', 'задач')}`
  return d.level > 0 ? `${head}: заходил, задач не решал` : `${head}: не заходил`
}
