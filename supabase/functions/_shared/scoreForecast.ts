/**
 * §255. Модель «Примерного балла на ЕГЭ» — ОДНА на фронт и Edge Functions
 * (письмо ЛК_прогноз_балла_хранить.md, 16.10): браузер (карточки, «что
 * изменится») и ночной `forecast-daily` считают одним и тем же кодом.
 * Без браузерных зависимостей; фронт берёт её через src/lib/egeForecast.ts.
 * Описание модели — там же, в шапке.
 */
import { activeSpec, isEgeSubject, maxPrimary, toTestScore, type EgeSpec, type EgeSubject } from './egeScales.ts'

export type EvidenceSource = 'hw' | 'test' | 'mock' | 'catalog'

export interface Evidence {
  subject: string
  /** Номер задания КИМ. */
  n:       number
  source:  EvidenceSource
  /** Доля верного 0..1. */
  score:   number
  /** Момент свидетельства (ISO). */
  at:      string
  /** Доля строки: 1 / (число номеров темы); у пробника и каталога — 1. */
  share:   number
  /** Ключ «одной задачи» — для счёта «ДЗ · N задач» без двойного счёта. */
  item:    string
  /** Пробник: сколько заданий в его шаблоне (сверка нумерации года). */
  kimTotal?: number | null
}

// ── Параметры модели (константы с причинами; меняются только здесь) ────────

/**
 * Априори для первой части — 0,3: «ещё не видели, как решаете» не должно
 * давать ни ноль (обидно и неправда — базовые номера решает большинство), ни
 * среднее по больнице. 0,3 — около порога: без данных номер тянет прогноз к
 * «чуть выше порога», а не к 50–60.
 */
export const PRIOR_PART1 = 0.3
/**
 * Вторая часть — 0,1: задания с развёрнутым решением и критериями; с
 * априори 0,3 у профильной математики без единого решения «из воздуха»
 * набегало бы ~6 первичных (≈ +20 тестовых) — прогноз врал бы вверх.
 */
export const PRIOR_PART2 = 0.1
/**
 * Псевдосчёт m = 2: априори весит как две задачи. Одна верная задача даёт
 * p = (0,6 + 1) / 3 ≈ 0,53, а не 100 %; десять верных — ≈ 0,88.
 */
export const PSEUDO_COUNT = 2
/**
 * Вторая часть — псевдосчёт 4: «не решали задачи с развёрнутым решением» —
 * довольно уверенное «скорее не решите», а не полная неизвестность. С m = 2
 * семь нетронутых номеров второй части давали ±1,4 первичных неопределённости
 * (в зоне 10–12 первичных у математики это ±8 тестовых) и диапазон «от 47 до
 * 71» у ученика, стабильно решающего 70 % первой части. С m = 4 — около ±1.
 * Цена — одна верная №13 поднимает его медленнее ((0,4 + 1) / 5 = 0,28): для
 * задач с критериями это и правильно.
 */
export const PSEUDO_COUNT_PART2 = 4
/**
 * Полураспад 30 дней: решение месячной давности весит вдвое меньше
 * сегодняшнего. Навык за месяц меняется заметно (тема пройдена → забыта или
 * отработана), а в пределах недели — почти нет.
 */
export const HALF_LIFE_DAYS = 30
/** Окно свидетельств — 180 дней (столько отдаёт база; старее весит < 2 %). */
export const WINDOW_DAYS = 180
/**
 * Веса источников.
 *   * ДЗ, тест темы и каталог — 1: задача с проверкой, но решается дома, с
 *     конспектом. Каталог с §256 — только ПРОВЕРЕННЫЕ ответы (и верные, и
 *     неверные; открыл ответ до проверки — не идёт), поэтому вес как у ДЗ и
 *     без потолка (решение владельца 02.10). Самоотметки «Выполнено» база в
 *     свидетельства больше не отдаёт.
 *   * Пробник — 2: условия экзамена (время, без подсказок, задание «как на
 *     ЕГЭ»), поэтому ближе всего к итогу.
 */
export const SOURCE_WEIGHT: Readonly<Record<EvidenceSource, number>> = { hw: 1, test: 1, mock: 2, catalog: 1 }
/**
 * Тема с несколькими номерами: решение ДЗ/теста делится между номерами
 * поровну (доля 1/k), но только при k ≤ 3 («№22-23», «№13, 14, 15»). Темы
 * шире («№1–12, повторение») пропускаем: такая работа почти ничего не говорит
 * про конкретный номер, а размазанная по 12 номерам закрыла бы покрытие.
 */
export const MAX_SPLIT_NUMBERS = 3
/** «Быстрее всего добавят баллы» — если поднять номер до 0,8. */
export const TARGET_P = 0.8
/**
 * Ширина диапазона: ±1σ (≈ 68 %). «Скорее всего» — это «вероятно» (так его
 * понимают и шкалы вероятностей — «likely» ≥ 66 %), а не «почти наверняка»:
 * 80–95 % на крутом участке шкалы математики (10–12 первичных — по 6 тестовых
 * за балл) давали «от 47 до 71» — честно, но бесполезно. Сужать дальше нельзя
 * — тогда диапазон стал бы декоративным.
 */
export const INTERVAL_Z = 1
/** Номер второй части попадает в «быстрее всего добавят», если уже решается хоть иногда. */
export const PART2_TIP_MIN_P = 0.35
/** Сколько номеров предлагать. */
export const TIPS_COUNT = 3

const DAY_MS = 86_400_000

// ── Расчёт ───────────────────────────────────────────────────────────────

export interface NumberStat {
  n:            number
  max:          number
  part:         1 | 2
  /** Среднее p_n (сглаженное, с затуханием). */
  p:            number
  variance:     number
  /** Есть ли хоть одно свидетельство (в окне и до даты расчёта). */
  hasEvidence:  boolean
  /** Сумма долей строк без затухания — для покрытия. */
  shareSum:     number
  /** Сколько задач (все источники; §256 — каталог тоже с проверкой). */
  count:        number
  /** Доля верного в них, без сглаживания (для подсказки «верно 35 %»). */
  rate:         number | null
  /** Из них задач каталога (проверенные ответы). */
  catalogCount: number
}

export interface ForecastPoint {
  /** Хватает ли данных показать балл (покрыта половина номеров части 1). */
  ready:    boolean
  covered:  number
  need:     number
  /** Сколько номеров части 1 не хватает до показа (0, если ready). */
  missing:  number
  primary:  number
  /** Тестовый (дробный). */
  score:    number
  low:      number
  high:     number
  numbers:  NumberStat[]
}

function validRows(spec: EgeSpec, rows: readonly Evidence[], asOf: Date): Evidence[] {
  const t = asOf.getTime()
  const from = t - WINDOW_DAYS * DAY_MS
  const tasks = spec.maxPoints.length
  return rows.filter(r => {
    if (r.subject !== spec.subject) return false
    if (!Number.isInteger(r.n) || r.n < 1 || r.n > tasks) return false
    if (!(r.share >= 1 / MAX_SPLIT_NUMBERS - 1e-9)) return false
    if (r.source === 'mock' && r.kimTotal != null && r.kimTotal !== tasks) return false
    const at = Date.parse(r.at)
    return Number.isFinite(at) && at <= t && at >= from
  })
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

export function numberStats(spec: EgeSpec, rows: readonly Evidence[], asOf: Date): NumberStat[] {
  const valid = validRows(spec, rows, asOf)
  const t = asOf.getTime()
  return spec.maxPoints.map((max, i) => {
    const n = i + 1
    const part: 1 | 2 = n <= spec.part1Last ? 1 : 2
    const prior = part === 1 ? PRIOR_PART1 : PRIOR_PART2
    const mine = valid.filter(r => r.n === n)
    let a = 0, b = 0
    let shareSum = 0, rateNum = 0, rateDen = 0
    const items = new Set<string>(), catItems = new Set<string>()
    for (const r of mine) {
      const s = clamp01(r.score)
      const age = Math.max(0, (t - Date.parse(r.at)) / DAY_MS)
      const w = SOURCE_WEIGHT[r.source] * r.share * Math.pow(0.5, age / HALF_LIFE_DAYS)
      shareSum += r.share
      a += w * s; b += w * (1 - s)
      rateNum += r.share * s; rateDen += r.share
      items.add(r.item)
      if (r.source === 'catalog') catItems.add(r.item)
    }
    const m = part === 1 ? PSEUDO_COUNT : PSEUDO_COUNT_PART2
    const alpha = prior * m + a
    const beta = (1 - prior) * m + b
    const p = alpha / (alpha + beta)
    return {
      n, max, part, p,
      variance: (p * (1 - p)) / (alpha + beta + 1),
      hasEvidence: mine.length > 0,
      shareSum,
      count: items.size,
      rate: rateDen > 0 ? rateNum / rateDen : null,
      catalogCount: catItems.size,
    }
  })
}

/** Сколько номеров части 1 нужно покрыть: половина, с округлением вверх. */
export function coverageNeed(spec: EgeSpec): number {
  return Math.ceil(spec.part1Last / 2)
}

/** Номер «покрыт», если по нему есть хотя бы одна целая задача (сумма долей ≥ 1). */
export function isCovered(s: NumberStat): boolean {
  return s.shareSum >= 1 - 1e-9
}

export function forecastAt(spec: EgeSpec, rows: readonly Evidence[], asOf: Date): ForecastPoint {
  const numbers = numberStats(spec, rows, asOf)
  const need = coverageNeed(spec)
  const covered = numbers.filter(s => s.part === 1 && isCovered(s)).length
  const primary = numbers.reduce((sum, s) => sum + s.p * s.max, 0)
  const sigma = Math.sqrt(numbers.reduce((sum, s) => sum + s.max * s.max * s.variance, 0))
  const top = maxPrimary(spec)
  const lowP = Math.max(0, primary - INTERVAL_Z * sigma)
  const highP = Math.min(top, primary + INTERVAL_Z * sigma)
  return {
    ready: covered >= need,
    covered: Math.min(covered, need),
    need,
    missing: Math.max(0, need - covered),
    primary,
    score: toTestScore(spec, primary),
    low: toTestScore(spec, lowP),
    high: toTestScore(spec, highP),
    numbers,
  }
}

// ── Вид для карточки ─────────────────────────────────────────────────────

export interface ForecastTip {
  n:      number
  /** Прирост тестовых баллов (целый, ≥ 1); null — номер ещё не решали («?»). */
  gain:   number | null
  rawGain: number
}

export interface TrendPoint {
  /** Дата конца недели YYYY-MM-DD (последняя точка — сегодня). */
  day:   string
  score: number | null
  current: boolean
}

export interface ForecastView {
  spec:       EgeSpec
  current:    ForecastPoint
  /** Округлённые для показа. */
  score:      number
  low:        number
  high:       number
  /** «+N за месяц»: разница с расчётом на дату 30 дней назад; null — тогда данных не хватало. */
  monthDelta: number | null
  trend:      TrendPoint[]
  tips:       ForecastTip[]
  /** «Считаем по последним решениям»: число задач (у пробника — пробников). */
  sources:    Record<EvidenceSource, number>
}

/** Москва без перехода на летнее время: UTC+3. */
const MSK_MS = 3 * 3_600_000
function mskDay(d: Date): string {
  return new Date(d.getTime() + MSK_MS).toISOString().slice(0, 10)
}
/** Конец московского дня YYYY-MM-DD как момент времени. */
function endOfMskDay(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS - MSK_MS - 1)
}

/** Концы 7 прошедших недель (воскресенья, по Москве) + сегодня — 8 точек. */
export function trendDates(now: Date): { day: string; asOf: Date; current: boolean }[] {
  const today = mskDay(now)
  const d = new Date(`${today}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // пн = 0
  const lastSunday = new Date(d.getTime() - (dow + 1) * DAY_MS)
  const out: { day: string; asOf: Date; current: boolean }[] = []
  for (let j = 6; j >= 0; j--) {
    const day = new Date(lastSunday.getTime() - j * 7 * DAY_MS).toISOString().slice(0, 10)
    out.push({ day, asOf: endOfMskDay(day), current: false })
  }
  out.push({ day: today, asOf: now, current: true })
  return out
}

function roundedRange(score: number, low: number, high: number) {
  const s = Math.round(score)
  return { score: s, low: Math.min(s, Math.floor(low)), high: Math.max(s, Math.ceil(high)) }
}

export function forecastTips(spec: EgeSpec, point: ForecastPoint): ForecastTip[] {
  const base = toTestScore(spec, point.primary)
  return point.numbers
    // Вторая часть — только номера, которые ученик УЖЕ решает хоть иногда
    // (p ≥ PART2_TIP_MIN_P): «дотянуть» №13 с 0,4 до 0,8 — быстро, а поднять
    // №18 с 0,1 — месяцы работы. Без этого фильтра номера по 3–4 балла
    // забивали бы список всегда (прирост пропорционален максимуму номера), и
    // слово «быстрее» врало бы.
    .filter(s => s.part === 1 || (s.hasEvidence && s.p >= PART2_TIP_MIN_P))
    .map(s => {
      const lift = Math.max(0, TARGET_P - s.p) * s.max
      const rawGain = toTestScore(spec, point.primary + lift) - base
      return { n: s.n, rawGain, gain: s.hasEvidence ? Math.max(1, Math.round(rawGain)) : null }
    })
    .filter(t => t.rawGain > 0.05)
    .sort((a, b) => b.rawGain - a.rawGain || a.n - b.n)
    .slice(0, TIPS_COUNT)
}

export function sourceCounts(spec: EgeSpec, rows: readonly Evidence[], now: Date): Record<EvidenceSource, number> {
  const valid = validRows(spec, rows, now)
  const out: Record<EvidenceSource, number> = { hw: 0, test: 0, mock: 0, catalog: 0 }
  for (const src of Object.keys(out) as EvidenceSource[]) {
    out[src] = new Set(valid.filter(r => r.source === src).map(r => r.item)).size
  }
  return out
}

export function buildForecastView(spec: EgeSpec, rows: readonly Evidence[], now: Date): ForecastView {
  const current = forecastAt(spec, rows, now)
  const monthAgo = forecastAt(spec, rows, new Date(now.getTime() - 30 * DAY_MS))
  const shown = roundedRange(current.score, current.low, current.high)
  return {
    spec,
    current,
    ...shown,
    monthDelta: current.ready && monthAgo.ready ? shown.score - Math.round(monthAgo.score) : null,
    trend: trendDates(now).map(({ day, asOf, current: isNow }) => {
      const p = isNow ? current : forecastAt(spec, rows, asOf)
      return { day, current: isNow, score: p.ready ? Math.round(p.score) : null }
    }),
    tips: forecastTips(spec, current),
    sources: sourceCounts(spec, rows, now),
  }
}

/** Ступень плитки КИМ: 0 — не решали (штриховка), 1..4 — реже ↔ почти всегда. */
export function tileLevel(s: NumberStat): 0 | 1 | 2 | 3 | 4 {
  if (!s.hasEvidence) return 0
  if (s.p < 0.4) return 1
  if (s.p < 0.6) return 2
  if (s.p < 0.8) return 3
  return 4
}

/** Подсказка плитки: «№6: верно 35 % решений (12 задач, из них 4 в каталоге)». */
export function tileHint(s: NumberStat, plural: (n: number, a: string, b: string, c: string) => string): string {
  if (!s.hasEvidence) return `№${s.n}: пока не решали — в прогнозе считаем осторожно`
  if (s.count === 0 || s.rate == null) return `№${s.n}: пока не решали — в прогнозе считаем осторожно`
  const cat = s.catalogCount > 0 ? `, из них ${s.catalogCount} в каталоге` : ''
  return `№${s.n}: верно ${Math.round(s.rate * 100)} % решений (${s.count} ${plural(s.count, 'задача', 'задачи', 'задач')}${cat})`
}

/** «Решите ещё N задач из разных номеров» — N из покрытия. */
export function missingText(missing: number, plural: (n: number, a: string, b: string, c: string) => string): string {
  return `Решите ещё ${missing} ${plural(missing, 'задачу', 'задачи', 'задач')} из разных номеров — и мы покажем примерный балл`
}

/**
 * Строка базы → свидетельства по номерам. База отдаёт `ns` — номера темы
 * (у пробника и каталога — один); строка с k номерами превращается в k
 * свидетельств с долей 1/k (`share`). Темы шире MAX_SPLIT_NUMBERS отбросит
 * `validRows` — здесь только разбор. Мусор пропускается, главную не роняет.
 */
export function normalizeEvidence(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return []
  const out: Evidence[] = []
  for (const item of raw) {
    const x = (item ?? {}) as Record<string, unknown>
    const source = x.source
    if (source !== 'hw' && source !== 'test' && source !== 'mock' && source !== 'catalog') continue
    const score = Number(x.score)
    if (typeof x.subject !== 'string' || typeof x.at !== 'string' || !Number.isFinite(score)) continue
    const ns = (Array.isArray(x.ns) ? x.ns : x.n != null ? [x.n] : [])
      .map(Number).filter(n => Number.isInteger(n) && n >= 1)
    const uniq = [...new Set(ns)]
    if (uniq.length === 0) continue
    const key = typeof x.item === 'string' ? x.item : `${source}:${uniq.join(',')}:${x.at}`
    const kimTotal = x.kim_total == null ? null : Number(x.kim_total)
    for (const n of uniq) {
      out.push({ subject: x.subject, n, source, score, at: x.at, share: 1 / uniq.length, item: key, kimTotal })
    }
  }
  return out
}

// ── Хранимый прогноз (письмо ЛК_прогноз_балла_хранить.md, 16.10) ───────────

/**
 * Строка таблицы `student_score_forecast`: то, что сайт показывает без
 * пересчёта. `details` — компактно, только для подсказок и сводки класса:
 * покрытие, «за месяц», «неделю назад», график 8 недель, «быстрее всего
 * добавят», источники и номера `[n, p, задач, доля верного, из каталога]`.
 */
export interface StoredForecastRow {
  subject: EgeSubject
  /** Тестовый балл, как на карточке (округлён); null — данных мало (`ready = false`). */
  score:   number | null
  low:     number | null
  high:    number | null
  /** «по 46 задачам и 1 пробнику». */
  basis:   string
  details: StoredForecastDetails
}

export interface StoredForecastDetails {
  v:           1
  ready:       boolean
  covered:     number
  need:        number
  missing:     number
  month_delta: number | null
  week_ago:    number | null
  trend:       Array<[string, number | null]>
  tips:        Array<[number, number | null]>
  sources:     Record<EvidenceSource, number>
  /** [n, p (2 знака), задач, доля верного (2 знака) | null, из каталога]. */
  numbers:     Array<[number, number, number, number | null, number]>
}

const r2 = (x: number) => Math.round(x * 100) / 100

function pl(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** «по 46 задачам и 1 пробнику» / «пока нет решений». */
export function forecastBasis(sources: Record<EvidenceSource, number>): string {
  const tasks = sources.hw + sources.test + sources.catalog
  const parts: string[] = []
  if (tasks > 0) parts.push(`${tasks} ${pl(tasks, 'задаче', 'задачам', 'задачам')}`)
  if (sources.mock > 0) parts.push(`${sources.mock} ${pl(sources.mock, 'пробнику', 'пробникам', 'пробникам')}`)
  return parts.length ? `по ${parts.join(' и ')}` : 'пока нет решений'
}

/**
 * Прогноз предмета для хранения — `buildForecastView` (та же функция, что в
 * браузере) и «неделю назад» `forecastAt`, упакованные в строку таблицы.
 * Предмет без шкалы — null.
 */
export function storedForecast(subject: string, rows: readonly Evidence[], now: Date): StoredForecastRow | null {
  if (!isEgeSubject(subject)) return null
  const spec = activeSpec(subject)
  if (!spec) return null
  const view = buildForecastView(spec, rows, now)
  const week = forecastAt(spec, rows, new Date(now.getTime() - 7 * DAY_MS))
  const ready = view.current.ready
  return {
    subject,
    score: ready ? view.score : null,
    low: ready ? view.low : null,
    high: ready ? view.high : null,
    basis: forecastBasis(view.sources),
    details: {
      v: 1,
      ready,
      covered: view.current.covered,
      need: view.current.need,
      missing: view.current.missing,
      month_delta: view.monthDelta,
      week_ago: ready && week.ready ? Math.round(week.score) : null,
      trend: view.trend.map(t => [t.day, t.score]),
      tips: view.tips.map(t => [t.n, t.gain]),
      sources: view.sources,
      numbers: view.current.numbers.map(s => [s.n, r2(s.p), s.count, s.rate == null ? null : r2(s.rate), s.catalogCount]),
    },
  }
}

/**
 * Ответ `student_forecast_evidence_of` (тот же, что видит браузер) → строки
 * по всем предметам прогноза ученика. «Сейчас» — из ответа базы.
 */
export function storedForecastsFromEvidence(raw: unknown, fallbackNow: Date = new Date()): StoredForecastRow[] {
  if (!raw || typeof raw !== 'object') return []
  const r = raw as Record<string, unknown>
  const nowMs = typeof r.now === 'string' ? Date.parse(r.now) : NaN
  const now = Number.isFinite(nowMs) ? new Date(nowMs) : fallbackNow
  const evidence = normalizeEvidence(r.evidence)
  const subjects = [...new Set((Array.isArray(r.subjects) ? r.subjects : [])
    .map(x => (x && typeof x === 'object' ? (x as Record<string, unknown>).subject : null))
    .filter((x): x is string => typeof x === 'string'))]
  return subjects.flatMap(s => {
    const row = storedForecast(s, evidence, now)
    return row ? [row] : []
  })
}
