/**
 * Учебный план по неделям (§151): расшифровка выдачи `study_plan_board` и
 * правила показа клетки.
 *
 * Зачёт и просрочка СЧИТАЮТСЯ В БАЗЕ (`study_plan_topic_states`), здесь только
 * раскладываем то, что пришло, и подбираем подпись. Своей копии правила
 * «сделано» тут нет: одно число живёт в одном месте (§147), иначе таблица
 * владельца и кабинет ученика разъедутся на первой же правке.
 *
 * Формат клетки — массив, а не объект: на классе из 16 человек и 169 тем это
 * 2704 клетки, объекты весили 900 КБ на одно открытие. Порядок полей и коды
 * описаны в миграции `study_plan_board_compact`; это единственное место, где
 * они расшифровываются.
 */

export type HwStatus = 'none' | 'not_started' | 'draft' | 'submitted' | 'accepted' | 'returned'

const HW_CODES: readonly HwStatus[] = ['none', 'not_started', 'draft', 'submitted', 'accepted', 'returned'] as const

const FLAG_DONE = 1
const FLAG_MARKED = 2
const FLAG_OVERDUE = 4
const FLAG_LATE = 8
const FLAG_REMOVED = 16
const FLAG_SHIFTED = 32
const FLAG_HW_PUBLISHED = 64

export interface BoardPlan {
  start_date: string
  auto_open: boolean
  current_week: number
  weeks_total: number
}

export interface BoardStudent {
  student_id: string
  profile_id: string
  full_name: string
}

export interface BoardTopic {
  topic_id: string
  title: string
  module_title: string
  week_no: number | null
  is_open: boolean | null
  available_from: string | null
  open_now: boolean
}

export interface BoardCell {
  /** Индексы в `students` / `topics`. */
  si: number
  ti: number
  /** Неделя с учётом сдвига ученику. */
  week: number
  hw: HwStatus
  hwPublished: boolean
  selfGroups: number
  selfMarked: number
  done: boolean
  marked: boolean
  overdue: boolean
  late: boolean
  removed: boolean
  shifted: boolean
  submittedAt: string | null
}

export interface BoardSummary {
  si: number
  week: number
  total: number
  done: number
  overdue: number
}

export interface StudyPlanBoard {
  plan: BoardPlan | null
  students: BoardStudent[]
  topics: BoardTopic[]
  cells: BoardCell[]
  summary: BoardSummary[]
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0)
}

/** Расшифровка выдачи RPC. `null` (нет прав) — тоже пустая доска. */
export function decodeBoard(raw: unknown): StudyPlanBoard {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const plan = (obj.plan && typeof obj.plan === 'object') ? obj.plan as BoardPlan : null
  const students = Array.isArray(obj.students) ? obj.students as BoardStudent[] : []
  const topics = Array.isArray(obj.topics) ? obj.topics as BoardTopic[] : []
  const cells: BoardCell[] = (Array.isArray(obj.cells) ? obj.cells as unknown[][] : []).map(row => {
    const flags = num(row[6])
    return {
      si: num(row[0]),
      ti: num(row[1]),
      week: num(row[2]),
      hw: HW_CODES[num(row[3])] ?? 'not_started',
      hwPublished: (flags & FLAG_HW_PUBLISHED) !== 0,
      selfGroups: num(row[4]),
      selfMarked: num(row[5]),
      done: (flags & FLAG_DONE) !== 0,
      marked: (flags & FLAG_MARKED) !== 0,
      overdue: (flags & FLAG_OVERDUE) !== 0,
      late: (flags & FLAG_LATE) !== 0,
      removed: (flags & FLAG_REMOVED) !== 0,
      shifted: (flags & FLAG_SHIFTED) !== 0,
      submittedAt: typeof row[7] === 'string' ? row[7] : null,
    }
  })
  const summary: BoardSummary[] = (Array.isArray(obj.summary) ? obj.summary as unknown[][] : []).map(row => ({
    si: num(row[0]), week: num(row[1]), total: num(row[2]), done: num(row[3]), overdue: num(row[4]),
  }))
  return { plan, students, topics, cells, summary }
}

// ─── Даты недели ─────────────────────────────────────────────────────────────

/** YYYY-MM-DD + дни, без часовых поясов: арифметика на UTC-полудне. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  const t = Date.UTC(y, m - 1, d, 12) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

export function weekStartDay(startDate: string, week: number): string {
  return addDays(startDate, 7 * (week - 1))
}

export function weekEndDay(startDate: string, week: number): string {
  return addDays(startDate, 7 * week - 1)
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export function formatDayShort(day: string): string {
  const [, m, d] = day.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS_SHORT[m - 1]}`
}

/** «7–13 сен» либо «28 сен – 4 окт», когда неделя переходит через месяц. */
export function formatWeekRange(startDate: string, week: number): string {
  const a = weekStartDay(startDate, week)
  const b = weekEndDay(startDate, week)
  const [, ma, da] = a.split('-').map(Number)
  const [, mb, db] = b.split('-').map(Number)
  if (ma === mb) return `${da}–${db} ${MONTHS_SHORT[ma - 1]}`
  return `${da} ${MONTHS_SHORT[ma - 1]} – ${db} ${MONTHS_SHORT[mb - 1]}`
}

/** ISO-день недели: 1 — понедельник. */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
  return wd === 0 ? 7 : wd
}

/** Ближайший понедельник, не раньше указанного дня. */
export function nextMonday(day: string): string {
  const wd = isoWeekday(day)
  return wd === 1 ? day.slice(0, 10) : addDays(day, 8 - wd)
}

// ─── Клетка ──────────────────────────────────────────────────────────────────

export type CellKind = 'removed' | 'done' | 'late' | 'overdue' | 'returned' | 'waiting'

export interface CellState {
  kind: CellKind
  /** Короткая подпись состояния зачёта. */
  label: string
  /** Чем зачёт считается: сдачей ДЗ или отметкой «пройдено». */
  basis: 'homework' | 'marks'
  /** Подпись про самоотметки, показывается РЯДОМ с зачётом. */
  marksLabel: string
  /** Расхождение «отметил пройденной, но ДЗ не сдал». */
  markedButNotSubmitted: boolean
}

export const HW_STATUS_LABEL: Record<HwStatus, string> = {
  none: 'ДЗ не опубликовано',
  not_started: 'ДЗ не сдано',
  draft: 'ДЗ в черновике',
  submitted: 'ДЗ сдано',
  accepted: 'ДЗ принято',
  returned: 'ДЗ на доработке',
}

export function cellState(cell: BoardCell): CellState {
  const basis = cell.hwPublished ? 'homework' : 'marks'
  const marksLabel = cell.selfGroups === 0
    ? 'отмечать нечего'
    : cell.marked
      ? 'отмечено пройденным'
      : cell.selfMarked > 0
        ? `отмечено ${cell.selfMarked} из ${cell.selfGroups}`
        : 'не отмечено'

  const markedButNotSubmitted = cell.hwPublished && cell.marked && !cell.done

  let kind: CellKind
  let label: string
  if (cell.removed) {
    kind = 'removed'; label = 'снята с плана'
  } else if (cell.done) {
    kind = cell.late ? 'late' : 'done'
    label = basis === 'homework'
      ? (cell.late ? 'сдано после срока' : HW_STATUS_LABEL[cell.hw])
      : 'пройдено'
  } else if (cell.overdue) {
    kind = 'overdue'
    label = basis === 'homework'
      ? (cell.hw === 'returned' ? 'на доработке, срок вышел' : 'просрочено')
      : 'просрочено'
  } else if (cell.hw === 'returned') {
    kind = 'returned'; label = HW_STATUS_LABEL.returned
  } else {
    kind = 'waiting'
    label = basis === 'homework' ? HW_STATUS_LABEL[cell.hw] : 'ещё не пройдено'
  }
  return { kind, label, basis, marksLabel, markedButNotSubmitted }
}

// ─── Сводка по неделе ────────────────────────────────────────────────────────

export type WeekBucket = 'full' | 'partial' | 'none' | 'empty'

export interface WeekReportRow {
  student: BoardStudent
  si: number
  total: number
  done: number
  overdue: number
  bucket: WeekBucket
}

export interface WeekReport {
  week: number
  rows: WeekReportRow[]
  full: WeekReportRow[]
  partial: WeekReportRow[]
  none: WeekReportRow[]
  /** У ученика на этой неделе нет тем (все сняты) — в отчёт не идёт. */
  empty: WeekReportRow[]
}

export function summaryFor(board: StudyPlanBoard, si: number, week: number): BoardSummary | null {
  return board.summary.find(s => s.si === si && s.week === week) ?? null
}

export function weekReport(board: StudyPlanBoard, week: number): WeekReport {
  const rows: WeekReportRow[] = board.students.map((student, si) => {
    const s = summaryFor(board, si, week)
    const total = s?.total ?? 0
    const done = s?.done ?? 0
    const overdue = s?.overdue ?? 0
    const bucket: WeekBucket = total === 0 ? 'empty' : done >= total ? 'full' : done > 0 ? 'partial' : 'none'
    return { student, si, total, done, overdue, bucket }
  })
  return {
    week,
    rows,
    full: rows.filter(r => r.bucket === 'full'),
    partial: rows.filter(r => r.bucket === 'partial'),
    none: rows.filter(r => r.bucket === 'none'),
    empty: rows.filter(r => r.bucket === 'empty'),
  }
}

/** Клетки ученика за неделю в порядке программы. */
export function cellsFor(board: StudyPlanBoard, si: number, week: number): BoardCell[] {
  return board.cells.filter(c => c.si === si && c.week === week).sort((a, b) => a.ti - b.ti)
}

/** Номера недель, которые есть в раскладке или в сдвигах. */
export function weekNumbers(board: StudyPlanBoard): number[] {
  const max = Math.max(
    board.plan?.weeks_total ?? 0,
    ...board.cells.map(c => c.week),
  )
  return Array.from({ length: Math.max(0, max) }, (_, i) => i + 1)
}

/** Текст подтверждения перед перекладкой: раскладка заменяется целиком. */
export function spreadConfirmText(perWeek: number, hasItems: boolean): string {
  const head = hasItems
    ? 'Текущая раскладка будет заменена: все темы курса лягут заново'
    : 'Все темы курса лягут'
  return `${head} по ${perWeek} в неделю в порядке программы. Отклонения по ученикам (сдвиги и снятые темы) сохранятся. Продолжить?`
}
