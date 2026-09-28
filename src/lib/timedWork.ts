/**
 * §240. «Проверочная / Контрольная работа» — работа по времени.
 *
 * Чистые помощники без сети. Правила держит база (PENDING_240: окно ученика,
 * одна попытка, автосдача, гейт условия и решения) — здесь только то, что
 * нужно экрану, чтобы показать правильное состояние и не рисовать кнопку,
 * которая заведомо закончится отказом сервера. Это UX, а не защита.
 *
 * Время показываем ПО МОСКВЕ (решение владельца): ученик в другом поясе видит
 * то же «10:00», что и учитель. Москва с 2014 года живёт на UTC+3 без
 * перехода на летнее время, поэтому перевод «дата + время по Москве → момент»
 * делается фиксированным смещением, а показ — через Intl с часовым поясом.
 */
import { plural } from './plural'

export type TopicKind = 'lesson' | 'check' | 'control'
export const TOPIC_KINDS: readonly TopicKind[] = ['lesson', 'check', 'control'] as const

/** Полные названия — выбор типа у учителя и метка у ученика. */
export const TOPIC_KIND_LABEL: Record<TopicKind, string> = {
  lesson: 'Урок',
  check: 'Проверочная работа',
  control: 'Контрольная работа',
}

/** Подпись под кнопкой выбора типа (как в макете). */
export const TOPIC_KIND_HINT: Record<TopicKind, string> = {
  lesson: 'теория, задачи, ДЗ',
  check: 'короткая, по времени',
  control: 'по времени, одна попытка',
}

/**
 * Плашка работы в очереди проверки: «ДЗ» / «Проверочная» / «КР». У урока
 * работа — это ДЗ темы, поэтому и плашка «ДЗ», а не «Урок».
 */
export const WORK_KIND_TAG: Record<TopicKind, string> = {
  lesson: 'ДЗ',
  check: 'Проверочная',
  control: 'КР',
}

/** Столбец `topics.kind` может отсутствовать (миграция не применена) — тогда урок. */
export function normalizeTopicKind(raw: unknown): TopicKind {
  return raw === 'check' || raw === 'control' ? raw : 'lesson'
}

/** Работа по времени: проверочная или контрольная — правила у них одни. */
export function isTimedKind(kind: unknown): boolean {
  const k = normalizeTopicKind(kind)
  return k === 'check' || k === 'control'
}

// ── Москва ───────────────────────────────────────────────────────────────────

export const MOSCOW_TZ = 'Europe/Moscow'
const MOSCOW_OFFSET = '+03:00'

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** «10:45» по Москве. */
export function formatMoscowTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  if (!d) return ''
  return new Intl.DateTimeFormat('ru-RU', { timeZone: MOSCOW_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
}

/** «чт, 2 октября» по Москве. */
export function formatMoscowDay(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  if (!d) return ''
  return new Intl.DateTimeFormat('ru-RU', { timeZone: MOSCOW_TZ, weekday: 'short', day: 'numeric', month: 'long' }).format(d)
}

/** «чт 2 окт, 10:00» — компактно, для плашек и карточек. */
export function formatMoscowShort(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  if (!d) return ''
  const day = new Intl.DateTimeFormat('ru-RU', { timeZone: MOSCOW_TZ, weekday: 'short', day: 'numeric', month: 'short' })
    .format(d).replace(/\.$/, '').replace(',', '')
  return `${day}, ${formatMoscowTime(d)}`
}

/** Дата и время по Москве в формате полей ввода: { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function moscowParts(value: string | number | Date | null | undefined): { date: string; time: string } {
  const d = toDate(value)
  if (!d) return { date: '', time: '' }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

/**
 * Дата и время по Москве → момент (ISO UTC). `null` — поля неполные или
 * неверные: сохранять нечего.
 */
export function moscowToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const d = new Date(`${date}T${time}:00${MOSCOW_OFFSET}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// ── Окно учителя: дата + «открывается» + «закрывается» ─────────────────────

export interface WindowDraft {
  date: string
  opens: string
  closes: string
}

export type WindowParse =
  | { kind: 'empty' }
  | { kind: 'incomplete' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ok'; opensAt: string; closesAt: string }

/**
 * Поля «дата / открывается / закрывается» → окно. Работа пишется в один день
 * (как в макете): закрытие раньше открытия — ошибка, а не «на следующий день».
 */
export function parseWindowDraft(draft: WindowDraft): WindowParse {
  const { date, opens, closes } = draft
  if (!date && !opens && !closes) return { kind: 'empty' }
  if (!date || !opens || !closes) return { kind: 'incomplete' }
  const opensAt = moscowToIso(date, opens)
  const closesAt = moscowToIso(date, closes)
  if (!opensAt || !closesAt) return { kind: 'invalid', message: 'Проверьте дату и время' }
  if (Date.parse(closesAt) <= Date.parse(opensAt)) {
    return { kind: 'invalid', message: 'Закрываться работа должна позже, чем открываться' }
  }
  return { kind: 'ok', opensAt, closesAt }
}

/** Окно из базы → поля ввода. */
export function windowDraftOf(opensAt: string | null | undefined, closesAt: string | null | undefined): WindowDraft {
  const o = moscowParts(opensAt)
  const c = moscowParts(closesAt)
  return { date: o.date, opens: o.time, closes: c.time }
}

/** «45 минут», «1 ч 30 мин», «2 часа». */
export function durationLabel(opensAt: string | null | undefined, closesAt: string | null | undefined): string {
  const o = toDate(opensAt), c = toDate(closesAt)
  if (!o || !c) return ''
  const minutes = Math.round((c.getTime() - o.getTime()) / 60e3)
  if (minutes <= 0) return ''
  if (minutes < 60) return `${minutes} ${plural(minutes, 'минута', 'минуты', 'минут')}`
  const h = Math.floor(minutes / 60), m = minutes % 60
  if (m === 0) return `${h} ${plural(h, 'час', 'часа', 'часов')}`
  return `${h} ч ${m} мин`
}

// ── Отсчёт и таймер ──────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Отсчёт: «32:14», «1:02:03», «1 д 03:12:40». Отрицательное — «00:00».
 * Секунды округляются вверх: при «осталось 0,4 с» на экране «00:01», а не
 * «00:00» раньше, чем сервер закроет окно.
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const days = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (days > 0) return `${days} д ${pad(h)}:${pad(m)}:${pad(s)}`
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

/** За 5 минут до конца таймер краснеет. */
export const WARN_BEFORE_MS = 5 * 60e3
export function isTimerWarning(msLeft: number): boolean {
  return msLeft > 0 && msLeft <= WARN_BEFORE_MS
}

/**
 * Разница «сервер − устройство». Середина запроса — лучшая оценка момента,
 * когда сервер прочитал часы: так сеть туда и обратно не сдвигает таймер.
 */
export function serverOffsetMs(serverNowIso: string | null | undefined, sentAtMs: number, receivedAtMs: number): number {
  const server = toDate(serverNowIso)
  if (!server) return 0
  return server.getTime() - (sentAtMs + receivedAtMs) / 2
}

// ── Состояние ученика ────────────────────────────────────────────────────────

/**
 * Пять состояний экрана из макета и два служебных:
 *  - `unscheduled` — работа по времени без окна («время не назначено»);
 *  - `before` — до открытия, отсчёт;
 *  - `live` — идёт, таймер;
 *  - `sending` — окно закрылось, у черновика есть фото, автосдача вот-вот;
 *  - `sent` — сдано, ждёт проверки;
 *  - `missed` — окно закрылось, сдавать нечего;
 *  - `done` — проверено (разбор §239, без пересдачи).
 */
export type TimedPhase = 'unscheduled' | 'before' | 'live' | 'sending' | 'sent' | 'missed' | 'done'

export interface TimedPhaseInput {
  opensAt: string | null
  closesAt: string | null
  /** Последняя попытка ученика по этой работе. */
  attemptStatus: 'draft' | 'submitted' | 'accepted' | 'returned_for_revision' | null
  /** Сколько фото в черновике. */
  draftFiles: number
  /** Сейчас по серверу, мс. */
  nowMs: number
}

export function timedPhase(input: TimedPhaseInput): TimedPhase {
  const { opensAt, closesAt, attemptStatus, draftFiles, nowMs } = input
  // Проверенная работа — разбор, что бы ни было с окном. Возврат на доработку
  // у работ по времени запрещён; возвращённая до §240 — тоже «проверено».
  if (attemptStatus === 'accepted' || attemptStatus === 'returned_for_revision') return 'done'
  if (attemptStatus === 'submitted') return 'sent'
  const o = toDate(opensAt), c = toDate(closesAt)
  if (!o || !c) return 'unscheduled'
  if (nowMs < o.getTime()) return 'before'
  if (nowMs < c.getTime()) return 'live'
  return attemptStatus === 'draft' && draftFiles > 0 ? 'sending' : 'missed'
}

/** «сдано автоматически в 10:45» / «сдано в 10:41». */
export function submittedLabel(submittedAt: string | null | undefined, auto: boolean | null | undefined): string {
  const time = formatMoscowTime(submittedAt)
  if (!time) return ''
  return auto ? `сдано автоматически в ${time}` : `сдано в ${time}`
}

// ── Сводка учителю ───────────────────────────────────────────────────────────

export interface TimedSummary {
  inClass: number
  submittedSelf: number
  submittedAuto: number
  notSubmitted: number
  personalWindows: number
  closed: boolean
  closesAt: string | null
}

/** Ответ `topic_homework_timed_summary` → числа. `bigint` приходит и строкой. */
export function parseTimedSummary(raw: unknown): TimedSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const n = (v: unknown) => Number(v) || 0
  return {
    inClass: n(r.in_class),
    submittedSelf: n(r.submitted_self),
    submittedAuto: n(r.submitted_auto),
    notSubmitted: n(r.not_submitted),
    personalWindows: n(r.personal_windows),
    closed: r.closed === true,
    closesAt: typeof r.closes_at === 'string' ? r.closes_at : null,
  }
}

// ── Очередь проверки: фильтр по типу ─────────────────────────────────────────

export type WorkKindFilter = 'all' | TopicKind
export const WORK_KIND_FILTER_KEY = 'homework-queue:kind'

export function isWorkKindFilter(value: unknown): value is WorkKindFilter {
  return value === 'all' || value === 'lesson' || value === 'check' || value === 'control'
}

/** Сколько работ каждого типа — счётчики у пунктов фильтра. */
export function countByKind<T extends { topicKind?: TopicKind }>(rows: readonly T[]): Record<WorkKindFilter, number> {
  const out: Record<WorkKindFilter, number> = { all: rows.length, lesson: 0, check: 0, control: 0 }
  for (const r of rows) out[r.topicKind ?? 'lesson'] += 1
  return out
}

export function filterByKind<T extends { topicKind?: TopicKind }>(rows: readonly T[], filter: WorkKindFilter): T[] {
  if (filter === 'all') return [...rows]
  return rows.filter(r => (r.topicKind ?? 'lesson') === filter)
}

/** Запомненный фильтр: чтение из localStorage не должно ронять страницу. */
export function readStoredKindFilter(storage: Pick<Storage, 'getItem'> | null | undefined): WorkKindFilter {
  try {
    const v = storage?.getItem(WORK_KIND_FILTER_KEY)
    return isWorkKindFilter(v) ? v : 'all'
  } catch {
    return 'all'
  }
}

export function storeKindFilter(storage: Pick<Storage, 'setItem'> | null | undefined, value: WorkKindFilter): void {
  try {
    storage?.setItem(WORK_KIND_FILTER_KEY, value)
  } catch {
    /* приватный режим, запрет сайта — фильтр просто не запомнится */
  }
}
