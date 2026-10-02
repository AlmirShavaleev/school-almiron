/**
 * §255. «Примерный балл на ЕГЭ» — чистая функция над свидетельствами.
 *
 * База (`student_exam_forecast_evidence()`) отдаёт СТРОКИ: номер задания КИМ,
 * источник, доля верного 0..1, когда, доля строки (тема с несколькими
 * номерами) — и ничего не считает. Модель целиком здесь, одна, и ею же
 * считаются «+N за месяц» и график за 8 недель (тот же расчёт на другую дату).
 *
 * ── Модель ────────────────────────────────────────────────────────────────
 * Для каждого номера n — вероятность решить его на экзамене p_n, бета-
 * распределение Beta(α, β):
 *   α = prior·m + Σ wᵢ·sᵢ,   β = (1 − prior)·m + Σ wᵢ·(1 − sᵢ),
 * где sᵢ — доля верного (верно 1, частично 0,5, неверно 0), wᵢ — вес
 * свидетельства: вес источника × доля строки × затухание 0,5^(возраст / 30 дн.).
 * p_n = α / (α + β) — среднее, Var p_n = p(1 − p) / (α + β + 1).
 *
 * Ожидаемый первичный μ = Σ p_n · max_n; тестовый — по шкале года
 * (`egeScales.toTestScore`, линейно между точками таблицы).
 *
 * Диапазон «скорее всего от … до …» — интервал ±1σ (≈ 68 %, «в двух случаях
 * из трёх») НЕОПРЕДЕЛЁННОСТИ p_n: σ² = Σ max_n² · Var p_n (номера
 * независимы), первичный μ ± σ,
 * концы переводятся той же шкалой (перевод монотонный — квантили переходят в
 * квантили). Интервал честно сужается, когда решений больше, и широк там,
 * где их мало, — он про то, насколько мы уверены в p_n, а не про удачу в
 * день экзамена.
 */
import { activeSpec, EGE_SUBJECT_ORDER, isEgeSubject, maxPrimary, toTestScore, type EgeSpec, type EgeSubject } from '@/lib/egeScales'

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
 *   * ДЗ и тест темы — 1: задача с проверкой, но решается дома, с конспектом.
 *   * Пробник — 2: условия экзамена (время, без подсказок, задание «как на
 *     ЕГЭ»), поэтому ближе всего к итогу.
 *   * Каталог — 0,3: база видит только УСПЕХИ («Выполнено» / верный ответ),
 *     ошибки там не остаются — свидетельство смещено вверх, вес малый.
 */
export const SOURCE_WEIGHT: Readonly<Record<EvidenceSource, number>> = { hw: 1, test: 1, mock: 2, catalog: 0.3 }
/**
 * Потолок каталога: суммарный вес каталожных решений одного номера не больше
 * 2 (как две задачи ДЗ). Одним каталогом номер поднимается максимум до
 * (0,6 + 2) / 4 = 0,65 — «решаете, но ошибок мы не видели», а не 100 %.
 */
export const CATALOG_WEIGHT_CAP = 2
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
  /** Сколько задач ДЗ / тестов / пробников (без каталога). */
  count:        number
  /** Доля верного в них, без сглаживания (для подсказки «верно 35 %»). */
  rate:         number | null
  /** Сколько задач каталога решено. */
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
    let a = 0, b = 0, catA = 0, catB = 0
    let shareSum = 0, rateNum = 0, rateDen = 0
    const items = new Set<string>(), catItems = new Set<string>()
    for (const r of mine) {
      const s = clamp01(r.score)
      const age = Math.max(0, (t - Date.parse(r.at)) / DAY_MS)
      const w = SOURCE_WEIGHT[r.source] * r.share * Math.pow(0.5, age / HALF_LIFE_DAYS)
      shareSum += r.share
      if (r.source === 'catalog') {
        catA += w * s; catB += w * (1 - s); catItems.add(r.item)
      } else {
        a += w * s; b += w * (1 - s)
        rateNum += r.share * s; rateDen += r.share
        items.add(r.item)
      }
    }
    const catW = catA + catB
    if (catW > CATALOG_WEIGHT_CAP) { const k = CATALOG_WEIGHT_CAP / catW; catA *= k; catB *= k }
    const m = part === 1 ? PSEUDO_COUNT : PSEUDO_COUNT_PART2
    const alpha = prior * m + a + catA
    const beta = (1 - prior) * m + b + catB
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

/** Подсказка плитки: «№6: верно 35 % решений (12 задач)». */
export function tileHint(s: NumberStat, plural: (n: number, a: string, b: string, c: string) => string): string {
  if (!s.hasEvidence) return `№${s.n}: пока не решали — в прогнозе считаем осторожно`
  const parts: string[] = []
  if (s.count > 0 && s.rate != null) {
    parts.push(`верно ${Math.round(s.rate * 100)} % решений (${s.count} ${plural(s.count, 'задача', 'задачи', 'задач')})`)
  }
  if (s.catalogCount > 0) {
    parts.push(`${s.count > 0 ? 'в каталоге' : 'в каталоге решено'} ${s.catalogCount} ${plural(s.catalogCount, 'задача', 'задачи', 'задач')}`)
  }
  return `№${s.n}: ${parts.join(' · ')}`
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

export interface ForecastSubjectInfo {
  subject: EgeSubject
  /** Цель, которую поставил себе ученик (student_exam_goals); null — нет. */
  goal: number | null
  /** Цель учителя (§216) — только для подсказки в окне цели. */
  teacherGoal: number | null
}

export interface ForecastResponse {
  /** «Сейчас» сервера (расчёт ведётся от него, а не от часов устройства). */
  now:      Date
  subjects: ForecastSubjectInfo[]
  /** Названия номеров из каталога: `${subject}:${n}` → «Простейшие уравнения». */
  titles:   Record<string, string>
  evidence: Evidence[]
}

const intOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isInteger(n) ? n : null
}

/** Ответ `student_exam_forecast_evidence()` → структура карточки. */
export function normalizeForecastResponse(raw: unknown, fallbackNow: Date = new Date()): ForecastResponse | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const nowMs = typeof r.now === 'string' ? Date.parse(r.now) : NaN
  const subjects: ForecastSubjectInfo[] = []
  for (const item of Array.isArray(r.subjects) ? r.subjects : []) {
    const x = (item ?? {}) as Record<string, unknown>
    if (!isEgeSubject(x.subject) || subjects.some(s => s.subject === x.subject)) continue
    subjects.push({ subject: x.subject, goal: intOrNull(x.goal), teacherGoal: intOrNull(x.teacher_goal) })
  }
  subjects.sort((a, b) => EGE_SUBJECT_ORDER.indexOf(a.subject) - EGE_SUBJECT_ORDER.indexOf(b.subject))
  const titles: Record<string, string> = {}
  for (const item of Array.isArray(r.titles) ? r.titles : []) {
    const x = (item ?? {}) as Record<string, unknown>
    if (typeof x.subject === 'string' && typeof x.title === 'string' && intOrNull(x.n) != null) {
      titles[`${x.subject}:${intOrNull(x.n)}`] = x.title
    }
  }
  return {
    now: Number.isFinite(nowMs) ? new Date(nowMs) : fallbackNow,
    subjects,
    titles,
    evidence: normalizeEvidence(r.evidence),
  }
}

/** Проверка ввода цели: целое 1..100; пусто — «снять цель» (null). */
export function parseGoalInput(text: string): { ok: true; goal: number | null } | { ok: false; error: string } {
  const t = text.trim()
  if (t === '') return { ok: true, goal: null }
  if (!/^\d{1,3}$/.test(t)) return { ok: false, error: 'Цель — целое число от 1 до 100' }
  const n = Number(t)
  if (n < 1 || n > 100) return { ok: false, error: 'Цель — целое число от 1 до 100' }
  return { ok: true, goal: n }
}

/**
 * Лучший «+N за месяц» по предметам ученика — для значка «Прогноз +5» в
 * «Баллах школы». null — прогноза нет ни по одному предмету (данных мало).
 */
export function bestMonthDelta(data: ForecastResponse | null): number | null {
  if (!data) return null
  let best: number | null = null
  for (const s of data.subjects) {
    const spec = activeSpec(s.subject)
    if (!spec) continue
    const now = forecastAt(spec, data.evidence, data.now)
    const ago = forecastAt(spec, data.evidence, new Date(data.now.getTime() - 30 * DAY_MS))
    if (!now.ready || !ago.ready) continue
    const d = Math.round(now.score) - Math.round(ago.score)
    if (best == null || d > best) best = d
  }
  return best
}
