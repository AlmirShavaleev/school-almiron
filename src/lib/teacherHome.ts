/**
 * §233. Главная преподавателя (дизайн v2, экран 03): «что делать сегодня».
 *
 * Чистые правила экрана — отдельно от запросов, чтобы их можно было проверить
 * тестами на границах. Данные приходят из двух мест:
 *   * работы ДЗ на проверке — из `topic_homework_attempts` тем же кодом, что
 *     очередь проверки (`buildQueueWorks`, `isSubmittedLate` — одно правило
 *     «просрочено» на весь кабинет), см. `useTeacherHome`;
 *   * всё остальное — один вызов `teacher_home` (definer, свои курсы).
 */
import { plural } from '@/lib/plural'
import { isSubmittedLate, type QueueRow } from '@/lib/homeworkQueue'

// ─────────────────────────────── Ответ базы ────────────────────────────────

export interface HomeGroup { course_id: string; course_title: string; group_id: string; name: string }
export interface MockPendingRow {
  mock_exam_id: string
  title: string
  group_name: string
  works: number
  oldest_student_id: string
  oldest_at: string
}
export type TelegramState = 'ok' | 'none' | 'muted'
export interface OverdueRow {
  homework_id: string
  topic_id: string
  course_id: string
  group_id: string
  group_name: string
  title: string
  student_id: string
  student_name: string
  /** 'YYYY-MM-DD' — день срока. */
  due_date: string
  telegram: TelegramState
  /** Когда этой паре «ДЗ + ученик» напоминали за последние 24 часа; null — не напоминали. */
  reminded_at: string | null
}
export interface MockPoint { score: number; unit: 'test' | 'primary' }
export interface SeriesRow {
  student_id: string
  student_name: string
  course_id: string
  group_name: string | null
  /** Проценты проверенных ДЗ, от старых к новым, не больше 8. */
  hw: number[]
  /** Итоги пробников, от старых к новым, не больше 8. */
  mocks: MockPoint[]
}
export interface UpcomingRow {
  kind: 'homework' | 'mock'
  id: string
  topic_id: string | null
  course_id: string
  group_name: string
  title: string
  /** 'YYYY-MM-DD' по Москве. */
  day: string
  /** 'HH:MM' по Москве — у пробника; у срока ДЗ null. */
  time: string | null
}
export interface TeacherHomeData {
  today: string
  now: string
  groups: HomeGroup[]
  mock_pending: MockPendingRow[]
  overdue: OverdueRow[]
  series: SeriesRow[]
  upcoming: UpcomingRow[]
}

export const EMPTY_HOME: TeacherHomeData = {
  today: '', now: '', groups: [], mock_pending: [], overdue: [], series: [], upcoming: [],
}

/** Ответ RPC может прийти неполным (старая база, сбой) — первый экран после входа не роняем. */
export function normalizeHome(raw: unknown, fallbackToday: string): TeacherHomeData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TeacherHomeData>
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    today: typeof r.today === 'string' && r.today ? r.today : fallbackToday,
    now: typeof r.now === 'string' ? r.now : '',
    groups: arr<HomeGroup>(r.groups),
    mock_pending: arr<MockPendingRow>(r.mock_pending),
    overdue: arr<OverdueRow>(r.overdue),
    series: arr<SeriesRow>(r.series).map(s => ({
      ...s,
      hw: arr<number | string>(s.hw).map(Number).filter(Number.isFinite),
      mocks: arr<MockPoint>(s.mocks).filter(m => m && Number.isFinite(Number(m.score))).map(m => ({ score: Number(m.score), unit: m.unit === 'primary' ? 'primary' : 'test' })),
    })),
    upcoming: arr<UpcomingRow>(r.upcoming),
  }
}

// ─────────────────────────────── На проверке ───────────────────────────────

export interface ReviewGroup {
  key: string
  kind: 'homework' | 'mock'
  title: string
  groupLine: string
  count: number
  /** Сдано позже срока (`isSubmittedLate`, как в очереди). У пробника срока нет — 0. */
  late: number
  oldestAt: string
  /** Очередь проверки этого задания. */
  href: string
  /** Проверка самой давней работы этого задания. */
  oldestHref: string
}

/**
 * Работы ДЗ, ждущие проверки (уже схлопнутые очередью, статус `submitted`),
 * по заданию: одно ДЗ = одна строка. ДЗ одно на тему, поэтому «очередь этого
 * задания» — очередь с фильтром по теме.
 */
export function homeworkReviewGroups(rows: QueueRow[], groupNameOf: (courseId: string) => string | null): ReviewGroup[] {
  const by = new Map<string, QueueRow[]>()
  for (const r of rows) {
    if (r.attempt.status !== 'submitted') continue
    const list = by.get(r.homeworkId)
    if (list) list.push(r)
    else by.set(r.homeworkId, [r])
  }
  const out: ReviewGroup[] = []
  for (const [hwId, list] of by) {
    const sorted = [...list].sort((a, b) => (a.attempt.submitted_at ?? '').localeCompare(b.attempt.submitted_at ?? ''))
    const first = sorted[0]
    out.push({
      key: `hw:${hwId}`,
      kind: 'homework',
      title: first.topicTitle,
      groupLine: groupNameOf(first.courseId) ?? first.courseTitle,
      count: list.length,
      late: list.filter(isSubmittedLate).length,
      oldestAt: first.attempt.submitted_at ?? '',
      href: `/homework-queue?topic=${encodeURIComponent(first.topicId)}`,
      oldestHref: `/homework-queue?attempt=${encodeURIComponent(first.attempt.id)}`,
    })
  }
  return out
}

export function mockReviewGroups(rows: MockPendingRow[]): ReviewGroup[] {
  return rows.filter(r => r.works > 0).map(r => ({
    key: `mock:${r.mock_exam_id}`,
    kind: 'mock' as const,
    title: r.title,
    groupLine: r.group_name,
    count: r.works,
    late: 0,
    oldestAt: r.oldest_at ?? '',
    href: `/mock-exams/${r.mock_exam_id}?tab=works`,
    oldestHref: `/mock-exams/${r.mock_exam_id}/review/${r.oldest_student_id}`,
  }))
}

/** Все задания на проверке — от того, где работа ждёт дольше всех. */
export function reviewGroups(hw: ReviewGroup[], mocks: ReviewGroup[]): ReviewGroup[] {
  return [...hw, ...mocks].sort((a, b) => {
    const ta = Date.parse(a.oldestAt), tb = Date.parse(b.oldestAt)
    if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1
    return (ta - tb) || a.title.localeCompare(b.title, 'ru')
  })
}

// ──────────────────────────────── Просели ──────────────────────────────────

export const DROP_HW_PP = 15
export const DROP_MOCK_POINTS = 10
const EPS = 1e-9

export interface Bar { value: number; height: number; recent: boolean }
export interface DropRow {
  studentId: string
  name: string
  groupName: string | null
  text: string
  bars: Bar[]
  /** Насколько просел — для порядка строк (п. п. или баллы). */
  severity: number
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function barsOf(values: number[], recent: number, scale: number): Bar[] {
  const top = scale > 0 ? scale : 1
  return values.map((v, i) => ({
    value: v,
    height: Math.max(4, Math.min(100, Math.round((v / top) * 100))),
    recent: i >= values.length - recent,
  }))
}

/**
 * Просел ли ученик (правило владельца):
 *   А. средний результат последних 3 проверенных ДЗ ниже среднего 5 ДЗ до них
 *      на 15 процентных пунктов и больше (ровно 15 — просел); нужно 8 работ;
 *   Б. последний пробник ниже предыдущего на 10 баллов и больше (ровно 10 —
 *      просел); баллы одной шкалы — тестовые с тестовыми, первичные с
 *      первичными; нужно 2 пробника.
 * Данных мало или не просел — null. Сработали оба — одна строка, обе причины.
 */
export function detectDrop(s: SeriesRow): DropRow | null {
  const reasons: string[] = []
  let bars: Bar[] | null = null
  let severity = 0

  const hw = s.hw.slice(-8)
  if (hw.length === 8) {
    const before = avg(hw.slice(0, 5))
    const after = avg(hw.slice(5))
    if (before - after >= DROP_HW_PP - EPS) {
      reasons.push(`было ${Math.round(before)} % по 5 работам, стало ${Math.round(after)} % по 3 последним`)
      bars = barsOf(hw, 3, 100)
      severity = before - after
    }
  }

  const mocks = s.mocks.slice(-8)
  if (mocks.length >= 2) {
    const last = mocks[mocks.length - 1]
    const prev = mocks[mocks.length - 2]
    if (last.unit === prev.unit && prev.score - last.score >= DROP_MOCK_POINTS - EPS) {
      const word = last.unit === 'test'
        ? plural(last.score, 'тестовый балл', 'тестовых балла', 'тестовых баллов')
        : plural(last.score, 'первичный балл', 'первичных балла', 'первичных баллов')
      reasons.push(`пробник: ${prev.score} → ${last.score} ${word}`)
      if (!bars) {
        const same = mocks.filter(m => m.unit === last.unit).map(m => m.score)
        bars = barsOf(same, Math.min(3, same.length - 1), last.unit === 'test' ? 100 : Math.max(...same))
        severity = prev.score - last.score
      }
    }
  }

  if (!bars) return null
  return { studentId: s.student_id, name: s.student_name, groupName: s.group_name, text: reasons.join(' · '), bars, severity }
}

export function dropRows(series: SeriesRow[]): DropRow[] {
  return series
    .map(detectDrop)
    .filter((r): r is DropRow => r !== null)
    .sort((a, b) => (b.severity - a.severity) || a.name.localeCompare(b.name, 'ru'))
}

// ──────────────────────────── Не сдали к сроку ─────────────────────────────

/** Разница в днях между двумя 'YYYY-MM-DD' (b − a). Календарная, без часовых поясов. */
export function dayDiff(a: string, b: string): number {
  const pa = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  const pb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
  return Math.round((pb - pa) / 86_400_000)
}

/** «вчера» / «срок прошёл 2 дня назад» — от «сегодня» базы (МСК), не от часов телефона. */
export function overdueWhen(dueDate: string, today: string): string {
  const n = dayDiff(dueDate, today)
  if (n <= 1) return 'вчера'
  return `срок прошёл ${n} ${plural(n, 'день', 'дня', 'дней')} назад`
}

/** «Сафин Данияр Ильдарович» → «Сафин Д.» — для перечня внутри фразы. */
export function shortStudentName(full: string): string {
  const [sur, first] = full.trim().split(/\s+/)
  if (!sur) return 'Ученик'
  return first ? `${sur} ${first[0].toUpperCase()}.` : sur
}

const COLLECTIVE = ['', '', 'Двое', 'Трое', 'Четверо', 'Пятеро', 'Шестеро', 'Семеро', 'Восьмеро', 'Девятеро', 'Десятеро']
const COLLECTIVE_DAT = ['', '', 'двоим', 'троим', 'четверым', 'пятерым', 'шестерым', 'семерым', 'восьмерым', 'девятерым', 'десятерым']

/** «Один ученик … сдал», «Четверо … сдали», «12 учеников … сдали», «21 ученик … сдал». */
function subject(n: number, singular: string, pluralVerb: string): string {
  if (n === 1) return `Один ученик ${singular}`
  if (n <= 10) return `${COLLECTIVE[n]} ${pluralVerb}`
  const one = n % 10 === 1 && n % 100 !== 11
  return `${n} ${plural(n, 'ученик', 'ученика', 'учеников')} ${one ? singular : pluralVerb}`
}

/** Подпись кнопки: «Напомнить всем четверым», «Напомнить всем 12», одному — «Напомнить». */
export function remindLabel(n: number): string {
  if (n <= 1) return 'Напомнить'
  if (n <= 10) return `Напомнить всем ${COLLECTIVE_DAT[n]}`
  return `Напомнить всем ${n}`
}

export interface RemindPlan {
  /** Всего должников (учеников). */
  students: number
  /** Сколько учеников получит сообщение по нажатию: Telegram есть и есть пара без напоминания за сутки. */
  toSend: number
  /** Напоминание дошло (Telegram есть, все его пары напомнены за сутки). */
  reached: number
  noTelegram: string[]
  muted: string[]
  /** Самое свежее напоминание за сутки — для «Напомнили в 14:05». */
  lastRemindedAt: string | null
}

export function remindPlan(rows: OverdueRow[]): RemindPlan {
  const by = new Map<string, OverdueRow[]>()
  for (const r of rows) {
    const l = by.get(r.student_id)
    if (l) l.push(r)
    else by.set(r.student_id, [r])
  }
  let toSend = 0, reached = 0
  const noTelegram: string[] = [], muted: string[] = []
  let last: string | null = null
  for (const list of by.values()) {
    const tg = list[0].telegram
    const name = shortStudentName(list[0].student_name)
    for (const r of list) if (r.reminded_at && (!last || r.reminded_at > last)) last = r.reminded_at
    if (tg === 'none') { noTelegram.push(name); continue }
    if (tg === 'muted') { muted.push(name); continue }
    if (list.some(r => !r.reminded_at)) toSend += 1
    else reached += 1
  }
  return { students: by.size, toSend, reached, noTelegram, muted, lastRemindedAt: last }
}

/** «14:05» по Москве. */
export function mskClock(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
}

/**
 * Честная строка рядом с кнопкой: кому не уйдёт и почему. После отправки —
 * «3 из 4 — нет Telegram: Никитина В.». Пусто — все, кому надо, получат (или
 * получили).
 */
export function remindNote(plan: RemindPlan): string {
  const why: string[] = []
  if (plan.noTelegram.length > 0) why.push(`нет Telegram: ${plan.noTelegram.join(', ')}`)
  if (plan.muted.length > 0) why.push(`напоминания выключены: ${plan.muted.join(', ')}`)
  if (why.length === 0) return ''
  const reachable = plan.students - plan.noTelegram.length - plan.muted.length
  return `${reachable} из ${plan.students} — ${why.join('; ')}`
}

// ───────────────────────────────── Баннер ──────────────────────────────────

export interface BannerInput {
  pending: number
  late: number
  overdue: OverdueRow[]
  dropped: number
}

/**
 * Фраза «что делать сегодня» — из тех же чисел, что блоки ниже:
 * «39 работ ждут проверки, 5 из них просрочены. Четверо не сдали ДЗ
 * «Отбор корней». Двое просели на последних работах.»
 * Пусто — спокойно: «Всё проверено. Никто не просрочил.»
 */
export function bannerPhrase({ pending, late, overdue, dropped }: BannerInput): string {
  const parts: string[] = []

  if (pending > 0) {
    let s = `${pending} ${plural(pending, 'работа ждёт', 'работы ждут', 'работ ждут')} проверки`
    if (late > 0) {
      if (late >= pending) s += pending === 1 ? ', она просрочена' : ', все просрочены'
      else s += `, ${late} из них ${plural(late, 'просрочена', 'просрочены', 'просрочены')}`
    }
    parts.push(`${s}.`)
  } else {
    parts.push('Всё проверено.')
  }

  const students = new Set(overdue.map(r => r.student_id)).size
  if (students === 0) {
    parts.push('Никто не просрочил.')
  } else {
    const hws = new Map(overdue.map(r => [r.homework_id, r.title]))
    const what = hws.size === 1 ? `ДЗ «${[...hws.values()][0]}»` : 'ДЗ к сроку'
    parts.push(`${subject(students, 'не сдал', 'не сдали')} ${what}.`)
  }

  if (dropped > 0) parts.push(`${subject(dropped, 'просел', 'просели')} на последних работах.`)

  return parts.join(' ')
}

// ─────────────────────────────── Ближайшее ─────────────────────────────────

/** «чт, 1 октября» — день недели и число по календарю (день уже московский). */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: 'UTC' })
  const dm = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })
  return `${wd}, ${dm}`
}

/** «Суббота, 26 сентября» — шапка баннера. */
export function bannerDate(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  const s = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function upcomingText(u: UpcomingRow): string {
  if (u.kind === 'mock') return `${u.title}${u.time ? ` в ${u.time}` : ''}`
  return `Срок ДЗ «${u.title}»`
}

export function upcomingHref(u: UpcomingRow): string {
  if (u.kind === 'mock') return `/mock-exams/${u.id}`
  return `/course-program?courseId=${encodeURIComponent(u.course_id)}${u.topic_id ? `&materialsTopic=${encodeURIComponent(u.topic_id)}` : ''}`
}

/** Сегодня по Москве, если база не ответила. */
export function mskToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
}
