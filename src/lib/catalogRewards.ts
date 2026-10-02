/**
 * §256. Каталог поднимает прогноз — разбор ответов базы и тексты.
 *
 * ВСЕ числа (пороги зон 40 % / 70 %, награды +5/+3/+1, вехи 10/20/30, задача
 * дня +10, цель недели +40, лимит проверок) живут ОДНОЙ таблицей в базе —
 * `catalog_reward_rules()` (миграции §256 (20261002174213…174501)) — и приходят в ответах
 * (`rules` / `catalog_rules`). Зону номера тоже считает база
 * (`student_kim_zone_shares`). Здесь своих порогов и наград нет: только
 * разбор, подписи и раскладка вех.
 *
 * Вердикт ответа — тоже только база (`catalog_check_answer`, правило
 * вариантов §63/§66). Клиент лишь показывает, что она ответила.
 */
import { plural } from '@/lib/plural'

export type CatalogZone = 'growth' | 'progress' | 'confident'

export interface ZoneRule {
  key:        CatalogZone
  perTask:    number
  milestones: { at: number; bonus: number }[]
}

export interface CatalogRules {
  windowDays:      number
  low:             number
  high:            number
  zones:           ZoneRule[]
  dailyTask:       number
  weeklyGoal:      number
  weeklyTarget:    number
  checksPerMinute: number
}

const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

export function isZone(v: unknown): v is CatalogZone {
  return v === 'growth' || v === 'progress' || v === 'confident'
}

/** `catalog_reward_rules()` → правила. Неполный ответ — null (таблицу не рисуем). */
export function normalizeCatalogRules(raw: unknown): CatalogRules | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const zones: ZoneRule[] = []
  for (const item of Array.isArray(r.zones) ? r.zones : []) {
    const z = (item ?? {}) as Record<string, unknown>
    if (!isZone(z.key)) continue
    zones.push({
      key: z.key,
      perTask: num(z.per_task),
      milestones: (Array.isArray(z.milestones) ? z.milestones : []).flatMap((m: unknown) => {
        const x = (m ?? {}) as Record<string, unknown>
        const at = num(x.at)
        return at > 0 ? [{ at, bonus: num(x.bonus) }] : []
      }).sort((a, b) => a.at - b.at),
    })
  }
  if (zones.length === 0) return null
  return {
    windowDays: num(r.window_days, 60),
    low: num(r.low),
    high: num(r.high),
    zones,
    dailyTask: num(r.daily_task),
    weeklyGoal: num(r.weekly_goal),
    weeklyTarget: num(r.weekly_target, 10),
    checksPerMinute: num(r.checks_per_minute),
  }
}

export const ZONE_LABEL: Record<CatalogZone, string> = {
  growth: 'зона роста',
  progress: 'в процессе',
  confident: 'уверенно',
}

const pct = (v: number) => `${Math.round(v * 100)}\u00a0%`

/** «верно меньше 40 %» / «40–70 %» / «больше 70 %» — из порогов базы. */
export function zoneRangeText(rules: Pick<CatalogRules, 'low' | 'high'>, zone: CatalogZone): string {
  if (zone === 'growth') return `верно меньше ${pct(rules.low)}`
  if (zone === 'progress') return `${Math.round(rules.low * 100)}–${pct(rules.high)}`
  return `больше ${pct(rules.high)}`
}

export function zoneRule(rules: CatalogRules | null, zone: CatalogZone | null): ZoneRule | null {
  if (!rules || !zone) return null
  return rules.zones.find(z => z.key === zone) ?? null
}

export const pointsWord = (n: number) => plural(n, 'балл', 'балла', 'баллов')

/** «+30 / +50 / +80». */
export function milestonesText(z: ZoneRule): string {
  return z.milestones.map(m => `+${m.bonus}`).join(' / ')
}

export interface MilestoneView {
  /** Следующая веха (10/20/30); null — все вехи пройдены. */
  next:  number | null
  /** Бонус следующей вехи в ТЕКУЩЕЙ зоне. */
  bonus: number | null
  /** Сколько засчитано по номеру. */
  solved: number
  /** Доля пути до следующей вехи 0..1 (от предыдущей). */
  ratio: number
  /** «3 из 10 → бонус +30» / «34 задачи — все вехи пройдены». */
  text:  string
  ticks: { at: number; bonus: number; reached: boolean }[]
}

/** Вехи номера: сколько засчитано, до какой вехи и сколько за неё (по зоне сейчас). */
export function milestoneView(rule: ZoneRule | null, solved: number): MilestoneView {
  const ticks = (rule?.milestones ?? []).map(m => ({ ...m, reached: solved >= m.at }))
  const nextTick = ticks.find(t => !t.reached) ?? null
  const prev = [...ticks].reverse().find(t => t.reached)?.at ?? 0
  if (!nextTick) {
    return {
      next: null, bonus: null, solved, ratio: 1, ticks,
      text: `${solved} ${plural(solved, 'задача', 'задачи', 'задач')} — все вехи пройдены`,
    }
  }
  return {
    next: nextTick.at,
    bonus: nextTick.bonus,
    solved,
    ratio: Math.min(1, Math.max(0, (solved - prev) / Math.max(1, nextTick.at - prev))),
    ticks,
    text: `${solved} из ${nextTick.at} → бонус +${nextTick.bonus}`,
  }
}

// ── Состояние страницы каталога (`catalog_practice_state`) ────────────────

export interface TaskPracticeState {
  taskId:      string
  checkable:   boolean
  attempts:    number
  lastVerdict: 'correct' | 'wrong' | null
  /** Есть верная попытка (засчитана или нет). */
  solved:      boolean
  /** Засчитана: верно без открытого ответа. */
  counted:     boolean
  revealed:    boolean
}

export interface NumberState {
  subject: string
  n:       number
  title:   string | null
  zone:    CatalogZone
  share:   number | null
  solved:  number
}

export interface PracticeState {
  rules:  CatalogRules | null
  number: NumberState | null
  tasks:  Record<string, TaskPracticeState>
}

export function normalizeNumberState(raw: unknown): NumberState | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Record<string, unknown>
  const n = num(x.n)
  if (typeof x.subject !== 'string' || !(n >= 1)) return null
  return {
    subject: x.subject,
    n,
    title: typeof x.title === 'string' ? x.title : null,
    zone: isZone(x.zone) ? x.zone : 'growth',
    share: numOrNull(x.share),
    solved: Math.max(0, num(x.solved)),
  }
}

export function normalizeTaskState(raw: unknown): TaskPracticeState | null {
  const x = (raw ?? {}) as Record<string, unknown>
  if (typeof x.task_id !== 'string') return null
  return {
    taskId: x.task_id,
    checkable: x.checkable === true,
    attempts: Math.max(0, num(x.attempts)),
    lastVerdict: x.last_verdict === 'correct' || x.last_verdict === 'wrong' ? x.last_verdict : null,
    solved: x.solved === true,
    counted: x.counted === true,
    revealed: x.revealed === true,
  }
}

export function normalizePracticeState(raw: unknown): PracticeState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const tasks: Record<string, TaskPracticeState> = {}
  for (const item of Array.isArray(r.tasks) ? r.tasks : []) {
    const t = normalizeTaskState(item)
    if (t) tasks[t.taskId] = t
  }
  return { rules: normalizeCatalogRules(r.rules), number: normalizeNumberState(r.number), tasks }
}

// ── Ответ проверки (`catalog_check_answer`) ────────────────────────────────

export interface CheckResult {
  verdict:        'correct' | 'wrong'
  alreadySolved:  boolean
  counted:        boolean
  revealedBefore: boolean
  subject:        string | null
  n:              number | null
  zone:           CatalogZone | null
  points:         number
  solved:         number | null
  milestoneBonus: number
  dailyBonus:     number
  weeklyBonus:    number
  weekly:         { progress: number; target: number } | null
  answerHtml:     string | null
}

export function normalizeCheckResult(raw: unknown): CheckResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.verdict !== 'correct' && r.verdict !== 'wrong') return null
  const w = r.weekly && typeof r.weekly === 'object' ? r.weekly as Record<string, unknown> : null
  return {
    verdict: r.verdict,
    alreadySolved: r.already_solved === true,
    counted: r.counted === true,
    revealedBefore: r.revealed_before === true,
    subject: typeof r.subject === 'string' ? r.subject : null,
    n: numOrNull(r.n),
    zone: isZone(r.zone) ? r.zone : null,
    points: num(r.points),
    solved: numOrNull(r.solved),
    milestoneBonus: num(r.milestone_bonus),
    dailyBonus: num(r.daily_bonus),
    weeklyBonus: num(r.weekly_bonus),
    weekly: w ? { progress: num(w.progress), target: num(w.target, 10) } : null,
    answerHtml: typeof r.answer_html === 'string' ? r.answer_html : null,
  }
}

/** Всего баллов за попытку: задача + веха + задача дня + цель недели. */
export function totalAward(r: CheckResult): number {
  return r.points + r.milestoneBonus + r.dailyBonus + r.weeklyBonus
}

/**
 * Изменение прогноза после проверки (клиент считает моделью §255 до/после).
 * null — прогноз этому ученику не считается (не ЕГЭ, нет курса) или ещё не
 * пересчитан; ready=false — данных мало, балла ещё нет.
 */
export interface ForecastChange { ready: boolean; delta: number; score: number }

/** «+1 к прогнозу», «+0,4 к прогнозу», «в прогноз засчитано». */
export function forecastChangeText(c: ForecastChange): string {
  if (!c.ready) return 'засчитано в прогноз'
  if (c.delta >= 0.95) return `+${Math.round(c.delta)} к прогнозу`
  if (c.delta > 0.04) return `+${c.delta.toFixed(1).replace('.', ',')} к прогнозу`
  return 'засчитано в прогноз'
}

/** Фишки результата: «+5 баллов школы», «веха 10 задач +30», «задача дня +10», «цель недели +40». */
export function awardChips(r: CheckResult): string[] {
  const out: string[] = []
  if (r.points > 0) out.push(`+${r.points} ${plural(r.points, 'балл', 'балла', 'баллов')} школы`)
  if (r.milestoneBonus > 0) out.push(`${r.solved ?? ''} ${plural(r.solved ?? 0, 'задача', 'задачи', 'задач')} по №${r.n} · +${r.milestoneBonus}`.trim())
  if (r.dailyBonus > 0) out.push(`задача дня +${r.dailyBonus}`)
  if (r.weeklyBonus > 0) out.push(`цель недели +${r.weeklyBonus}`)
  return out
}

/** Текст тоста после засчитанного верного ответа. */
export function toastText(r: CheckResult, change: ForecastChange | null): string {
  const total = totalAward(r)
  const parts = [total > 0 ? `+${total} ${plural(total, 'балл', 'балла', 'баллов')} школы` : 'Верно!']
  if (r.dailyBonus > 0) parts.push('задача дня решена')
  if (r.weeklyBonus > 0) parts.push('цель недели выполнена')
  if (change?.ready) parts.push(`прогноз ${Math.round(change.score)}`)
  return parts.join(' · ')
}

/** Ошибка базы → человеческий текст. */
export function checkErrorText(message: string | null | undefined): string {
  const m = message ?? ''
  if (m.includes('RATE_LIMIT')) return 'Слишком много проверок подряд — подождите минуту'
  if (m.includes('EMPTY_ANSWER')) return 'Введите ответ'
  if (m.includes('NOT_CHECKABLE')) return 'У этой задачи нет короткого ответа для проверки'
  if (m.includes('NOT_FOUND')) return 'Задача не найдена'
  return 'Не удалось проверить ответ. Попробуйте ещё раз'
}

// ── Главная: задача дня и цель недели ──────────────────────────────────────

export interface DailyTask {
  day:       string
  subject:   string
  n:         number
  zone:      CatalogZone
  bonus:     number
  sectionId: string | null
  title:     string | null
  task: {
    id:            string
    statementHtml: string
    subject:       string
    examType:      string
    assets:        { id: string; tex_session_id: number | null; kind: string; storage_path: string; alt: string | null; position: number }[]
  } | null
  attempts:  number
  revealed:  boolean
  /** Есть верная попытка. */
  solved:    boolean
  /** Засчитано +N: верно в тот же день без открытого ответа. */
  done:      boolean
}

/** `student_daily_task(subject)` → задача дня; null — задачи нет (не ЕГЭ, всё решено, функции нет). */
export function normalizeDailyTask(raw: unknown): DailyTask | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const t = r.task && typeof r.task === 'object' ? r.task as Record<string, unknown> : null
  if (!t || typeof t.id !== 'string' || typeof r.subject !== 'string') return null
  const n = num(r.n)
  if (!(n >= 1)) return null
  return {
    day: typeof r.day === 'string' ? r.day.slice(0, 10) : '',
    subject: r.subject,
    n,
    zone: isZone(r.zone) ? r.zone : 'growth',
    bonus: num(r.bonus),
    sectionId: typeof r.section_id === 'string' ? r.section_id : null,
    title: typeof r.title === 'string' ? r.title : null,
    task: {
      id: t.id,
      statementHtml: typeof t.statement_html === 'string' ? t.statement_html : '',
      subject: typeof t.subject === 'string' ? t.subject : '',
      examType: typeof t.exam_type === 'string' ? t.exam_type : '',
      assets: (Array.isArray(t.assets) ? t.assets : []).flatMap((a: unknown) => {
        const x = (a ?? {}) as Record<string, unknown>
        return typeof x.id === 'string' && typeof x.storage_path === 'string'
          ? [{ id: x.id, tex_session_id: null, kind: typeof x.kind === 'string' ? x.kind : 'image', storage_path: x.storage_path, alt: typeof x.alt === 'string' ? x.alt : null, position: num(x.position) }]
          : []
      }),
    },
    attempts: num(r.attempts),
    revealed: r.revealed === true,
    solved: r.solved === true,
    done: r.done === true,
  }
}

export interface WeeklyGoal {
  weekStart: string
  weekEnd:   string
  subject:   string
  numbers:   number[]
  sections:  { n: number; sectionId: string; title: string | null }[]
  target:    number
  progress:  number
  done:      boolean
  bonus:     number
}

export function normalizeWeeklyGoal(raw: unknown): WeeklyGoal | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.numbers) || r.numbers.length === 0 || typeof r.subject !== 'string') return null
  const numbers = r.numbers.map(Number).filter(n => Number.isInteger(n) && n >= 1)
  if (numbers.length === 0) return null
  const target = Math.max(1, num(r.target, 10))
  const progress = Math.max(0, num(r.progress))
  return {
    weekStart: typeof r.week_start === 'string' ? r.week_start.slice(0, 10) : '',
    weekEnd: typeof r.week_end === 'string' ? r.week_end.slice(0, 10) : '',
    subject: r.subject,
    numbers,
    sections: (Array.isArray(r.sections) ? r.sections : []).flatMap((s: unknown) => {
      const x = (s ?? {}) as Record<string, unknown>
      return typeof x.section_id === 'string' && num(x.n) >= 1 ? [{ n: num(x.n), sectionId: x.section_id, title: typeof x.title === 'string' ? x.title : null }] : []
    }),
    target,
    progress,
    done: r.done === true || progress >= target,
    bonus: num(r.bonus),
  }
}

/** «№6 и №7», «№6, №7 и №9». */
export function numbersText(ns: readonly number[]): string {
  const xs = ns.map(n => `№${n}`)
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`
}

/** «3 из 10 решено» / «10 из 10 — бонус +40 получен!». */
export function weeklyProgressText(g: WeeklyGoal): string {
  return g.done
    ? `${Math.min(g.progress, g.target)} из ${g.target} — бонус +${g.bonus} получен!`
    : `${g.progress} из ${g.target} решено`
}
