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
import { activeSpec, EGE_SUBJECT_ORDER, isEgeSubject } from '@/lib/egeScales'
import { isZone, milestoneView, normalizeCatalogRules, zoneRule, type CatalogRules, type CatalogZone, type ForecastChange } from '@/lib/catalogRewards'
import { buildForecastView, forecastAt, normalizeEvidence, type Evidence, type ForecastPoint } from '../../supabase/functions/_shared/scoreForecast.ts'
import type { EgeSpec, EgeSubject } from '@/lib/egeScales'

// Модель (свидетельства → балл) — общий модуль с ночным расчётом `forecast-daily`.
export * from '../../supabase/functions/_shared/scoreForecast.ts'

export interface ForecastSubjectInfo {
  subject: EgeSubject
  /** Цель, которую поставил себе ученик (student_exam_goals); null — нет. */
  goal: number | null
  /** Цель учителя (§216) — только для подсказки в окне цели. */
  teacherGoal: number | null
}

export interface NumberZone {
  zone:   CatalogZone
  share:  number | null
  /** Засчитано задач каталога с проверкой по номеру (за всё время). */
  solved: number
}

export interface ForecastResponse {
  /** «Сейчас» сервера (расчёт ведётся от него, а не от часов устройства). */
  now:      Date
  subjects: ForecastSubjectInfo[]
  /** Названия номеров из каталога: `${subject}:${n}` → «Простейшие уравнения». */
  titles:   Record<string, string>
  /** §256. Раздел каталога номера: `${subject}:${n}` → id раздела. */
  sections: Record<string, string>
  /** §256. Зона номера и засчитанное — считает база: `${subject}:${n}`. */
  zones:    Record<string, NumberZone>
  /** §256. Правила наград каталога (вехи — для «верно k из 10»). */
  catalogRules: CatalogRules | null
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
  const sections: Record<string, string> = {}
  for (const item of Array.isArray(r.titles) ? r.titles : []) {
    const x = (item ?? {}) as Record<string, unknown>
    if (typeof x.subject === 'string' && typeof x.title === 'string' && intOrNull(x.n) != null) {
      titles[`${x.subject}:${intOrNull(x.n)}`] = x.title
      if (typeof x.section_id === 'string') sections[`${x.subject}:${intOrNull(x.n)}`] = x.section_id
    }
  }
  const zones: Record<string, NumberZone> = {}
  for (const item of Array.isArray(r.numbers) ? r.numbers : []) {
    const x = (item ?? {}) as Record<string, unknown>
    const n = intOrNull(x.n)
    if (typeof x.subject !== 'string' || n == null || !isZone(x.zone)) continue
    const share = x.share == null ? null : Number(x.share)
    zones[`${x.subject}:${n}`] = { zone: x.zone, share: Number.isFinite(share) ? share : null, solved: intOrNull(x.solved) ?? 0 }
  }
  return {
    now: Number.isFinite(nowMs) ? new Date(nowMs) : fallbackNow,
    subjects,
    titles,
    sections,
    zones,
    catalogRules: normalizeCatalogRules(r.catalog_rules),
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
 * §257. Что главная сообщает базе для наград «Рост прогноза» и «Цель
 * достигнута» (`claim_forecast_achievement`): по каждому ЕГЭ-предмету, где
 * балл уже показывается, — текущий (как на карточке, округлённый) и «первый
 * показ» — самая ранняя неделя графика с баллом. База запоминает «первый»
 * один раз, дальше берёт свой. Предмет без балла не сообщается.
 */
export function forecastClaims(data: ForecastResponse | null): { subject: EgeSubject; first: number; current: number }[] {
  if (!data) return []
  const out: { subject: EgeSubject; first: number; current: number }[] = []
  for (const s of data.subjects) {
    const spec = activeSpec(s.subject)
    if (!spec) continue
    const v = buildForecastView(spec, data.evidence, data.now)
    if (!v.current.ready) continue
    const first = v.trend.find(t => t.score != null)?.score ?? v.score
    const clamp = (x: number) => Math.min(100, Math.max(0, Math.round(x)))
    out.push({ subject: s.subject, first: clamp(first), current: clamp(v.score) })
  }
  return out
}

// ── §256. «Решите в каталоге — и балл вырастет» ─────────────────────────

/** Сколько верных задач каталога симулируем для «≈ +N за 10 верных». */
export const CATALOG_SIM_TASKS = 10
/** Сколько номеров предлагать в «Решите в каталоге». */
export const CATALOG_TIPS_COUNT = 3

/**
 * «≈ +N к прогнозу за 10 верных»: та же модель §255 — к свидетельствам
 * добавляем `k` верных задач каталога по номеру `n` «сейчас» и смотрим, на
 * сколько вырос тестовый балл. Не оценка «на глаз», а ровно то, что увидит
 * ученик, когда решит их.
 */
export function catalogGain(spec: EgeSpec, rows: readonly Evidence[], n: number, now: Date, k = CATALOG_SIM_TASKS): number {
  const base = forecastAt(spec, rows, now)
  const at = new Date(now.getTime() - 1000).toISOString()
  const sim: Evidence[] = Array.from({ length: k }, (_, i) => ({
    subject: spec.subject, n, source: 'catalog', score: 1, at, share: 1, item: `sim:${n}:${i}`,
  }))
  return forecastAt(spec, [...rows, ...sim], now).score - base.score
}

export interface CatalogTip {
  n:         number
  title:     string | null
  sectionId: string | null
  zone:      CatalogZone
  /** Засчитано задач каталога по номеру. */
  solved:    number
  /** Следующая веха (10/20/30) — «верно k из 10»; null — все пройдены. */
  next:      number | null
  /** ≈ прирост тестового балла за 10 верных; null — прогноза ещё нет. */
  gain:      number | null
}

export interface CatalogTips {
  /** Номера, которые стоит решать (не «уверенно»), по убыванию прироста. */
  tips:      CatalogTip[]
  /** Номера «уверенно» — тихой строкой: там почти максимум. */
  confident: CatalogTip[]
}

/**
 * Номера части 1 с разделом каталога. Зона — из базы (`zones`), прирост —
 * `catalogGain`. «Уверенно» в основной список не идёт (решение §256: там
 * «≈ +1, почти максимум» без кнопки — одной строкой под списком, чтобы не
 * занимать место номеров, которые действительно поднимут балл). Пока балла
 * нет (мало данных) — сначала номера без решений: они откроют прогноз.
 */
export function catalogTips(spec: EgeSpec, data: ForecastResponse, point: ForecastPoint): CatalogTips {
  const rows: { tip: CatalogTip; hasEvidence: boolean }[] = []
  for (const s of point.numbers) {
    if (s.part !== 1) continue
    const key = `${spec.subject}:${s.n}`
    const sectionId = data.sections[key] ?? null
    if (!sectionId) continue
    const z = data.zones[key]
    const zone: CatalogZone = z?.zone ?? 'growth'
    const solved = z?.solved ?? 0
    rows.push({
      hasEvidence: s.hasEvidence,
      tip: {
        n: s.n, title: data.titles[key] ?? null, sectionId, zone, solved,
        next: milestoneView(zoneRule(data.catalogRules, zone), solved).next,
        gain: point.ready ? catalogGain(spec, data.evidence, s.n, data.now) : null,
      },
    })
  }
  const confident = rows.filter(r => r.tip.zone === 'confident').map(r => r.tip).sort((a, b) => a.n - b.n)
  const rest = rows.filter(r => r.tip.zone !== 'confident')
  rest.sort(point.ready
    ? (a, b) => (b.tip.gain ?? 0) - (a.tip.gain ?? 0) || a.tip.n - b.tip.n
    : (a, b) => Number(a.hasEvidence) - Number(b.hasEvidence) || a.tip.n - b.tip.n)
  return { tips: rest.slice(0, CATALOG_TIPS_COUNT).map(r => r.tip), confident }
}

/** «≈ +5 к прогнозу»: прирост за 10 верных, не меньше 1. */
export function gainText(gain: number): string {
  return `≈ +${Math.max(1, Math.round(gain))} к прогнозу`
}

/**
 * Изменение прогноза между двумя ответами базы (до и после проверки) — та же
 * модель на тех же датах сервера. null — предмета нет в прогнозе.
 */
export function forecastChange(before: ForecastResponse | null, after: ForecastResponse | null, subject: string): ForecastChange | null {
  if (!before || !after || !isEgeSubject(subject)) return null
  const spec = activeSpec(subject)
  if (!spec) return null
  const a = forecastAt(spec, before.evidence, before.now)
  const b = forecastAt(spec, after.evidence, after.now)
  return { ready: b.ready, delta: b.ready && a.ready ? b.score - a.score : 0, score: b.score }
}
