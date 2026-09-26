/**
 * §227. Таблица пробника в новом дизайне — чистая логика показа.
 *
 * Здесь нет новых данных: всё считается из той же таблицы клеток, итогов и
 * «набрано по номеру» (`lib/mockExamGrid`), что рисует экран. Поэтому вывод
 * над таблицей и сама таблица не могут разойтись — у них один источник, и
 * несохранённая правка меняет обе части сразу.
 */
import { plural } from '@/lib/plural'
import type { Cell, RowTotals, TaskStat } from '@/lib/mockExamGrid'

/**
 * Слабый номер — набрано меньше трети от максимума (макет: «набрано меньше
 * трети от максимума»). Сравнение точное (`got · 3 < of`), а не по
 * округлённому проценту: 33 % от 3 из 9 — ровно треть, не «меньше».
 * Номер, который никто не решал, слабым не считается — про него нечего сказать.
 */
export function isWeakTask(st: TaskStat): boolean {
  return st.count > 0 && st.of > 0 && st.got * 3 < st.of
}

/** Номера слабых заданий (с единицы). */
export function weakTasks(stats: TaskStat[]): number[] {
  return stats.flatMap((st, t) => (isWeakTask(st) ? [t + 1] : []))
}

export interface GridSummaryInput {
  totals: (RowTotals | null)[]
  stats: TaskStat[]
  /** Сколько учеников в группе. */
  roster: number
  /** Максимум первичных. */
  maxPrimary: number
  /** Есть ли у шаблона таблица перевода: тогда средний — тестовый. */
  hasScale: boolean
  /** Онлайн-пробник ещё не закрыт (не начался, идёт или догружают фото): баллов пока и не может быть. */
  lessonOpen?: boolean
}

/**
 * Вывод над таблицей: «Внесено 11 из 12. Средний — 70 тестовых баллов по 11
 * работам. Хуже всего решены №16, №17: набрано меньше трети от максимума.»
 *
 * * средний — всегда с подписью «по N работам» (честные цифры);
 * * тестовый — только при таблице перевода; первичный вне таблицы перевода
 *   тестового не имеет и в средний тестовый не входит — N считается по тем,
 *   у кого тестовый есть;
 * * фразы про слабые номера нет, если слабых нет.
 */
export function gridSummary({ totals, stats, roster, maxPrimary, hasScale, lessonOpen }: GridSummaryInput): string {
  const filled = totals.filter((r): r is RowTotals => r != null)
  if (!filled.length && lessonOpen) {
    return 'Баллов пока нет: первая часть проверится по ключу, когда ученики сдадут бланки, вторую впишете после проверки фото.'
  }
  if (!filled.length) {
    return `Ничего не внесено: у ${roster} ${plural(roster, 'ученика', 'учеников', 'учеников')} группы пока нет ни одного балла. Вставьте блок из Excel или впишите баллы по номерам.`
  }
  const parts = [`Внесено ${filled.length} из ${roster}.`]
  const avgLine = (avg: number, n: number, word: [string, string, string], tail = '') =>
    `Средний — ${avg} ${plural(avg, ...word)}${tail} по ${n} ${plural(n, 'работе', 'работам', 'работам')}.`
  const tests = hasScale ? filled.map(r => r.test).filter((x): x is number => x != null) : []
  if (hasScale && tests.length) {
    const avg = Math.round(tests.reduce((a, b) => a + b, 0) / tests.length)
    parts.push(avgLine(avg, tests.length, ['тестовый балл', 'тестовых балла', 'тестовых баллов']))
  } else {
    const avg = Math.round(filled.reduce((a, r) => a + r.primary, 0) / filled.length)
    parts.push(avgLine(avg, filled.length, ['первичный балл', 'первичных балла', 'первичных баллов'], ` из ${maxPrimary}`))
  }
  const weak = weakTasks(stats)
  if (weak.length) {
    const list = weak.map(n => `№${n}`).join(', ')
    parts.push(`Хуже всего ${weak.length === 1 ? 'решён' : 'решены'} ${list}: набрано меньше трети от максимума.`)
  }
  return parts.join(' ')
}

/**
 * Как выглядит клетка. Состояния — те же, что у метки проверки (§225), но
 * в клетке таблицы, где стоит число:
 *
 * * `full` — полный балл, без фона;
 * * `part` — часть балла: жёлтая заливка и черта снизу;
 * * `zero` — ноль: красная заливка и рамка;
 * * `unk`  — не сверено: пустая клетка первой части, которую ключ не проверил
 *   (сданный бланк или строка, уже проверенная ключом), — пунктир и «?»;
 * * `none` — не решено: пустая клетка в строке, где результат уже есть, — «—»;
 * * `empty` — строка без результата: ничего не рисуем;
 * * `err`  — не число или больше максимума — красное кольцо (как было).
 *
 * Форма различается и без цвета (печать ч/б): рамка, черта, пунктир, тире.
 */
export type CellLook = 'full' | 'part' | 'zero' | 'unk' | 'none' | 'empty' | 'err'

export function cellLook(c: Cell | undefined, max: number, o: { rowHasResult: boolean; awaitsCheck: boolean }): CellLook {
  if (c?.err) return 'err'
  if (!c || c.v == null) return o.awaitsCheck ? 'unk' : o.rowHasResult ? 'none' : 'empty'
  if (c.v === 0) return max === 0 ? 'full' : 'zero'
  if (c.v >= max) return 'full'
  return 'part'
}

/**
 * Пустая клетка первой части онлайн-пробника ждёт преподавателя, если бланк
 * ученика уже проверяли по ключу: он сдан или в строке есть «авто»-клетки.
 * Проверка по ключу ставит 0 за пустой ответ, поэтому пустой после неё
 * остаётся только ответ, который ключу не поддаётся (§221), — или ключа нет.
 */
export function awaitsKeyCheck(o: { lesson: boolean; task: number; part1Last: number; submitted: boolean; rowHasAuto: boolean }): boolean {
  return o.lesson && o.task < o.part1Last && (o.submitted || o.rowHasAuto)
}
