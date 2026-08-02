import { describe, expect, it } from 'vitest'
import { HANDLE_CURSOR, moveRect, rectsEqual, resizeRect } from '@/lib/annotationGeometry'

const MIN = 0.015
const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 }

describe('перенос рамки', () => {
  it('сдвигает на дельту, не меняя размер', () => {
    const rect = moveRect(box, 0.05, -0.1)
    expect(rect.x).toBeCloseTo(0.25, 10)
    expect(rect.y).toBeCloseTo(0.2, 10)
    expect(rect.w).toBe(0.4)
    expect(rect.h).toBe(0.2)
  })

  it('у края страницы упирается целиком, а не сплющивается', () => {
    const pushedRight = moveRect(box, 0.9, 0)
    expect(pushedRight.x).toBeCloseTo(0.6, 10)
    expect(pushedRight.w).toBe(0.4)
    expect(pushedRight.x + pushedRight.w).toBeCloseTo(1, 10)

    const pushedUp = moveRect(box, 0, -0.9)
    expect(pushedUp.y).toBe(0)
    expect(pushedUp.h).toBe(0.2)
  })

  it('не выходит за левый и верхний край', () => {
    const rect = moveRect(box, -5, -5)
    expect(rect).toEqual({ x: 0, y: 0, w: 0.4, h: 0.2 })
  })
})

describe('растягивание за ручку', () => {
  it('двигает только те стороны, которых касается ручка', () => {
    const east = resizeRect(box, 'e', 0.1, 0.1, MIN)
    expect(east.x).toBe(0.2)
    expect(east.y).toBe(0.3)
    expect(east.w).toBeCloseTo(0.5, 10)
    expect(east.h).toBeCloseTo(0.2, 10)

    const north = resizeRect(box, 'n', 0.1, -0.1, MIN)
    expect(north.y).toBeCloseTo(0.2, 10)
    expect(north.h).toBeCloseTo(0.3, 10)
    expect(north.x).toBe(0.2)
    expect(north.w).toBeCloseTo(0.4, 10)
  })

  it('угловая ручка двигает обе свои стороны, противоположный угол стоит', () => {
    const rect = resizeRect(box, 'sw', -0.1, 0.05, MIN)
    expect(rect.x).toBeCloseTo(0.1, 10)
    expect(rect.y).toBe(0.3)
    expect(rect.x + rect.w).toBeCloseTo(0.6, 10)
    expect(rect.y + rect.h).toBeCloseTo(0.55, 10)
  })

  it('не схлопывает рамку меньше минимума', () => {
    const rect = resizeRect(box, 'e', -1, 0, MIN)
    expect(rect.w).toBeCloseTo(MIN, 10)
    expect(rect.x).toBe(0.2)
  })

  it('не выпускает сторону за пределы страницы', () => {
    expect(resizeRect(box, 'e', 5, 0, MIN).x + resizeRect(box, 'e', 5, 0, MIN).w).toBe(1)
    expect(resizeRect(box, 'w', -5, 0, MIN).x).toBe(0)
    expect(resizeRect(box, 's', 5, 5, MIN).y + resizeRect(box, 's', 5, 5, MIN).h).toBe(1)
  })
})

describe('сравнение рамок', () => {
  it('дрожание указателя правкой не считается', () => {
    expect(rectsEqual(box, { ...box, x: box.x + 1e-9 })).toBe(true)
    expect(rectsEqual(box, { ...box, x: box.x + 0.001 })).toBe(false)
  })
})

describe('курсоры ручек', () => {
  it('противоположные ручки одной диагонали показывают один курсор', () => {
    expect(HANDLE_CURSOR.nw).toBe(HANDLE_CURSOR.se)
    expect(HANDLE_CURSOR.ne).toBe(HANDLE_CURSOR.sw)
    expect(HANDLE_CURSOR.n).toBe(HANDLE_CURSOR.s)
    expect(HANDLE_CURSOR.e).toBe(HANDLE_CURSOR.w)
  })
})
