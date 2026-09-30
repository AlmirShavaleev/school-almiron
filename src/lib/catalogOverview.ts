import { plural } from '@/lib/plural'

/**
 * §246. Главная «Каталога заданий»: решённое по номерам и сравнение со школой.
 *
 * Данные — один вызов `catalog_my_overview()` (PENDING_246.sql). Здесь —
 * разбор ответа и всё, что из него выводится для экрана: строки предметов,
 * столбики по номерам, чипы, личный итог. Отрисовка — `CatalogHome.tsx`.
 *
 * «Решено» определяет база (отметка «Выполнено» ИЛИ верный ответ в варианте,
 * одна задача — один раз); клиент ничего не пересчитывает, только
 * складывает номера и подписывает.
 */

export interface OverviewNumber {
  n: number
  total: number
  /** null — у персонала (решённого нет вовсе). */
  solved: number | null
  /** Куда ведёт столбик: первый непустой раздел номера. */
  sectionId: string | null
}

export interface OverviewExam {
  subject: string
  examType: string
  isMine: boolean
  total: number
  solved: number | null
  solved7d: number | null
  solvers: number | null
  betterPct: number | null
  numbers: OverviewNumber[]
}

export interface OverviewOverall {
  solved: number
  solved7d: number
  solvers: number
  betterPct: number | null
}

export interface CatalogOverview {
  viewer: 'student' | 'staff'
  minSolvers: number
  overall: OverviewOverall | null
  exams: OverviewExam[]
}

export const DEFAULT_MIN_SOLVERS = 10

// ─── Разбор ответа ───────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * Номера одного экзамена: по возрастанию, повторяющийся номер (несколько
 * разделов с одним exam_number — у физики ОГЭ у №20 их три) — одним столбиком:
 * задачи и решённое складываются, ссылка — на первый раздел, в котором есть
 * задачи. База уже отдаёт номера сложенными; здесь то же правило на случай,
 * если придут разделы по отдельности. Номер без задач (пустой №0 физики ЕГЭ)
 * столбика не получает.
 */
export function mergeNumbers(rows: OverviewNumber[]): OverviewNumber[] {
  const byN = new Map<number, OverviewNumber>()
  for (const r of rows) {
    if (!Number.isInteger(r.n) || r.n < 1) continue
    const prev = byN.get(r.n)
    if (!prev) {
      byN.set(r.n, { ...r, sectionId: r.total > 0 ? r.sectionId : null })
      continue
    }
    byN.set(r.n, {
      n: r.n,
      total: prev.total + r.total,
      solved: prev.solved == null && r.solved == null ? null : (prev.solved ?? 0) + (r.solved ?? 0),
      sectionId: prev.sectionId ?? (r.total > 0 ? r.sectionId : null),
    })
  }
  return [...byN.values()].filter(r => r.total > 0).sort((a, b) => a.n - b.n)
}

export function normalizeCatalogOverview(raw: unknown): CatalogOverview | null {
  const root = obj(raw)
  if (!root) return null
  const viewer = root.viewer === 'student' ? 'student' : 'staff'
  const isStudent = viewer === 'student'
  const exams: OverviewExam[] = []
  for (const item of Array.isArray(root.exams) ? root.exams : []) {
    const e = obj(item)
    if (!e || typeof e.subject !== 'string' || typeof e.exam_type !== 'string') continue
    const numbers = mergeNumbers(
      (Array.isArray(e.numbers) ? e.numbers : []).flatMap((x): OverviewNumber[] => {
        const r = obj(x)
        const n = num(r?.n)
        if (!r || n == null) return []
        return [{
          n,
          total: num(r.total) ?? 0,
          solved: isStudent ? (num(r.solved) ?? 0) : null,
          sectionId: typeof r.section_id === 'string' ? r.section_id : null,
        }]
      }),
    )
    if (numbers.length === 0) continue
    const total = numbers.reduce((s, r) => s + r.total, 0)
    const solvedSum = numbers.reduce((s, r) => s + (r.solved ?? 0), 0)
    exams.push({
      subject: e.subject,
      examType: e.exam_type,
      isMine: isStudent && e.is_mine === true,
      total,
      solved: isStudent ? (num(e.solved) ?? solvedSum) : null,
      solved7d: isStudent ? (num(e.solved_7d) ?? 0) : null,
      solvers: isStudent ? num(e.solvers) : null,
      betterPct: isStudent ? positivePct(num(e.better_pct)) : null,
      numbers,
    })
  }
  const o = obj(root.overall)
  const overall: OverviewOverall | null = isStudent
    ? {
      solved: num(o?.solved) ?? exams.reduce((s, e) => s + (e.solved ?? 0), 0),
      solved7d: num(o?.solved_7d) ?? 0,
      solvers: num(o?.solvers) ?? 0,
      betterPct: positivePct(num(o?.better_pct)),
    }
    : null
  return { viewer, minSolvers: num(root.min_solvers) ?? DEFAULT_MIN_SOLVERS, overall, exams }
}

/** «0 %» не показываем (правило §223), как и мусор вне 1..99. */
function positivePct(v: number | null): number | null {
  if (v == null) return null
  const p = Math.floor(v)
  return p >= 1 && p <= 99 ? p : null
}

// ─── Предметы и экзамены ─────────────────────────────────────────────────────

export type SubjectTone = 'math' | 'physics' | 'other'

const SUBJECT_ORDER = ['Математика', 'Физика']
const EXAM_ORDER = ['ЕГЭ', 'ОГЭ']
const SUBJECT_SLUG: Record<string, string> = { 'Математика': 'math', 'Физика': 'physics' }
const EXAM_SLUG: Record<string, string> = { 'ЕГЭ': 'ege', 'ОГЭ': 'oge' }

/** Подписи под «ЕГЭ/ОГЭ» — из макета. */
const EXAM_SUB: Record<string, string> = {
  'Математика|ЕГЭ': 'Профильная математика',
  'Математика|ОГЭ': '9 класс',
  'Физика|ЕГЭ': 'Первая и вторая часть',
  'Физика|ОГЭ': '9 класс',
}

export function subjectTone(subject: string): SubjectTone {
  if (subject === 'Математика') return 'math'
  if (subject === 'Физика') return 'physics'
  return 'other'
}
export function subjectGlyph(subject: string): string {
  if (subject === 'Математика') return '∑'
  if (subject === 'Физика') return 'Φ'
  return subject.slice(0, 1).toUpperCase()
}
export function examSubtitle(subject: string, examType: string): string {
  return EXAM_SUB[`${subject}|${examType}`] ?? ''
}

/** Страница номеров экзамена — прежний список разделов `/catalog?subject=&exam=`. */
export function examHref(subject: string, examType: string): string {
  const s = SUBJECT_SLUG[subject] ?? encodeURIComponent(subject)
  const e = EXAM_SLUG[examType] ?? encodeURIComponent(examType)
  return `/catalog?subject=${s}&exam=${e}`
}
/** Столбик номера — в раздел, как карточка раздела в списке. */
export function numberHref(subject: string, examType: string, sectionId: string): string {
  const s = SUBJECT_SLUG[subject] ?? encodeURIComponent(subject)
  const e = EXAM_SLUG[examType] ?? encodeURIComponent(examType)
  return `/catalog/${sectionId}?subject=${s}&exam=${e}`
}

const rank = (list: string[], v: string) => {
  const i = list.indexOf(v)
  return i === -1 ? list.length : i
}

export interface SubjectRow {
  subject: string
  tone: SubjectTone
  glyph: string
  solved: number | null
  exams: OverviewExam[]
}

/** Строки предметов: математика, физика, дальше прочее; внутри — ЕГЭ, ОГЭ. */
export function subjectRows(o: CatalogOverview): SubjectRow[] {
  const by = new Map<string, OverviewExam[]>()
  for (const e of o.exams) by.set(e.subject, [...(by.get(e.subject) ?? []), e])
  return [...by.entries()]
    .sort(([a], [b]) => rank(SUBJECT_ORDER, a) - rank(SUBJECT_ORDER, b) || a.localeCompare(b, 'ru'))
    .map(([subject, exams]) => ({
      subject,
      tone: subjectTone(subject),
      glyph: subjectGlyph(subject),
      solved: o.viewer === 'student' ? exams.reduce((s, e) => s + (e.solved ?? 0), 0) : null,
      exams: [...exams].sort((a, b) =>
        rank(EXAM_ORDER, a.examType) - rank(EXAM_ORDER, b.examType) || a.examType.localeCompare(b.examType, 'ru')),
    }))
}

/**
 * Бледнее — «чужие» экзамены (не по курсам ученика). Если у ученика нет ни
 * одного своего экзамена (без групп), бледнеть нечему: все равны.
 */
export function isDimmed(o: CatalogOverview, e: OverviewExam): boolean {
  if (o.viewer !== 'student') return false
  return o.exams.some(x => x.isMine) && !e.isMine
}

// ─── Столбики ────────────────────────────────────────────────────────────────

export const BAR_MAX_PX = 70
const BAR_MIN_ON_PX = 8
const BAR_STUB_PX = 6

export interface Bar {
  n: number
  heightPx: number
  /** Закрашен: у ученика — номер начат, у персонала — всегда. */
  on: boolean
  tip: string
  href: string | null
}

const fmt = (n: number) => n.toLocaleString('ru-RU')
export const tasksWord = (n: number) => plural(n, 'задача', 'задачи', 'задач')
export const numbersWord = (n: number) => plural(n, 'номер', 'номера', 'номеров')

/**
 * Ученику высота — решённое в номере относительно лучшего номера экзамена,
 * не начатый номер — короткий серый столбик. Персоналу — число задач в номере
 * относительно самого большого номера (как было в первой версии макета).
 */
export function examBars(o: CatalogOverview, e: OverviewExam): Bar[] {
  const student = o.viewer === 'student'
  const values = e.numbers.map(r => (student ? (r.solved ?? 0) : r.total))
  const max = Math.max(1, ...values)
  return e.numbers.map((r, i) => {
    const v = values[i]
    const on = v > 0
    const heightPx = on ? Math.max(BAR_MIN_ON_PX, Math.round((v / max) * BAR_MAX_PX)) : BAR_STUB_PX
    return {
      n: r.n,
      heightPx,
      on,
      tip: barTip(r, student),
      href: r.sectionId ? numberHref(e.subject, e.examType, r.sectionId) : null,
    }
  })
}

/** «№12 · решено 3 из 503» / «№12 · не начат · 503 задачи»; персоналу — «№12 · 503 задачи». */
export function barTip(r: OverviewNumber, student: boolean): string {
  if (!student) return `№${r.n} · ${fmt(r.total)} ${tasksWord(r.total)}`
  const s = r.solved ?? 0
  return s > 0
    ? `№${r.n} · решено ${fmt(s)} из ${fmt(r.total)}`
    : `№${r.n} · не начат · ${fmt(r.total)} ${tasksWord(r.total)}`
}

export function numberRange(e: OverviewExam): string {
  if (e.numbers.length === 0) return ''
  const a = e.numbers[0].n
  const b = e.numbers[e.numbers.length - 1].n
  return a === b ? `№${a}` : `№${a}–${b}`
}

export function untouchedCount(e: OverviewExam): number {
  return e.numbers.filter(r => (r.solved ?? 0) === 0).length
}

// ─── Чипы экзамена ───────────────────────────────────────────────────────────

export type ChipTone = 'ok' | 'acc' | 'mute'
export interface Chip { tone: ChipTone; text: string }

const PCT = ' %'

export function examChips(o: CatalogOverview, e: OverviewExam): Chip[] {
  if (o.viewer !== 'student') {
    const k = e.numbers.length
    return [{ tone: 'mute', text: `${k} ${numbersWord(k)}` }]
  }
  const solved = e.solved ?? 0
  if (solved === 0) {
    return [{ tone: 'mute', text: isDimmed(o, e) ? 'не твой экзамен — можно потренироваться' : 'пока ничего не отмечено' }]
  }
  const chips: Chip[] = []
  if ((e.solved7d ?? 0) > 0) chips.push({ tone: 'ok', text: `+${fmt(e.solved7d ?? 0)} за неделю` })
  if (e.betterPct != null) chips.push({ tone: 'acc', text: `больше, чем ${e.betterPct}${PCT} школы` })
  else if ((e.solvers ?? 0) < o.minSolvers) chips.push({ tone: 'mute', text: `сравнение — когда решающих будет ${o.minSolvers}+` })
  const k = untouchedCount(e)
  if (k > 0) chips.push({ tone: 'mute', text: `не начато: ${k} ${numbersWord(k)}` })
  return chips
}

// ─── Личный итог ─────────────────────────────────────────────────────────────

export type SummaryState = 'staff' | 'new' | 'active'

export function summaryState(o: CatalogOverview): SummaryState {
  if (o.viewer !== 'student') return 'staff'
  return (o.overall?.solved ?? 0) > 0 ? 'active' : 'new'
}

/** «1 задача решена», «2 задачи решено», «7 задач решено». */
export function solvedCaption(n: number): string {
  return plural(n, 'задача решена', 'задачи решено', 'задач решено')
}

/**
 * «Сильнее всего» — номер с наибольшим числом решённых (при равенстве —
 * порядок экзаменов, затем меньший номер). Экзамен в подписи — только если
 * ученик решает оба экзамена этого предмета, иначе «математика №1» однозначно.
 */
export function strongestLabel(o: CatalogOverview): string | null {
  let best: { e: OverviewExam; n: number; v: number } | null = null
  for (const row of subjectRows(o)) {
    for (const e of row.exams) {
      for (const r of e.numbers) {
        const v = r.solved ?? 0
        if (v > 0 && (!best || v > best.v)) best = { e, n: r.n, v }
      }
    }
  }
  if (!best) return null
  const b = best
  const both = o.exams.filter(x => x.subject === b.e.subject && (x.solved ?? 0) > 0).length > 1
  return `${b.e.subject.toLowerCase()}${both ? ` ${b.e.examType}` : ''} №${b.n}`
}

/**
 * «Не начаты: K номеров твоих экзаменов». Свои — по курсам ученика; если своих
 * нет (без групп) — экзамены, в которых он решает.
 */
export function untouchedMine(o: CatalogOverview): number {
  const mine = o.exams.filter(e => e.isMine)
  const scope = mine.length > 0 ? mine : o.exams.filter(e => (e.solved ?? 0) > 0)
  return scope.reduce((s, e) => s + untouchedCount(e), 0)
}

export type Rank =
  | { kind: 'pct'; pct: number; caption: string }
  | { kind: 'wait'; text: string }
  | { kind: 'none' }

/**
 * Сравнение сверху — по объединению экзаменов, в которых ученик решает.
 * Подпись называет экзамен, если он у всех решаемых один («…решают в каталоге ЕГЭ»).
 */
export function overallRank(o: CatalogOverview): Rank {
  const ov = o.overall
  if (o.viewer !== 'student' || !ov) return { kind: 'none' }
  if (ov.solved === 0) return { kind: 'wait', text: 'Сравнение со школой появится после первых решённых задач' }
  if (ov.betterPct != null) {
    const types = [...new Set(o.exams.filter(e => (e.solved ?? 0) > 0).map(e => e.examType))]
    const tail = types.length === 1 ? ` ${types[0]}` : ''
    return { kind: 'pct', pct: ov.betterPct, caption: `учеников школы, которые решают в каталоге${tail}` }
  }
  if (ov.solvers < o.minSolvers) {
    return {
      kind: 'wait',
      text: `Сравнение появится, когда в каталоге будут решать хотя бы ${o.minSolvers} учеников школы (сейчас ${fmt(ov.solvers)})`,
    }
  }
  // Решающих достаточно, но меньше, чем у ученика, ни у кого: «0 %» не пишем.
  return { kind: 'none' }
}

export function summaryChips(o: CatalogOverview): Chip[] {
  const ov = o.overall
  if (!ov || ov.solved === 0) return []
  const chips: Chip[] = []
  if (ov.solved7d > 0) chips.push({ tone: 'ok', text: `+${fmt(ov.solved7d)} за неделю` })
  const strong = strongestLabel(o)
  if (strong) chips.push({ tone: 'acc', text: `сильнее всего: ${strong}` })
  const k = untouchedMine(o)
  if (k > 0) chips.push({ tone: 'mute', text: `не начаты: ${k} ${numbersWord(k)}` })
  return chips
}

export { fmt as formatCount }
