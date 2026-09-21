/**
 * §211. Пересчёт рамок при повороте страницы.
 *
 * Это самое опасное место карточки board/062: пометки преподавателя лежат в
 * долях страницы, и поворот, который не пересчитал их, разом уводит всю его
 * работу — восстановить её нечем. Поэтому тесты здесь на числа, а не на
 * «функция что-то вернула».
 */
import { describe, expect, it } from 'vitest'
import {
  QUARTER_TURNS,
  nextQuarter,
  normalizeQuarter,
  rotateRatio,
  rotateRect,
  rotationDegrees,
  unrotateRect,
} from '../pageRotation'

/** Рамка в левой верхней четверти: у неё все четыре числа разные. */
const RECT = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }

/**
 * Сравнение рамок с допуском: `1 − 0.2 − 0.4` в double даёт
 * 0.4000000000000001, и ждать от десятичных дробей точного равенства тут
 * бессмысленно. Точное равенство проверяется отдельно — там, где оно
 * действительно обещано: на четырёх поворотах подряд.
 */
function expectRect(actual: { x: number; y: number; w: number; h: number }, expected: { x: number; y: number; w: number; h: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 12)
  expect(actual.y).toBeCloseTo(expected.y, 12)
  expect(actual.w).toBeCloseTo(expected.w, 12)
  expect(actual.h).toBeCloseTo(expected.h, 12)
}

describe('поворот рамки', () => {
  it('90° — верхний левый угол уезжает в правый верхний', () => {
    // Левый край (x = 0.1) становится верхним; нижний край (y+h = 0.6)
    // становится левым, считая справа: 1 − 0.6 = 0.4.
    expectRect(rotateRect(RECT, 1), { x: 0.4, y: 0.1, w: 0.4, h: 0.3 })
  })

  it('180° — рамка зеркалится по обеим осям, стороны не меняются', () => {
    expectRect(rotateRect(RECT, 2), { x: 0.6, y: 0.4, w: 0.3, h: 0.4 })
  })

  it('270° — тот же разворот в другую сторону', () => {
    expectRect(rotateRect(RECT, 3), { x: 0.2, y: 0.6, w: 0.4, h: 0.3 })
  })

  it('на 90° и 270° ширина и высота меняются местами', () => {
    expect(rotateRect(RECT, 1).w).toBe(RECT.h)
    expect(rotateRect(RECT, 1).h).toBe(RECT.w)
    expect(rotateRect(RECT, 3).w).toBe(RECT.h)
    expect(rotateRect(RECT, 3).h).toBe(RECT.w)
  })

  it('рамка не вылезает за страницу ни при одном повороте', () => {
    for (let quarter = 0; quarter < QUARTER_TURNS; quarter += 1) {
      const out = rotateRect(RECT, quarter)
      expect(out.x).toBeGreaterThanOrEqual(0)
      expect(out.y).toBeGreaterThanOrEqual(0)
      expect(out.x + out.w).toBeLessThanOrEqual(1)
      expect(out.y + out.h).toBeLessThanOrEqual(1)
    }
  })

  it('ЧЕТЫРЕ ПОВОРОТА ПОДРЯД дают ровно исходные числа', () => {
    // Побайтово, а не «примерно»: доворот туда-обратно не имеет права
    // сдвинуть пометку даже на 1e-17 — иначе за неделю проверок рамки
    // расползутся, и виноватого будет не найти.
    const rects = [
      RECT,
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0.0137, y: 0.9001, w: 0.0862, h: 0.0999 },
      { x: 1 / 3, y: 1 / 7, w: 0.1, h: 0.30000000000000004 },
    ]
    for (const rect of rects) {
      let quarter = 0
      for (let press = 0; press < QUARTER_TURNS; press += 1) quarter = nextQuarter(quarter)
      expect(quarter).toBe(0)
      const out = rotateRect(rect, quarter)
      expect(out.x).toBe(rect.x)
      expect(out.y).toBe(rect.y)
      expect(out.w).toBe(rect.w)
      expect(out.h).toBe(rect.h)
      expect(Object.is(out.x, rect.x)).toBe(true)
    }
  })

  it('обратный перевод возвращает рамку на место', () => {
    for (let quarter = 0; quarter < QUARTER_TURNS; quarter += 1) {
      const back = unrotateRect(rotateRect(RECT, quarter), quarter)
      expect(back.x).toBeCloseTo(RECT.x, 12)
      expect(back.y).toBeCloseTo(RECT.y, 12)
      expect(back.w).toBeCloseTo(RECT.w, 12)
      expect(back.h).toBeCloseTo(RECT.h, 12)
    }
  })

  it('исходную рамку функция не трогает', () => {
    const rect = { ...RECT }
    rotateRect(rect, 1)
    unrotateRect(rect, 2)
    expect(rect).toEqual(RECT)
  })
})

describe('угол страницы', () => {
  it('кнопка крутит по часовой и замыкается на четвёртом нажатии', () => {
    expect([0, 1, 2, 3].map(nextQuarter)).toEqual([1, 2, 3, 0])
  })

  it('мусор из jsonb читается как «не повёрнуто»', () => {
    for (const value of [undefined, null, NaN, 'боком', {}, Infinity]) {
      expect(normalizeQuarter(value)).toBe(0)
    }
    // Чужой клиент мог записать угол в градусах или «накрутить» лишнего —
    // и то и другое обязано читаться, а не ронять разбор.
    expect(normalizeQuarter(5)).toBe(1)
    expect(normalizeQuarter(-1)).toBe(3)
    expect(normalizeQuarter('2')).toBe(2)
  })

  it('градусы — для pdf.js и CSS', () => {
    expect([0, 1, 2, 3].map(rotationDegrees)).toEqual([0, 90, 180, 270])
  })
})

describe('отношение сторон повёрнутой страницы', () => {
  it('на 90° и 270° лист ложится набок', () => {
    const a4 = 595 / 842
    expect(rotateRatio(a4, 0)).toBe(a4)
    expect(rotateRatio(a4, 1)).toBeCloseTo(842 / 595, 12)
    expect(rotateRatio(a4, 2)).toBe(a4)
    expect(rotateRatio(a4, 3)).toBeCloseTo(842 / 595, 12)
  })

  it('неизвестный размер страницы не превращается в бесконечность', () => {
    expect(rotateRatio(0, 1)).toBe(0)
    expect(Number.isNaN(rotateRatio(NaN, 1))).toBe(true)
  })
})
