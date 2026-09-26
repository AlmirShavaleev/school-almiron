/**
 * §229. Варианты внутри одного пробника — чистая логика экранов.
 *
 * Правила доступа здесь не живут: кому какой файл выдать и что можно сменить,
 * решает база (PENDING_229.sql: mock_exam_file_readable, триггеры выдачи).
 * Здесь — раздача «кому какой» для таблицы на экране, пути файлов и то, что
 * сказать в чек-листе. Это UX, а не защита.
 */
import { sanitizeStorageFileName } from '@/lib/topicMaterialItems'
import { plural } from '@/lib/plural'

export type VariantFileKind = 'condition' | 'solution' | 'criteria'
export type VariantMode = 'order' | 'random' | 'manual'

/** `short` — подпись на телефоне: три «таблетки» должны встать в одну строку на 390. */
export const VARIANT_MODES: { key: VariantMode; label: string; short: string }[] = [
  { key: 'order', label: 'По очереди по списку', short: 'По очереди' },
  { key: 'random', label: 'Случайно', short: 'Случайно' },
  { key: 'manual', label: 'Вручную', short: 'Вручную' },
]

/** Сколько вариантов можно завести (в базе — до 30; больше на экране не нужно). */
export const MAX_VARIANTS = 8

export const FILE_KIND_LABEL: Record<VariantFileKind, string> = {
  condition: 'Вариант (условие)',
  solution: 'Решение',
  criteria: 'Критерии',
}

/**
 * Путь файла варианта: `<пробник>/v<номер>/<вид>/<время>_<имя>`. Второй и
 * третий сегменты держат политику бакета: условие ученику варианта N — с
 * начала, решение — после конца и отправки результата, критерии — никогда.
 */
export function variantFilePath(examId: string, position: number, kind: VariantFileKind, fileName: string, now: number = Date.now()): string {
  return `${examId}/v${position}/${kind}/${now}_${sanitizeStorageFileName(fileName)}`
}

/** «Вариант 2» или подпись, если её задали. */
export function variantName(v: { position: number; label?: string | null }): string {
  const l = (v.label ?? '').trim()
  return l || `Вариант ${v.position}`
}

export interface RosterStudent { id: string; name: string }

/** Ученики по алфавиту — тот же порядок, что в таблице баллов и в «Работах». */
export function byName<T extends { name: string }>(list: T[]): T[] {
  return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

/**
 * Кому какой вариант.
 *
 * * `order` — по списку (алфавит), по кругу: соседи по списку получают разные
 *   варианты (списать у соседа по парте труднее).
 * * `random` — случайный порядок, но поровну: каждому следующему — наименее
 *   занятый вариант (при равенстве — по кругу).
 * * `manual` — как стоит сейчас; кому не стоит ничего — по очереди.
 *
 * `locked` — у кого уже есть бланк или фото: вариант не меняется (база
 * откажет), он остаётся, а остальных раздача обходит. Возвращает номер
 * варианта (position) по id ученика.
 */
export function distributeVariants(
  students: RosterStudent[],
  positions: number[],
  mode: VariantMode,
  opts: { locked?: Record<string, number>; current?: Record<string, number>; rng?: () => number } = {},
): Record<string, number> {
  const out: Record<string, number> = {}
  const pos = positions.slice().sort((a, b) => a - b)
  if (pos.length === 0) return out
  const locked = opts.locked ?? {}
  const list = byName(students)
  for (const s of list) if (locked[s.id] != null) out[s.id] = locked[s.id]

  if (mode === 'order' || mode === 'manual') {
    list.forEach((s, i) => {
      if (out[s.id] != null) return
      const cur = mode === 'manual' ? opts.current?.[s.id] : undefined
      out[s.id] = cur != null && pos.includes(cur) ? cur : pos[i % pos.length]
    })
    return out
  }

  // random: перемешать свободных (Фишер — Йетс), дальше — наименее занятый.
  const rng = opts.rng ?? Math.random
  const free = list.filter(s => out[s.id] == null)
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[free[i], free[j]] = [free[j], free[i]]
  }
  const count = new Map(pos.map(p => [p, 0]))
  for (const p of Object.values(out)) if (count.has(p)) count.set(p, (count.get(p) ?? 0) + 1)
  let turn = 0
  for (const s of free) {
    const min = Math.min(...count.values())
    const candidates = pos.filter(p => count.get(p) === min)
    const p = candidates[turn % candidates.length]
    turn++
    out[s.id] = p
    count.set(p, (count.get(p) ?? 0) + 1)
  }
  return out
}

/** Сколько учеников на каждом варианте: `{1: 5, 2: 5, 3: 6}`. */
export function variantCounts(assign: Record<string, number>, positions: number[]): Record<number, number> {
  const out: Record<number, number> = Object.fromEntries(positions.map(p => [p, 0]))
  for (const p of Object.values(assign)) if (p in out) out[p]++
  return out
}

/** «5 учеников» — подпись в шапке карточки варианта. */
export function studentsLabel(n: number): string {
  return `${n} ${plural(n, 'ученик', 'ученика', 'учеников')}`
}

export interface VariantReady {
  position: number
  label?: string | null
  hasCondition: boolean
  hasSolution: boolean
  hasCriteria: boolean
  keyFilled: number
  keyTotal: number
}

/** Номера вариантов без условия — их нельзя назначать (у кого-то из учеников не будет заданий). */
export function missingConditions(vs: VariantReady[]): number[] {
  return vs.filter(v => !v.hasCondition).map(v => v.position)
}

export interface ReadyLine { state: 'ok' | 'todo' | 'later'; text: string }

/**
 * Строки чек-листа про варианты (справа от формы). Один вариант — как в
 * §228 (условие, ключ, решение) плюс критерии «можно позже». Несколько —
 * по каждому варианту без условия отдельная строка «Вариант 3: нет условия —
 * не назначить», ключи и решения — сводкой.
 */
export function variantReadiness(vs: VariantReady[]): ReadyLine[] {
  if (vs.length === 0) return [{ state: 'todo', text: 'Нет ни одного варианта' }]
  const lines: ReadyLine[] = []
  const keyTotal = vs[0].keyTotal
  if (vs.length === 1) {
    const v = vs[0]
    lines.push(v.hasCondition ? { state: 'ok', text: 'Условие загружено' } : { state: 'todo', text: 'Условие не загружено' })
    lines.push(keyLine(v.keyFilled, keyTotal))
    lines.push(v.hasSolution ? { state: 'ok', text: 'Решение загружено' } : { state: 'later', text: 'Решение — можно добавить позже' })
    lines.push(v.hasCriteria ? { state: 'ok', text: 'Критерии загружены' } : { state: 'later', text: 'Критерии — можно добавить позже' })
    return lines
  }
  const noCond = vs.filter(v => !v.hasCondition)
  if (noCond.length === 0) lines.push({ state: 'ok', text: `Условия: у всех ${vs.length} ${plural(vs.length, 'варианта', 'вариантов', 'вариантов')}` })
  for (const v of noCond) lines.push({ state: 'todo', text: `${variantName(v)}: нет условия — не назначить` })
  if (keyTotal === 0) lines.push({ state: 'later', text: 'Ключ — после выбора шаблона' })
  else {
    const full = vs.filter(v => v.keyFilled === keyTotal).length
    const empty = vs.filter(v => v.keyFilled === 0)
    if (full === vs.length) lines.push({ state: 'ok', text: `Ключи: у всех ${vs.length}, ${keyTotal} из ${keyTotal}` })
    else {
      const parts = vs.map(v => `${v.position} — ${v.keyFilled} из ${keyTotal}`).join(', ')
      lines.push({ state: empty.length > 0 ? 'later' : 'ok', text: `Ключи: ${parts} — пустые проверите вручную` })
    }
  }
  const sol = vs.filter(v => v.hasSolution).length
  lines.push(sol === vs.length ? { state: 'ok', text: 'Решения загружены у всех' } : { state: 'later', text: `Решения: ${sol} из ${vs.length} — можно позже` })
  const crit = vs.filter(v => v.hasCriteria).length
  lines.push(crit === vs.length ? { state: 'ok', text: 'Критерии загружены у всех' } : { state: 'later', text: `Критерии: ${crit} из ${vs.length} — можно позже` })
  return lines
}

function keyLine(filled: number, total: number): ReadyLine {
  if (total === 0) return { state: 'later', text: 'Ключ — после выбора шаблона' }
  if (filled === total) return { state: 'ok', text: `Ключ: ${filled} из ${total}` }
  if (filled > 0) return { state: 'ok', text: `Ключ: ${filled} из ${total} — пустые проверите вручную` }
  return { state: 'later', text: 'Ключ не внесён — первую часть проверите вручную' }
}

/** Файл с телефона — PDF? По типу, а если тип пустой — по имени. */
export function isPdfFile(f: { type?: string | null; name?: string | null; mime_type?: string | null; file_name?: string | null; storage_path?: string | null }): boolean {
  const type = (f.type ?? f.mime_type ?? '').toLowerCase()
  if (type === 'application/pdf') return true
  const name = f.name ?? f.file_name ?? f.storage_path ?? ''
  return /\.pdf$/i.test(name)
}
