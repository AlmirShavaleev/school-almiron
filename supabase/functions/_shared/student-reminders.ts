/**
 * §264. Напоминания ученикам в Telegram — ЧИСТЫЕ правила: кто, когда, сколько в день, в каком порядке, каким
 * текстом. Без сети и базы — модуль гоняет vitest (`src/lib/__tests__/studentReminders.test.ts`), клиент берёт
 * отсюда список видов и подписи для настроек (`src/lib/studentReminders.ts` реэкспортирует).
 *
 * Как устроено (тот же механизм, что у напоминаний об уроках, второй системы нет):
 *   pg_cron (раз в 5 минут, секрет из vault) → edge-функция `student-reminders` (тонкая обёртка) →
 *   SQL `student_reminder_candidates(now, kinds)` отдаёт ФАКТЫ (сроки, окна, сдано/черновик/фото, серия,
 *   настройки курса и ученика, журнал напоминаний за сутки) → `planReminders` здесь решает, что ставить →
 *   строки `notification_queue` (event_type `student_reminder`, ключ дедупликации) → `process-notification-queue`
 *   собирает текст `buildStudentReminderTelegramMessage` и отправляет.
 *
 * Правила (макет §264, вкладка В; владелец 03.10 «ок, запускай»):
 *   * виды и моменты — `REMINDER_KINDS` ниже (по Москве; Москва без перехода на летнее время, UTC+3);
 *   * тишина 22:00–08:00 МСК: момент, попавший в тишину, переносится на 08:00, если событие ещё впереди
 *     (проверочная в 08:45 — напоминание в 08:00), иначе напоминания нет;
 *   * не больше `DAILY_LIMIT` напоминаний в день одному ученику; приоритет — `REMINDER_PRIORITY`
 *     (проверочная > нет фото > пробник > срок ДЗ > серия). Приоритет решает и между одновременными, и «бронью»:
 *     младшее не занимает последнее место дня, если позже сегодня у ученика ждёт старшее;
 *   * без привязанного Telegram (подключение + общий выключатель) — ничего;
 *   * дедупликация «один вид × одно событие × один ученик» — ключ `dedupKey`, уникальный индекс очереди.
 */
import { buildLinkButton, escapeHtml, formatClockMsk } from './variant-telegram.ts'

export const STUDENT_REMINDER_EVENT = 'student_reminder'

export type ReminderKind =
  | 'hw_due_tomorrow'
  | 'hw_overdue'
  | 'check_soon'
  | 'no_photo'
  | 'streak'
  | 'mock_tomorrow'

export interface ReminderKindInfo {
  kind: ReminderKind
  /** Подпись в настройках (учитель и ученик). */
  label: string
  /** «Когда» — как в макете. */
  when: string
  /** «Кому» — как в макете. */
  who: string
  /** Включено ли в курсе по умолчанию (нет строки настроек — эти значения). */
  defaultOn: boolean
  /** Колонка `course_reminder_settings`. */
  courseColumn: string
  /** Колонка `notification_prefs` (выключатель ученика; по умолчанию включено). */
  prefColumn: string
}

/** Порядок — как строки в макете (В). */
export const REMINDER_KINDS: readonly ReminderKindInfo[] = [
  { kind: 'hw_due_tomorrow', label: 'Срок ДЗ завтра', when: 'накануне в 19:00', who: 'кто не сдал', defaultOn: true, courseColumn: 'hw_due_tomorrow', prefColumn: 'remind_hw_due_tomorrow' },
  { kind: 'hw_overdue', label: 'Срок ДЗ прошёл', when: 'на следующий день в 17:00', who: 'кто не сдал', defaultOn: true, courseColumn: 'hw_overdue', prefColumn: 'remind_hw_overdue' },
  { kind: 'check_soon', label: 'Скоро проверочная', when: 'за 1 час до начала', who: 'весь класс', defaultOn: true, courseColumn: 'check_soon', prefColumn: 'remind_check_soon' },
  { kind: 'no_photo', label: 'Нет фото в работе', when: 'за 10 мин до конца', who: 'открыл, но без фото', defaultOn: true, courseColumn: 'no_photo', prefColumn: 'remind_no_photo' },
  { kind: 'streak', label: 'Серия прервётся', when: 'в 18:30', who: 'серия от 3 дней, сегодня не решал', defaultOn: true, courseColumn: 'streak', prefColumn: 'remind_streak' },
  { kind: 'mock_tomorrow', label: 'Пробник завтра', when: 'накануне в 19:00', who: 'группа', defaultOn: false, courseColumn: 'mock_tomorrow', prefColumn: 'remind_mock_tomorrow' },
]

export const REMINDER_KIND_KEYS: readonly ReminderKind[] = REMINDER_KINDS.map(k => k.kind)

export function isReminderKind(v: unknown): v is ReminderKind {
  return typeof v === 'string' && (REMINDER_KIND_KEYS as readonly string[]).includes(v)
}

/** Меньше — важнее. Задача: «проверочная > нет фото > срок ДЗ > серия»; пробник — экзамен, ставим за «нет фото». */
export const REMINDER_PRIORITY: Readonly<Record<ReminderKind, number>> = {
  check_soon: 1,
  no_photo: 2,
  mock_tomorrow: 3,
  hw_due_tomorrow: 4,
  hw_overdue: 5,
  streak: 6,
}

export const DAILY_LIMIT = 2
/** Тишина: с 22:00 до 08:00 по Москве (минуты от полуночи). */
export const QUIET_FROM_MIN = 22 * 60
export const QUIET_TO_MIN = 8 * 60
/** Серия, которую жалко прерывать: от трёх дней. */
export const STREAK_MIN = 3
/**
 * Запас вперёд: крон раз в 5 минут, очередь — тоже раз в 5 минут. Напоминание, момент которого наступит в
 * ближайшие 5 минут, ставится сразу со `scheduled_for` = момент: очередь отправит его в свой ближайший такт после
 * момента, а не через такт после следующего прогона (иначе «за 10 минут до конца» приходило бы за 5).
 */
export const LOOKAHEAD_MS = 5 * 60_000

const MIN = 60_000
const DAY = 24 * 60 * MIN
const MSK = 3 * 60 * MIN

// ── Время по Москве ──────────────────────────────────────────────────────

/** День «YYYY-MM-DD» по Москве. */
export function mskDay(d: Date): string {
  return new Date(d.getTime() + MSK).toISOString().slice(0, 10)
}

/** Минуты от полуночи по Москве. */
export function mskMinutes(d: Date): number {
  const t = new Date(d.getTime() + MSK)
  return t.getUTCHours() * 60 + t.getUTCMinutes()
}

/** Момент «день + HH:MM по Москве». */
export function mskAt(day: string, minutes: number): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - MSK + minutes * MIN)
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
}

export function isQuietMsk(d: Date): boolean {
  const m = mskMinutes(d)
  return m >= QUIET_FROM_MIN || m < QUIET_TO_MIN
}

/** Момент, попавший в тишину, — на ближайшие 08:00 после него; вне тишины — как есть. */
export function outOfQuiet(d: Date): Date {
  if (!isQuietMsk(d)) return d
  const day = mskDay(d)
  const at8 = mskAt(day, QUIET_TO_MIN)
  return mskMinutes(d) < QUIET_TO_MIN ? at8 : mskAt(addDays(day, 1), QUIET_TO_MIN)
}

// ── Кандидаты (факты из базы) ────────────────────────────────────────────

export interface ReminderCandidate {
  kind: ReminderKind
  /** Событие: ДЗ+срок, работа+окно, пробник+начало, день серии — часть ключа дедупликации. */
  eventKey: string
  profileId: string
  studentId: string | null
  courseId: string | null
  groupId: string | null
  /** ДЗ / пробник (entity_id в очереди); у серии null. */
  entityId: string | null
  title: string
  /** У проверочной/контрольной: 'check' | 'control'. */
  workKind: string | null
  /** Начало: окно работы (личное, если есть — §240) или начало пробника. */
  opensAt: string | null
  /** Конец окна работы / пробника. */
  closesAt: string | null
  /** Срок ДЗ «YYYY-MM-DD». */
  dueDate: string | null
  link: string | null
  /** Сдано (правило §259: есть попытка с submitted_at) / у работы — есть не-черновик. */
  done: boolean
  hasDraft: boolean
  hasPhoto: boolean
  /** Открыл условие работы (§263, a263). До §263 база отдаёт false — тогда «открыл» = есть черновик. */
  opened: boolean
  streak: number
  solvedToday: boolean
  /** Telegram подключён и общий выключатель «Telegram» включён. */
  telegram: boolean
  /** Вид включён в курсе (учитель) — у серии: хотя бы в одном курсе ученика. */
  courseOn: boolean
  /** Вид не выключен учеником. */
  studentOn: boolean
}

/** Строка журнала: напоминания ученика за последние сутки (любого статуса). */
export interface ReminderLogRow {
  profileId: string
  key: string
  status: string
  scheduledFor: string
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const bool = (v: unknown): boolean => v === true
const int = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** Ответ базы → кандидаты. Мусор пропускается. */
export function normalizeCandidates(raw: unknown): ReminderCandidate[] {
  if (!Array.isArray(raw)) return []
  const out: ReminderCandidate[] = []
  for (const item of raw) {
    const x = (item ?? {}) as Record<string, unknown>
    const profileId = str(x.profile_id)
    const eventKey = str(x.event_key)
    if (!isReminderKind(x.kind) || !profileId || !eventKey) continue
    out.push({
      kind: x.kind,
      eventKey,
      profileId,
      studentId: str(x.student_id),
      courseId: str(x.course_id),
      groupId: str(x.group_id),
      entityId: str(x.entity_id),
      title: str(x.title) ?? '',
      workKind: str(x.work_kind),
      opensAt: str(x.opens_at),
      closesAt: str(x.closes_at),
      dueDate: str(x.due_date)?.slice(0, 10) ?? null,
      link: str(x.link),
      done: bool(x.done),
      hasDraft: bool(x.has_draft),
      hasPhoto: bool(x.has_photo),
      opened: bool(x.opened),
      streak: int(x.streak),
      solvedToday: bool(x.solved_today),
      telegram: bool(x.telegram),
      courseOn: bool(x.course_on),
      studentOn: x.student_on !== false,
    })
  }
  return out
}

export function normalizeLog(raw: unknown): ReminderLogRow[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item: unknown) => {
    const x = (item ?? {}) as Record<string, unknown>
    const profileId = str(x.profile_id)
    const key = str(x.key)
    const scheduledFor = str(x.scheduled_for)
    if (!profileId || !key || !scheduledFor) return []
    return [{ profileId, key, status: str(x.status) ?? 'pending', scheduledFor }]
  })
}

// ── Кто ──────────────────────────────────────────────────────────────────

/** Подходит ли ученик под вид — без учёта времени, лимита и дедупликации. */
export function isEligible(c: ReminderCandidate): boolean {
  if (!c.telegram || !c.courseOn || !c.studentOn) return false
  switch (c.kind) {
    case 'hw_due_tomorrow':
    case 'hw_overdue':
      return !c.done && !!c.dueDate
    case 'check_soon':
      return !c.done && !!c.opensAt
    case 'no_photo':
      // «Открыл условие или есть черновик — и фото нет». Отметку «открыл» даёт §263; до неё — черновик.
      return !c.done && !c.hasPhoto && (c.hasDraft || c.opened) && !!c.closesAt
    case 'streak':
      return c.streak >= STREAK_MIN && !c.solvedToday
    case 'mock_tomorrow':
      return !!c.opensAt
  }
}

// ── Когда ────────────────────────────────────────────────────────────────

export interface FireWindow {
  /** Момент напоминания после переноса из тишины. */
  at: Date
  /** После этого момента напоминание бессмысленно (событие началось / кончилось / день кончился). */
  until: Date
}

const parse = (iso: string | null): number => (iso ? Date.parse(iso) : NaN)

/**
 * Окно напоминания относительно «сегодня» по Москве. null — у вида сегодня напоминания нет (не тот срок, не тот
 * день пробника, момент в тишине и событие до 08:00).
 */
export function fireWindow(c: ReminderCandidate, now: Date): FireWindow | null {
  const today = mskDay(now)
  const dayEnd = mskAt(today, QUIET_FROM_MIN)
  let at: Date
  let until: Date
  switch (c.kind) {
    case 'hw_due_tomorrow':
      if (c.dueDate !== addDays(today, 1)) return null
      at = mskAt(today, 19 * 60); until = dayEnd
      break
    case 'hw_overdue':
      if (c.dueDate !== addDays(today, -1)) return null
      at = mskAt(today, 17 * 60); until = dayEnd
      break
    case 'streak':
      at = mskAt(today, 18 * 60 + 30); until = dayEnd
      break
    case 'mock_tomorrow': {
      const t = parse(c.opensAt)
      if (!Number.isFinite(t) || mskDay(new Date(t)) !== addDays(today, 1)) return null
      at = mskAt(today, 19 * 60); until = dayEnd
      break
    }
    case 'check_soon': {
      const t = parse(c.opensAt)
      if (!Number.isFinite(t)) return null
      at = new Date(t - 60 * MIN); until = new Date(t)
      break
    }
    case 'no_photo': {
      const t = parse(c.closesAt)
      if (!Number.isFinite(t)) return null
      at = new Date(t - 10 * MIN); until = new Date(t)
      break
    }
  }
  const moved = outOfQuiet(at)
  if (moved.getTime() >= until.getTime()) return null
  return { at: moved, until }
}

/** Пора ли ставить: момент наступит в ближайшие LOOKAHEAD_MS (или уже наступил), а событие ещё впереди. */
export function isDue(c: ReminderCandidate, now: Date): boolean {
  const w = fireWindow(c, now)
  if (!w) return false
  const t = now.getTime()
  return w.at.getTime() <= t + LOOKAHEAD_MS && t < w.until.getTime()
}

/**
 * Какие виды спрашивать у базы сейчас. Всё, кроме серии, — дёшево (отбор по срокам и окнам), поэтому берётся
 * всегда вне тишины: нужно и для «брони» под старшие виды. Серия считается по всей истории ученика — её спрашиваем,
 * только когда её окно (18:30–22:00) открыто.
 */
export function kindsToFetch(now: Date): ReminderKind[] {
  const ahead = new Date(now.getTime() + LOOKAHEAD_MS)
  if (isQuietMsk(now) && isQuietMsk(ahead)) return []
  const m = mskMinutes(ahead)
  const streakOpen = mskMinutes(now) < QUIET_FROM_MIN && m >= 18 * 60 + 30
  return REMINDER_KIND_KEYS.filter(k => k !== 'streak' || streakOpen)
}

// ── Сколько и в каком порядке ────────────────────────────────────────────

export function dedupKey(c: Pick<ReminderCandidate, 'kind' | 'eventKey' | 'profileId'>): string {
  return `${STUDENT_REMINDER_EVENT}:${c.kind}:${c.eventKey}:${c.profileId}`
}

const COUNTED = new Set(['pending', 'processing', 'sent'])

/** Сколько напоминаний ученику уже стоит/ушло на день `day` (погашенные и сбойные не считаются). */
export function countForDay(log: readonly ReminderLogRow[], profileId: string, day: string): number {
  return log.filter(r => r.profileId === profileId && COUNTED.has(r.status) && mskDay(new Date(r.scheduledFor)) === day).length
}

export interface QueueRow {
  profile_id: string
  channel: 'telegram'
  event_type: typeof STUDENT_REMINDER_EVENT
  entity_type: string | null
  entity_id: string | null
  deduplication_key: string
  payload: Record<string, unknown>
  status: 'pending'
  attempts: 0
  scheduled_for: string
}

export type SkipReason = 'not_eligible' | 'not_due' | 'duplicate' | 'daily_limit' | 'reserved'

export interface ReminderPlan {
  queue: QueueRow[]
  skipped: { key: string; reason: SkipReason }[]
}

function order(a: ReminderCandidate, b: ReminderCandidate, now: Date): number {
  const p = REMINDER_PRIORITY[a.kind] - REMINDER_PRIORITY[b.kind]
  if (p !== 0) return p
  const wa = fireWindow(a, now)?.until.getTime() ?? 0
  const wb = fireWindow(b, now)?.until.getTime() ?? 0
  return wa - wb || a.title.localeCompare(b.title, 'ru') || a.eventKey.localeCompare(b.eventKey)
}

export function reminderPayload(c: ReminderCandidate): Record<string, unknown> {
  return {
    kind: c.kind,
    title: c.title,
    work_kind: c.workKind,
    opens_at: c.opensAt,
    closes_at: c.closesAt,
    due_date: c.dueDate,
    streak: c.kind === 'streak' ? c.streak : null,
    link: c.link,
  }
}

/**
 * Что поставить в очередь сейчас. Для каждого ученика: подходящие и «пора» кандидаты без записи в журнале, по
 * приоритету; ставится, пока на этот день у ученика меньше DAILY_LIMIT, и младшее — только если после него
 * останется место под старшие, которые ждут его позже сегодня (бронь).
 */
export function planReminders(candidates: readonly ReminderCandidate[], log: readonly ReminderLogRow[], now: Date): ReminderPlan {
  const queue: QueueRow[] = []
  const skipped: ReminderPlan['skipped'] = []
  const logged = new Set(log.map(r => r.key))
  const today = mskDay(now)
  const seen = new Set<string>()

  const byProfile = new Map<string, ReminderCandidate[]>()
  for (const c of candidates) {
    const key = dedupKey(c)
    if (seen.has(key)) continue
    seen.add(key)
    if (!isEligible(c)) { skipped.push({ key, reason: 'not_eligible' }); continue }
    if (logged.has(key)) { skipped.push({ key, reason: 'duplicate' }); continue }
    const list = byProfile.get(c.profileId) ?? []
    list.push(c)
    byProfile.set(c.profileId, list)
  }

  for (const [profileId, list] of byProfile) {
    let used = countForDay(log, profileId, today)
    const dueNow = list.filter(c => isDue(c, now)).sort((a, b) => order(a, b, now))
    // Старшие, которые сегодня ещё впереди (их момент позже окна «сейчас»), — бронь.
    const later = list.filter(c => {
      if (isDue(c, now)) return false
      const w = fireWindow(c, now)
      return !!w && mskDay(w.at) === today && w.at.getTime() > now.getTime() + LOOKAHEAD_MS
    })
    for (const c of list) if (!dueNow.includes(c) && !later.includes(c)) skipped.push({ key: dedupKey(c), reason: 'not_due' })
    for (const c of later) skipped.push({ key: dedupKey(c), reason: 'not_due' })

    for (const c of dueNow) {
      const key = dedupKey(c)
      if (used >= DAILY_LIMIT) { skipped.push({ key, reason: 'daily_limit' }); continue }
      const reserve = later.filter(x => REMINDER_PRIORITY[x.kind] < REMINDER_PRIORITY[c.kind]).length
      if (used + 1 + reserve > DAILY_LIMIT) { skipped.push({ key, reason: 'reserved' }); continue }
      const w = fireWindow(c, now) as FireWindow
      used += 1
      queue.push({
        profile_id: profileId,
        channel: 'telegram',
        event_type: STUDENT_REMINDER_EVENT,
        entity_type: c.kind === 'mock_tomorrow' ? 'mock_exam' : c.kind === 'streak' ? null : 'topic_homework',
        entity_id: c.entityId,
        deduplication_key: key,
        payload: reminderPayload(c),
        status: 'pending',
        attempts: 0,
        scheduled_for: new Date(Math.max(now.getTime(), w.at.getTime())).toISOString(),
      })
    }
  }
  return { queue, skipped }
}

// ── Отправка: настройки ученика, тишина, устаревшее ─────────────────────

/** Выключатель ученика по виду (колонки `notification_prefs.remind_*`, нет значения — включено). */
export function studentReminderAllowedByPrefs(kind: unknown, prefs: Record<string, unknown> | null | undefined): boolean {
  if (!isReminderKind(kind)) return false
  const info = REMINDER_KINDS.find(k => k.kind === kind) as ReminderKindInfo
  return prefs?.[info.prefColumn] !== false
}

/**
 * Напоминание, которое очередь взяла слишком поздно, уже не нужно: «скоро проверочная» после её начала, «нет фото»
 * после конца окна. Тишину проверяет очередь отдельно (`isQuietMsk`).
 */
export function isReminderStale(payload: Record<string, unknown>, now: Date): boolean {
  const t = now.getTime()
  if (payload.kind === 'check_soon') return !(t < parse(str(payload.opens_at)))
  if (payload.kind === 'no_photo') return !(t < parse(str(payload.closes_at)))
  return false
}

// ── Тексты (макет В: без эмодзи, кнопка-ссылка) ──────────────────────────

function word(n: number, one: string, few: string, many: string): string {
  const m100 = Math.abs(n) % 100
  if (m100 >= 11 && m100 <= 14) return many
  const m10 = Math.abs(n) % 10
  if (m10 === 1) return one
  if (m10 >= 2 && m10 <= 4) return few
  return many
}

export const daysWord = (n: number) => `${n} ${word(n, 'день', 'дня', 'дней')}`
export const minutesWord = (n: number) => `${n} ${word(n, 'минуту', 'минуты', 'минут')}`

/** «Через час» (50–70 минут) / «Через 45 минут». */
export function untilText(minutes: number): string {
  if (minutes >= 50 && minutes <= 70) return 'Через час'
  return `Через ${minutesWord(Math.max(1, minutes))}`
}

const quote = (title: unknown, fallback: string) => {
  const s = typeof title === 'string' && title.trim() ? title.trim() : fallback
  return `«${escapeHtml(s)}»`
}

function range(from: unknown, to: unknown): string {
  const a = formatClockMsk(from)
  const b = formatClockMsk(to)
  return a && b ? `${a}–${b}` : a
}

export const BUTTON_LABEL: Readonly<Record<ReminderKind, string>> = {
  hw_due_tomorrow: 'Открыть ДЗ',
  hw_overdue: 'Открыть ДЗ',
  check_soon: 'Открыть работу',
  no_photo: 'Загрузить фото',
  streak: 'Задача дня',
  mock_tomorrow: 'Открыть пробник',
}

/** Текст сообщения. `now` — момент отправки: «через сколько» считается от него, а не от постановки в очередь. */
export function studentReminderText(payload: Record<string, unknown>, now: Date = new Date()): string {
  const control = payload.work_kind === 'control'
  switch (payload.kind) {
    case 'hw_due_tomorrow':
      return `Завтра срок ДЗ ${quote(payload.title, 'Домашнее задание')}. Ещё не сдано.`
    case 'hw_overdue':
      return `Вчера был срок ДЗ ${quote(payload.title, 'Домашнее задание')}, а работа не сдана. Сдать можно и сейчас.`
    case 'check_soon': {
      const mins = Math.round((parse(str(payload.opens_at)) - now.getTime()) / MIN)
      const when = range(payload.opens_at, payload.closes_at)
      return `${untilText(Number.isFinite(mins) ? mins : 60)} ${control ? 'контрольная' : 'проверочная'} ` +
        `${quote(payload.title, 'Работа')}${when ? `, ${when}` : ''}. Возьми листы и заряженный телефон.`
    }
    case 'no_photo': {
      const mins = Math.ceil((parse(str(payload.closes_at)) - now.getTime()) / MIN)
      return `До конца ${control ? 'контрольной' : 'проверочной'} ${minutesWord(Number.isFinite(mins) ? Math.max(1, mins) : 10)}, ` +
        'а фото ещё нет. Без фото работа не уйдёт.'
    }
    case 'streak': {
      const n = int(payload.streak)
      return `Серия ${daysWord(n)}! Реши сегодня одну задачу — и будет ${n + 1}. Задача дня уже ждёт.`
    }
    case 'mock_tomorrow': {
      const when = range(payload.opens_at, payload.closes_at)
      return `Завтра пробник ${quote(payload.title, 'Пробник')}${when ? `, ${when}` : ''}. ` +
        'Нужны черновик, ручка и телефон для фото второй части.'
    }
    default:
      return 'Напоминание'
  }
}

export function buildStudentReminderTelegramMessage(payload: Record<string, unknown>, appUrl: string, now: Date = new Date()) {
  const label = isReminderKind(payload.kind) ? BUTTON_LABEL[payload.kind] : 'Открыть'
  const link = typeof payload.link === 'string' && payload.link ? payload.link : null
  return { text: studentReminderText(payload, now), replyMarkup: buildLinkButton(link, appUrl, label) }
}
