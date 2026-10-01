/**
 * §250. Журнал домашних заданий курса — чистая логика без сети.
 *
 * Данные — `course_homework_grades` (PENDING_250): опубликованные ДЗ тем-уроков
 * по разделам и клетки «ученик × ДЗ» там, где у ученика есть попытка (нет
 * строки — попыток нет). Здесь — как разложить это журналом «строки — ученики,
 * столбцы — разделы, раскрываются в ДЗ своих тем» (макет владельца 01.10) и
 * строкой класса во вкладке «Курс».
 *
 * Правила (решение владельца 01.10, п. 4):
 * - столбец — ДЗ, которое ВЫДАНО: тема открыта ученикам (`topic_open`, то же
 *   правило, что `topic_open_now`) или кто-то уже сдавал; ДЗ закрытой темы
 *   ученик не видит — сплошные «—» в журнале ничего не сообщают;
 * - клетка ДЗ: «✓» — принято (у ДЗ нет шкалы или балл не поставлен); оценка
 *   цветом как в §249 — у ДЗ со шкалой; «ждёт» — сдано, не проверено;
 *   «дораб.» — вернули; «просроч.» — срок `due_at` прошёл (дата по Москве от
 *   сервера), сдачи нет (нет попытки или только черновик); «—» — срок не
 *   наступил или срока нет;
 * - клетка раздела: «X из Y» — принято из выданных; ниже «просроч. N» или
 *   «ждёт N»; красным, если есть просрочка, зелёным — если принято всё;
 * - «Сначала отстающие»: больше просрочек — выше, потом меньше принятого.
 *
 * Только темы-уроки: проверочные и контрольные — во вкладке §249.
 */
import { fiveOf, toneOf, type GradeScale, type GradeTone } from './courseGrades'

export type HwCellStatus = 'none' | 'draft' | 'submitted' | 'reviewed' | 'returned'

export interface HwJournalHomework {
  topic_id: string
  homework_id: string
  module_id: string
  module_title: string
  module_order: number
  topic_title: string
  topic_order: number
  hw_title: string | null
  /** Срок — календарная дата «ГГГГ-ММ-ДД» (тип date в базе). */
  due_at: string | null
  grade_scale: GradeScale
  /** Тема открыта ученикам прямо сейчас (`topic_open_now`). */
  topic_open: boolean
}

export interface HwJournalStudent {
  student_id: string
  name: string
}

export interface HwJournalCell {
  topic_id: string
  student_id: string
  status: HwCellStatus
  score: number | null
  attempt_id: string | null
  attempt_number: number | null
}

export interface CourseHomeworkGrades {
  serverNow: string
  /** Сегодня по Москве, «ГГГГ-ММ-ДД» — с этим сравнивается срок ДЗ. */
  today: string
  isTemplate: boolean
  groupId: string | null
  groupName: string | null
  students: HwJournalStudent[]
  homeworks: HwJournalHomework[]
  cells: HwJournalCell[]
}

// ─── Разбор ответа ──────────────────────────────────────────────────────────

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}
function arr(v: unknown): Record<string, unknown>[] {
  return (Array.isArray(v) ? v : []).map(obj).filter((x): x is Record<string, unknown> => !!x)
}
const STATUSES: readonly HwCellStatus[] = ['none', 'draft', 'submitted', 'reviewed', 'returned']

/** Сегодня по Москве — запасной вариант, если сервер не прислал `today`. */
export function moscowToday(nowMs: number = Date.now()): string {
  return new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
}

/** Ответ `course_homework_grades` → типы. Мусор — null (экран покажет, что журнала нет). */
export function parseHomeworkGrades(raw: unknown): CourseHomeworkGrades | null {
  const r = obj(raw)
  if (!r) return null
  const serverNow = str(r.server_now) ?? new Date().toISOString()
  return {
    serverNow,
    today: (str(r.today) ?? moscowToday(Date.parse(serverNow) || Date.now())).slice(0, 10),
    isTemplate: r.is_template === true,
    groupId: str(r.group_id),
    groupName: str(r.group_name),
    students: arr(r.students).filter(s => str(s.student_id)).map(s => ({
      student_id: s.student_id as string,
      name: str(s.name) ?? 'Без имени',
    })),
    homeworks: arr(r.homeworks).filter(h => str(h.topic_id) && str(h.module_id)).map(h => ({
      topic_id: h.topic_id as string,
      homework_id: str(h.homework_id) ?? (h.topic_id as string),
      module_id: h.module_id as string,
      module_title: str(h.module_title) ?? 'Без названия',
      module_order: num(h.module_order) ?? 0,
      topic_title: str(h.topic_title) ?? 'Без названия',
      topic_order: num(h.topic_order) ?? 0,
      hw_title: str(h.hw_title),
      due_at: str(h.due_at)?.slice(0, 10) ?? null,
      grade_scale: h.grade_scale === 'five' || h.grade_scale === 'hundred' ? h.grade_scale : null,
      topic_open: h.topic_open === true,
    })),
    cells: arr(r.cells).filter(c => str(c.topic_id) && str(c.student_id)).map(c => ({
      topic_id: c.topic_id as string,
      student_id: c.student_id as string,
      status: STATUSES.includes(c.status as HwCellStatus) ? c.status as HwCellStatus : 'none',
      score: num(c.score),
      attempt_id: str(c.attempt_id),
      attempt_number: num(c.attempt_number),
    })),
  }
}

// ─── Даты ───────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['янв', 'февр', 'марта', 'апр', 'мая', 'июня', 'июля', 'авг', 'сент', 'окт', 'нояб', 'дек']

/** «21 сент» из «2026-09-21» — календарная дата, без часовых поясов. */
export function shortDay(day: string | null | undefined): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) return '—'
  return `${Number(day.slice(8, 10))} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1] ?? ''}`
}

/** Срок прошёл: due_at — дата, просрочено со следующего дня. */
export function isPastDue(due: string | null, today: string): boolean {
  return !!due && due.slice(0, 10) < today
}

// ─── Клетка ─────────────────────────────────────────────────────────────────

export type HwCellView =
  | { kind: 'accepted'; text: '✓'; attemptId: string | null }
  | { kind: 'grade'; text: string; tone: GradeTone | null; five: number | null; attemptId: string | null }
  | { kind: 'wait'; text: 'ждёт'; attemptId: string | null }
  | { kind: 'returned'; text: 'дораб.'; attemptId: string | null }
  | { kind: 'late'; text: 'просроч.'; attemptId: string | null }
  | { kind: 'empty'; text: '—' }

export function hwCellView(cell: HwJournalCell | undefined, hw: Pick<HwJournalHomework, 'due_at' | 'grade_scale'>, today: string): HwCellView {
  const status = cell?.status ?? 'none'
  const attemptId = cell?.attempt_id ?? null
  switch (status) {
    case 'reviewed': {
      if (hw.grade_scale && cell?.score != null) {
        const five = fiveOf(cell.score, hw.grade_scale)
        return { kind: 'grade', text: String(cell.score), tone: toneOf(five), five, attemptId }
      }
      return { kind: 'accepted', text: '✓', attemptId }
    }
    case 'submitted':
      return { kind: 'wait', text: 'ждёт', attemptId }
    case 'returned':
      return { kind: 'returned', text: 'дораб.', attemptId }
    default:
      // Нет попытки или только черновик: «не сдал». Просрочено — если срок прошёл.
      return isPastDue(hw.due_at, today) ? { kind: 'late', text: 'просроч.', attemptId } : { kind: 'empty', text: '—' }
  }
}

const isAccepted = (c: HwCellView) => c.kind === 'accepted' || c.kind === 'grade'

// ─── Выдано ли ДЗ ───────────────────────────────────────────────────────────

/** ДЗ выдано: тема открыта, либо кто-то уже сдавал (тему могли закрыть обратно). */
export function isIssued(hw: HwJournalHomework, cells: readonly HwJournalCell[]): boolean {
  if (hw.topic_open) return true
  return cells.some(c => c.topic_id === hw.topic_id && c.status !== 'draft' && c.status !== 'none')
}

// ─── Журнал ─────────────────────────────────────────────────────────────────

export type HwSortMode = 'name' | 'behind'

export interface HwColumn {
  hw: HwJournalHomework
  /** «до 21 сент» / «без срока». */
  dueLabel: string
}

export interface HwSection {
  moduleId: string
  title: string
  columns: HwColumn[]
}

export interface SectionSummary {
  accepted: number
  issued: number
  late: number
  wait: number
  returned: number
  /** «2 из 5» */
  text: string
  /** «просроч. 2» / «ждёт 1» / '' */
  note: string
  tone: 'bad' | 'ok' | 'plain'
}

export interface HwJournalRow {
  student: HwJournalStudent
  /** По разделам: сводка и клетки ДЗ (в порядке столбцов раздела). */
  sections: { summary: SectionSummary; cells: HwCellView[] }[]
  accepted: number
  issued: number
  late: number
  wait: number
}

export interface HwJournalView {
  sections: HwSection[]
  rows: HwJournalRow[]
  /** Сколько ДЗ выдано (столбцов). */
  issued: number
  /** Ждут проверки — по всем клеткам. */
  pending: number
  /** Просроченных клеток по классу. */
  late: number
}

export function summarize(cells: readonly HwCellView[]): SectionSummary {
  const accepted = cells.filter(isAccepted).length
  const late = cells.filter(c => c.kind === 'late').length
  const wait = cells.filter(c => c.kind === 'wait').length
  const returned = cells.filter(c => c.kind === 'returned').length
  const issued = cells.length
  return {
    accepted, issued, late, wait, returned,
    text: `${accepted} из ${issued}`,
    note: late > 0 ? `просроч. ${late}` : wait > 0 ? `ждёт ${wait}` : '',
    tone: late > 0 ? 'bad' : issued > 0 && accepted === issued ? 'ok' : 'plain',
  }
}

function byOrder(a: HwJournalHomework, b: HwJournalHomework): number {
  return a.module_order - b.module_order
    || a.module_id.localeCompare(b.module_id)
    || a.topic_order - b.topic_order
    || a.topic_title.localeCompare(b.topic_title, 'ru')
}

export function cellKey(topicId: string, studentId: string) {
  return `${topicId}|${studentId}`
}

export function homeworkJournalView(data: CourseHomeworkGrades, opts: { sort: HwSortMode }): HwJournalView {
  const issued = data.homeworks.filter(h => isIssued(h, data.cells)).slice().sort(byOrder)
  const sections: HwSection[] = []
  for (const hw of issued) {
    let s = sections[sections.length - 1]
    if (!s || s.moduleId !== hw.module_id) {
      s = { moduleId: hw.module_id, title: hw.module_title, columns: [] }
      sections.push(s)
    }
    s.columns.push({ hw, dueLabel: hw.due_at ? `до ${shortDay(hw.due_at)}` : 'без срока' })
  }

  const index = new Map<string, HwJournalCell>()
  for (const c of data.cells) index.set(cellKey(c.topic_id, c.student_id), c)

  const rows: HwJournalRow[] = data.students.map(student => {
    const parts = sections.map(s => {
      const cells = s.columns.map(col => hwCellView(index.get(cellKey(col.hw.topic_id, student.student_id)), col.hw, data.today))
      return { summary: summarize(cells), cells }
    })
    const sum = (k: 'accepted' | 'issued' | 'late' | 'wait') => parts.reduce((n, p) => n + p.summary[k], 0)
    return { student, sections: parts, accepted: sum('accepted'), issued: sum('issued'), late: sum('late'), wait: sum('wait') }
  })

  const byName = (a: HwJournalRow, b: HwJournalRow) => a.student.name.localeCompare(b.student.name, 'ru')
  rows.sort(opts.sort === 'behind'
    ? (a, b) => (b.late - a.late) || ((b.issued - b.accepted) - (a.issued - a.accepted)) || byName(a, b)
    : byName)

  return {
    sections,
    rows,
    issued: issued.length,
    pending: rows.reduce((n, r) => n + r.wait, 0),
    late: rows.reduce((n, r) => n + r.late, 0),
  }
}

/** «59 ДЗ выдано · ждут проверки 5 · просрочено 31». */
export function journalMetaText(view: HwJournalView): string {
  const parts = [`${view.issued} ДЗ выдано`]
  if (view.pending > 0) parts.push(`ждут проверки ${view.pending}`)
  if (view.late > 0) parts.push(`просрочено ${view.late}`)
  return parts.join(' · ')
}

/**
 * Таблица для Excel: все разделы раскрыты (выгрузка — для работы с таблицей,
 * а не снимок экрана), ученики — в текущем порядке. На раздел — столбец
 * «принято из выданных», затем ДЗ его тем; в конце — итог и просрочено.
 */
export function homeworkJournalSheet(view: HwJournalView): (string | number)[][] {
  const head: string[] = ['Ученик']
  for (const s of view.sections) {
    head.push(`${s.title}: принято из выданных`)
    for (const c of s.columns) head.push(`${s.title} · ${c.hw.topic_title}${c.hw.due_at ? ` (${c.dueLabel})` : ''}`)
  }
  head.push('Всего принято', 'Просрочено')
  const out = (c: HwCellView): string | number => {
    switch (c.kind) {
      case 'accepted': return 'принято'
      case 'grade': return Number(c.text)
      case 'wait': return 'ждёт проверки'
      case 'returned': return 'на доработке'
      case 'late': return 'просрочено'
      default: return '—'
    }
  }
  const body = view.rows.map(r => {
    const line: (string | number)[] = [r.student.name]
    r.sections.forEach(p => {
      line.push(p.summary.text)
      line.push(...p.cells.map(out))
    })
    line.push(`${r.accepted} из ${r.issued}`, r.late)
    return line
  })
  return [head, ...body]
}

// ─── Строка класса (вкладка «Курс») ─────────────────────────────────────────

export interface TopicClassStats {
  topicId: string
  inClass: number
  /** Сдали: есть сданная попытка (ждёт, принята или возвращена). */
  submitted: number
  pending: number
  accepted: number
  late: number
  /** Средний по принятым с баллом, в пятибалльной; null — оценок нет. */
  avgFive: number | null
  dueAt: string | null
  issued: boolean
}

export function topicClassStats(data: CourseHomeworkGrades): Map<string, TopicClassStats> {
  const out = new Map<string, TopicClassStats>()
  const index = new Map<string, HwJournalCell>()
  for (const c of data.cells) index.set(cellKey(c.topic_id, c.student_id), c)
  for (const hw of data.homeworks) {
    const views = data.students.map(s => ({ cell: index.get(cellKey(hw.topic_id, s.student_id)) }))
      .map(({ cell }) => ({ cell, view: hwCellView(cell, hw, data.today) }))
    const fives = views.flatMap(v => (v.view.kind === 'grade' && v.view.five != null ? [v.view.five] : []))
    out.set(hw.topic_id, {
      topicId: hw.topic_id,
      inClass: data.students.length,
      submitted: views.filter(v => v.cell && v.cell.status !== 'draft' && v.cell.status !== 'none').length,
      pending: views.filter(v => v.view.kind === 'wait').length,
      accepted: views.filter(v => isAccepted(v.view)).length,
      late: views.filter(v => v.view.kind === 'late').length,
      avgFive: fives.length ? fives.reduce((a, b) => a + b, 0) / fives.length : null,
      dueAt: hw.due_at,
      issued: isIssued(hw, data.cells),
    })
  }
  return out
}

export interface ModuleClassStats {
  /** ДЗ выдано в разделе. */
  homeworks: number
  submitted: number
  pending: number
  late: number
  avgFive: number | null
}

/** Раздел: сумма по выданным ДЗ его тем; средний — по всем оценкам раздела. */
export function moduleClassStats(data: CourseHomeworkGrades, stats: Map<string, TopicClassStats>, topicIds: readonly string[]): ModuleClassStats {
  const ids = new Set(topicIds)
  const res: ModuleClassStats = { homeworks: 0, submitted: 0, pending: 0, late: 0, avgFive: null }
  let sum = 0
  let n = 0
  const index = new Map<string, HwJournalCell>()
  for (const c of data.cells) if (ids.has(c.topic_id)) index.set(cellKey(c.topic_id, c.student_id), c)
  for (const hw of data.homeworks) {
    if (!ids.has(hw.topic_id)) continue
    const s = stats.get(hw.topic_id)
    if (!s?.issued) continue
    res.homeworks += 1
    res.submitted += s.submitted
    res.pending += s.pending
    res.late += s.late
    for (const st of data.students) {
      const v = hwCellView(index.get(cellKey(hw.topic_id, st.student_id)), hw, data.today)
      if (v.kind === 'grade' && v.five != null) { sum += v.five; n += 1 }
    }
  }
  res.avgFive = n ? sum / n : null
  return res
}

