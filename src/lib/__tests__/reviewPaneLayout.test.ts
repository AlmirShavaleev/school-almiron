import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SOLUTION_FRACTION,
  MAX_SOLUTION_FRACTION,
  MIN_SOLUTION_FRACTION,
  SOLUTION_FRACTION_STORAGE_KEY,
  SPLIT_MIN_WIDTH,
  clampSolutionFraction,
  fractionFromPointer,
  fractionToPercent,
  readSolutionFraction,
  writeSolutionFraction,
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
