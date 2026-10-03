/**
 * §264. «Сводка» класса у учителя — разбор ответа `course_summary_for_staff` и всё, что по нему считается. Чистые
 * функции, без запросов.
 *
 * Правил здесь своих нет — только сбор общих:
 *   * прогноз — модель §255 (`egeForecast.ts`) над теми же свидетельствами, что у ученика на главной; показ — то же
 *     правило покрытия (`ready`), «за 30 дн.» — `buildForecastView.monthDelta`, «неделю назад» — `forecastAt` на
 *     момент 7 дней назад;
 *   * «ДЗ вовремя k/n» — `homeworkDeadlineSummary` (§261 → §259 `homeworkDeadline`), как в карточке ученика;
 *   * оценки проверочных — `formatGrade`/`gradeAverage` (§261);
 *   * зоны номеров — база (`student_kim_zone_shares`).
 *
 * «Просел за неделю» (макет §264, Г): прогноз упал по сравнению с моментом 7 дней назад ИЛИ за 7 дней ни одного
 * дня с решением (день серии §256: сдача ДЗ, верная задача каталога, тест, вариант, пробник).
 */
import { buildForecastView, forecastAt, normalizeForecastResponse, type ForecastResponse } from './egeForecast'
import { activeSpec, isEgeSubject } from './egeScales'
import { isZone, type CatalogZone } from './catalogRewards'
import { plural } from './plural'
import {
  DASH, formatGrade, gradeAverage, homeworkDeadlineSummary, normalizeAssessments, normalizeHomeworks,
  type AssessmentRow, type GradeAverage, type HomeworkRow,
} from './studentOverview'

const DAY_MS = 86_400_000

export type SummaryForecast =
  /** Курс не ЕГЭ по математике/физике — колонки нет (прочерк). */
  | { kind: 'none' }
  /** Покрытия не хватает — «мало данных». */
  | { kind: 'few' }
  | { kind: 'ready'; score: number; monthDelta: number | null; weekAgo: number | null }

export interface WeakNumber {
  n: number
  zone: CatalogZone
  share: number
  title: string | null
}

export interface SummaryMark {
  /** «5», «78», «ждёт», «—». */
  text: string
  tone: 'five' | 'four' | 'three' | 'two' | 'hundred' | 'wait' | 'missed'
  title: string
}

export interface SummaryStudent {
  studentId: string
  name: string
  forecast: SummaryForecast
  assessments: AssessmentRow[]
  /** Последние 3 проверочные курса — по порядку дат (старая → новая). */
  marks: SummaryMark[]
  /** Средняя оценка за проверочные курса (для сортировки). */
  assessAvg: GradeAverage | null
  homeworks: HomeworkRow[]
  hwOnTime: number
  hwTotal: number
  catalogTried: number
  catalogCorrect: number
  streak: number
  solvedToday: boolean
  lastSolved: string | null
  lastSeen: string | null
  weak: WeakNumber[]
  /** Прогноз упал за неделю (на сколько; null — не упал или сравнивать не с чем). */
  forecastDrop: number | null
  /** За 7 дней ни одного дня с решением. */
  idle7: boolean
  sagged: boolean
}

export interface CourseSummary {
  courseId: string
  courseTitle: string
  subject: string
  examType: string
  now: Date
  today: string
  forecastEnabled: boolean
  students: SummaryStudent[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const day = (v: unknown): string | null => {
  const s = str(v)
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/** Компактные свидетельства базы `[ns, source, score, at, kim_total]` → вход `normalizeForecastResponse`. */
function expandEvidence(ev: unknown, subject: string): Record<string, unknown>[] {
  if (!Array.isArray(ev)) return []
  return ev.flatMap((t: unknown) => {
    if (!Array.isArray(t)) return []
    const [ns, source, score, at, kim] = t
    return [{ subject, ns, source, score, at, kim_total: kim ?? null }]
  })
}

function forecastData(raw: unknown, subject: string, titles: unknown, now: Date): ForecastResponse | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return normalizeForecastResponse({
    now: r.now ?? now.toISOString(),
    subjects: r.subjects,
    titles,
    numbers: Array.isArray(r.numbers) ? (r.numbers as Record<string, unknown>[]).map(x => ({ ...x, subject })) : [],
    catalog_rules: null,
    evidence: expandEvidence(r.ev, subject),
  }, now)
}

/** Прогноз по курсу: та же модель и то же правило показа, что у ученика (§255). */
export function summaryForecast(data: ForecastResponse | null, subject: string): SummaryForecast {
  if (!data || !isEgeSubject(subject)) return { kind: 'none' }
  const spec = activeSpec(subject)
  if (!spec || !data.subjects.some(s => s.subject === subject)) return { kind: 'none' }
  const view = buildForecastView(spec, data.evidence, data.now)
  if (!view.current.ready) return { kind: 'few' }
  const week = forecastAt(spec, data.evidence, new Date(data.now.getTime() - 7 * DAY_MS))
  return { kind: 'ready', score: view.score, monthDelta: view.monthDelta, weekAgo: week.ready ? Math.round(week.score) : null }
}

/** Слабые номера: с данными, не «уверенная» зона — сначала «рост», потом «прогресс», по доле верного; до трёх. */
export function weakNumbers(data: ForecastResponse | null, subject: string, k = 3): WeakNumber[] {
  if (!data) return []
  const out: WeakNumber[] = []
  for (const [key, z] of Object.entries(data.zones)) {
    const [s, n] = key.split(':')
    if (s !== subject || z.share == null || !isZone(z.zone) || z.zone === 'confident') continue
    out.push({ n: Number(n), zone: z.zone, share: z.share, title: data.titles[key] ?? null })
  }
  const rank = (z: CatalogZone) => (z === 'growth' ? 0 : 1)
  return out.sort((a, b) => rank(a.zone) - rank(b.zone) || a.share - b.share || a.n - b.n).slice(0, k)
}

function markOf(r: AssessmentRow): SummaryMark {
  const title = r.date ? `${r.title} · ${r.date.split('-').reverse().slice(0, 2).join('.')}` : r.title
  if (r.status === 'accepted' && r.score != null) {
    const v = r.score
    const tone: SummaryMark['tone'] = r.gradeScale !== 'five' ? 'hundred' : v >= 5 ? 'five' : v >= 4 ? 'four' : v >= 3 ? 'three' : 'two'
    return { text: String(v).replace('.', ','), tone, title }
  }
  if (r.status == null) return { text: DASH, tone: 'missed', title: `${title}: не писал` }
  if (r.status === 'returned_for_revision') return { text: 'дор.', tone: 'wait', title: `${title}: на доработке` }
  return { text: 'ждёт', tone: 'wait', title: `${title}: ждёт проверки` }
}

/** Последние три проверочные курса — слева старая, справа новая. */
export function lastMarks(rows: readonly AssessmentRow[], k = 3): SummaryMark[] {
  return [...rows]
    .filter(r => r.date != null)
    .sort((a, b) => (b.date as string).localeCompare(a.date as string))
    .slice(0, k)
    .reverse()
    .map(markOf)
}

export function addDaysKey(dayKey: string, n: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

export function normalizeCourseSummary(raw: unknown, fallbackNow: Date = new Date()): CourseSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const course = (r.course ?? {}) as Record<string, unknown>
  const courseId = str(course.id)
  if (!courseId) return null
  const nowMs = typeof r.now === 'string' ? Date.parse(r.now) : NaN
  const now = Number.isFinite(nowMs) ? new Date(nowMs) : fallbackNow
  const today = day(r.today) ?? new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
  const subject = str(course.subject) ?? ''
  const forecastEnabled = r.forecast_enabled === true
  const students: SummaryStudent[] = []
  for (const item of Array.isArray(r.students) ? r.students : []) {
    const x = (item ?? {}) as Record<string, unknown>
    const studentId = str(x.student_id)
    if (!studentId) continue
    const data = forecastEnabled ? forecastData(x.forecast, subject, r.titles, now) : null
    const forecast = forecastEnabled ? summaryForecast(data, subject) : { kind: 'none' as const }
    const assessments = normalizeAssessments(x.assessments)
    const homeworks = normalizeHomeworks(x.homeworks)
    const dl = homeworkDeadlineSummary(homeworks, now.getTime())
    const cat = (x.catalog ?? {}) as Record<string, unknown>
    const lastSolved = day(x.last_solved)
    const idle7 = !lastSolved || lastSolved < addDaysKey(today, -6)
    const forecastDrop = forecast.kind === 'ready' && forecast.weekAgo != null && forecast.score < forecast.weekAgo
      ? forecast.weekAgo - forecast.score : null
    students.push({
      studentId,
      name: str(x.name) ?? 'Ученик',
      forecast,
      assessments,
      marks: lastMarks(assessments),
      assessAvg: gradeAverage(assessments),
      homeworks,
      hwOnTime: dl.ontime,
      hwTotal: dl.total,
      catalogTried: num(cat.tried) ?? 0,
      catalogCorrect: num(cat.correct) ?? 0,
      streak: num(x.streak) ?? 0,
      solvedToday: x.solved_today === true,
      lastSolved,
      lastSeen: day(x.last_seen),
      weak: weakNumbers(data, subject),
      forecastDrop,
      idle7,
      sagged: forecastDrop != null || idle7,
    })
  }
  return {
    courseId,
    courseTitle: str(course.title) ?? 'Курс',
    subject,
    examType: str(course.exam_type) ?? '',
    now,
    today,
    forecastEnabled,
    students,
  }
}

// ── Шапка ────────────────────────────────────────────────────────────────

export interface SummaryHeader {
  /** Средний показанный прогноз по ученикам, у кого он есть; null — ни у кого. */
  forecastAvg: number | null
  forecastCount: number
  /** «ДЗ вовремя» по классу: вовремя / (вовремя + с опозданием + срок прошёл) — %. */
  hwOnTimePct: number | null
  /** Средняя оценка проверочных курса по всем ученикам. */
  assessAvg: GradeAverage | null
  sagged: number
}

export function summaryHeader(students: readonly SummaryStudent[]): SummaryHeader {
  const ready = students.flatMap(s => (s.forecast.kind === 'ready' ? [s.forecast.score] : []))
  const ontime = students.reduce((a, s) => a + s.hwOnTime, 0)
  const total = students.reduce((a, s) => a + s.hwTotal, 0)
  return {
    forecastAvg: ready.length ? Math.round(ready.reduce((a, b) => a + b, 0) / ready.length) : null,
    forecastCount: ready.length,
    hwOnTimePct: total > 0 ? Math.round((ontime / total) * 100) : null,
    assessAvg: gradeAverage(students.flatMap(s => s.assessments)),
    sagged: students.filter(s => s.sagged).length,
  }
}

export function formatAvgGrade(avg: GradeAverage | null): string {
  return avg ? formatGrade(avg.value, avg.scale) : DASH
}

// ── Колонки и сортировка ─────────────────────────────────────────────────

export type SummarySortKey = 'name' | 'forecast' | 'delta' | 'assessments' | 'homework' | 'catalog' | 'streak' | 'weak' | 'seen'
export type SortDir = 'asc' | 'desc'

/** Значение для сортировки; null — «нет данных», такие строки всегда внизу. */
export function sortValue(s: SummaryStudent, key: SummarySortKey): number | string | null {
  switch (key) {
    case 'name': return s.name
    case 'forecast': return s.forecast.kind === 'ready' ? s.forecast.score : null
    case 'delta': return s.forecast.kind === 'ready' ? s.forecast.monthDelta : null
    case 'assessments': return s.assessAvg ? s.assessAvg.value : null
    case 'homework': return s.hwTotal > 0 ? s.hwOnTime / s.hwTotal : null
    case 'catalog': return s.catalogCorrect + s.catalogTried / 10_000
    case 'streak': return s.streak
    case 'weak': return s.weak.length
    case 'seen': return s.lastSeen
  }
}

/** Направление по умолчанию при первом нажатии: имя — по алфавиту, «был» — свежие сверху, числа — большие сверху. */
export function defaultDir(key: SummarySortKey): SortDir {
  return key === 'name' ? 'asc' : 'desc'
}

export function sortStudents(list: readonly SummaryStudent[], key: SummarySortKey, dir: SortDir): SummaryStudent[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    if (va == null && vb == null) return a.name.localeCompare(b.name, 'ru')
    if (va == null) return 1
    if (vb == null) return -1
    const c = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb, 'ru') : (va as number) - (vb as number)
    return c !== 0 ? sign * c : a.name.localeCompare(b.name, 'ru')
  })
}

// ── Подписи ──────────────────────────────────────────────────────────────

/** «+8» / «−3» / «0»; null — прочерк. */
export function deltaText(d: number | null): string {
  if (d == null) return DASH
  if (d > 0) return `+${d}`
  if (d < 0) return `−${Math.abs(d)}`
  return '0'
}

/** «сегодня» / «вчера» / «3 дня назад» / «не заходил». */
export function seenText(dayKey: string | null, today: string): string {
  if (!dayKey) return 'не заходил'
  const n = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dayKey}T00:00:00Z`)) / DAY_MS)
  if (n <= 0) return 'сегодня'
  if (n === 1) return 'вчера'
  return `${n} ${plural(n, 'день', 'дня', 'дней')} назад`
}

export function streakText(n: number): string {
  return n > 0 ? `${n} дн.` : '0'
}

/** Почему «просел»: для подсказки у строки. */
export function saggedReason(s: SummaryStudent): string {
  const parts: string[] = []
  if (s.forecastDrop != null) parts.push(`прогноз −${s.forecastDrop} за неделю`)
  if (s.idle7) parts.push('за 7 дней ни одной сдачи и решения')
  return parts.join('; ')
}

export function studentsWord(n: number): string {
  return `${n} ${plural(n, 'ученик', 'ученика', 'учеников')}`
}
