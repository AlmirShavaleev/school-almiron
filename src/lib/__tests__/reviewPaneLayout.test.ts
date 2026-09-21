import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SOLUTION_FRACTION,
  DEFAULT_TABLE_FRACTION,
  MAX_SOLUTION_FRACTION,
  MAX_TABLE_FRACTION,
  MIN_SOLUTION_FRACTION,
  MIN_TABLE_FRACTION,
  MIN_WORK_FRACTION,
  SOLUTION_FRACTION_STORAGE_KEY,
  SPLIT_MIN_WIDTH,
  TABLE_FRACTION_STORAGE_KEY,
  clampSolutionFraction,
  clampTableFraction,
  fractionFromPointer,
  fractionToPercent,
  readSolutionFraction,
  readTableFraction,
  solutionShareOf,
  tableFractionFromPointer,
  writeSolutionFraction,
  writeTableFraction,
} from '../reviewPaneLayout'

/**
 * §140. Панель «Решение задания» была фиксированной (384 px) и на широком
 * экране оставалась щелью. Здесь проверяется арифметика доли: её видно
 * тестом, а не только глазами на скриншоте.
 */

describe('умолчание и границы', () => {
  it('по умолчанию 40 % — требование владельца', () => {
    expect(DEFAULT_SOLUTION_FRACTION).toBe(0.4)
  })

  it('уже 25 % и шире 60 % не пускаем', () => {
    expect(clampSolutionFraction(0.05)).toBe(MIN_SOLUTION_FRACTION)
    expect(clampSolutionFraction(0.95)).toBe(MAX_SOLUTION_FRACTION)
    expect(clampSolutionFraction(0.45)).toBe(0.45)
  })

  it('мусор вместо числа даёт умолчание, а не NaN в стилях', () => {
    expect(clampSolutionFraction(Number.NaN)).toBe(DEFAULT_SOLUTION_FRACTION)
  })

  it('доля превращается в проценты для CSS', () => {
    expect(fractionToPercent(0.4)).toBe('40.0%')
    expect(fractionToPercent(0.9)).toBe('60.0%')
  })

  it('доля включается только с 1536', () => {
    // На 1366 три колонки не помещаются: 40 % оставили бы документу ~436 px.
    // Там панель остаётся фиксированной, и это осознанный порог, а не круглое
    // число «на глаз».
    expect(SPLIT_MIN_WIDTH).toBe(1536)
    const laptop = 1366
    expect(laptop).toBeLessThan(SPLIT_MIN_WIDTH)
  })
})

describe('перетаскивание границы', () => {
  const rect = { left: 100, width: 1000 }

  it('курсор посередине даёт половину', () => {
    expect(fractionFromPointer(600, rect)).toBe(0.5)
  })

  it('утянутая влево граница упирается в минимум', () => {
    expect(fractionFromPointer(120, rect)).toBe(MIN_SOLUTION_FRACTION)
  })

  it('утянутая вправо — в максимум', () => {
    expect(fractionFromPointer(1090, rect)).toBe(MAX_SOLUTION_FRACTION)
  })

  it('нулевая ширина области не даёт деления на ноль', () => {
    expect(fractionFromPointer(500, { left: 0, width: 0 })).toBe(DEFAULT_SOLUTION_FRACTION)
  })
})

describe('запоминание ширины', () => {
  it('читает сохранённое и пишет обратно', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    }

    writeSolutionFraction(0.52, storage)
    expect(store.get(SOLUTION_FRACTION_STORAGE_KEY)).toBe('0.52')
    expect(readSolutionFraction(storage)).toBe(0.52)
  })

  it('сохранённое за границами подрезается при чтении', () => {
    const storage = { getItem: () => '0.95' }
    expect(readSolutionFraction(storage)).toBe(MAX_SOLUTION_FRACTION)
  })

  it('пустое хранилище — умолчание', () => {
    expect(readSolutionFraction({ getItem: () => null })).toBe(DEFAULT_SOLUTION_FRACTION)
  })

  it('запрет на хранилище не роняет разбор работы', () => {
    // Приватное окно и «блокировать данные сайтов» — обычное дело; ширина
    // панели не стоит того, чтобы из-за неё падал экран проверки.
    const angry = {
      getItem: vi.fn(() => { throw new Error('denied') }),
      setItem: vi.fn(() => { throw new Error('denied') }),
    }
    expect(readSolutionFraction(angry)).toBe(DEFAULT_SOLUTION_FRACTION)
    expect(() => writeSolutionFraction(0.5, angry)).not.toThrow()
  })
})

/* ─── §210. Вторая граница: работа | таблица проверки ─────────────────────── */

describe('ширина таблицы проверки', () => {
  it('умолчание 37 % — из деления 26/37/37 на 1280', () => {
    expect(DEFAULT_TABLE_FRACTION).toBe(0.37)
  })

  it('уже 22 % и шире 50 % не пускаем', () => {
    expect(clampTableFraction(0.05)).toBe(MIN_TABLE_FRACTION)
    expect(clampTableFraction(0.95)).toBe(MAX_TABLE_FRACTION)
    expect(clampTableFraction(0.3)).toBe(0.3)
  })

  it('работе всегда остаётся её минимум — колонку не схлопнуть в ноль', () => {
    // Решение на 50 %: таблице дальше 30 % ходу нет, иначе работа схлопнется
    // и рамки ставить станет некуда.
    expect(clampTableFraction(0.5, 0.5)).toBe(1 - 0.5 - MIN_WORK_FRACTION)
    expect(clampTableFraction(0.5, 0.4)).toBeCloseTo(0.4, 5)
  })

  it('при самом широком решении таблица упирается в свой минимум, а не в минус', () => {
    // Решение 60 % + таблица 22 % + работа 20 % в сумме больше единицы — это
    // единственный случай, когда минимум работы приходится подвинуть. Выбор
    // сделан в пользу читаемой таблицы: ширину решения человек задал сам и
    // сам же её уберёт, а колонка, ушедшая в минус, исчезла бы молча.
    expect(clampTableFraction(0.4, 0.6)).toBe(MIN_TABLE_FRACTION)
    expect(clampTableFraction(0.4, 0.9)).toBe(MIN_TABLE_FRACTION)
  })

  it('мусор вместо числа даёт умолчание', () => {
    expect(clampTableFraction(Number.NaN)).toBe(DEFAULT_TABLE_FRACTION)
  })

  it('доля считается от правого края — там и стоит колонка', () => {
    const rect = { left: 0, width: 1000 }
    expect(tableFractionFromPointer(700, rect)).toBe(0.3)
    expect(tableFractionFromPointer(950, rect)).toBe(MIN_TABLE_FRACTION)
    expect(tableFractionFromPointer(100, rect)).toBe(MAX_TABLE_FRACTION)
  })

  it('нулевая ширина области не даёт деления на ноль', () => {
    expect(tableFractionFromPointer(500, { left: 0, width: 0 })).toBe(DEFAULT_TABLE_FRACTION)
  })

  it('своё хранилище, отдельное от решения', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    }

    writeTableFraction(0.3, storage)
    writeSolutionFraction(0.5, storage)

    expect(store.get(TABLE_FRACTION_STORAGE_KEY)).toBe('0.3')
    expect(store.get(SOLUTION_FRACTION_STORAGE_KEY)).toBe('0.5')
    expect(readTableFraction(storage)).toBe(0.3)
    expect(readSolutionFraction(storage)).toBe(0.5)
  })

  it('запрет на хранилище не роняет разбор работы', () => {
    const angry = {
      getItem: vi.fn(() => { throw new Error('denied') }),
      setItem: vi.fn(() => { throw new Error('denied') }),
    }
    expect(readTableFraction(angry)).toBe(DEFAULT_TABLE_FRACTION)
    expect(() => writeTableFraction(0.3, angry)).not.toThrow()
  })
})

describe('сколько занимает решение прямо сейчас', () => {
  it('выключено — ноль, и таблице доступна вся ширина', () => {
    expect(solutionShareOf({ shown: false, fraction: 0.4, chosen: true, areaWidth: 1280 })).toBe(0)
  })

  it('на ноутбуке и нетронутой границе панель фиксированная, а не 40 %', () => {
    // §140/§208: между 1024 и 1536 это 20rem. Считать её по доле значило бы
    // запрещать таблице ширину, которая на экране свободна.
    expect(solutionShareOf({ shown: true, fraction: 0.4, chosen: false, areaWidth: 1280 }))
      .toBeCloseTo(320 / 1280, 5)
  })

  it('границу двигали — действует выбор человека', () => {
    expect(solutionShareOf({ shown: true, fraction: 0.5, chosen: true, areaWidth: 1280 })).toBe(0.5)
  })

  it('с 1536 доля действует и без правки границы', () => {
    expect(solutionShareOf({ shown: true, fraction: 0.4, chosen: false, areaWidth: SPLIT_MIN_WIDTH })).toBe(0.4)
  })
})
