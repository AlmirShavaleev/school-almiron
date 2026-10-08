/**
 * §274. Календарь ученика на главной: сроки ДЗ, открытие уроков, пробники,
 * проверочные и контрольные — в одной сетке месяца.
 *
 * Здесь только чистые правила: из чего складывается событие, на какой день
 * МОСКВЫ оно ложится, как выглядит сетка месяца (неделя с понедельника) и что
 * попадает в «Ближайшие 7 дней». Хук и компонент данных не толкуют — так
 * правила проверяются без сети и без часов браузера.
 *
 * Дни — строки «YYYY-MM-DD». Срок ДЗ (`topic_homework.due_at`) и дата
 * открытия темы (`topics.available_from`) — тип `date`, их день берётся как
 * есть; начало пробника — timestamp, его день считается по Москве
 * (`mskDateKey`, тот же, что у сроков ДЗ §259).
 */
import { dueDateKey, mskDateKey } from './homeworkDeadline'
import { isTimedKind, normalizeTopicKind } from './timedWork'
import type { MockLessonListRow } from './mockExamLesson'
import type { JournalHwStatus } from './topicJournal'

export type CalendarEventKind = 'homework' | 'lesson' | 'mock' | 'work'

export interface CalendarEvent {
  /** Уникален в пределах календаря: `<kind>:<id>`. */
  id: string
  kind: CalendarEventKind
  /** День по Москве, «YYYY-MM-DD». */
  day: string
  title: string
  /** Подпись курса — курсов у ученика бывает два. */
  course: string | null
  /** Куда ведёт строка списка дня; null — некуда (курс не найден). */
  href: string | null
  /** «10:00» по Москве — только у событий со временем (пробник). */
  time: string | null
  /** Короткое состояние: «сдано», «принято», «просрочено» и т. п. */
  note: string | null
  /** Дело закрыто — точка бледнее, строка без призыва. */
  done: boolean
}

/** Подписи типов — легенда и строка списка дня. */
export const CALENDAR_KIND_LABEL: Record<CalendarEventKind, string> = {
  homework: 'Срок ДЗ',
  lesson: 'Открытие урока',
  mock: 'Пробник',
  work: 'Контрольная',
}

/** Порядок типов в легенде и внутри дня. */
export const CALENDAR_KIND_ORDER: readonly CalendarEventKind[] = ['mock', 'work', 'homework', 'lesson']

// ─── Даты ───────────────────────────────────────────────────────────────────

/** Месяцы в именительном — заголовок сетки «Октябрь 2026». */
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
/** Шапка сетки: неделя с понедельника, как в российском календаре. */
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const WEEKDAY_BY_UTC = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

const DAY_MS = 86_400_000
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function keyMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** «YYYY-MM-DD» из года, месяца (0–11) и числа; переполнение месяца разрешено. */
export function dayKey(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Сдвиг дня на `n` календарных дней. */
export function addDays(day: string, n: number): string {
  const d = new Date(keyMs(day) + n * DAY_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Разница дней `b − a`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((keyMs(b) - keyMs(a)) / DAY_MS)
}

/** «пт, 10 окт» — день недели и число без года. */
export function shortDayLabel(day: string): string {
  if (!KEY_RE.test(day)) return ''
  const d = new Date(keyMs(day))
  return `${WEEKDAY_BY_UTC[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`
}

/** «10 октября» — заголовок списка дня. */
export function longDayLabel(day: string): string {
  if (!KEY_RE.test(day)) return ''
  const d = new Date(keyMs(day))
  return `${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`
}

/** «12 окт» — подпись «Откроется 12 окт» на карточке урока. */
export function dayMonthShort(day: string): string {
  if (!KEY_RE.test(day)) return ''
  const d = new Date(keyMs(day))
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`
}

function mskTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(iso))
}

// ─── Сетка месяца ───────────────────────────────────────────────────────────

export interface MonthCell {
  day: string
  /** Число месяца — то, что пишется в клетке. */
  date: number
  /** Клетка своего месяца (чужие — бледные хвосты соседних). */
  inMonth: boolean
}

/**
 * Сетка месяца: целые недели с понедельника по воскресенье. Первая неделя
 * начинается с понедельника, на который приходится или перед которым стоит
 * 1-е число; последняя заканчивается воскресеньем после последнего дня.
 * Строк — 4–6, сколько нужно месяцу (высота не прыгает больше, чем на строку).
 */
export function monthGrid(year: number, month: number): MonthCell[][] {
  const first = dayKey(year, month, 1)
  // getUTCDay: 0 — воскресенье. Сдвиг до понедельника: пн → 0, вс → 6.
  const lead = (new Date(keyMs(first)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const total = Math.ceil((lead + daysInMonth) / 7) * 7
  const start = addDays(first, -lead)
  const weeks: MonthCell[][] = []
  for (let i = 0; i < total; i++) {
    const day = addDays(start, i)
    const cell: MonthCell = { day, date: Number(day.slice(8, 10)), inMonth: Number(day.slice(5, 7)) - 1 === month }
    if (i % 7 === 0) weeks.push([])
    weeks[weeks.length - 1].push(cell)
  }
  return weeks
}

/** Соседний месяц: `delta` = −1 / +1. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month + delta, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
}

// ─── События ────────────────────────────────────────────────────────────────

/** Курс ученика — подпись и группа для ссылки. */
export interface CalendarCourse {
  courseId: string
  groupId: string
  title: string
}

/** ДЗ из журнала ученика (`get_student_topic_journal`) в нужном объёме. */
export interface CalendarHomework {
  homework_id: string
  title: string
  topic_id: string
  topic_title: string
  course_id: string
  due_at: string | null
  status: JournalHwStatus
}

/** Тема с датой открытия (`topics.available_from`) — урок или работа по времени. */
export interface CalendarTopic {
  id: string
  title: string
  available_from: string | null
  is_open: boolean | null
  kind: string | null
  course_id: string
}

const HW_NOTE: Record<JournalHwStatus, string | null> = {
  not_started: null,
  draft: 'черновик',
  submitted: 'сдано',
  returned: 'на доработке',
  accepted: 'принято',
}

/**
 * Все события календаря. `today` — день по Москве: по нему ДЗ без сдачи после
 * срока помечается «просрочено».
 *
 * Тема попадает в календарь, только если дата её ДЕЙСТВИТЕЛЬНО откроет: у темы
 * с тумблером (`is_open` не null) дата не действует (§59, `willOpenByDate`), и
 * обещать «откроется 12 окт» было бы враньём. Прошедшие открытия остаются —
 * сетку листают и назад.
 */
export function buildCalendarEvents(input: {
  courses: CalendarCourse[]
  homework: CalendarHomework[]
  topics: CalendarTopic[]
  mocksByGroup: Record<string, MockLessonListRow[]>
  today: string
}): CalendarEvent[] {
  const byCourse = new Map(input.courses.map(c => [c.courseId, c]))
  const byGroup = new Map(input.courses.map(c => [c.groupId, c]))
  const out: CalendarEvent[] = []

  for (const h of input.homework) {
    const day = dueDateKey(h.due_at)
    if (!day) continue
    const course = byCourse.get(h.course_id) ?? null
    const done = h.status === 'submitted' || h.status === 'accepted'
    const overdue = !done && h.status !== 'returned' && day < input.today
    out.push({
      id: `homework:${h.homework_id}`,
      kind: 'homework',
      day,
      title: h.topic_title || h.title,
      course: course?.title ?? null,
      href: course ? `/my-course/${course.groupId}/topic/${h.topic_id}` : null,
      time: null,
      note: overdue ? 'просрочено' : HW_NOTE[h.status],
      done,
    })
  }

  for (const t of input.topics) {
    if (t.is_open !== null && t.is_open !== undefined) continue
    const day = dueDateKey(t.available_from)
    if (!day) continue
    const course = byCourse.get(t.course_id) ?? null
    const timed = isTimedKind(t.kind)
    const opened = day <= input.today
    out.push({
      id: `${timed ? 'work' : 'lesson'}:${t.id}`,
      kind: timed ? 'work' : 'lesson',
      day,
      title: t.title,
      course: course?.title ?? null,
      // Закрытая тема своей страницы ученику не откроет — ведём в курс.
      href: course ? (opened ? `/my-course/${course.groupId}/topic/${t.id}` : `/my-course/${course.groupId}`) : null,
      time: null,
      note: timed ? (normalizeTopicKind(t.kind) === 'control' ? 'контрольная' : 'проверочная') : opened ? 'открыт' : null,
      done: false,
    })
  }

  for (const [groupId, list] of Object.entries(input.mocksByGroup)) {
    const course = byGroup.get(groupId) ?? null
    for (const m of list ?? []) {
      const t = Date.parse(m.starts_at)
      if (Number.isNaN(t)) continue
      out.push({
        id: `mock:${m.id}`,
        kind: 'mock',
        day: mskDateKey(t),
        title: m.title,
        course: course?.title ?? null,
        href: `/my-course/${groupId}/mock/${m.id}`,
        time: mskTime(m.starts_at),
        note: m.submitted_at ? 'сдано' : null,
        done: !!m.submitted_at,
      })
    }
  }

  return out.sort(compareEvents)
}

function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  const k = CALENDAR_KIND_ORDER.indexOf(a.kind) - CALENDAR_KIND_ORDER.indexOf(b.kind)
  if (k !== 0) return k
  if ((a.time ?? '') !== (b.time ?? '')) return (a.time ?? '') < (b.time ?? '') ? -1 : 1
  return a.title.localeCompare(b.title, 'ru')
}

/** События по дням: день → список в порядке `compareEvents`. */
export function eventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    const list = map.get(e.day)
    if (list) list.push(e)
    else map.set(e.day, [e])
  }
  return map
}

/** «Ближайшие 7 дней»: сегодня и шесть следующих, закрытые дела — не в списке. */
export function upcomingEvents(events: CalendarEvent[], today: string, days = 7): CalendarEvent[] {
  const last = addDays(today, days - 1)
  return events.filter(e => e.day >= today && e.day <= last && !e.done)
}

/** «сегодня», «завтра» или «пт, 10 окт». */
export function relativeDayLabel(day: string, today: string): string {
  const d = daysBetween(today, day)
  if (d === 0) return 'сегодня'
  if (d === 1) return 'завтра'
  return shortDayLabel(day)
}
