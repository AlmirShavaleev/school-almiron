/**
 * §218. Пробник по номерам заданий: чистая логика таблицы.
 *
 * Перенесено из утверждённого владельцем макета (`МАКЕТ-ПРОБНИКА.html`, блок
 * `<script>`), а не написано заново по описанию: владелец вставил туда блок
 * из своего Excel и сказал «все хорошо». Имена функций совпадают с макетом
 * там, где это возможно (`parseVal` → `parseCell`, `norm` → `normName`,
 * `match` → `matchName`, `sums` → `rowTotals`), чтобы расхождение было видно
 * глазами при сверке.
 *
 * Здесь нет ни React, ни базы — только данные на входе и данные на выходе.
 * Состояние таблицы не мутируется: каждая вставка возвращает НОВУЮ таблицу,
 * поэтому «Отменить вставку» — это просто прежнее значение.
 *
 * Где разошлись с макетом — сознательно, в защитную сторону (главное правило
 * оркестратора: баллы не должны уехать не тому ученику):
 *
 *  1. Фамилия нашлась ровно у одного ученика, но имя в Excel ЕСТЬ и с ним не
 *     сходится («Белов Пётр» при «Белов Артём» в группе). Макет вставлял
 *     такую строку Артёму. Здесь — «имя не совпадает», строка не вставляется.
 *  2. Одного ученика в блоке нашли две строки. Макет вставлял первую и
 *     отклонял вторую. Но какая из двух настоящая, неизвестно: два «Иванов»
 *     без имени при одном Иванове в группе. Здесь не вставляется ни одна.
 *
 * На примере владельца из макета оба правила ничего не меняют — это
 * проверено тестом `mockExamGrid.test.ts` («блок владельца из макета»).
 */

/* ─────────────────────────────── Клетки ─────────────────────────────── */

/**
 * Клетка таблицы. `v === null` — «нет данных», а не ноль: ноль значит
 * «решал и не получил». Макет держал эти два случая раздельно, и отчёт
 * «набрано по номеру» на этом стоит.
 */
export interface Cell {
  raw: string
  v: number | null
  err: null | 'bad' | 'over'
}

export const EMPTY_CELL: Cell = Object.freeze({ raw: '', v: null, err: null }) as Cell

/** Макет: `parseVal`. Запятая как десятичный знак, пробелы по краям — не мешают. */
export function parseCell(raw: unknown, max: number): Cell {
  const s = String(raw == null ? '' : raw).trim().replace(',', '.')
  if (s === '') return { raw: '', v: null, err: null }
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0 || Math.round(n) !== n) return { raw: s, v: null, err: 'bad' }
  if (n > max) return { raw: s, v: n, err: 'over' }
  return { raw: s, v: n, err: null }
}

export type Grid = Cell[][]

export function emptyGrid(students: number, tasks: number): Grid {
  return Array.from({ length: students }, () => Array.from({ length: tasks }, () => EMPTY_CELL))
}

/** Сохранённые баллы (`null` — клетка пустая) → таблица клеток. */
export function gridFromPoints(points: (number | null)[][], maxPts: number[]): Grid {
  return points.map(row => maxPts.map((m, t) => {
    const v = row[t]
    return v == null ? EMPTY_CELL : parseCell(String(v), m)
  }))
}

/** Таблица клеток → то, что уезжает в базу. Только для таблицы без ошибок. */
export function gridToPoints(grid: Grid): (number | null)[][] {
  return grid.map(row => row.map(c => (c.err ? null : c.v)))
}

/** Красные клетки: «Не сохранено: N клеток обведены красным». */
export interface CellRef { s: number; t: number }
export function gridErrors(grid: Grid): CellRef[] {
  const out: CellRef[] = []
  grid.forEach((row, s) => row.forEach((c, t) => { if (c.err) out.push({ s, t }) }))
  return out
}

/* ─────────────────────────────── Итоги ──────────────────────────────── */

/**
 * Перевод первичного балла в тестовый. Таблица перевода — массив, индекс =
 * первичный балл. Таблицы нет — тестовый равен первичному (так велит
 * карточка: отчёт для родителя тогда хотя бы не пустой). Первичный вне
 * таблицы — `null`, а не выдуманное число.
 */
export function toTestScore(primary: number | null, scale: number[] | null | undefined): number | null {
  if (primary == null) return null
  if (!scale || scale.length === 0) return primary
  const v = scale[primary]
  return v == null ? null : v
}

export interface RowTotals { p1: number; p2: number; primary: number; test: number | null }

/**
 * Макет: `sums`. Итог строки — только если в ней есть хоть одна клетка с
 * числом; строка из одних пустых клеток итога не имеет вовсе («нет
 * данных»), а не «0 баллов». Клетка «больше максимума» в сумму идёт
 * урезанной до максимума, «не число» — не идёт (как в макете); сохранить
 * таблицу с такими клетками всё равно нельзя.
 *
 * `p1End` — номер последнего задания первой части (в макете `p1End = 12`,
 * индекс `t < p1End` — первая часть).
 */
export function rowTotals(row: Cell[], maxPts: number[], p1End: number, scale?: number[] | null): RowTotals | null {
  let p1 = 0, p2 = 0, any = false
  row.forEach((c, t) => {
    if (c.v != null && c.err !== 'bad') {
      any = true
      const v = Math.min(c.v, maxPts[t] ?? 0)
      if (t < p1End) p1 += v; else p2 += v
    }
  })
  if (!any) return null
  const primary = p1 + p2
  return { p1, p2, primary, test: toTestScore(primary, scale) }
}

/** Ступени подсветки «набрано по номеру»: <40, 40–60, 60–80, ≥80 %. */
export type HeatLevel = 0 | 1 | 2 | 3
export function heatLevel(pct: number): HeatLevel {
  return pct < 40 ? 0 : pct < 60 ? 1 : pct < 80 ? 2 : 3
}

export interface TaskStat {
  /** Сколько учеников решали номер (клетка не пустая). */
  count: number
  got: number
  /** `count × максимум` — из скольких набрано. */
  of: number
  /** Процент от максимума; `null` — никто не решал или максимум 0. */
  pct: number | null
  level: HeatLevel | null
}

/**
 * Макет: нижняя строка «набрано по номеру». Считается ТОЛЬКО по тем, у кого
 * клетка заполнена: пустая клетка — «нет данных» и в знаменатель не идёт,
 * иначе недозаполненная таблица показывала бы провал по всем номерам.
 */
export function taskStats(grid: Grid, maxPts: number[]): TaskStat[] {
  return maxPts.map((m, t) => {
    let got = 0, count = 0
    for (const row of grid) {
      const c = row[t]
      if (c && c.v != null && c.err !== 'bad') { got += Math.min(c.v, m); count++ }
    }
    const of = count * m
    if (!count || of === 0) return { count, got, of, pct: null, level: null }
    const pct = Math.round(got / of * 100)
    return { count, got, of, pct, level: heatLevel(pct) }
  })
}

/** Макет: «ср. N» под итогами — по тем строкам, у которых итог есть. */
export function averageTotals(totals: (RowTotals | null)[]): { p1: number; p2: number; primary: number; test: number | null } | null {
  const filled = totals.filter((r): r is RowTotals => r != null)
  if (!filled.length) return null
  const avg = (k: 'p1' | 'p2' | 'primary') => Math.round(filled.reduce((a, r) => a + r[k], 0) / filled.length)
  const tests = filled.map(r => r.test).filter((x): x is number => x != null)
  return {
    p1: avg('p1'),
    p2: avg('p2'),
    primary: avg('primary'),
    test: tests.length ? Math.round(tests.reduce((a, b) => a + b, 0) / tests.length) : null,
  }
}

/* ──────────────────────── Сопоставление по фамилии ─────────────────────── */

/** Макет: `norm`. Регистр, «ё» = «е», точки/запятые и лишние пробелы не мешают. */
export function normName(x: string): string {
  return String(x).toLowerCase().replace(/ё/g, 'е').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface RosterKey { sur: string; first: string }

/** Ростер «Фамилия Имя [Отчество]» — так имя вводится при регистрации (`ФИО`, «Иванов Иван Иванович»). */
export function rosterKeys(roster: string[]): RosterKey[] {
  return roster.map(n => { const p = normName(n).split(' '); return { sur: p[0] ?? '', first: p[1] ?? '' } })
}

export type NameMatch =
  | { kind: 'ok'; i: number }
  | { kind: 'none' }
  | { kind: 'ambiguous'; options: number[] }
  | { kind: 'mismatch'; options: number[] }

/**
 * Макет: `match`. Фамилия — первое слово, имя — второе, и имя сверяется
 * по НАЧАЛУ («Иванов К.» → Кирилл).
 *
 * Отличие от макета одно (см. шапку файла): при единственном однофамильце
 * имя, если оно написано, тоже обязано сойтись.
 */
export function matchName(name: string, keys: RosterKey[]): NameMatch {
  const p = normName(name).split(' ')
  const sur = p[0] ?? '', first = p[1] ?? ''
  if (!sur) return { kind: 'none' }
  const byS: number[] = []
  keys.forEach((r, i) => { if (r.sur === sur) byS.push(i) })
  if (!byS.length) return { kind: 'none' }
  if (!first) return byS.length === 1 ? { kind: 'ok', i: byS[0] } : { kind: 'ambiguous', options: byS }
  const byF = byS.filter(i => keys[i].first.indexOf(first) === 0)
  if (byF.length === 1) return { kind: 'ok', i: byF[0] }
  if (byF.length === 0) return byS.length === 1 ? { kind: 'mismatch', options: byS } : { kind: 'ambiguous', options: byS }
  return { kind: 'ambiguous', options: byF }
}

/* ─────────────────────────────── Вставка ─────────────────────────────── */

/** Макет: `isNumberLike`. Пустая клетка — тоже «похоже на число». */
export function isNumberLike(x: string): boolean {
  const s = String(x).trim().replace(',', '.')
  return s === '' || Number.isFinite(Number(s))
}

/** Текст из буфера (Excel: табы и переводы строк) → строки клеток. */
export function parseClipboard(text: string): string[][] {
  return String(text ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .filter(r => r.trim() !== '')
    .map(r => r.split('\t'))
}

/** Блок с фамилиями — если первая клетка первой строки не число. */
export function hasNames(rows: string[][]): boolean {
  return rows.length > 0 && !isNumberLike(rows[0][0] ?? '')
}

export interface PasteProblemCell { student: string; task: number; value: string; kind: 'bad' | 'over'; max: number }

export interface NamedPasteReport {
  mode: 'named'
  /** Сопоставлено: как было написано в Excel → кому вставлено. */
  ok: { from: string; to: string }[]
  /** Такой фамилии в группе нет. Баллы не вставлены никуда. */
  none: string[]
  /** Однофамильцы, имя не помогло (или его нет). Не вставлено. */
  ambiguous: { name: string; options: string[] }[]
  /** Фамилия одна на группу, но имя в Excel другое. Не вставлено. */
  mismatch: { name: string; options: string[] }[]
  /** Один ученик найден несколькими строками блока. Не вставлена ни одна из них. */
  duplicates: { to: string; rows: string[] }[]
  /** Вставленные клетки с ошибками — обведены красным. */
  problems: PasteProblemCell[]
  /** На сколько значений строка длиннее, чем заданий в пробнике (максимум по строкам). */
  extra: number
}

export interface PositionalPasteReport {
  mode: 'positional'
  inserted: number
  /** Клетки блока, которые не поместились в таблицу справа или снизу. */
  outside: number
  problems: PasteProblemCell[]
}

export type PasteReport = NamedPasteReport | PositionalPasteReport

function setCells(grid: Grid, updates: { s: number; t: number; raw: string }[], maxPts: number[]): Grid {
  if (!updates.length) return grid
  const next = grid.map(r => r.slice())
  for (const u of updates) {
    next[u.s] ??= maxPts.map(() => EMPTY_CELL)
    next[u.s][u.t] = parseCell(u.raw, maxPts[u.t])
  }
  return next
}

function problemsOf(grid: Grid, cells: { s: number; t: number }[], roster: string[], maxPts: number[]): PasteProblemCell[] {
  const out: PasteProblemCell[] = []
  for (const { s, t } of cells) {
    const c = grid[s][t]
    if (c.err) out.push({ student: roster[s], task: t + 1, value: c.raw, kind: c.err, max: maxPts[t] })
  }
  return out
}

/**
 * Макет: `pasteNamed`. Строки блока сопоставляются по фамилии; кого не
 * узнали — в отчёт, и их баллы не попадают НИКУДА. Пустая клетка в строке
 * блока стирает клетку таблицы — как в Excel.
 */
export function pasteNamed(grid: Grid, rows: string[][], roster: string[], maxPts: number[]): { grid: Grid; report: NamedPasteReport } {
  const keys = rosterKeys(roster)
  const report: NamedPasteReport = { mode: 'named', ok: [], none: [], ambiguous: [], mismatch: [], duplicates: [], problems: [], extra: 0 }

  // Первый проход — только сопоставление. Вставлять сразу нельзя: повтор
  // ученика ниже в блоке отменяет и строку выше (см. шапку файла).
  const hits: { i: number; name: string; vals: string[] }[] = []
  for (const r of rows) {
    const name = (r[0] ?? '').trim()
    const vals = r.slice(1)
    const m = matchName(name, keys)
    if (m.kind === 'none') { report.none.push(name); continue }
    if (m.kind === 'ambiguous') { report.ambiguous.push({ name, options: m.options.map(i => roster[i]) }); continue }
    if (m.kind === 'mismatch') { report.mismatch.push({ name, options: m.options.map(i => roster[i]) }); continue }
    hits.push({ i: m.i, name, vals })
  }

  const byStudent = new Map<number, typeof hits>()
  for (const h of hits) byStudent.set(h.i, [...(byStudent.get(h.i) ?? []), h])

  const updates: { s: number; t: number; raw: string }[] = []
  for (const h of hits) {
    const same = byStudent.get(h.i)!
    if (same.length > 1) {
      if (same[0] === h) report.duplicates.push({ to: roster[h.i], rows: same.map(x => x.name) })
      continue
    }
    if (h.vals.length > maxPts.length) report.extra = Math.max(report.extra, h.vals.length - maxPts.length)
    h.vals.slice(0, maxPts.length).forEach((v, t) => updates.push({ s: h.i, t, raw: v }))
    report.ok.push({ from: h.name, to: roster[h.i] })
  }

  const next = setCells(grid, updates, maxPts)
  report.problems = problemsOf(next, updates, roster, maxPts)
  return { grid: next, report }
}

/** Макет: `pastePositional`. Как в Excel: от выбранной клетки вправо и вниз. */
export function pastePositional(grid: Grid, rows: string[][], s0: number, t0: number, roster: string[], maxPts: number[]): { grid: Grid; report: PositionalPasteReport } {
  const updates: { s: number; t: number; raw: string }[] = []
  let outside = 0
  rows.forEach((r, dr) => r.forEach((v, dt) => {
    const s = s0 + dr, t = t0 + dt
    if (s < roster.length && t < maxPts.length) updates.push({ s, t, raw: v })
    else outside++
  }))
  const next = setCells(grid, updates, maxPts)
  return { grid: next, report: { mode: 'positional', inserted: updates.length, outside, problems: problemsOf(next, updates, roster, maxPts) } }
}

/**
 * Одна точка входа для обработчика `paste`: сама решает, с фамилиями блок
 * или без. `at` — клетка, с которой начинается вставка без фамилий;
 * `null` — с левой верхней клетки, как в макете. Экран, когда фокус стоит в
 * столбце «Ученик», передаёт `{ s: эта строка, t: 0 }`.
 */
export function applyPaste(grid: Grid, text: string, at: { s: number; t: number } | null, roster: string[], maxPts: number[]): { grid: Grid; report: PasteReport } | null {
  const rows = parseClipboard(text)
  if (!rows.length) return null
  if (hasNames(rows)) return pasteNamed(grid, rows, roster, maxPts)
  return pastePositional(grid, rows, at?.s ?? 0, at?.t ?? 0, roster, maxPts)
}

/* ──────────────────────── Таблица перевода из Excel ───────────────────── */

export interface ScaleParse { scale: number[] | null; error: string | null }

/**
 * Таблица перевода «первичный → тестовый», вставленная столбцом из Excel.
 * Тот же разбор буфера, что у таблицы баллов. Понимает два вида:
 *   * один столбец тестовых баллов, строка = первичный 0, 1, 2, …;
 *   * два столбца «первичный ⇥ тестовый» (как в официальной таблице).
 * Строка-заголовок с текстом пропускается.
 *
 * Правила — те же, что в базе (`mock_exam_template_scale_ok`): длина ровно
 * «максимум первичных + 1», целые, не отрицательные, не убывают.
 */
export function parseScale(text: string, maxPrimary: number): ScaleParse {
  let rows = parseClipboard(text).map(r => r.map(x => x.trim()).filter(x => x !== ''))
  rows = rows.filter(r => r.length > 0)
  if (rows.length && !isNumberLike(rows[0][0])) rows = rows.slice(1)
  if (!rows.length) return { scale: null, error: 'Пусто: вставьте столбец тестовых баллов' }

  const toInt = (x: string) => { const s = x.replace(',', '.'); const n = Number(s); return Number.isInteger(n) ? n : NaN }
  const twoCols = rows.every(r => r.length >= 2)
  const values: number[] = []
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k]
    if (twoCols) {
      const primary = toInt(r[0])
      if (primary !== k) return { scale: null, error: `Строка ${k + 1}: первичный балл ${r[0]}, ожидался ${k} — строки должны идти подряд с нуля` }
    }
    const v = toInt(twoCols ? r[1] : r[0])
    if (!Number.isFinite(v) || v < 0) return { scale: null, error: `Строка ${k + 1}: «${twoCols ? r[1] : r[0]}» — не целое неотрицательное число` }
    values.push(v)
  }
  const check = checkScale(values, maxPrimary)
  return check ? { scale: null, error: check } : { scale: values, error: null }
}

/** `null` — таблица годится; иначе — что с ней не так, словами. */
export function checkScale(scale: number[], maxPrimary: number): string | null {
  if (scale.length !== maxPrimary + 1) {
    return `Строк ${scale.length}, а нужно ${maxPrimary + 1}: по одной на каждый первичный балл от 0 до ${maxPrimary}`
  }
  for (let k = 0; k < scale.length; k++) {
    if (!Number.isInteger(scale[k]) || scale[k] < 0) return `Первичный ${k}: тестовый балл должен быть целым и не отрицательным`
    if (k > 0 && scale[k] < scale[k - 1]) return `Первичный ${k}: тестовый ${scale[k]} меньше, чем у ${k - 1} (${scale[k - 1]}) — таблица не может убывать`
  }
  return null
}

/* ─────────────────────────────── Уведомления ─────────────────────────── */

export interface SavedTotal { student_id: string; old_score: number | null; score: number | null }

/**
 * Кому слать «результат пробника» после сохранения: только тем, у кого итог
 * ПОЯВИЛСЯ или ИЗМЕНИЛСЯ. Раньше слалось всем заполненным строкам при каждом
 * сохранении — правка одной опечатки будила всю группу. Итог стёрли — не
 * шлём: «ваш результат удалён» никто не просил.
 *
 * Старое значение приходит ИЗ БАЗЫ, из той же транзакции, что записала
 * новое (`save_mock_exam_grid`), а не из памяти экрана: экран мог открыться
 * до того, как соседний преподаватель сохранил свою правку.
 */
export function totalsToNotify(saved: SavedTotal[]): { student_id: string; score: number }[] {
  return saved
    .filter((r): r is SavedTotal & { score: number } => r.score != null && r.score !== r.old_score)
    .map(r => ({ student_id: r.student_id, score: r.score }))
}
