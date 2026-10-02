/**
 * §254. Главная ученика: серия, календарь активности, «решено задач по
 * неделям», карточки «Мои курсы».
 *
 * Источник активности — ОДИН вызов `student_home_activity()` (PENDING_254):
 * дни заходов, решённые задачи по дням, серия и рекорд, пройденные темы по
 * курсам. Что считается «решённой задачей» и «днём серии», решает база
 * (`student_solved_task_days`, `student_visit_streak`) — здесь только
 * раскладка по клеткам и неделям. Своих правил серии на клиенте нет: вторая
 * копия разошлась бы с первой (урок §21/§29).
 *
 * Все даты — календарные дни YYYY-MM-DD по Москве, как их отдаёт база. Счёт
 * идёт в UTC от этих строк, поэтому часовой пояс устройства на клетки не влияет.
 */
import { plural } from '@/lib/plural'
import type { TopicJournalHomework } from '@/lib/topicJournal'
import type { StudentTodo } from '@/lib/studentTodo'
import { myTopicHref } from '@/lib/studentTopicAccess'

export interface SolvedDay {
  day:     string
  n:       number
  hw:      number
  catalog: number
  mock:    number
  test:    number
}

export interface CourseTopics {
  courseId:    string
  topicsTotal: number
  topicsDone:  number
}

export interface HomeActivity {
  today:        string
  from:         string
  streak:       number
  record:       number
  visitedToday: boolean
  visits:       string[]
  solved:       SolvedDay[]
  courses:      CourseTopics[]
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

/** Ответ базы → структура страницы. Неполный ответ не роняет главную. */
export function normalizeHomeActivity(raw: unknown): HomeActivity | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const today = day(r.today)
  if (!today) return null
  return {
    today,
    from: day(r.from) ?? today,
    streak: num(r.streak),
    record: num(r.record),
    visitedToday: r.visited_today === true,
    visits: Array.isArray(r.visits) ? r.visits.map(day).filter((d): d is string => !!d) : [],
    solved: Array.isArray(r.solved)
      ? r.solved.flatMap((item: unknown) => {
          const x = (item ?? {}) as Record<string, unknown>
          const d = day(x.day)
          return d ? [{ day: d, n: num(x.n), hw: num(x.hw), catalog: num(x.catalog), mock: num(x.mock), test: num(x.test) }] : []
        })
      : [],
    courses: Array.isArray(r.courses)
      ? r.courses.flatMap((item: unknown) => {
          const x = (item ?? {}) as Record<string, unknown>
          return typeof x.course_id === 'string'
            ? [{ courseId: x.course_id, topicsTotal: num(x.topics_total), topicsDone: num(x.topics_done) }]
            : []
        })
      : [],
  }
}

// ── календарная арифметика по строкам YYYY-MM-DD ────────────────────────────
const DAY_MS = 86400000
function toMs(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return Date.UTC(y, m - 1, dd)
}
function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
export function addDays(d: string, n: number): string {
  return fromMs(toMs(d) + n * DAY_MS)
}
/** Понедельник недели дня `d` (неделя пн–вс, как в календаре). */
export function mondayOf(d: string): string {
  const dow = (new Date(toMs(d)).getUTCDay() + 6) % 7 // пн = 0
  return addDays(d, -dow)
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** «2 октября». */
export function longDay(d: string): string {
  const [, m, dd] = d.split('-').map(Number)
  return `${dd} ${MONTHS_GEN[m - 1]}`
}
/** «28 сен» — подпись недели. */
export function shortDay(d: string): string {
  const [, m, dd] = d.split('-').map(Number)
  return `${dd} ${MONTHS_SHORT[m - 1]}`
}

export function tasksWord(n: number): string {
  return `${n} ${plural(n, 'задача', 'задачи', 'задач')}`
}

/** «5 дней подряд». */
export function streakPhrase(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')} подряд`
}

/**
 * Ступень цвета клетки: 0 — ничего, 1 — 1–2 задачи, 2 — 3–5, 3 — 6–9,
 * 4 — 10 и больше. Ступени — по задачам, не по заходам: заход засчитывает
 * день в серию, а цвет говорит, сколько сделано.
 */
export function activityLevel(n: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0
  if (n <= 2) return 1
  if (n <= 5) return 2
  if (n <= 9) return 3
  return 4
}

export interface CalendarCell {
  day:     string
  future:  boolean
  today:   boolean
  visited: boolean
  solved:  number
  level:   0 | 1 | 2 | 3 | 4
  /** Подсказка: «2 октября: 5 задач» / «не заходили» / «заходили, задач не решали». */
  label:   string
}

export function cellLabel(cell: Pick<CalendarCell, 'day' | 'visited' | 'solved' | 'future'>): string {
  const head = longDay(cell.day)
  if (cell.future) return `${head}: ещё впереди`
  if (cell.solved > 0) return `${head}: ${tasksWord(cell.solved)}`
  return cell.visited ? `${head}: заходили, задач не решали` : `${head}: не заходили`
}

/**
 * Календарь за `weeks` недель, последней — текущая. Колонка — неделя
 * (пн…вс), клетка — день. Будущие дни текущей недели — пустые клетки.
 */
export function buildCalendar(activity: Pick<HomeActivity, 'today' | 'visits' | 'solved'>, weeks = 12): CalendarCell[][] {
  const visits = new Set(activity.visits)
  const solved = new Map(activity.solved.map(s => [s.day, s.n]))
  const start = addDays(mondayOf(activity.today), -7 * (weeks - 1))
  const todayMs = toMs(activity.today)
  const out: CalendarCell[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: CalendarCell[] = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i)
      const future = toMs(d) > todayMs
      const n = future ? 0 : solved.get(d) ?? 0
      const cell = { day: d, future, today: d === activity.today, visited: !future && visits.has(d), solved: n, level: activityLevel(n), label: '' }
      cell.label = cellLabel(cell)
      col.push(cell)
    }
    out.push(col)
  }
  return out
}

/** Точки текущей недели пн…вс в плашке серии: заходил ли в этот день. */
export function weekDots(activity: Pick<HomeActivity, 'today' | 'visits'>): boolean[] {
  const visits = new Set(activity.visits)
  const monday = mondayOf(activity.today)
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i)
    return toMs(d) <= toMs(activity.today) && visits.has(d)
  })
}

export interface WeekBar {
  /** Понедельник недели. */
  start:   string
  label:   string
  n:       number
  current: boolean
}

/** «Решено задач по неделям»: `weeks` недель пн–вс, последняя — текущая. */
export function weeklySolved(activity: Pick<HomeActivity, 'today' | 'solved'>, weeks = 10): WeekBar[] {
  const thisMonday = mondayOf(activity.today)
  const bars: WeekBar[] = Array.from({ length: weeks }, (_, i) => {
    const start = addDays(thisMonday, -7 * (weeks - 1 - i))
    return { start, label: shortDay(start), n: 0, current: i === weeks - 1 }
  })
  const index = new Map(bars.map((b, i) => [b.start, i]))
  for (const s of activity.solved) {
    if (toMs(s.day) > toMs(activity.today)) continue
    const i = index.get(mondayOf(s.day))
    if (i != null) bars[i].n += s.n
  }
  return bars
}

/** Подсказка столбика: «неделя с 28 сен: 14 задач» / «эта неделя: 3 задачи». */
export function weekBarLabel(bar: WeekBar): string {
  return `${bar.current ? 'эта неделя' : `неделя с ${bar.label}`}: ${tasksWord(bar.n)}`
}

// ── «Мои курсы» ───────────────────────────────────────────────────────────────

export interface HomeCourse {
  courseId: string
  groupId:  string
  title:    string
  subject:  string | null
}

export interface CourseCard extends HomeCourse {
  /** null — база ещё не ответила (или функции нет): число не выдумываем. */
  topicsDone:  number | null
  topicsTotal: number | null
  hwAccepted:  number
  hwTotal:     number
  /** «4,3», «78/100» или «—». */
  average:     string
}

/**
 * Средняя оценка курса по принятым работам с баллом. Пятибалльная шкала —
 * главная оценка школы: если в курсе есть такие работы, среднее по ним
 * («4,3»); иначе по стобалльной («78/100»); без шкалы и балла — «—». Шкалы не
 * складываются друг с другом (правило §111.2).
 */
export function courseAverage(rows: Pick<TopicJournalHomework, 'status' | 'score' | 'grade_scale'>[]): string {
  const scored = rows.filter(r => r.status === 'accepted' && r.score != null)
  const five = scored.filter(r => r.grade_scale === 'five').map(r => r.score as number)
  if (five.length > 0) {
    return (five.reduce((s, v) => s + v, 0) / five.length).toFixed(1).replace('.', ',')
  }
  const hundred = scored.filter(r => r.grade_scale === 'hundred').map(r => r.score as number)
  if (hundred.length > 0) return `${Math.round(hundred.reduce((s, v) => s + v, 0) / hundred.length)}/100`
  return '—'
}

/**
 * Карточки курсов: темы — из базы (`topic_done_events`, §152), ДЗ и оценка —
 * из журнала (`get_student_topic_journal`, тот же источник, что у страницы ДЗ:
 * «ДЗ принято 4 из 8» здесь и там совпадает).
 */
export function courseCards(
  courses: HomeCourse[],
  topics: CourseTopics[] | null,
  journal: TopicJournalHomework[],
): CourseCard[] {
  const byCourse = new Map((topics ?? []).map(t => [t.courseId, t]))
  return courses.map(c => {
    const rows = journal.filter(r => r.course_id === c.courseId)
    const t = byCourse.get(c.courseId)
    return {
      ...c,
      topicsDone:  topics ? t?.topicsDone ?? 0 : null,
      topicsTotal: topics ? t?.topicsTotal ?? 0 : null,
      hwAccepted:  rows.filter(r => r.status === 'accepted').length,
      hwTotal:     rows.length,
      average:     courseAverage(rows),
    }
  })
}

/** Пять ступеней одного синего (токены primary), ступень 0 — пустая клетка. */
export const ACTIVITY_BG = ['bg-graphite-100', 'bg-primary-100', 'bg-primary-300', 'bg-primary-500', 'bg-primary-800'] as const

/** Верх шкалы: «красивое» чётное число не меньше максимума (10, 20, 30…) — середина целая. */
export function niceMax(n: number): number {
  if (n <= 10) return 10
  return Math.ceil(n / 10) * 10
}


// ── Тихие ссылки под кнопками главной ────────────────────────────────────────

const MAX_LINKS = 3

export interface HomeExtraLink { key: string; text: string; href: string | null }

/** Тихие строки под кнопками: без срока → список ДЗ, тесты и новые темы → в тему. */
export function extraLinks(todo: StudentTodo): HomeExtraLink[] {
  const out: HomeExtraLink[] = []
  if (todo.noDue.length > 0) {
    out.push({ key: 'nodue', text: `Без срока: ${todo.noDue.length}`, href: '/my-homework?show=nodue' })
  }
  for (const t of todo.tests.slice(0, MAX_LINKS)) {
    out.push({ key: `test-${t.assignmentId}`, text: `Тестирование «${t.testTitle}»`, href: myTopicHref(t.groupId, t.topicId) })
  }
  if (todo.tests.length > MAX_LINKS) {
    out.push({ key: 'tests-more', text: `ещё тестирований: ${todo.tests.length - MAX_LINKS}`, href: null })
  }
  for (const t of todo.newlyOpened.slice(0, MAX_LINKS)) {
    out.push({ key: `open-${t.topicId}`, text: `Открылась тема «${t.topicTitle}»`, href: myTopicHref(t.groupId, t.topicId) })
  }
  if (todo.newlyOpened.length > MAX_LINKS) {
    out.push({ key: 'open-more', text: `ещё новых тем: ${todo.newlyOpened.length - MAX_LINKS}`, href: null })
  }
  return out
}
