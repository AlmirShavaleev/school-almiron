import { describe, expect, it } from 'vitest'
import {
  countDuplicateFrames,
  duplicateFrameIds,
  isAiFrame,
  rectsNearlyEqual,
  replaceAiFrames,
  withoutDuplicateFrames,
  type FrameObject,
} from '@/lib/aiFrames'

/**
 * §207. Правила повторного переноса рамок.
 *
 * Главное здесь одно: рамку, нарисованную преподавателем, потерять нельзя ни
 * при каких условиях — её никто не восстановит. Поэтому почти каждый тест
 * ниже проверяет не только «дубль убрался», но и «ручное осталось».
 */

const rect = (x: number, y: number) => ({ x, y, w: 0.2, h: 0.1 })

const ai = (id: string, finding: string, over: Partial<FrameObject> = {}): FrameObject => ({
  id,
  type: 'region',
  rect: rect(0.1, 0.2),
  text: 'Вычислительная ошибка',
  source: { kind: 'ai', finding, job: 'j1' },
  ...over,
})

const hand = (id: string, over: Partial<FrameObject> = {}): FrameObject => ({
  id,
  type: 'region',
  rect: rect(0.5, 0.5),
  text: 'Перепиши решение полностью',
  ...over,
})

describe('isAiFrame', () => {
  it('помеченная рамка — наша, ручная — нет', () => {
    expect(isAiFrame(ai('a1', 'f1'))).toBe(true)
    expect(isAiFrame(hand('h1'))).toBe(false)
  })

  it('пометка на не-рамке ничего не значит', () => {
    expect(isAiFrame({ id: 's1', type: 'stroke', source: { kind: 'ai', finding: 'f1' } })).toBe(false)
  })

  it('рамка без пометки (перенос до §207) считается чужой — трогать нельзя', () => {
    expect(isAiFrame({ id: 'old', type: 'region', rect: rect(0, 0), text: 'Знак' })).toBe(false)
  })
})

describe('replaceAiFrames — повторный перенос', () => {
  it('второй перенос не добавляет слой: было 3 своих, стало 3 новых', () => {
    const before = [ai('a1', 'f1'), ai('a2', 'f2'), ai('a3', 'f3')]
    const after = replaceAiFrames(before, [ai('b1', 'f1'), ai('b2', 'f2'), ai('b3', 'f3')])
    expect(after.map(m => m.id)).toEqual(['b1', 'b2', 'b3'])
  })

  it('ручные рамки остаются на месте и в прежнем порядке', () => {
    const before = [hand('h1'), ai('a1', 'f1'), hand('h2'), ai('a2', 'f2')]
    const after = replaceAiFrames(before, [ai('b1', 'f1')])
    expect(after.map(m => m.id)).toEqual(['h1', 'h2', 'b1'])
  })

  it('находок в новом прогоне нет — свои убираются, ручные целы', () => {
    const after = replaceAiFrames([hand('h1'), ai('a1', 'f1')], [])
    expect(after.map(m => m.id)).toEqual(['h1'])
  })

  it('легаси-штрихи и подписи перенос не трогает', () => {
    const marks: FrameObject[] = [
      { id: 's1', type: 'stroke' },
      { id: 't1', type: 'text', text: 'см. поля' },
      ai('a1', 'f1'),
    ]
    expect(replaceAiFrames(marks, []).map(m => m.id)).toEqual(['s1', 't1'])
  })
})

describe('rectsNearlyEqual', () => {
  it('разница в третьем знаке — то же место', () => {
    expect(rectsNearlyEqual({ x: 0.1, y: 0.2, w: 0.2, h: 0.1 }, { x: 0.104, y: 0.198, w: 0.2, h: 0.1 })).toBe(true)
  })

  it('сдвиг на пятую часть страницы — другое место', () => {
    expect(rectsNearlyEqual({ x: 0.1, y: 0.2, w: 0.2, h: 0.1 }, { x: 0.3, y: 0.2, w: 0.2, h: 0.1 })).toBe(false)
  })

  it('прямоугольника нет — не совпадение, а не падение', () => {
    expect(rectsNearlyEqual(undefined, { x: 0, y: 0, w: 1, h: 1 })).toBe(false)
  })
})

describe('duplicateFrameIds — точные повторы', () => {
  it('три одинаковых — два повтора, первый остаётся', () => {
    const page = [
      { id: 'd1', type: 'region', rect: rect(0.1, 0.2), text: 'Вычислительная ошибка' },
      { id: 'd2', type: 'region', rect: rect(0.103, 0.2), text: 'Вычислительная ошибка' },
      { id: 'd3', type: 'region', rect: rect(0.1, 0.204), text: 'Вычислительная ошибка' },
    ]
    expect(duplicateFrameIds(page)).toEqual(['d2', 'd3'])
    expect(withoutDuplicateFrames(page).map(m => m.id)).toEqual(['d1'])
  })

  it('тот же текст в другом месте — не повтор: это два разных замечания', () => {
    const page = [
      { id: 'a', type: 'region', rect: rect(0.1, 0.1), text: 'Знак ускорения' },
      { id: 'b', type: 'region', rect: rect(0.1, 0.6), text: 'Знак ускорения' },
    ]
    expect(duplicateFrameIds(page)).toEqual([])
  })

  it('то же место, но другой текст — не повтор', () => {
    const page = [
      { id: 'a', type: 'region', rect: rect(0.1, 0.1), text: 'Знак ускорения' },
      { id: 'b', type: 'region', rect: rect(0.1, 0.1), text: 'Нет единиц измерения' },
    ]
    expect(duplicateFrameIds(page)).toEqual([])
  })

  it('две безымянные рамки рядом — обычная разметка, а не дубль', () => {
    const page = [
      { id: 'a', type: 'region', rect: rect(0.1, 0.1), text: '' },
      { id: 'b', type: 'region', rect: rect(0.1, 0.1), text: '   ' },
    ]
    expect(duplicateFrameIds(page)).toEqual([])
  })

  it('повтор ручной рамки убирается тоже — но только один экземпляр из пары', () => {
    // Дубли, накопленные прежними переносами, пометки источника не имеют:
    // отличить их от ручных нечем. Поэтому правило одно на всех, и оно всегда
    // оставляет одну рамку из группы.
    const page = [hand('h1'), hand('h2'), ai('a1', 'f1')]
    expect(withoutDuplicateFrames(page).map(m => m.id)).toEqual(['h1', 'a1'])
  })
})

describe('countDuplicateFrames — число для кнопки', () => {
  it('считает по всем страницам', () => {
    const pages = {
      'f::1': { objects: [hand('h1'), hand('h2')] },
      'f::2': { objects: [ai('a1', 'f1'), ai('a2', 'f1'), ai('a3', 'f1')] },
      'f::3': { objects: [hand('h9')] },
    }
    expect(countDuplicateFrames(pages)).toBe(3)
  })

  it('повторов нет — ноль, и кнопке не за что показаться', () => {
    expect(countDuplicateFrames({ 'f::1': { objects: [hand('h1'), ai('a1', 'f1')] } })).toBe(0)
    expect(countDuplicateFrames({})).toBe(0)
  })
})
