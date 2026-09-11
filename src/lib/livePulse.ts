/**
 * Чистые помощники живой панели «Сейчас».
 *
 * Здесь нет обращений к сети: числа приходят готовыми из `admin_live_pulse()`
 * и `admin_live_feed()`. Ниже — только то, как их показать, не соврав.
 */

export interface DayPoint {
  day:   string
  value: number
}

export interface HourPoint {
  hour:   number
  events: number
}

export type FeedKind = 'submitted' | 'reviewed' | 'marked' | 'enrolled'

export interface FeedEvent {
  kind:      FeedKind
  at:        string
  actorName: string
  detail:    string
}

export interface WeekOverWeek {
  visitsThis:  number
  visitsPrev:  number
  submitsThis: number
  submitsPrev: number
}

export interface PulseData {
  visitsDaily:  DayPoint[]
  submitsDaily: DayPoint[]
  hourly:       HourPoint[]
  week:         WeekOverWeek
  reach:        { active7d: number; enrolled: number }
  visitDaysPerStudent: number
  newStudents:  Array<{ studentId: string; profileId: string; fullName: string; createdAt: string }>
  noTelegram:   Array<{ studentId: string; profileId: string; fullName: string }>
}

/** Подписи событий ленты. Формулировки — от лица школы, а не таблиц базы. */
export const FEED_LABELS: Record<FeedKind, string> = {
  submitted: 'сдал работу',
  reviewed:  'разобрал работу',
  marked:    'отметил тему пройденной',
  enrolled:  'зачислен в курс',
}

/**
 * Изменение недели к неделе.
 *
 * `null` вместо процента, когда прошлая неделя была нулевой: рост «с нуля до
 * двадцати трёх» не выражается процентом, а +2300 % — это не число, а шум.
 * Экран в таком случае пишет словами.
 */
export function weekChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous <= 0) return null
  return (current - previous) / previous
}

/** Направление стрелки. Ровное значение — не «рост на 0 %», а именно ровно. */
export function weekDirection(current: number, previous: number): 'up' | 'down' | 'flat' {
  if (current > previous) return 'up'
  if (current < previous) return 'down'
  return 'flat'
}

/**
 * Час пик учебного дня. `null`, если событий нет вовсе — иначе пиком стал бы
 * нулевой час, и экран уверенно показал бы «школа учится в полночь».
 */
export function peakHour(hours: HourPoint[]): HourPoint | null {
  let best: HourPoint | null = null
  for (const point of hours) {
    if (point.events <= 0) continue
    if (!best || point.events > best.events) best = point
  }
  return best
}

/** Всего событий в разбивке по часам — для честной подписи «на чём построено». */
export function totalHourEvents(hours: HourPoint[]): number {
  return hours.reduce((sum, h) => sum + (Number.isFinite(h.events) ? h.events : 0), 0)
}

/** «14:00» — подпись деления на графике часов. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** «08.09» — подпись дня. */
export function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

/**
 * «только что», «12 мин назад», «3 ч назад», дальше — дата.
 *
 * Лента живая, и абсолютное время в ней читается хуже относительного: «сдал в
 * 16:22» требует от смотрящего вычитания, «12 минут назад» — нет. Через сутки
 * относительное перестаёт помогать, и мы переходим на дату.
 */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return '—'
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000)

  if (seconds < 0) return 'только что'
  if (seconds < 60) return 'только что'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  return then.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Доля охвата 0..1, либо `null`, когда зачисленных нет и делить не на что. */
export function reachShare(active: number, enrolled: number): number | null {
  if (!Number.isFinite(active) || !Number.isFinite(enrolled) || enrolled <= 0) return null
  return Math.min(active / enrolled, 1)
}

/**
 * Разбор ответа `admin_live_pulse()`.
 *
 * Снаружи приходит `jsonb` из Postgres со змеиными именами — приводим к одному
 * виду здесь, чтобы компонент не разбирал чужой формат.
 */
export function parsePulse(raw: unknown): PulseData {
  const body = (raw ?? {}) as Record<string, any>
  const days = (list: unknown, key: string): DayPoint[] =>
    Array.isArray(list)
      ? list.map(row => ({ day: String(row?.day ?? ''), value: Number(row?.[key] ?? 0) }))
      : []

  return {
    visitsDaily:  days(body.visits_daily, 'people'),
    submitsDaily: days(body.submits_daily, 'count'),
    hourly: Array.isArray(body.hourly)
      ? body.hourly.map((row: any) => ({ hour: Number(row?.hour ?? 0), events: Number(row?.events ?? 0) }))
      : [],
    week: {
      visitsThis:  Number(body.week?.visits_this ?? 0),
      visitsPrev:  Number(body.week?.visits_prev ?? 0),
      submitsThis: Number(body.week?.submits_this ?? 0),
      submitsPrev: Number(body.week?.submits_prev ?? 0),
    },
    reach: {
      active7d: Number(body.reach?.active_7d ?? 0),
      enrolled: Number(body.reach?.enrolled ?? 0),
    },
    visitDaysPerStudent: Number(body.visit_days_per_student ?? 0),
    newStudents: Array.isArray(body.new_students)
      ? body.new_students.map((row: any) => ({
          studentId: String(row?.student_id ?? ''),
          profileId: String(row?.profile_id ?? ''),
          fullName:  String(row?.full_name ?? ''),
          createdAt: String(row?.created_at ?? ''),
        }))
      : [],
    noTelegram: Array.isArray(body.no_telegram)
      ? body.no_telegram.map((row: any) => ({
          studentId: String(row?.student_id ?? ''),
          profileId: String(row?.profile_id ?? ''),
          fullName:  String(row?.full_name ?? ''),
        }))
      : [],
  }
}

/** Разбор строк `admin_live_feed()`. Неизвестные события отбрасываются. */
export function parseFeed(raw: unknown): FeedEvent[] {
  if (!Array.isArray(raw)) return []
  const known = new Set<string>(['submitted', 'reviewed', 'marked', 'enrolled'])
  return raw
    .filter((row: any) => known.has(String(row?.kind ?? '')))
    .map((row: any) => ({
      kind:      String(row.kind) as FeedKind,
      at:        String(row?.at ?? ''),
      actorName: String(row?.actor_name ?? ''),
      detail:    String(row?.detail ?? ''),
    }))
}
