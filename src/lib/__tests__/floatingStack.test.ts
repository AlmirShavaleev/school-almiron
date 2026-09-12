import { describe, expect, it, beforeEach } from 'vitest'
import { FAB_SLOT, dodgeSideFor, syncFloatingStackSide } from '@/lib/floatingStack'

/**
 * Стек правого нижнего угла (board/007). Пиксели в jsdom условны, поэтому
 * проверяется то, что задаёт раскладку: разные слоты у разных элементов и
 * переключатель ухода от плеера.
 */

const VIEWPORT = { width: 1280, height: 800 }

describe('FAB_SLOT', () => {
  it('каждому элементу — свой слот, ни одного повтора', () => {
    const slots = [FAB_SLOT.help, FAB_SLOT.cart, FAB_SLOT.toast]
    expect(new Set(slots).size).toBe(slots.length)
  })

  it('кнопка помощи внизу, подборка над ней, плашка выше подборки', () => {
    expect(FAB_SLOT.help).toContain('fab-slot-0')
    expect(FAB_SLOT.cart).toContain('fab-slot-1')
    expect(FAB_SLOT.toast).toContain('fab-slot-2')
  })

  it('координаты берутся из общего класса, а не из отступов на месте', () => {
    for (const slot of [FAB_SLOT.help, FAB_SLOT.cart, FAB_SLOT.toast]) {
      expect(slot).toContain('fab-slot ')
      expect(slot).not.toMatch(/bottom-\d|right-\d/)
    }
  })

  it('панель помощи остаётся выше подборки по z-index', () => {
    // Панель в SupportWidget живёт на z-50, подборка — на z-40.
    expect(FAB_SLOT.cart).toContain('z-40')
  })
})

describe('dodgeSideFor', () => {
  it('пустой угол — стек остаётся справа', () => {
    expect(dodgeSideFor([], VIEWPORT)).toBeNull()
  })

  it('плеер в правом нижнем углу — стек уходит влево', () => {
    const player = { left: 400, right: 1240, top: 300, bottom: 760 }
    expect(dodgeSideFor([player], VIEWPORT)).toBe('left')
  })

  it('плеер выше зоны стека — не мешает', () => {
    const player = { left: 400, right: 1240, top: 60, bottom: 420 }
    expect(dodgeSideFor([player], VIEWPORT)).toBeNull()
  })

  it('плеер левее зоны стека — не мешает', () => {
    const player = { left: 40, right: 600, top: 300, bottom: 760 }
    expect(dodgeSideFor([player], VIEWPORT)).toBeNull()
  })
})

describe('syncFloatingStackSide', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    delete document.documentElement.dataset.fabSide
  })

  function addPlayer(rect: { left: number; right: number; top: number; bottom: number }) {
    const frame = document.createElement('iframe')
    frame.setAttribute('allowfullscreen', '')
    frame.getBoundingClientRect = () => ({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left, y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect
    document.body.appendChild(frame)
    return frame
  }

  it('ставит и снимает пометку стороны по мере появления плеера', () => {
    expect(syncFloatingStackSide()).toBeNull()
    expect(document.documentElement.dataset.fabSide).toBeUndefined()

    const player = addPlayer({
      left: 100,
      right: window.innerWidth - 10,
      top: window.innerHeight - 300,
      bottom: window.innerHeight - 10,
    })
    expect(syncFloatingStackSide()).toBe('left')
    expect(document.documentElement.dataset.fabSide).toBe('left')

    player.remove()
    expect(syncFloatingStackSide()).toBeNull()
    expect(document.documentElement.dataset.fabSide).toBeUndefined()
  })

  it('свёрнутый в ноль элемент за препятствие не считается', () => {
    addPlayer({ left: 0, right: 0, top: 0, bottom: 0 })
    expect(syncFloatingStackSide()).toBeNull()
  })
})
