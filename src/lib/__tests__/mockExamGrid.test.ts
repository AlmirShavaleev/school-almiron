/**
 * §218. Чистая логика таблицы пробника по номерам заданий.
 *
 * Данные — из утверждённого макета (`МАКЕТ-ПРОБНИКА.html`): тот же ростер, та же
 * раскладка профильной математики, тот же «пример из Excel» с подвохами.
 * Если здесь что-то покраснело, сначала сверить с макетом: правила обязаны
 * совпадать с тем, что видел владелец.
 */
import { describe, expect, it } from 'vitest'
import {
  applyPaste,
  averageTotals,
  checkScale,
  emptyGrid,
  gridErrors,
  gridFromPoints,
  gridToPoints,
  hasNames,
  heatLevel,
  matchName,
  normName,
  parseCell,
  parseClipboard,
  parseScale,
  pasteNamed,
  pastePositional,
  rosterKeys,
  rowTotals,
  taskStats,
  toTestScore,
  totalsToNotify,
  type Grid,
  type NamedPasteReport,
  type PositionalPasteReport,
} from '@/lib/mockExamGrid'

// Макет: maxPts и roster.
const MAX = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 2, 2, 3, 4, 4]
const P1_END = 12
const ROSTER = [
  'Абрамова Дарья', 'Белов Артём', 'Гарипов Тимур', 'Ёлкина Мария', 'Иванов Иван', 'Иванов Кирилл',
  'Каримова Алсу', 'Лебедев Максим', 'Мухаметзянов Ренат', 'Никитина Полина', 'Сафин Амир', 'Шарипова Лейла',
]
const idx = (name: string) => ROSTER.indexOf(name)

// Макет: sampleText — «нарочно с подвохами».
const OWNER_SAMPLE = [
  'Абрамова Д.\t1\t1\t1\t0\t1\t1\t1\t1\t0\t1\t1\t1\t2\t1\t2\t0\t1\t0\t0',
  'Белов Артём\t1\t1\t1\t1\t1\t1\t0\t1\t1\t1\t1\t1\t1\t2\t1\t1\t0\t1\t0',
  'Елкина Мария\t1\t1\t0\t1\t1\t1\t1\t1\t1\t0\t1\t1\t2\t3\t2\t2\t1\t2\t1',
  'Иванов К.\t1\t1\t1\t1\t0\t1\t1\t0\t1\t1\t1\t0\t0\t1\t0\t1\t0\t0\t0',
  'Иванов\t1\t0\t1\t1\t1\t1\t1\t1\t1\t1\t0\t1\t2\t2\t1\t1\t1\t0\t0',
  'Петров Олег\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t2\t3\t2\t2\t3\t4\t4',
  '  Сафин   Амир \t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t2\t4\t2\t2\t2\t1\t1',
].join('\n')

const blank = () => emptyGrid(ROSTER.length, MAX.length)
const row = (g: Grid, name: string) => g[idx(name)].map(c => c.raw)

describe('parseCell — клетка', () => {
  it('пустая клетка — «нет данных», а не ноль', () => {
    expect(parseCell('', 2)).toEqual({ raw: '', v: null, err: null })
    expect(parseCell('   ', 2).v).toBeNull()
    expect(parseCell(null, 2).v).toBeNull()
  })
  it('ноль — это число: «решал и не получил»', () => {
    expect(parseCell('0', 2)).toEqual({ raw: '0', v: 0, err: null })
  })
  it('запятая и пробелы по краям не мешают', () => {
    expect(parseCell(' 2 ', 2)).toEqual({ raw: '2', v: 2, err: null })
    expect(parseCell('2,0', 2)).toEqual({ raw: '2.0', v: 2, err: null })
  })
  it('выше максимума — «over», значение сохраняется для подсказки', () => {
    expect(parseCell('4', 3)).toEqual({ raw: '4', v: 4, err: 'over' })
  })
  it('не число, дробь, минус — «bad»', () => {
    expect(parseCell('абв', 3).err).toBe('bad')
    expect(parseCell('1.5', 3).err).toBe('bad')
    expect(parseCell('-1', 3).err).toBe('bad')
    expect(parseCell('12abc', 20).err).toBe('bad')
  })
})

describe('matchName — сопоставление по фамилии (правила макета)', () => {
  const keys = rosterKeys(ROSTER)
  it('полное совпадение', () => {
    expect(matchName('Белов Артём', keys)).toEqual({ kind: 'ok', i: idx('Белов Артём') })
  })
  it('регистр не мешает', () => {
    expect(matchName('БЕЛОВ артём', keys)).toEqual({ kind: 'ok', i: idx('Белов Артём') })
  })
  it('«ё» = «е» в обе стороны', () => {
    expect(matchName('Елкина Мария', keys)).toEqual({ kind: 'ok', i: idx('Ёлкина Мария') })
    expect(matchName('Белов Артем', keys)).toEqual({ kind: 'ok', i: idx('Белов Артём') })
  })
  it('точки и лишние пробелы не мешают', () => {
    expect(matchName('  Сафин   Амир ', keys)).toEqual({ kind: 'ok', i: idx('Сафин Амир') })
    expect(matchName('Абрамова Д.', keys)).toEqual({ kind: 'ok', i: idx('Абрамова Дарья') })
    expect(normName('Иванов.К.')).toBe('иванов к')
  })
  it('фамилия без имени при единственном ученике с ней', () => {
    expect(matchName('Каримова', keys)).toEqual({ kind: 'ok', i: idx('Каримова Алсу') })
  })
  it('два однофамильца: уточняет начало имени', () => {
    expect(matchName('Иванов К.', keys)).toEqual({ kind: 'ok', i: idx('Иванов Кирилл') })
    expect(matchName('Иванов Ив', keys)).toEqual({ kind: 'ok', i: idx('Иванов Иван') })
  })
  it('два однофамильца без имени — неоднозначно', () => {
    expect(matchName('Иванов', keys)).toEqual({ kind: 'ambiguous', options: [idx('Иванов Иван'), idx('Иванов Кирилл')] })
  })
  it('два однофамильца, имя не подошло ни к одному — неоднозначно', () => {
    expect(matchName('Иванов Олег', keys).kind).toBe('ambiguous')
  })
  it('два ученика с одинаковыми фамилией и именем — неоднозначно всегда', () => {
    const twins = rosterKeys(['Иванов Иван Петрович', 'Иванов Иван Сергеевич'])
    expect(matchName('Иванов Иван', twins).kind).toBe('ambiguous')
    expect(matchName('Иванов И.', twins).kind).toBe('ambiguous')
  })
  it('фамилии нет в группе — не найден', () => {
    expect(matchName('Петров Олег', keys)).toEqual({ kind: 'none' })
    expect(matchName('', keys)).toEqual({ kind: 'none' })
  })
  it('§218, строже макета: фамилия одна, но имя в Excel другое — не вставлять', () => {
    expect(matchName('Белов Пётр', keys)).toEqual({ kind: 'mismatch', options: [idx('Белов Артём')] })
  })
  it('ростер с отчеством: имя — второе слово', () => {
    const k = rosterKeys(['Хабибуллина Динара Рустемовна'])
    expect(matchName('Хабибуллина Д.', k)).toEqual({ kind: 'ok', i: 0 })
  })
})

describe('разбор буфера', () => {
  it('табы, \\r\\n и пустые строки в конце — как отдаёт Excel', () => {
    expect(parseClipboard('1\t0\r\n0\t1\r\n\r\n')).toEqual([['1', '0'], ['0', '1']])
  })
  it('блок с фамилиями — если первая клетка не число', () => {
    expect(hasNames(parseClipboard('Белов\t1'))).toBe(true)
    expect(hasNames(parseClipboard('1\t1'))).toBe(false)
    expect(hasNames(parseClipboard('\t1'))).toBe(false)
  })
})

describe('pasteNamed — блок владельца из макета', () => {
  const { grid, report } = applyPaste(blank(), OWNER_SAMPLE, null, ROSTER, MAX)! as { grid: Grid; report: NamedPasteReport }

  it('сопоставлено 5 из 7, как на макете', () => {
    expect(report.mode).toBe('named')
    expect(report.ok.map(o => o.to)).toEqual(['Абрамова Дарья', 'Белов Артём', 'Ёлкина Мария', 'Иванов Кирилл', 'Сафин Амир'])
  })
  it('«Петров Олег» — не найден, и его баллы не легли НИКУДА', () => {
    expect(report.none).toEqual(['Петров Олег'])
    // Строка Петрова — единственная с 3/4/4 в конце; ни у кого таких нет.
    for (const r of grid) expect(r.slice(16).map(c => c.raw)).not.toEqual(['3', '4', '4'])
  })
  it('«Иванов» — неоднозначно, и ни одному Иванову не вставлено то, что было в его строке', () => {
    expect(report.ambiguous).toEqual([{ name: 'Иванов', options: ['Иванов Иван', 'Иванов Кирилл'] }])
    expect(row(grid, 'Иванов Иван').every(x => x === '')).toBe(true)
    // Кириллу — ЕГО строка («Иванов К.»), а не строка «Иванов».
    expect(row(grid, 'Иванов Кирилл').slice(0, 3)).toEqual(['1', '1', '1'])
    expect(row(grid, 'Иванов Кирилл')[1]).toBe('1')
  })
  it('балл выше максимума у Сафина (№14: 4 при максимуме 3) — вставлен и обведён красным', () => {
    expect(report.problems).toEqual([{ student: 'Сафин Амир', task: 14, value: '4', kind: 'over', max: 3 }])
    expect(grid[idx('Сафин Амир')][13].err).toBe('over')
    expect(gridErrors(grid)).toEqual([{ s: idx('Сафин Амир'), t: 13 }])
  })
  it('те, кого в блоке не было, не тронуты', () => {
    expect(row(grid, 'Никитина Полина').every(x => x === '')).toBe(true)
  })
  it('исходная таблица не изменилась — отмена вставки это прежнее значение', () => {
    const before = blank()
    const res = pasteNamed(before, parseClipboard(OWNER_SAMPLE), ROSTER, MAX)
    expect(res.grid).not.toBe(before)
    expect(gridErrors(before)).toEqual([])
    expect(before.every(r => r.every(c => c.raw === ''))).toBe(true)
  })
})

describe('pasteNamed — остальные подвохи', () => {
  it('одна фамилия дважды в блоке — не вставлена ни одна из строк (строже макета)', () => {
    const { grid, report } = pasteNamed(blank(), parseClipboard('Белов\t1\t1\nБелов Артём\t0\t0'), ROSTER, MAX)
    expect(report.ok).toEqual([])
    expect(report.duplicates).toEqual([{ to: 'Белов Артём', rows: ['Белов', 'Белов Артём'] }])
    expect(row(grid, 'Белов Артём').every(x => x === '')).toBe(true)
  })
  it('повтор не мешает остальным строкам блока', () => {
    const { report } = pasteNamed(blank(), parseClipboard('Белов\t1\nСафин\t1\nБелов\t1'), ROSTER, MAX)
    expect(report.ok.map(o => o.to)).toEqual(['Сафин Амир'])
    expect(report.duplicates).toHaveLength(1)
  })
  it('лишние столбцы отброшены с предупреждением', () => {
    const line = 'Сафин\t' + Array(MAX.length + 3).fill('1').join('\t')
    const { grid, report } = pasteNamed(blank(), parseClipboard(line), ROSTER, MAX)
    expect(report.extra).toBe(3)
    expect(grid[idx('Сафин Амир')]).toHaveLength(MAX.length)
  })
  it('имя не совпало — строка не вставлена и видна в отчёте', () => {
    const { grid, report } = pasteNamed(blank(), parseClipboard('Белов Пётр\t1\t1'), ROSTER, MAX)
    expect(report.mismatch).toEqual([{ name: 'Белов Пётр', options: ['Белов Артём'] }])
    expect(row(grid, 'Белов Артём').every(x => x === '')).toBe(true)
  })
  it('пустая клетка в строке блока стирает клетку таблицы — как в Excel', () => {
    const start = gridFromPoints(ROSTER.map((_, s) => MAX.map(() => (s === idx('Сафин Амир') ? 1 : null))), MAX)
    const { grid } = pasteNamed(start, parseClipboard('Сафин\t\t0'), ROSTER, MAX)
    expect(grid[idx('Сафин Амир')][0].v).toBeNull()
    expect(grid[idx('Сафин Амир')][1].v).toBe(0)
    expect(grid[idx('Сафин Амир')][2].v).toBe(1)
  })
})

describe('pastePositional — без фамилий, от выбранной клетки', () => {
  it('вправо и вниз от клетки', () => {
    const { grid, report } = applyPaste(blank(), '1\t0\n0\t1', { s: 2, t: 5 }, ROSTER, MAX)! as { grid: Grid; report: PositionalPasteReport }
    expect(report).toMatchObject({ mode: 'positional', inserted: 4, outside: 0 })
    expect(grid[2][5].v).toBe(1)
    expect(grid[2][6].v).toBe(0)
    expect(grid[3][5].v).toBe(0)
    expect(grid[3][6].v).toBe(1)
    expect(grid[2][4].v).toBeNull()
  })
  it('что не поместилось справа и снизу — отброшено и посчитано', () => {
    const { report } = pastePositional(blank(), parseClipboard('1\t1\t1'), ROSTER.length - 1, MAX.length - 1, ROSTER, MAX)
    expect(report.inserted).toBe(1)
    expect(report.outside).toBe(2)
  })
  it('ошибки вставленных клеток — в отчёте', () => {
    const { report } = pastePositional(blank(), parseClipboard('5'), 0, 12, ROSTER, MAX)
    expect(report.problems).toEqual([{ student: ROSTER[0], task: 13, value: '5', kind: 'over', max: 2 }])
  })
  it('пустой буфер — ничего не делаем', () => {
    expect(applyPaste(blank(), '\n\n', null, ROSTER, MAX)).toBeNull()
  })
})

describe('итоги', () => {
  // Макет: seed «Никитина Полина».
  const nikitina = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 2, 2, 2, 3, 2]
  const g = gridFromPoints([nikitina], MAX)

  it('по частям: первая 1–12, вторая 13–19', () => {
    expect(rowTotals(g[0], MAX, P1_END)).toEqual({ p1: 12, p2: 16, primary: 28, test: 28 })
  })
  it('граница частей сдвигается', () => {
    expect(rowTotals(g[0], MAX, 13)).toMatchObject({ p1: 14, p2: 14, primary: 28 })
  })
  it('без таблицы перевода тестовый = первичный', () => {
    expect(toTestScore(28, null)).toBe(28)
    expect(toTestScore(28, [])).toBe(28)
  })
  it('с таблицей перевода — по таблице, индекс = первичный', () => {
    const scale = Array.from({ length: 33 }, (_, k) => Math.min(100, k * 3))
    expect(rowTotals(g[0], MAX, P1_END, scale)!.test).toBe(84)
    expect(toTestScore(0, scale)).toBe(0)
  })
  it('первичный вне таблицы — null, а не выдуманное число', () => {
    expect(toTestScore(40, [0, 5, 10])).toBeNull()
  })
  it('пустая строка — итога нет вовсе, а не ноль', () => {
    expect(rowTotals(blank()[0], MAX, P1_END)).toBeNull()
  })
  it('строка из одних нулей — итог 0: решал и не получил', () => {
    expect(rowTotals(gridFromPoints([MAX.map(() => 0)], MAX)[0], MAX, P1_END)).toEqual({ p1: 0, p2: 0, primary: 0, test: 0 })
  })
  it('одна клетка заполнена — остальные пустые не считаются нулями в «набрано по номеру»', () => {
    const grid = gridFromPoints([[1, ...Array(18).fill(null)], [0, 1, ...Array(17).fill(null)]], MAX)
    const st = taskStats(grid, MAX)
    expect(st[0]).toMatchObject({ count: 2, got: 1, of: 2, pct: 50, level: 1 })
    expect(st[1]).toMatchObject({ count: 1, got: 1, pct: 100, level: 3 })
    expect(st[2]).toMatchObject({ count: 0, pct: null, level: null })
  })
  it('«не число» в сумму не идёт, «выше максимума» — урезан до максимума (как в макете)', () => {
    const r = [parseCell('x', 1), parseCell('9', 1), ...Array(17).fill(parseCell('', 1))]
    expect(rowTotals(r, MAX, P1_END)).toMatchObject({ p1: 1, primary: 1 })
  })
  it('ступени подсветки: <40, 40–60, 60–80, ≥80', () => {
    expect([0, 39, 40, 59, 60, 79, 80, 100].map(heatLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  })
  it('средние — по тем, у кого итог есть', () => {
    expect(averageTotals([null, { p1: 10, p2: 4, primary: 14, test: 14 }, { p1: 12, p2: 8, primary: 20, test: null }]))
      .toEqual({ p1: 11, p2: 6, primary: 17, test: 14 })
    expect(averageTotals([null, null])).toBeNull()
  })
  it('в базу уходит null за пустую клетку и число за ноль', () => {
    expect(gridToPoints(gridFromPoints([[0, null, 1]], [1, 1, 1]))).toEqual([[0, null, 1]])
  })
})

describe('таблица перевода из Excel', () => {
  const maxPrimary = 3
  it('один столбец: строка = первичный 0, 1, 2, …', () => {
    expect(parseScale('0\n27\n33\n39\n', maxPrimary)).toEqual({ scale: [0, 27, 33, 39], error: null })
  })
  it('два столбца «первичный ⇥ тестовый» и заголовок', () => {
    expect(parseScale('Первичный\tТестовый\n0\t0\n1\t6\n2\t11\n3\t17', maxPrimary)).toEqual({ scale: [0, 6, 11, 17], error: null })
  })
  it('строк не столько, сколько первичных баллов + 1 — ошибка словами', () => {
    expect(parseScale('0\n6\n11', maxPrimary).error).toMatch(/Строк 3, а нужно 4/)
  })
  it('убывающая таблица — ошибка', () => {
    expect(checkScale([0, 10, 5, 20], maxPrimary)).toMatch(/убывать/)
  })
  it('пропуск первичного балла в двух столбцах — ошибка', () => {
    expect(parseScale('0\t0\n2\t11\n3\t17\n4\t20', maxPrimary).error).toMatch(/ожидался 1/)
  })
  it('не число — ошибка', () => {
    expect(parseScale('0\nабв\n2\n3', maxPrimary).error).toMatch(/не целое/)
  })
})

describe('уведомления — только если итог появился или изменился', () => {
  it('новый итог — шлём, тот же — нет, изменился — шлём, стёрт — нет', () => {
    expect(totalsToNotify([
      { student_id: 'a', old_score: null, score: 14 },
      { student_id: 'b', old_score: 20, score: 20 },
      { student_id: 'c', old_score: 20, score: 21 },
      { student_id: 'd', old_score: 20, score: null },
      { student_id: 'e', old_score: null, score: null },
    ])).toEqual([{ student_id: 'a', score: 14 }, { student_id: 'c', score: 21 }])
  })
  it('итог 0 — тоже итог', () => {
    expect(totalsToNotify([{ student_id: 'a', old_score: null, score: 0 }])).toEqual([{ student_id: 'a', score: 0 }])
  })
})
