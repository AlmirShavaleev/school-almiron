/**
 * §249. Вкладка курса «Проверочные и контрольные» — чистая логика без сети.
 *
 * Данные — `course_assessment_grades` (PENDING_249): по каждой работе по
 * времени (тема check/control с опубликованным ДЗ) и каждому ученику групп
 * курса — статус последней попытки и балл последнего вердикта. Здесь — как
 * разложить это журналом «ученик × работа» и списком работ со статистикой.
 *
 * Правила журнала (макет владельца 01.10):
 * - столбцы — сначала «Проверочные», потом «Контрольные», внутри — по дате
 *   окна; работа, у которой окно ещё не открылось и никто ничего не сдал, —
 *   не столбец (в журнале она была бы сплошными «—»), но в списке работ есть;
 * - клетка: оценка цветом (5/4/3/2), «ждёт» (сдал, вердикта нет), «—» (не
 *   сдавал или только черновик), «дораб.» (вернули, новой попытки нет);
 * - средний ученика — только по проверенным, в пятибалльной шкале:
 *   стобалльная переводится порогами `fiveFromRatio` 90/70/50 (как в ИИ-
 *   проверке), иначе средний «4 и 80» не имел бы смысла; в клетке стобалльной
 *   — сам балл, цвет — по переводу;
 * - «Сначала слабые» — по среднему по возрастанию, без оценок — в конце;
 * - точка у имени — две и больше двоек среди видимых столбцов.
 */
import { fiveFromRatio } from './homeworkReviewTasks'
import { mskShortDate, mskWeekday, type TeacherRow, type CourseAssessmentsSummary, teacherBlocks } from './courseAssessments'
import { plural } from './plural'

export type WorkKind = 'check' | 'control'
export type GradeScale = 'five' | 'hundred' | null
export type GradeCellStatus = 'none' | 'draft' | 'submitted' | 'reviewed' | 'returned'

export interface GradeWork {
  topic_id: string
  homework_id: string | null
  kind: WorkKind
  title: string
  module_title: string | null
  opens_at: string | null
  closes_at: string | null
  grade_scale: GradeScale
}

export interface GradeStudent {
  student_id: string
  name: string
}

export interface GradeCell {
  topic_id: string
  student_id: string
  status: GradeCellStatus
  score: number | null
  attempt_id: string | null
  attempt_number: number | null
  auto_submitted: boolean
}

export interface CourseGrades {
  serverNow: string
  isTemplate: boolean
  groupId: string | null
  groupName: string | null
  students: GradeStudent[]
  works: GradeWork[]
  cells: GradeCell[]
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
const CELL_STATUSES: readonly GradeCellStatus[] = ['none', 'draft', 'submitted', 'reviewed', 'returned']

/** Ответ `course_assessment_grades` → типы. Мусор — null (экран покажет, что журнала нет). */
export function parseGrades(raw: unknown): CourseGrades | null {
  const r = obj(raw)
  if (!r) return null
  return {
    serverNow: str(r.server_now) ?? new Date().toISOString(),
    isTemplate: r.is_template === true,
    groupId: str(r.group_id),
    groupName: str(r.group_name),
    students: arr(r.students).filter(s => str(s.student_id)).map(s => ({
      student_id: s.student_id as string,
      name: str(s.name) ?? 'Без имени',
    })),
    works: arr(r.works).filter(w => str(w.topic_id)).map(w => ({
      topic_id: w.topic_id as string,
      homework_id: str(w.homework_id),
      kind: w.kind === 'control' ? 'control' : 'check',
      title: str(w.title) ?? 'Без названия',
      module_title: str(w.module_title),
      opens_at: str(w.opens_at),
      closes_at: str(w.closes_at),
      grade_scale: w.grade_scale === 'five' || w.grade_scale === 'hundred' ? w.grade_scale : null,
    })),
    cells: arr(r.cells).filter(c => str(c.topic_id) && str(c.student_id)).map(c => ({
      topic_id: c.topic_id as string,
      student_id: c.student_id as string,
      status: CELL_STATUSES.includes(c.status as GradeCellStatus) ? c.status as GradeCellStatus : 'none',
      score: num(c.score),
      attempt_id: str(c.attempt_id),
      attempt_number: num(c.attempt_number),
      auto_submitted: c.auto_submitted === true,
    })),
  }
}

// ─── Оценка, цвет, числа ───────────────────────────────────────────────────

export type GradeTone = 5 | 4 | 3 | 2

/**
 * Оценка в пятибалльной шкале — для цвета, среднего и «двоек». Пятибалльная —
 * как есть (0 и 1 — тоже «двойка» по цвету), стобалльная — порогами 90/70/50.
 * Шкалы нет (ДЗ без баллов) — оценки нет.
 */
export function fiveOf(score: number | null, scale: GradeScale): number | null {
  if (score == null) return null
  if (scale === 'five') return score
  if (scale === 'hundred') return fiveFromRatio(score / 100)
  return null
}

export function toneOf(five: number | null): GradeTone | null {
  if (five == null) return null
  if (five >= 4.5) return 5
  if (five >= 3.5) return 4
  if (five >= 2.5) return 3
  return 2
}

/** «4,3» — всегда один знак после запятой, как в макете; нет числа — «—». */
export function formatAvg(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return (Math.round(n * 10) / 10).toFixed(1).replace('.', ',')
}

function avg(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null
}

function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** «пн 29 сент» по Москве; без даты — «без даты». */
export function workDateLabel(iso: string | null): string {
  if (!iso) return 'без даты'
  return `${mskWeekday(iso)} ${mskShortDate(iso)}`
}

// ─── Журнал ────────────────────────────────────────────────────────────────

export type KindFilter = 'all' | 'check' | 'control'
export type SortMode = 'name' | 'weak'

export type CellView =
  | { kind: 'grade'; text: string; tone: GradeTone | null; five: number | null; attemptId: string | null }
  | { kind: 'wait'; text: 'ждёт'; attemptId: string | null; auto: boolean }
  | { kind: 'returned'; text: 'дораб.'; attemptId: string | null }
  | { kind: 'empty'; text: '—' }

export interface JournalColumn {
  work: GradeWork
  dateLabel: string
  /** Средний по классу по этой работе: пятибалльная — «4,1», стобалльная — «72». */
  classAvg: string
}

export interface JournalRow {
  student: GradeStudent
  cells: CellView[]
  /** Средний по проверенным (пятибалльный), null — оценок нет. */
  avg: number | null
  twos: number
  flagged: boolean
}

export interface JournalView {
  /** Шапка над столбцами: «Проверочные» / «Контрольные» и сколько столбцов под ней. */
  groups: { kind: WorkKind; title: string; span: number }[]
  columns: JournalColumn[]
  rows: JournalRow[]
  /** Средний по классу — среднее средних учеников. */
  classAvg: number | null
  flaggedCount: number
  /** Столбцы есть хоть при каком-то фильтре (иначе журнал не рисуем вовсе). */
  hasAnyColumns: boolean
}

const GROUP_TITLE: Record<WorkKind, string> = { check: 'Проверочные', control: 'Контрольные' }

/** Работа — столбец журнала: окно уже открылось, либо кто-то уже что-то сдал. */
export function isJournalWork(w: GradeWork, cells: readonly GradeCell[], nowMs: number): boolean {
  const opens = msOf(w.opens_at)
  if (opens != null && opens <= nowMs) return true
  return cells.some(c => c.topic_id === w.topic_id && (c.status === 'submitted' || c.status === 'reviewed' || c.status === 'returned'))
}

function byDate(a: GradeWork, b: GradeWork): number {
  const ta = msOf(a.opens_at), tb = msOf(b.opens_at)
  if (ta !== tb) return (ta ?? Infinity) - (tb ?? Infinity)
  return a.title.localeCompare(b.title, 'ru')
}

export function cellView(cell: GradeCell | undefined, scale: GradeScale): CellView {
  if (!cell) return { kind: 'empty', text: '—' }
  switch (cell.status) {
    case 'submitted':
      return { kind: 'wait', text: 'ждёт', attemptId: cell.attempt_id, auto: cell.auto_submitted }
    case 'returned':
      return { kind: 'returned', text: 'дораб.', attemptId: cell.attempt_id }
    case 'reviewed': {
      const five = fiveOf(cell.score, scale)
      // Принята без балла (у ДЗ нет шкалы) — «зачёт», без цвета и без среднего.
      const text = cell.score == null ? 'зачёт' : String(cell.score)
      return { kind: 'grade', text, tone: toneOf(five), five, attemptId: cell.attempt_id }
    }
    default:
      return { kind: 'empty', text: '—' }
  }
}

export function journalView(data: CourseGrades, opts: { kind: KindFilter; sort: SortMode; nowMs: number }): JournalView {
  const all = data.works.filter(w => isJournalWork(w, data.cells, opts.nowMs))
  const visible = all.filter(w => opts.kind === 'all' || w.kind === opts.kind)
  const checks = visible.filter(w => w.kind === 'check').sort(byDate)
  const controls = visible.filter(w => w.kind === 'control').sort(byDate)
  const ordered = [...checks, ...controls]

  const cellIndex = new Map<string, GradeCell>()
  for (const c of data.cells) cellIndex.set(`${c.topic_id}|${c.student_id}`, c)

  const rows: JournalRow[] = data.students.map(student => {
    const cells = ordered.map(w => cellView(cellIndex.get(`${w.topic_id}|${student.student_id}`), w.grade_scale))
    const fives = cells.flatMap(c => (c.kind === 'grade' && c.five != null ? [c.five] : []))
    const twos = cells.filter(c => c.kind === 'grade' && c.tone === 2).length
    return { student, cells, avg: avg(fives), twos, flagged: twos >= 2 }
  })

  const byName = (a: JournalRow, b: JournalRow) => a.student.name.localeCompare(b.student.name, 'ru')
  rows.sort(opts.sort === 'weak'
    ? (a, b) => {
        if (a.avg == null && b.avg == null) return byName(a, b)
        if (a.avg == null) return 1
        if (b.avg == null) return -1
        return a.avg - b.avg || byName(a, b)
      }
    : byName)

  const columns: JournalColumn[] = ordered.map((w, i) => {
    const scores = rows.flatMap(r => {
      const c = r.cells[i]
      return c.kind === 'grade' && c.five != null ? [Number(c.text)] : []
    })
    const a = avg(scores)
    return {
      work: w,
      dateLabel: workDateLabel(w.opens_at),
      classAvg: w.grade_scale === 'hundred' ? (a == null ? '—' : String(Math.round(a))) : formatAvg(a),
    }
  })

  const groups: JournalView['groups'] = []
  if (checks.length) groups.push({ kind: 'check', title: GROUP_TITLE.check, span: checks.length })
  if (controls.length) groups.push({ kind: 'control', title: GROUP_TITLE.control, span: controls.length })

  return {
    groups,
    columns,
    rows,
    classAvg: avg(rows.flatMap(r => (r.avg == null ? [] : [r.avg]))),
    flaggedCount: rows.filter(r => r.flagged).length,
    hasAnyColumns: all.length > 0,
  }
}

/** Таблица для выгрузки (Excel): шапка, ученики в текущем порядке, строка среднего. */
export function journalSheet(view: JournalView): (string | number)[][] {
  const head = ['Ученик', ...view.columns.map(c => `${c.work.kind === 'check' ? 'Проверочная' : 'КР'}: ${c.work.title} (${c.dateLabel})`), 'Средний']
  const cellOut = (c: CellView): string | number => {
    if (c.kind === 'grade') return c.text === 'зачёт' ? 'зачёт' : Number(c.text)
    if (c.kind === 'wait') return 'ждёт проверки'
    if (c.kind === 'returned') return 'на доработке'
    return '—'
  }
  const avgOut = (n: number | null): string | number => (n == null ? '—' : Math.round(n * 10) / 10)
  const body = view.rows.map(r => [r.student.name, ...r.cells.map(cellOut), avgOut(r.avg)])
  const foot = ['Средний по классу', ...view.columns.map(c => c.classAvg), avgOut(view.classAvg)]
  return [head, ...body, foot]
}

// ─── Список работ ──────────────────────────────────────────────────────────

export interface Distribution {
  five: number
  four: number
  three: number
  two: number
  wait: number
  /** Ученики в классе — знаменатель полоски. */
  total: number
}

/** Распределение оценок по работе (по пятибалльному переводу) + ждут проверки. */
export function distributionOf(data: CourseGrades, topicId: string): Distribution | null {
  const w = data.works.find(x => x.topic_id === topicId)
  if (!w) return null
  const d: Distribution = { five: 0, four: 0, three: 0, two: 0, wait: 0, total: data.students.length }
  for (const c of data.cells) {
    if (c.topic_id !== topicId) continue
    if (c.status === 'submitted') d.wait += 1
    else if (c.status === 'reviewed') {
      const t = toneOf(fiveOf(c.score, w.grade_scale))
      if (t === 5) d.five += 1
      else if (t === 4) d.four += 1
      else if (t === 3) d.three += 1
      else if (t === 2) d.two += 1
    }
  }
  return d
}

export interface WorkListRow extends TeacherRow {
  kind: WorkKind
  topicId: string
  dist: Distribution | null
}

/**
 * Работы по времени курса — по дате (старые сверху, как журнал читается слева
 * направо); без даты — в конце. Статус и кнопки — те же, что в сводке §241
 * (`teacherBlocks`), только «Проверка» здесь «Проверить N» — как в макете.
 */
export function worksList(summary: CourseAssessmentsSummary, grades: CourseGrades | null, nowMs: number): WorkListRow[] {
  const rows = teacherBlocks({ ...summary, mocks: [] }, nowMs).flatMap(b => b.rows)
  const kindOf = new Map(summary.works.map(w => [w.topic_id, w] as const))
  const out: WorkListRow[] = []
  for (const r of rows) {
    const topicId = r.key.replace(/^work:/, '')
    const w = kindOf.get(topicId)
    if (!w) continue
    out.push({
      ...r,
      kind: w.kind,
      topicId,
      // Полоска — только у работы, которую уже писали: у запланированной и
      // без времени она была бы пустой серой чертой.
      dist: grades && !summary.isTemplate && w.status !== 'planned' && w.status !== 'unscheduled'
        ? distributionOf(grades, topicId) : null,
      actions: r.actions.map(a => (a.kind === 'queue' ? { ...a, label: `Проверить ${w.pending}` } : a)),
    })
  }
  return out.sort((a, b) => {
    const ta = msOf(a.date), tb = msOf(b.date)
    if (ta !== tb) return (ta ?? Infinity) - (tb ?? Infinity)
    return a.title.localeCompare(b.title, 'ru')
  })
}

/** «1 проверочная · 2 контрольные · ждут проверки 5». */
export function worksMeta(rows: readonly WorkListRow[], summary: CourseAssessmentsSummary): string {
  const nc = rows.filter(r => r.kind === 'check').length
  const nk = rows.length - nc
  const pending = summary.works.reduce((n, w) => n + w.pending, 0)
  const parts = [
    `${nc} ${plural(nc, 'проверочная', 'проверочные', 'проверочных')}`,
    `${nk} ${plural(nk, 'контрольная', 'контрольные', 'контрольных')}`,
  ]
  if (pending > 0 && !summary.isTemplate) parts.push(`ждут проверки ${pending}`)
  return parts.join(' · ')
}

/** «24 ученика · две и больше двоек у 3». */
export function journalMeta(view: JournalView): string {
  const n = view.rows.length
  const parts = [`${n} ${plural(n, 'ученик', 'ученика', 'учеников')}`]
  if (view.flaggedCount > 0) parts.push(`две и больше двоек у ${view.flaggedCount}`)
  return parts.join(' · ')
}
