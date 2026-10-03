/**
 * §261. «Ученик целиком» — разбор ответов базы и сборка того, что видят учитель (карточка ученика) и родитель
 * (лист отчёта). Чистые функции, без запросов.
 *
 * Откуда числа и где правила — по одному месту на каждое:
 *   * работы (проверочные и ДЗ) — база, `student_work_rows` (PENDING_261): первая сдача, вердикт учителя, баллы по
 *     критериям из таблицы преподавателя (§260), средняя по классу;
 *   * «вовремя / с опозданием / не сдано» — `homeworkDeadline` (§259, src/lib/homeworkDeadline.ts): база отдаёт срок
 *     и первую сдачу, состояние считается ТОЙ ЖЕ функцией, что в журнале учителя;
 *   * «Примерный балл» — `buildForecastView` (§255, src/lib/egeForecast.ts) над теми же свидетельствами, что у
 *     ученика на главной; показывать ли балл — то же правило покрытия (`current.ready`);
 *   * зоны номеров и их пороги — база (`student_kim_zone_shares`, `catalog_reward_rules`), здесь своих порогов нет.
 */
import { buildForecastView, normalizeForecastResponse, type ForecastResponse } from './egeForecast'
import { activeSpec, isEgeSubject, part1Numbers, type EgeSubject } from './egeScales'
import { deadlineLabel, deadlineTone, homeworkDeadline, type DeadlineState, type DeadlineTone } from './homeworkDeadline'
import { normalizeStaffAchievements, type StaffAchievements } from './achievements'
import { isZone, type CatalogRules, type CatalogZone } from './catalogRewards'
import { plural } from './plural'

/** Прочерк — тот же символ, что на листе отчёта. */
export const DASH = '—'

// ── Строки работ ─────────────────────────────────────────────────────────

export type GradeScale = 'five' | 'hundred'

export interface AssessmentRow {
  title:     string
  subject:   string
  examType:  string
  kind:      string
  /** День работы «YYYY-MM-DD» (начало окна; без окна — первая сдача) или null. */
  date:      string | null
  /** Статус последней попытки: null — ученик не писал. */
  status:    string | null
  /** Оценка последнего вердикта учителя (только у принятой работы). */
  score:     number | null
  gradeScale: GradeScale | null
  /** Баллы по критериям (§260, таблица преподавателя) — «10 из 12»; null — учитель баллов не ставил. */
  points:    number | null
  pointsMax: number | null
  /** Средняя оценка по классу; в отчёте — null, если в классе меньше шести (приватность, §217). */
  classAvg:  number | null
  classSize: number
}

export interface HomeworkRow {
  title:     string
  subject:   string
  examType:  string
  /** Срок «YYYY-MM-DD» или null. */
  dueAt:     string | null
  firstSubmittedAt: string | null
  status:    string | null
  score:     number | null
  gradeScale: GradeScale | null
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const day = (v: unknown): string | null => {
  const s = str(v)
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}
const scale = (v: unknown): GradeScale | null => (v === 'five' || v === 'hundred' ? v : null)

export function normalizeAssessments(raw: unknown): AssessmentRow[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item: unknown) => {
    const x = (item ?? {}) as Record<string, unknown>
    const title = str(x.title)
    if (!title) return []
    return [{
      title,
      subject: str(x.subject) ?? '',
      examType: str(x.exam_type) ?? '',
      kind: str(x.kind) ?? 'check',
      date: day(x.date),
      status: str(x.status),
      score: num(x.score),
      gradeScale: scale(x.grade_scale),
      points: num(x.points),
      pointsMax: num(x.points_max),
      classAvg: num(x.class_avg),
      classSize: num(x.class_size) ?? 0,
    }]
  })
}

export function normalizeHomeworks(raw: unknown): HomeworkRow[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item: unknown) => {
    const x = (item ?? {}) as Record<string, unknown>
    const title = str(x.title)
    if (!title) return []
    return [{
      title,
      subject: str(x.subject) ?? '',
      examType: str(x.exam_type) ?? '',
      dueAt: day(x.due_at),
      firstSubmittedAt: str(x.first_submitted_at),
      status: str(x.status),
      score: num(x.score),
      gradeScale: scale(x.grade_scale),
    }]
  })
}

// ── Числа ────────────────────────────────────────────────────────────────

/** «4,0» — средняя оценка одной цифрой после запятой; «78» — у стобалльной. */
export function formatGrade(value: number, gradeScale: GradeScale = 'five'): string {
  if (gradeScale === 'hundred') return String(Math.round(value))
  return (Math.round(value * 10) / 10).toFixed(1).replace('.', ',')
}

/** «10 из 12», «½ из 1»; баллов нет — null (в таблице прочерк). */
export function pointsLabel(points: number | null, max: number | null): string | null {
  if (points == null || max == null || !(max > 0)) return null
  const p = (v: number) => (v === 0.5 ? '½' : String(v).replace('.', ','))
  return `${p(points)} из ${p(max)}`
}

export interface GradeAverage {
  value: number
  count: number
  scale: GradeScale
}

/**
 * Средняя оценка по принятым работам. Пятибалльная и стобалльная в одну среднюю не складываются: если есть
 * пятибалльные — средняя по ним, иначе по стобалльным. Нет оценок — null (прочерк, а не ноль).
 */
export function gradeAverage(rows: readonly { score: number | null; gradeScale: GradeScale | null }[]): GradeAverage | null {
  for (const s of ['five', 'hundred'] as const) {
    const xs = rows.filter(r => r.gradeScale === s && r.score != null).map(r => r.score as number)
    if (xs.length > 0) return { value: xs.reduce((a, b) => a + b, 0) / xs.length, count: xs.length, scale: s }
  }
  return null
}

export interface AssessmentSummary {
  /** Средняя ученика; null — оценок нет. */
  avg:      GradeAverage | null
  /** Средняя класса по ТЕМ ЖЕ работам (где у ученика есть оценка и у класса средняя); null — сравнивать не с чем. */
  classAvg: number | null
}

/**
 * Плитка «Проверочные»: средняя оценка ученика, сколько работ, средняя класса. Класс берётся по тем же работам,
 * что и ученик (яблоки с яблоками): «4,0 · 3 работы · класс 3,9».
 */
export function assessmentSummary(rows: readonly AssessmentRow[]): AssessmentSummary {
  const avg = gradeAverage(rows)
  if (!avg) return { avg: null, classAvg: null }
  const same = rows.filter(r => r.gradeScale === avg.scale && r.score != null && r.classAvg != null)
  const classAvg = same.length > 0 ? same.reduce((a, r) => a + (r.classAvg as number), 0) / same.length : null
  return { avg, classAvg }
}

export function worksWord(n: number): string {
  return `${n} ${plural(n, 'работа', 'работы', 'работ')}`
}

/** Подпись под плиткой «Проверочные»: «3 работы · класс 3,9». */
export function assessmentNote(s: AssessmentSummary): string {
  if (!s.avg) return 'оценок за проверочные пока нет'
  const parts = [worksWord(s.avg.count)]
  if (s.classAvg != null) parts.push(`класс ${formatGrade(s.classAvg, s.avg.scale)}`)
  return parts.join(' · ')
}

// ── ДЗ: срок и первая сдача (§259) ───────────────────────────────────────

export interface DeadlineSummary261 {
  ontime:  number
  late:    number
  /** Срок прошёл, не сдано. ДЗ, срок которого ещё впереди, сюда НЕ идёт: «не сдано» до срока — неправда. */
  missing: number
  /** Сколько ДЗ «уже должно было быть сдано»: вовремя + с опозданием + не сдано. */
  total:   number
}

/** Состояние срока строки ДЗ — функцией §259 (первая сдача против срока по Москве). */
export function rowDeadline(row: HomeworkRow, nowMs: number): DeadlineState {
  return homeworkDeadline(row.dueAt, row.firstSubmittedAt ? [{ submitted_at: row.firstSubmittedAt }] : [], nowMs)
}

export function homeworkDeadlineSummary(rows: readonly HomeworkRow[], nowMs: number): DeadlineSummary261 {
  const out: DeadlineSummary261 = { ontime: 0, late: 0, missing: 0, total: 0 }
  for (const r of rows) {
    const s = rowDeadline(r, nowMs)
    if (s.kind === 'ontime') out.ontime += 1
    else if (s.kind === 'late') out.late += 1
    else if (s.kind === 'overdue') out.missing += 1
  }
  out.total = out.ontime + out.late + out.missing
  return out
}

/** «2 с опозданием · 1 не сдано» / «все вовремя». */
export function deadlineNote(s: DeadlineSummary261, sep = ' · '): string {
  if (s.total === 0) return 'сроков, которые уже прошли, пока нет'
  const parts: string[] = []
  if (s.late > 0) parts.push(`${s.late} с опозданием`)
  if (s.missing > 0) parts.push(`${s.missing} не сдано`)
  return parts.join(sep) || 'все вовремя'
}

export interface HomeworkView {
  row:      HomeworkRow
  deadline: DeadlineState
  /** Подпись в колонке «Сдал»: «вовремя», «опоздание 2 дн.», «просрочено 2 дн.», «ещё 3 дн.», «сдано», «—». */
  label:    string
  tone:     DeadlineTone
  /** «5», «78», «ждёт», «доработка», «—». */
  scoreText: string
}

export function homeworkScoreText(row: { status: string | null; score: number | null; gradeScale: GradeScale | null }): string {
  if (row.status === 'accepted') return row.score != null ? formatScore(row.score) : 'принято'
  if (row.status === 'submitted') return 'ждёт'
  if (row.status === 'returned_for_revision') return 'доработка'
  return DASH
}

function formatScore(v: number): string {
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',')
}

/**
 * Последние `k` ДЗ для таблицы карточки: по дню (срок, без срока — первая сдача) от новых к старым. ДЗ без срока и
 * без сдачи в таблицу не идут — про них сказать нечего.
 */
export function recentHomeworks(rows: readonly HomeworkRow[], nowMs: number, k = 6): HomeworkView[] {
  const key = (r: HomeworkRow) => r.dueAt ?? (r.firstSubmittedAt ? r.firstSubmittedAt.slice(0, 10) : null)
  return rows
    .filter(r => key(r) != null)
    .sort((a, b) => (key(b) as string).localeCompare(key(a) as string) || a.title.localeCompare(b.title, 'ru'))
    .slice(0, k)
    .map(row => {
      const deadline = rowDeadline(row, nowMs)
      const label = deadline.kind === 'none' ? (row.firstSubmittedAt ? 'сдано' : DASH) : deadlineLabel(deadline)
      return { row, deadline, label, tone: deadlineTone(deadline), scoreText: homeworkScoreText(row) }
    })
}

// ── Прогноз ──────────────────────────────────────────────────────────────

export type ForecastSummary =
  /** Предмет не ЕГЭ математика/физика или свидетельств нет вовсе в ответе — строки прогноза нет. */
  | { kind: 'none' }
  /** Покрытия не хватает (то же правило, что у ученика на главной) — «пока мало данных». */
  | { kind: 'few'; missing: number; covered: number; need: number; goal: number | null }
  | { kind: 'ready'; score: number; low: number; high: number; monthDelta: number | null; goal: number | null; toGoal: number | null }

/**
 * «Примерный балл» по предмету — ТА ЖЕ модель и ТО ЖЕ правило показа, что у ученика (§255): `buildForecastView`
 * над свидетельствами базы, `current.ready` — покрыта половина номеров части 1. Цель — из ответа (цель ученика,
 * student_exam_goals); `goalFallback` — цель учителя (§216), если ученик своей не ставил.
 */
export function forecastSummary(data: ForecastResponse | null, subject: string, goalFallback: number | null = null): ForecastSummary {
  if (!data || !isEgeSubject(subject)) return { kind: 'none' }
  const spec = activeSpec(subject)
  if (!spec || !data.subjects.some(s => s.subject === subject)) return { kind: 'none' }
  const info = data.subjects.find(s => s.subject === subject)
  const goal = info?.goal ?? goalFallback ?? null
  const view = buildForecastView(spec, data.evidence, data.now)
  if (!view.current.ready) {
    return { kind: 'few', missing: view.current.missing, covered: view.current.covered, need: view.current.need, goal }
  }
  return {
    kind: 'ready',
    score: view.score,
    low: view.low,
    high: view.high,
    monthDelta: view.monthDelta,
    goal,
    toGoal: goal != null ? goal - view.score : null,
  }
}

/** «+6 за месяц» / «−2 за месяц» / «без изменений за месяц»; null — месяц назад балла ещё не было. */
export function monthDeltaText(delta: number | null): string | null {
  if (delta == null) return null
  if (delta > 0) return `+${delta} за месяц`
  if (delta < 0) return `−${Math.abs(delta)} за месяц`
  return 'без изменений за месяц'
}

/** «до цели 13» / «цель достигнута». */
export function toGoalText(toGoal: number | null): string | null {
  if (toGoal == null) return null
  return toGoal > 0 ? `до цели ${toGoal}` : 'цель достигнута'
}

export const FEW_DATA_TEXT = 'Пока мало данных для прогноза'

// ── Номера ЕГЭ, часть 1 ──────────────────────────────────────────────────

export interface ZoneCell {
  n:     number
  zone:  CatalogZone
  /** Доля верного 0..1 за окно правил; null — свидетельств по номеру нет. */
  share: number | null
}

/**
 * Номера части 1 предмета с зоной — зону и долю считает база (`student_kim_zone_shares`), порог — её же правила.
 * Номер, по которому база зоны не прислала, — «зона роста» без доли (так база и определяет: нет данных — рост).
 */
export function zoneCells(data: ForecastResponse | null, subject: string): ZoneCell[] {
  if (!data || !isEgeSubject(subject)) return []
  const spec = activeSpec(subject)
  if (!spec) return []
  return part1Numbers(spec).map(n => {
    const z = data.zones[`${subject}:${n}`]
    return { n, zone: z && isZone(z.zone) ? z.zone : 'growth', share: z?.share ?? null }
  })
}

/** Подпись легенды из порогов базы: «до 40 %», «40–70 %», «от 70 %». */
export function zoneLegend(rules: Pick<CatalogRules, 'low' | 'high'> | null): Record<CatalogZone, string> | null {
  if (!rules) return null
  const p = (v: number) => Math.round(v * 100)
  return { growth: `до ${p(rules.low)} %`, progress: `${p(rules.low)}–${p(rules.high)} %`, confident: `от ${p(rules.high)} %` }
}

// ── Активность ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * DAY_MS).toISOString().slice(0, 10)

/** 14 клеток «решал ли в этот день» — от `today − 13` до `today`. */
export function activityCells(days: readonly string[], today: string, count = 14): { day: string; solved: boolean }[] {
  const set = new Set(days.map(d => d.slice(0, 10)))
  return Array.from({ length: count }, (_, i) => {
    const d = addDays(today, i - (count - 1))
    return { day: d, solved: set.has(d) }
  })
}

// ── Ответ student_overview_for_staff ─────────────────────────────────────

export interface OverviewSubject {
  subject:  string
  examType: string
  courseTitles: string | null
}

export interface StudentOverview {
  today:    string
  now:      Date
  subjects: OverviewSubject[]
  forecast: ForecastResponse | null
  activity: {
    streak:  number
    record:  number
    days:    string[]
    daily:   { days: number; assigned: number; done: number }
    weekly:  { subject: string; target: number; progress: number; numbers: number[] }[]
    catalog: { total: number; weekTried: number; weekCorrect: number }
  }
  achievements: StaffAchievements | null
  level: { n: number; name: string; count: number } | null
  assessments: AssessmentRow[]
  homeworks: HomeworkRow[]
  nextSteps: { from: string; to: string; steps: string[] } | null
}

export function normalizeOverview(raw: unknown, fallbackNow: Date = new Date()): StudentOverview | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const nowMs = typeof r.now === 'string' ? Date.parse(r.now) : NaN
  const now = Number.isFinite(nowMs) ? new Date(nowMs) : fallbackNow
  const today = day(r.today) ?? now.toISOString().slice(0, 10)
  const act = (r.activity ?? {}) as Record<string, unknown>
  const daily = (act.daily ?? {}) as Record<string, unknown>
  const cat = (act.catalog ?? {}) as Record<string, unknown>
  const week = (cat.week ?? {}) as Record<string, unknown>
  const pts = (r.points ?? null) as Record<string, unknown> | null
  const lvl = (pts?.level ?? null) as Record<string, unknown> | null
  const ns = (r.next_steps ?? null) as Record<string, unknown> | null
  const steps = Array.isArray(ns?.steps) ? (ns?.steps as unknown[]).map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean) : []
  return {
    today,
    now,
    subjects: (Array.isArray(r.subjects) ? r.subjects : []).flatMap((item: unknown) => {
      const x = (item ?? {}) as Record<string, unknown>
      const subject = str(x.subject)
      return subject ? [{ subject, examType: str(x.exam_type) ?? '', courseTitles: str(x.course_titles) }] : []
    }),
    forecast: normalizeForecastResponse(r.forecast, now),
    activity: {
      streak: num(act.streak) ?? 0,
      record: num(act.record) ?? 0,
      days: (Array.isArray(act.days) ? act.days : []).flatMap((d: unknown) => (day(d) ? [day(d) as string] : [])),
      daily: { days: num(daily.days) ?? 14, assigned: num(daily.assigned) ?? 0, done: num(daily.done) ?? 0 },
      weekly: (Array.isArray(act.weekly) ? act.weekly : []).flatMap((item: unknown) => {
        const x = (item ?? {}) as Record<string, unknown>
        const subject = str(x.subject)
        if (!subject) return []
        return [{
          subject,
          target: num(x.target) ?? 0,
          progress: num(x.progress) ?? 0,
          numbers: (Array.isArray(x.numbers) ? x.numbers : []).map(Number).filter(Number.isInteger),
        }]
      }),
      catalog: { total: num(cat.total) ?? 0, weekTried: num(week.tried) ?? 0, weekCorrect: num(week.correct) ?? 0 },
    },
    achievements: normalizeStaffAchievements(r.achievements),
    level: lvl && num(lvl.n) != null
      ? { n: num(lvl.n) as number, name: str(lvl.name) ?? '', count: num(pts?.levels_count) ?? 0 }
      : null,
    assessments: normalizeAssessments(r.assessments),
    homeworks: normalizeHomeworks(r.homeworks),
    nextSteps: ns && steps.length > 0
      ? { from: day(ns.period_from) ?? '', to: day(ns.period_to) ?? '', steps: steps.slice(0, 3) }
      : null,
  }
}

/** Ключ предмета для переключателя: «physics:ege». */
export const subjectKey = (s: { subject: string; examType: string }) => `${s.subject}:${s.examType}`

/** Работы одного предмета. */
export function bySubject<T extends { subject: string; examType: string }>(rows: readonly T[], key: string | null): T[] {
  return key ? rows.filter(r => subjectKey(r) === key) : [...rows]
}

/**
 * Предмет по умолчанию: ЕГЭ математика/физика (у них есть прогноз), иначе первый. Переключатель рисуется, только
 * если предметов больше одного (в 10А предмет один — переключателя нет).
 */
export function defaultSubjectKey(subjects: readonly OverviewSubject[]): string | null {
  const ege = subjects.find(s => s.examType === 'ege' && isEgeSubject(s.subject))
  const first = ege ?? subjects[0]
  return first ? subjectKey(first) : null
}

export type { EgeSubject }

// ── Плитки карточки ──────────────────────────────────────────────────────

export interface OverviewTile {
  key:    'forecast' | 'assessments' | 'ontime' | 'hw' | 'catalog' | 'streak'
  label:  string
  value:  string
  note:   string
  /** Прочерк / «мало данных» — подпись серая, без цифр. */
  dashed: boolean
  /** Полоса «балл из 100» с отметкой цели — только у прогноза. */
  bar?:   { value: number; goal: number | null }
}

/**
 * Шесть плиток карточки (макет §261, экран А) из ответа `student_overview_for_staff` и выбранного предмета
 * (`subjectKey`, «physics:ege»; null — все). Каталог, серия и уровень — по ученику целиком, остальное — по предмету.
 */
export function overviewTiles(o: StudentOverview, key: string | null): OverviewTile[] {
  const subject = key ? key.split(':')[0] : (o.subjects[0]?.subject ?? '')
  const teacherGoal = o.forecast?.subjects.find(s => s.subject === subject)?.teacherGoal ?? null
  const fc = forecastSummary(o.forecast, subject, teacherGoal)
  const forecast: OverviewTile = fc.kind === 'ready'
    ? {
      key: 'forecast', label: 'Примерный балл ЕГЭ', value: String(fc.score), dashed: false,
      note: [fc.goal != null ? `цель ${fc.goal}` : 'цель не задана', monthDeltaText(fc.monthDelta)].filter(Boolean).join(' · '),
      bar: { value: fc.score, goal: fc.goal },
    }
    : fc.kind === 'few'
      ? { key: 'forecast', label: 'Примерный балл ЕГЭ', value: DASH, dashed: true, note: `мало данных: ${fc.covered} из ${fc.need} номеров части 1` }
      : { key: 'forecast', label: 'Примерный балл ЕГЭ', value: DASH, dashed: true, note: 'только для ЕГЭ по математике и физике' }

  const a = assessmentSummary(bySubject(o.assessments, key))
  const hwRows = bySubject(o.homeworks, key)
  const d = homeworkDeadlineSummary(hwRows, o.now.getTime())
  const hw = gradeAverage(hwRows.filter(r => r.status === 'accepted'))
  const level = o.level ? ` · уровень ${o.level.n}${o.level.name ? ` «${o.level.name}»` : ''}` : ''

  return [
    forecast,
    { key: 'assessments', label: 'Проверочные', value: a.avg ? formatGrade(a.avg.value, a.avg.scale) : DASH, note: assessmentNote(a), dashed: !a.avg },
    { key: 'ontime', label: 'ДЗ вовремя', value: d.total > 0 ? `${d.ontime} / ${d.total}` : DASH, note: deadlineNote(d), dashed: d.total === 0 },
    {
      key: 'hw', label: 'Средний за ДЗ', value: hw ? formatGrade(hw.value, hw.scale) : DASH, dashed: !hw,
      note: hw ? `${hw.count} ${plural(hw.count, 'проверенное', 'проверенных', 'проверенных')}` : 'оценок за ДЗ пока нет',
    },
    {
      key: 'catalog', label: 'Каталог', value: String(o.activity.catalog.total), dashed: false,
      note: `верно с проверкой · ${o.activity.catalog.weekCorrect} за неделю`,
    },
    {
      key: 'streak', label: 'Серия', value: `${o.activity.streak} дн.`, dashed: false,
      note: `рекорд ${o.activity.record}${level}`,
    },
  ]
}
