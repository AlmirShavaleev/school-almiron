import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { edgeMask, scrollEdges, useScrollEdges } from '@/hooks/useScrollEdges'

/**
 * §265. Вкладки курса на телефоне: край, за которым есть ещё вкладки, тает.
 * Нет переполнения — нет и маски (на 1280 полоса как была).
 */
describe('§265. края прокручиваемой полосы', () => {
  it('всё помещается — краёв нет, маски нет', () => {
    const e = scrollEdges({ scrollLeft: 0, scrollWidth: 800, clientWidth: 800 })
    expect(e).toEqual({ left: false, right: false })
    expect(edgeMask(e)).toBeUndefined()
  })

  it('в начале — тает только правый край; в середине — оба; в конце — только левый', () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 900, clientWidth: 358 })).toEqual({ left: false, right: true })
    expect(scrollEdges({ scrollLeft: 200, scrollWidth: 900, clientWidth: 358 })).toEqual({ left: true, right: true })
    expect(scrollEdges({ scrollLeft: 542, scrollWidth: 900, clientWidth: 358 })).toEqual({ left: true, right: false })
    // дробный scrollLeft у самого края (HiDPI) — край не мигает
    expect(scrollEdges({ scrollLeft: 541.4, scrollWidth: 900, clientWidth: 358 }).right).toBe(false)
  })

  it('маска: прозрачна у тающего края, сплошная у остальных', () => {
    expect(edgeMask({ left: false, right: true })).toBe('linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%)')
    expect(edgeMask({ left: true, right: false })).toBe('linear-gradient(to right, transparent 0, #000 28px, #000 100%)')
  })

  function Strip() {
    const ref = useRef<HTMLDivElement>(null)
    const edges = useScrollEdges(ref)
    return <div ref={ref} data-testid="strip" data-left={String(edges.left)} data-right={String(edges.right)} />
  }

  it('хук следит за прокруткой полосы', () => {
    render(<Strip />)
    const el = screen.getByTestId('strip')
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 900 })
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 358 })
    act(() => { el.scrollLeft = 0; el.dispatchEvent(new Event('scroll')) })
    expect(el.dataset.right).toBe('true')
    expect(el.dataset.left).toBe('false')
    act(() => { el.scrollLeft = 542; el.dispatchEvent(new Event('scroll')) })
    expect(el.dataset.right).toBe('false')
    expect(el.dataset.left).toBe('true')
  })
})
