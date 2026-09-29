/**
 * §242. Статистика курса у учителя — чистая логика без сети: разбор ответов
 * RPC (PENDING_242), форматирование, сортировка таблицы класса, запомненные
 * период и разрез.
 *
 * Что и как считается, решает база (`course_stats_summary`, `course_stats_topics`,
 * `course_stats_students`, `course_stats_topic_students`) — одни определения на
 * всех экранах: «занимался в курсе» = открыл материал темы, смотрел видео темы
 * или начал/сдал работу по ДЗ темы (вход в приложение не считается); ДЗ — только
 * темы-уроки (контрольные и пробники — в разделе §241). Здесь — только слова.
 *
 * Дни — по Москве, «сегодня» берём у сервера (`to` в ответе), а не у часов
 * компьютера учителя.
 */
import { plural } from './plural'

export type StatsPeriod = '7d' | '30d' | 'all'
export type StatsView = 'topics' | 'students'

export const STATS_PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: '7d', label: '7 дней' },
  { key: '30d', label: '30 дней' },
  { key: 'all', label: 'Всё время' },
]

/** С какого дня данные вообще пишутся (§107, §204) — подпись в «Всё время». */
export const MATERIAL_VIEWS_SINCE = '2026-08-13'
export const VIDEO_SINCE = '2026-09-18'

// ─── Разбор ответов ─────────────────────────────────────────────────────────

export interface StatsPerson {
  student_id: string
  full_name: string
  last_day?: string | null
}

export interface CourseStatsSummary {
  period: StatsPeriod
  from: string | null
  to: string
  inClass: number
  active: number
  views: number
  viewsPrev: number | null
  videoSeconds: number
  videoDone: number
  submitted: number
  accepted: number
  returned: number
  pending: number
  pendingOldestAt: string | null
  avgFive: number | null
  avgFiveCount: number
  avgHundred: number | null
  avgHundredCount: number
  days: { day: string; active: number }[]
  quiet: StatsPerson[]
  noHw14: StatsPerson[]
}

export interface TopicStats {
  topicId: string
  timed: boolean
  opened: number
  videos: number
  videoDone: number
  videoStarted: number
  hw: boolean
  gradeScale: 'five' | 'hundred' | null
  submitted: number
  avgScore: number | null
  pending: number
}

export interface CourseTopicsStats {
  period: StatsPeriod
  inClass: number
  byTopic: Record<string, TopicStats>
}

export type VideoMark = 'done' | 'started' | 'none'
export type HwMark = 'draft' | 'submitted' | 'accepted' | 'returned'

export interface TopicStudentRow {
  studentId: string
  fullName: string
  opened: boolean
  /** null — у темы нет видео. */
  video: VideoMark | null
  hw: HwMark | null
  score: number | null
  gradeScale: 'five' | 'hundred' | null
}

export interface StudentStatsRow {
  studentId: string
  fullName: string
  lastDay: string | null
  days: number
  filesOpened: number
  filesTotal: number
  videoSeconds: number
  hw7: number
  hw30: number
  hwDone: number
  hwTotal: number
  avgFive: number | null
  avgHundred: number | null
  debts: number
  mockScore: number | null
}

export interface CourseStudentsStats {
  period: StatsPeriod
  to: string
  inClass: number
  mock: { id: string; title: string; maxScore: number | null } | null
  rows: StudentStatsRow[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const period = (v: unknown): StatsPeriod => (v === '30d' || v === 'all' ? v : '7d')
const scale = (v: unknown): 'five' | 'hundred' | null => (v === 'five' || v === 'hundred' ? v : null)
const people = (v: unknown): StatsPerson[] => (Array.isArray(v) ? v : [])
  .filter(isObj)
  .map(p => ({ student_id: String(p.student_id ?? ''), full_name: String(p.full_name ?? ''), last_day: str(p.last_day) }))
  .filter(p => p.student_id)

export function parseStatsSummary(raw: unknown): CourseStatsSummary | null {
  if (!isObj(raw) || !str(raw.to)) return null
  return {
    period: period(raw.period),
    from: str(raw.from),
    to: String(raw.to),
    inClass: num(raw.in_class),
    active: num(raw.active),
    views: num(raw.views),
    viewsPrev: numOrNull(raw.views_prev),
    videoSeconds: num(raw.video_seconds),
    videoDone: num(raw.video_done),
    submitted: num(raw.submitted),
    accepted: num(raw.accepted),
    returned: num(raw.returned),
    pending: num(raw.pending),
    pendingOldestAt: str(raw.pending_oldest_at),
    avgFive: numOrNull(raw.avg_five),
    avgFiveCount: num(raw.avg_five_count),
    avgHundred: numOrNull(raw.avg_hundred),
    avgHundredCount: num(raw.avg_hundred_count),
    days: (Array.isArray(raw.days) ? raw.days : []).filter(isObj)
      .map(d => ({ day: String(d.day ?? ''), active: num(d.active) }))
      .filter(d => d.day)
      .sort((a, b) => a.day.localeCompare(b.day)),
    quiet: people(raw.quiet),
    noHw14: people(raw.no_hw_14),
  }
}

export function parseTopicsStats(raw: unknown): CourseTopicsStats | null {
  if (!isObj(raw) || !Array.isArray(raw.topics)) return null
  const byTopic: Record<string, TopicStats> = {}
  for (const t of raw.topics.filter(isObj)) {
    const id = str(t.topic_id)
    if (!id) continue
    byTopic[id] = {
      topicId: id,
      timed: t.timed === true,
      opened: num(t.opened),
      videos: num(t.videos),
      videoDone: num(t.video_done),
      videoStarted: num(t.video_started),
      hw: t.hw === true,
      gradeScale: scale(t.grade_scale),
      submitted: num(t.submitted),
      avgScore: numOrNull(t.avg_score),
      pending: num(t.pending),
    }
  }
  return { period: period(raw.period), inClass: num(raw.in_class), byTopic }
}

export function parseTopicStudents(raw: unknown): TopicStudentRow[] | null {
  if (!isObj(raw) || !Array.isArray(raw.rows)) return null
  const VIDEO: readonly VideoMark[] = ['done', 'started', 'none']
  const HW: readonly HwMark[] = ['draft', 'submitted', 'accepted', 'returned']
  return raw.rows.filter(isObj).map((r): TopicStudentRow => ({
    studentId: String(r.student_id ?? ''),
    fullName: String(r.full_name ?? ''),
    opened: r.opened === true,
    video: VIDEO.find(v => v === r.video) ?? null,
    hw: HW.find(v => v === r.hw_status) ?? null,
    score: numOrNull(r.score),
    gradeScale: scale(r.grade_scale),
  })).filter(r => r.studentId)
}

export function parseStudentsStats(raw: unknown): CourseStudentsStats | null {
  if (!isObj(raw) || !Array.isArray(raw.rows) || !str(raw.to)) return null
  const mock = isObj(raw.mock) && str(raw.mock.id)
    ? { id: String(raw.mock.id), title: String(raw.mock.title ?? ''), maxScore: numOrNull(raw.mock.max_score) }
    : null
  return {
    period: period(raw.period),
    to: String(raw.to),
    inClass: num(raw.in_class),
    mock,
    rows: raw.rows.filter(isObj).map(r => ({
      studentId: String(r.student_id ?? ''),
      fullName: String(r.full_name ?? ''),
      lastDay: str(r.last_day),
      days: num(r.days),
      filesOpened: num(r.files_opened),
      filesTotal: num(r.files_total),
      videoSeconds: num(r.video_seconds),
      hw7: num(r.hw7),
      hw30: num(r.hw30),
      hwDone: num(r.hw_done),
      hwTotal: num(r.hw_total),
      avgFive: numOrNull(r.avg_five),
      avgHundred: numOrNull(r.avg_hundred),
      debts: num(r.debts),
      mockScore: numOrNull(r.mock_score),
    })).filter(r => r.studentId),
  }
}

// ─── Слова и числа ──────────────────────────────────────────────────────────

/** Сколько дней между двумя датами «ГГГГ-ММ-ДД» (по календарю, без часовых поясов). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

/** Московская дата момента времени — «ГГГГ-ММ-ДД». */
export function moscowDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
}

export function pluralDays(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')}`
}

export type AgoTone = 'ok' | 'mid' | 'bad'

/**
 * «Был в курсе»: «сегодня», «1 день назад», «5 дней назад», «не заходил».
 * Цвет по давности: до двух дней — зелёный, до недели — жёлтый, неделя и
 * больше (и «ни разу») — красный. Тот же порог, что «не заходили 7 дней».
 */
export function formatAgo(lastDay: string | null, today: string): { text: string; tone: AgoTone; days: number | null } {
  if (!lastDay) return { text: 'не заходил', tone: 'bad', days: null }
  const d = Math.max(0, daysBetween(lastDay, today))
  if (d === 0) return { text: 'сегодня', tone: 'ok', days: 0 }
  return { text: `${pluralDays(d)} назад`, tone: d <= 2 ? 'ok' : d < 7 ? 'mid' : 'bad', days: d }
}

/** Время видео: «12 мин», «1 ч 05 м», «11 ч 40 м»; меньше минуты — «< 1 мин», ноль — «0 мин». */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s === 0) return '0 мин'
  if (s < 60) return '< 1 мин'
  const totalMin = Math.round(s / 60)
  if (totalMin < 60) return `${totalMin} мин`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h} ч ${String(m).padStart(2, '0')} м`
}

/** Средний балл: пятибалльная — «4,3», стобалльная — «70». */
export function formatScore(value: number | null, scale: 'five' | 'hundred' | null): string {
  if (value === null) return '—'
  if (scale === 'hundred') return String(Math.round(value))
  return value.toFixed(1).replace('.', ',')
}

/** Средний ученика: пятибалльный, если есть, иначе стобалльный. */
export function pickAvg(avgFive: number | null, avgHundred: number | null): { value: number | null; scale: 'five' | 'hundred' | null } {
  if (avgFive !== null) return { value: avgFive, scale: 'five' }
  if (avgHundred !== null) return { value: avgHundred, scale: 'hundred' }
  return { value: null, scale: null }
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
/** «13 августа» из «2026-08-13». */
export function formatDayMonth(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTHS_GEN[Number(day.slice(5, 7)) - 1] ?? ''}`
}
/** «29.09» из «2026-09-29». */
export function formatDayShort(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`
}

/** Подпись «к прошлому периоду»: «к прошлой неделе», «к прошлым 30 дням». */
export function prevPeriodLabel(p: StatsPeriod): string | null {
  return p === '7d' ? 'к прошлой неделе' : p === '30d' ? 'к прошлым 30 дням' : null
}

/** «+18», «−3», «0» — со знаком, минус типографский. */
export function formatDelta(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `−${Math.abs(n)}`
  return '0'
}

/** Доля для полоски: 0..100, без деления на ноль. */
export function percent(part: number, whole: number): number {
  if (!whole) return 0
  return Math.max(0, Math.min(100, Math.round(part / whole * 100)))
}

/** Слабая полоска (светлее) — меньше половины. */
export const isLow = (part: number, whole: number) => percent(part, whole) < 50

// ─── Таблица класса: сортировка ─────────────────────────────────────────────

export type StudentSortKey = 'name' | 'last' | 'days' | 'files' | 'video' | 'hw7' | 'hw30' | 'hw' | 'avg' | 'debts' | 'mock'
export interface StudentSort { key: StudentSortKey; dir: 'asc' | 'desc' }

/** По умолчанию — дольше всех не заходившие сверху. */
export const DEFAULT_STUDENT_SORT: StudentSort = { key: 'last', dir: 'desc' }

/** Направление при первом нажатии на столбец: имя — по алфавиту, остальное — «больше сверху». */
export function firstDir(key: StudentSortKey): 'asc' | 'desc' {
  return key === 'name' ? 'asc' : 'desc'
}

export function nextSort(cur: StudentSort, key: StudentSortKey): StudentSort {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: firstDir(key) }
}

/**
 * Значение для сортировки. «Был в курсе» — сколько дней назад (ни разу —
 * бесконечно давно). Пустые (нет оценок, не писал пробник) — всегда внизу,
 * в какую сторону ни сортируй.
 */
function sortValue(r: StudentStatsRow, key: StudentSortKey, today: string): number | string | null {
  switch (key) {
    case 'name': return r.fullName
    case 'last': return r.lastDay ? daysBetween(r.lastDay, today) : Number.POSITIVE_INFINITY
    case 'days': return r.days
    case 'files': return r.filesTotal ? r.filesOpened / r.filesTotal : 0
    case 'video': return r.videoSeconds
    case 'hw7': return r.hw7
    case 'hw30': return r.hw30
    case 'hw': return r.hwTotal ? r.hwDone / r.hwTotal : 0
    case 'avg': {
      const a = pickAvg(r.avgFive, r.avgHundred)
      return a.value === null ? null : a.scale === 'hundred' ? a.value / 20 : a.value
    }
    case 'debts': return r.debts
    case 'mock': return r.mockScore
  }
}

export function sortStudents(rows: StudentStatsRow[], sort: StudentSort, today: string): StudentStatsRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return rows.slice().sort((a, b) => {
    const x = sortValue(a, sort.key, today)
    const y = sortValue(b, sort.key, today)
    if (x === null && y !== null) return 1
    if (y === null && x !== null) return -1
    let c = 0
    if (typeof x === 'string' && typeof y === 'string') c = x.localeCompare(y, 'ru')
    else if (typeof x === 'number' && typeof y === 'number') c = x === y ? 0 : x < y ? -1 : 1
    if (c !== 0) return c * sign
    return a.fullName.localeCompare(b.fullName, 'ru')
  })
}

// ─── Запомненные период и разрез ────────────────────────────────────────────

export const PERIOD_KEY = 'course-stats:period'
export const VIEW_KEY = 'course-stats:view'

export function readPeriod(): StatsPeriod {
  try {
    const v = localStorage.getItem(PERIOD_KEY)
    return v === '30d' || v === 'all' || v === '7d' ? v : '7d'
  } catch {
    return '7d'
  }
}

export function readView(): StatsView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'students' ? 'students' : 'topics'
  } catch {
    return 'topics'
  }
}

export function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Приватное окно или запрещённое хранилище — просто не запоминаем.
  }
}
