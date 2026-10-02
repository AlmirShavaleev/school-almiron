/**
 * §259. Срок ДЗ темы глазами учителя: «вовремя / опоздание / просрочено / ещё».
 *
 * Правило одно с базой — «ДЗ вовремя» в наградах и баллах школы
 * (`student_school_points`, §255/§257, CTE `first_sub`): считается ПЕРВАЯ сдача
 * (самый ранний `submitted_at` среди всех попыток ученика по этому ДЗ), и она
 * вовремя, если её дата ПО МОСКВЕ не позже даты срока. Срок включительно:
 * «до 11 сент» и сдача 11 сент в 23:40 МСК — вовремя, в 00:00 12 сент — уже
 * опоздание на 1 день. Пересдача после доработки опоздания не делает — она не
 * первая. Черновик (`submitted_at` пуст) сдачей не считается.
 *
 * Отличие от базы одно и намеренное: у наград «срока нет — тоже вовремя»
 * (баллы есть), а в таблице учителя без срока статуса нет вовсе — «вовремя»
 * без срока было бы выдумкой.
 *
 * Срок (`topic_homework.due_at`) — тип `date`, «YYYY-MM-DD» без часов. Дни
 * считаются календарными, по Москве (UTC+3 круглый год).
 */
const MSK = 'Europe/Moscow'
const DAY_MS = 86_400_000

export interface DeadlineAttempt {
  submitted_at: string | null
}

export type DeadlineState =
  /** Срок не задан — статуса нет. */
  | { kind: 'none' }
  /** Первая сдача — в день срока или раньше. */
  | { kind: 'ontime'; submittedAt: string }
  /** Первая сдача — позже срока на `days` календарных дней. */
  | { kind: 'late'; days: number; submittedAt: string }
  /** Не сдано, срок прошёл `days` дней назад. */
  | { kind: 'overdue'; days: number }
  /** Не сдано, срок сегодня. */
  | { kind: 'today' }
  /** Не сдано, до срока `days` дней. */
  | { kind: 'left'; days: number }

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

/** Дата по Москве «YYYY-MM-DD». */
export function mskDateKey(t: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MSK, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t))
}

/** «YYYY-MM-DD» из `due_at` (date; на всякий случай и из timestamp) или null. */
export function dueDateKey(dueAt: string | null | undefined): string | null {
  if (!dueAt) return null
  const key = dueAt.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null
}

/** Разница календарных дат `b − a` в днях. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

/** Первая сдача — самый ранний `submitted_at`; черновики не в счёт. */
export function firstSubmittedAt(attempts: readonly DeadlineAttempt[]): string | null {
  let best: { iso: string; t: number } | null = null
  for (const a of attempts) {
    const t = ms(a.submitted_at)
    if (t == null) continue
    if (!best || t < best.t) best = { iso: a.submitted_at as string, t }
  }
  return best?.iso ?? null
}

/** Состояние срока у одного ученика: все его попытки по этому ДЗ, «сейчас» — `nowMs`. */
export function homeworkDeadline(
  dueAt: string | null | undefined,
  attempts: readonly DeadlineAttempt[],
  nowMs: number,
): DeadlineState {
  const due = dueDateKey(dueAt)
  if (!due) return { kind: 'none' }
  const first = firstSubmittedAt(attempts)
  if (first) {
    const late = daysBetween(due, mskDateKey(ms(first) as number))
    return late <= 0 ? { kind: 'ontime', submittedAt: first } : { kind: 'late', days: late, submittedAt: first }
  }
  const left = daysBetween(mskDateKey(nowMs), due)
  if (left < 0) return { kind: 'overdue', days: -left }
  if (left === 0) return { kind: 'today' }
  return { kind: 'left', days: left }
}

/** Подпись в колонке «Срок»: «вовремя», «опоздание 17 дн.», «просрочено 21 дн.», «ещё 3 дн.», «сегодня срок», «—». */
export function deadlineLabel(s: DeadlineState): string {
  switch (s.kind) {
    case 'none': return '—'
    case 'ontime': return 'вовремя'
    case 'late': return `опоздание ${s.days} дн.`
    case 'overdue': return `просрочено ${s.days} дн.`
    case 'today': return 'сегодня срок'
    case 'left': return `ещё ${s.days} дн.`
  }
}

/** Тон подписи: вовремя — зелёный, опоздание — янтарный, просрочено — красный, остальное — серый. */
export type DeadlineTone = 'ok' | 'late' | 'bad' | 'wait' | 'none'

export function deadlineTone(s: DeadlineState): DeadlineTone {
  switch (s.kind) {
    case 'ontime': return 'ok'
    case 'late': return 'late'
    case 'overdue': return 'bad'
    case 'today':
    case 'left': return 'wait'
    default: return 'none'
  }
}

export interface DeadlineSummary {
  ontime: number
  late: number
  /** Не сдали (срок прошёл или ещё нет). */
  missing: number
}

/** Сводка по классу. Без срока — null (сводки нет). */
export function deadlineSummary(states: readonly DeadlineState[]): DeadlineSummary | null {
  if (states.length === 0 || states.every(s => s.kind === 'none')) return null
  const out: DeadlineSummary = { ontime: 0, late: 0, missing: 0 }
  for (const s of states) {
    if (s.kind === 'ontime') out.ontime += 1
    else if (s.kind === 'late') out.late += 1
    else if (s.kind !== 'none') out.missing += 1
  }
  return out
}

/** «пт 11 сент» — дата срока. */
export function formatDueDate(dueAt: string | null | undefined): string | null {
  const key = dueDateKey(dueAt)
  if (!key) return null
  // Полдень по UTC — тот же календарный день и в Москве.
  const d = new Date(`${key}T12:00:00Z`)
  const wd = new Intl.DateTimeFormat('ru-RU', { timeZone: MSK, weekday: 'short' }).format(d).replace(/\.$/, '')
  const day = new Intl.DateTimeFormat('ru-RU', { timeZone: MSK, day: 'numeric', month: 'short' }).format(d).replace(/\.$/, '')
  return `${wd} ${day}`
}

/** «вовремя 11 · с опозданием 4 · не сдали 2» — для подписи и скринридера. */
export function deadlineSummaryText(s: DeadlineSummary): string {
  return `вовремя ${s.ontime} · с опозданием ${s.late} · не сдали ${s.missing}`
}

