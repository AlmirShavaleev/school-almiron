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
  /** Размер очереди проверки на конец каждого дня. Уровень, а не поток. */
  queueDaily:   DayPoint[]
  /** Сколько тем стало пройденными в этот день. Строго, через topic_done_events. */
  marksDaily:   DayPoint[]
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
    queueDaily:   days(body.queue_daily, 'count'),
    marksDaily:   days(body.marks_daily, 'count'),
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

// ── Карточки с графиками (§152) ────────────────────────────────────────────

/**
 * Что хорошо, а что плохо.
 *
 * Бейдж изменения красится ПО СМЫСЛУ, а не по знаку. Рост заходов, сдач и
 * пройденных тем — хорошо. Рост очереди проверки — плохо, и зелёная стрелка
 * вверх на нём была бы прямой дезинформацией: владелец прочёл бы «дела идут в
 * гору» там, где работы копятся.
 */
export type CardTone = 'more-is-good' | 'more-is-bad'

/** Цвет бейджа: смысл изменения, а не его направление. */
export function changeMood(
  direction: 'up' | 'down' | 'flat',
  tone: CardTone,
): 'good' | 'bad' | 'flat' {
  if (direction === 'flat') return 'flat'
  const grew = direction === 'up'
  return (tone === 'more-is-good') === grew ? 'good' : 'bad'
}

export interface CardSummary {
  current:  number
  previous: number
}

/**
 * Сводка для карточки-ПОТОКА: заходы, сдачи, пройденные темы.
 *
 * Крупное число — сумма за последнюю неделю, бейдж — к предыдущей. Складывать
 * поток осмысленно: «за неделю сдали 23 работы» — это величина.
 */
export function flowSummary(points: DayPoint[], days = 7): CardSummary {
  const tail = points.slice(-days)
  const head = points.slice(-days * 2, -days)
  const sum = (list: DayPoint[]) => list.reduce((acc, p) => acc + (Number.isFinite(p.value) ? p.value : 0), 0)
  return { current: sum(tail), previous: sum(head) }
}

/**
 * Сводка для карточки-УРОВНЯ: очередь проверки.
 *
 * Очередь — не поток, а запас: сумма её значений по дням не значит ничего
 * (работа, ждавшая три дня, вошла бы в сумму трижды). Поэтому крупное число —
 * размер очереди СЕЙЧАС, а бейдж — сравнение с уровнем неделю назад.
 */
export function levelSummary(points: DayPoint[], days = 7): CardSummary {
  if (points.length === 0) return { current: 0, previous: 0 }
  const current = points[points.length - 1]?.value ?? 0
  const earlier = points[points.length - 1 - days]
  return { current, previous: earlier?.value ?? current }
}

export interface CardChartPoint {
  label:  string
  /** Завершённые дни. У последнего — null, чтобы линия сюда не дотягивалась. */
  solid:  number | null
  /** Незавершённый хвост: предпоследняя точка для стыка плюс сегодняшняя. */
  dashed: number | null
}

/**
 * Разделение ряда на сплошную часть и пунктирный хвост.
 *
 * Пунктир означает ровно одно: **период ещё не закончился**. Сегодняшний день
 * неполный, и сплошная линия до него врала бы формой — падение в конце
 * читалось бы как обвал, хотя день просто не прожит.
 *
 * Прошлые дни пунктиром не рисуются НИКОГДА: стоит нарисовать так «слабые»
 * дни или дни без данных — и пунктир перестанет что-либо значить.
 *
 * Предпоследняя точка попадает в оба ряда намеренно: без общей точки сплошная
 * и пунктирная линии не состыкуются и в графике будет разрыв.
 */
export function splitUnfinishedTail(points: DayPoint[]): CardChartPoint[] {
  if (points.length === 0) return []
  const last = points.length - 1
  return points.map((point, i) => ({
    label:  point.day,
    solid:  i < last ? point.value : null,
    dashed: i >= last - 1 ? point.value : null,
  }))
}
