/**
 * §227. Вывод над таблицей пробника и вид клеток — из тех же данных, что
 * таблица (`lib/mockExamGrid`): здесь проверяется, что слова совпадают с
 * числами, а не отдельный подсчёт.
 */
import { describe, expect, it } from 'vitest'
import { gridFromPoints, rowTotals, taskStats, type RowTotals } from '@/lib/mockExamGrid'
import { awaitsKeyCheck, cellLook, gridSummary, isWeakTask, weakTasks } from '@/lib/mockExamGridView'

const MAX = [1, 1, 2, 3]
const P1 = 2

function summaryOf(points: (number | null)[][], scale: number[] | null = null) {
  const grid = gridFromPoints(points, MAX)
  const totals = grid.map(r => rowTotals(r, MAX, P1, scale))
  return gridSummary({ totals, stats: taskStats(grid, MAX), roster: points.length, maxPrimary: 7, hasScale: !!scale })
}

describe('weakTasks — меньше трети от максимума', () => {
  it('ровно треть — не слабый; никто не решал — не слабый', () => {
    const stats = taskStats(gridFromPoints([[1, 0, 0, 1], [1, 0, null, null]], MAX), MAX)
    // №1 2/2, №2 0/2, №3 0/2, №4 1/3 (ровно треть).
    expect(stats.map(isWeakTask)).toEqual([false, true, true, false])
    expect(weakTasks(taskStats(gridFromPoints([[null, null, null, null]], MAX), MAX))).toEqual([])
  })
})

describe('gridSummary', () => {
  it('без таблицы перевода — первичный из максимума, «по N работам», слабые номера', () => {
    expect(summaryOf([[1, 0, 2, 3], [1, 0, 0, 3], [null, null, null, null]]))
      .toBe('Внесено 2 из 3. Средний — 5 первичных баллов из 7 по 2 работам. Хуже всего решён №2: набрано меньше трети от максимума.')
  })

  it('слабых нет — фразы нет', () => {
    expect(summaryOf([[1, 1, 2, 3]])).toBe('Внесено 1 из 1. Средний — 7 первичных баллов из 7 по 1 работе.')
  })

  it('с таблицей перевода — тестовый; первичный вне таблицы в средний не входит и N считает честно', () => {
    const scale = [0, 10, 20, 30, 40, 50, 60, 70]
    expect(summaryOf([[1, 1, 0, 0], [1, 1, 2, 0]], scale))
      .toBe('Внесено 2 из 2. Средний — 30 тестовых баллов по 2 работам. Хуже всего решён №4: набрано меньше трети от максимума.')
    const totals: (RowTotals | null)[] = [{ p1: 1, p2: 0, primary: 1, test: 21 }, { p1: 2, p2: 5, primary: 7, test: null }]
    expect(gridSummary({ totals, stats: [], roster: 2, maxPrimary: 7, hasScale: true }))
      .toBe('Внесено 2 из 2. Средний — 21 тестовый балл по 1 работе.')
  })

  it('ничего не внесено — так и сказано, без среднего', () => {
    expect(summaryOf([[null, null, null, null], [null, null, null, null]])).toMatch(/^Ничего не внесено/)
  })
})

describe('cellLook и awaitsKeyCheck', () => {
  const c = (raw: string, max: number) => gridFromPoints([[raw === '' ? null : Number(raw)]], [max])[0][0]
  it('полный, частично, ноль — по баллу и максимуму', () => {
    const o = { rowHasResult: true, awaitsCheck: false }
    expect(cellLook(c('3', 3), 3, o)).toBe('full')
    expect(cellLook(c('1', 3), 3, o)).toBe('part')
    expect(cellLook(c('0', 3), 3, o)).toBe('zero')
  })
  it('пустая: ждёт ключа → «?», строка с результатом → «—», иначе пусто; ошибка — err', () => {
    expect(cellLook(undefined, 1, { rowHasResult: true, awaitsCheck: true })).toBe('unk')
    expect(cellLook(undefined, 1, { rowHasResult: true, awaitsCheck: false })).toBe('none')
    expect(cellLook(undefined, 1, { rowHasResult: false, awaitsCheck: false })).toBe('empty')
    expect(cellLook({ raw: '5', v: 5, err: 'over' }, 3, { rowHasResult: true, awaitsCheck: false })).toBe('err')
  })
  it('«не сверено» — только первая часть онлайн-пробника у проверенного ключом или сданного бланка', () => {
    const base = { lesson: true, task: 3, part1Last: 12, submitted: true, rowHasAuto: false }
    expect(awaitsKeyCheck(base)).toBe(true)
    expect(awaitsKeyCheck({ ...base, submitted: false, rowHasAuto: true })).toBe(true)
    expect(awaitsKeyCheck({ ...base, submitted: false })).toBe(false)
    expect(awaitsKeyCheck({ ...base, task: 12 })).toBe(false)
    expect(awaitsKeyCheck({ ...base, lesson: false })).toBe(false)
  })
})

describe('gridSummary у открытого онлайн-пробника', () => {
  it('баллов нет, пробник идёт — не зовёт вставлять, говорит, откуда баллы появятся', () => {
    expect(gridSummary({ totals: [null], stats: [], roster: 1, maxPrimary: 7, hasScale: false, lessonOpen: true })).toMatch(/^Баллов пока нет: первая часть проверится по ключу/)
  })
})
